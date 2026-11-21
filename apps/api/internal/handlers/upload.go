package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/imaging"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
	"lumina-imagehost/internal/storage"
	"lumina-imagehost/internal/worker"
)

func (s *Server) resolveUploadRoleAndQuota(ctx context.Context, p *middleware.AuthPrincipal) (role string, policy *models.RolePolicy, quota int64, used int64, err error) {
	if p == nil {
		general := s.getSiteSetting(ctx, "general")
		allowGuest, _ := general["allow_guest_upload"].(bool)
		if !allowGuest {
			return "", nil, 0, 0, errors.New("未登录用户不允许上传，请先登录或联系管理员开启游客上传")
		}
		pol, err := s.getRolePolicy(ctx, "guest")
		if err != nil {
			return "", nil, 0, 0, err
		}
		return "guest", pol, pol.StorageQuotaBytes, 0, nil
	}
	if !p.HasScope("upload") {
		return "", nil, 0, 0, errors.New("API Token 缺少 upload 权限作用域")
	}
	pol, err := s.getRolePolicy(ctx, p.Role)
	if err != nil {
		return "", nil, 0, 0, err
	}
	var override *int64
	err = s.Pool.QueryRow(ctx, `SELECT storage_quota_override, storage_used_bytes FROM users WHERE id = $1`, p.UserID).Scan(&override, &used)
	if err != nil {
		return "", nil, 0, 0, err
	}
	quota = pol.StorageQuotaBytes
	if override != nil {
		quota = *override
	}
	var monthlyLimit int
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(monthly_upload_limit, 0) FROM role_policies WHERE role = $1`, p.Role).Scan(&monthlyLimit)
	if monthlyLimit > 0 {
		var monthlyCount int
		_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM user_assets WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())`, p.UserID).Scan(&monthlyCount)
		if monthlyCount >= monthlyLimit {
			return "", nil, 0, 0, fmt.Errorf("已达到当前角色本月上传次数上限 (%d 次)", monthlyLimit)
		}
	}
	return p.Role, pol, quota, used, nil
}

// UploadPrecheck handles SHA-256 instant dedup ("秒传") OR issues a Presigned Direct Upload URL (R2 or Local NVMe).
func (s *Server) UploadPrecheck(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	role, policy, quota, used, err := s.resolveUploadRoleAndQuota(r.Context(), p)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		SHA256       string `json:"sha256"`
		Filename     string `json:"filename"`
		MimeType     string `json:"mime_type"`
		SizeBytes    int64  `json:"size_bytes"`
		Engine       string `json:"engine"` // smart, local, r2
		AlbumID      *int64 `json:"album_id"`
		Visibility   string `json:"visibility"`
		Password     string `json:"password"`
		ExpireHours  int    `json:"expire_hours"`
		StripGPS     bool   `json:"strip_gps"`
		CustomAlias  string `json:"custom_alias"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json payload")
		return
	}
	req.SHA256 = strings.ToLower(strings.TrimSpace(req.SHA256))
	if len(req.SHA256) != 64 || req.SizeBytes <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的 SHA-256 哈希或文件体积")
		return
	}
	if req.SizeBytes > policy.MaxFileSizeBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("单文件超过当前角色组上限 (%d MB)", policy.MaxFileSizeBytes/1024/1024))
		return
	}
	if !containsStr(policy.AllowedMimes, req.MimeType) {
		writeErr(w, http.StatusUnsupportedMediaType, "不允许的文件格式: "+req.MimeType)
		return
	}
	if p != nil && used+req.SizeBytes > quota {
		writeErr(w, http.StatusInsufficientStorage, "存储配额不足，请清理回收站或联系管理员扩容")
		return
	}

	if req.Visibility == "" {
		req.Visibility = "public"
	}
	var passHash string
	if req.Visibility == "password" && req.Password != "" {
		h, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		passHash = string(h)
	}
	var expiresAt *time.Time
	if req.ExpireHours > 0 {
		t := time.Now().Add(time.Duration(req.ExpireHours) * time.Hour)
		expiresAt = &t
	} else if role == "guest" {
		t := time.Now().Add(24 * time.Hour)
		expiresAt = &t
	}

	// 1. Check global Content-Addressable Storage (CAS) for SHA-256 hit!
	var objID int64
	var modStatus string
	err = s.Pool.QueryRow(r.Context(), `
		SELECT id, moderation_status FROM storage_objects WHERE sha256 = $1
	`, req.SHA256).Scan(&objID, &modStatus)
	if err == nil {
		if modStatus == "blocked" {
			writeErr(w, http.StatusForbidden, "该图片内容命中全站合规黑名单，禁止上传")
			return
		}
		var uidPtr *int64
		if p != nil {
			uid := p.UserID
			uidPtr = &uid
		}
		asset, err := s.createAssetLinkWithAlias(r.Context(), uidPtr, objID, req.AlbumID, req.Filename, req.Visibility, passHash, expiresAt, req.SizeBytes, req.CustomAlias)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "创建秒传资产记录失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"instant": true,
			"asset":   asset,
		})
		return
	}

	// 2. Miss -> Select storage engine (Local NVMe vs Cloudflare R2) & issue Presigned PUT URL
	requestedEngine := req.Engine
	if requestedEngine == "" || requestedEngine == "auto" {
		requestedEngine = policy.DefaultEngine
	}
	drv, err := s.Router.ResolveEngine(requestedEngine, policy.AllowedEngines, req.SizeBytes)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	uname := "guest"
	if p != nil && p.Username != "" {
		uname = p.Username
	}
	objectKey := storage.BuildObjectKeyForUser(uname, req.SHA256, req.Filename, req.MimeType)
	presigned, err := drv.PresignPut(r.Context(), objectKey, req.MimeType, req.SizeBytes, 15*time.Minute)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "签发直传凭证失败: "+err.Error())
		return
	}

	intentID := uuid.New()
	var uidPtr *int64
	if p != nil {
		uid := p.UserID
		uidPtr = &uid
	}
	_, err = s.Pool.Exec(r.Context(), `
		INSERT INTO upload_intents (id, user_id, sha256, object_key, storage_engine, original_name, mime_type, size_bytes, album_id, visibility, access_password_hash, expires_at, strip_gps, custom_alias, intent_expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW() + INTERVAL '20 minutes')
	`, intentID, uidPtr, req.SHA256, objectKey, drv.Name(), req.Filename, req.MimeType, req.SizeBytes, req.AlbumID, req.Visibility, passHash, expiresAt, req.StripGPS, req.CustomAlias)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建上传意图失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"instant":   false,
		"intent_id": intentID.String(),
		"upload":    presigned,
	})
}

// LocalDirectPut receives direct binary PUT uploads for the Local NVMe driver using HMAC-signed tokens.
func (s *Server) LocalDirectPut(w http.ResponseWriter, r *http.Request) {
	ld := s.Router.LocalDriver()
	if ld == nil {
		writeErr(w, http.StatusServiceUnavailable, "local storage is disabled")
		return
	}
	signed := chi.URLParam(r, "token")
	tok, err := ld.VerifyToken(signed)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	limited := io.LimitReader(r.Body, tok.MaxSize+1024)
	if err := ld.Put(r.Context(), tok.Key, limited, tok.MaxSize, tok.ContentType); err != nil {
		writeErr(w, http.StatusInternalServerError, "write local object failed: "+err.Error())
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// UploadComplete verifies the uploaded object, extracts color palette & dimensions, and commits DB records.
func (s *Server) UploadComplete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IntentID  string `json:"intent_id"`
		ThumbHash string `json:"thumbhash"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var (
		uidPtr     *int64
		shaHex     string
		objectKey  string
		engine     string
		origName   string
		mimeType   string
		sizeBytes  int64
		albumID    *int64
		visibility string
		passHash   string
		expiresAt   *time.Time
		customAlias string
		completed   bool
	)
	err := s.Pool.QueryRow(r.Context(), `
		SELECT user_id, sha256, object_key, storage_engine, original_name, mime_type, size_bytes,
		       album_id, visibility, access_password_hash, expires_at, COALESCE(custom_alias,''), completed
		FROM upload_intents WHERE id = $1 AND intent_expires_at > NOW()
	`, req.IntentID).Scan(&uidPtr, &shaHex, &objectKey, &engine, &origName, &mimeType, &sizeBytes, &albumID, &visibility, &passHash, &expiresAt, &customAlias, &completed)
	if err != nil {
		writeErr(w, http.StatusNotFound, "上传会话不存在或已过期")
		return
	}
	if completed {
		writeErr(w, http.StatusConflict, "该上传会话已完成")
		return
	}

	drv, err := s.Router.GetDriver(engine)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	exists, actualSize, err := drv.Exists(r.Context(), objectKey)
	if err != nil || !exists {
		writeErr(w, http.StatusBadRequest, "对象存储中未检测到已上传文件，请重试")
		return
	}
	if actualSize > 0 {
		sizeBytes = actualSize
	}

	// Inspect image metadata (dimensions + 5-color palette)
	var meta imaging.ImageMeta
	if rc, _, _, err := drv.Get(r.Context(), objectKey); err == nil {
		meta = imaging.Inspect(rc)
		rc.Close()
	} else {
		meta = imaging.ImageMeta{DominantColor: "#64748b", ColorPalette: []string{"#64748b"}}
	}

	// Determine moderation status from role policy
	modStatus := "passed"
	if uidPtr == nil {
		modStatus = "pending"
	} else {
		var uRole string
		if s.Pool.QueryRow(r.Context(), `SELECT role FROM users WHERE id = $1`, *uidPtr).Scan(&uRole) == nil {
			if pol, err := s.getRolePolicy(r.Context(), uRole); err == nil && pol.RequireModeration {
				modStatus = "pending"
			}
		}
	}

	paletteJSON, _ := json.Marshal(meta.ColorPalette)
	exifJSON, _ := json.Marshal(meta.ExifData)
	var objID int64
	err = s.Pool.QueryRow(r.Context(), `
		INSERT INTO storage_objects (sha256, storage_engine, object_key, mime_type, size_bytes, width, height, dominant_color, color_palette, thumbhash, exif_data, moderation_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (sha256) DO UPDATE SET thumbhash = COALESCE(NULLIF(EXCLUDED.thumbhash, ''), storage_objects.thumbhash), updated_at = NOW()
		RETURNING id
	`, shaHex, engine, objectKey, mimeType, sizeBytes, meta.Width, meta.Height, meta.DominantColor, paletteJSON, req.ThumbHash, exifJSON, modStatus).Scan(&objID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入物理对象表失败")
		return
	}

	_, _ = s.Pool.Exec(r.Context(), `UPDATE upload_intents SET completed = TRUE WHERE id = $1`, req.IntentID)

	asset, err := s.createAssetLinkWithAlias(r.Context(), uidPtr, objID, albumID, origName, visibility, passHash, expiresAt, sizeBytes, customAlias)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建资产记录失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"asset": asset})
}

// MultipartUpload provides 1-step standard multipart/form-data upload compatible with PicGo, PicList, ShareX, and Typora.
func (s *Server) MultipartUpload(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	_, policy, quota, used, err := s.resolveUploadRoleAndQuota(r.Context(), p)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	if err := r.ParseMultipartForm(policy.MaxFileSizeBytes + 1024*1024); err != nil {
		writeErr(w, http.StatusBadRequest, "解析表单失败或文件超出上限")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("image")
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少文件字段 (file 或 image)")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, policy.MaxFileSizeBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "读取文件失败")
		return
	}
	if int64(len(data)) > policy.MaxFileSizeBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "文件体积超出当前角色限制")
		return
	}
	if p != nil && used+int64(len(data)) > quota {
		writeErr(w, http.StatusInsufficientStorage, "用户存储配额已满")
		return
	}

	mimeType := detectImageMime(data, header.Filename)
	if !containsStr(policy.AllowedMimes, mimeType) {
		writeErr(w, http.StatusUnsupportedMediaType, "不支持的文件类型: "+mimeType)
		return
	}

	engineReq := r.FormValue("engine")
	asset, instant, err := s.storeRawBytes(r.Context(), p, policy, data, header.Filename, mimeType, engineReq, nil, "public", "", nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":  true,
		"instant": instant,
		"url":     asset.DirectURL,
		"data": map[string]any{
			"url":      asset.DirectURL,
			"webp_url": asset.WebPURL,
			"markdown": fmt.Sprintf("![%s](%s)", asset.OriginalName, asset.DirectURL),
			"asset":    asset,
		},
	})
}

// RemoteFetchUpload downloads an image from a remote URL (with SSRF guard) and stores it in Local or R2.
func (s *Server) RemoteFetchUpload(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	_, policy, quota, used, err := s.resolveUploadRoleAndQuota(r.Context(), p)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	var req struct {
		URL        string `json:"url"`
		Engine     string `json:"engine"`
		AlbumID    *int64 `json:"album_id"`
		Visibility string `json:"visibility"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	parsed, err := url.Parse(strings.TrimSpace(req.URL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		writeErr(w, http.StatusBadRequest, "仅支持 http/https 远程图片链接")
		return
	}
	if isPrivateHost(parsed.Hostname()) {
		writeErr(w, http.StatusForbidden, "出于安全限制，禁止抓取内网地址")
		return
	}

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(parsed.String())
	if err != nil || resp.StatusCode >= 400 {
		writeErr(w, http.StatusBadGateway, "远程图片下载失败")
		return
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, policy.MaxFileSizeBytes+1))
	if err != nil || int64(len(data)) > policy.MaxFileSizeBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "远程图片超过大小限制")
		return
	}
	if p != nil && used+int64(len(data)) > quota {
		writeErr(w, http.StatusInsufficientStorage, "用户存储配额已满")
		return
	}

	mimeType := detectImageMime(data, parsed.Path)
	if !containsStr(policy.AllowedMimes, mimeType) {
		writeErr(w, http.StatusUnsupportedMediaType, "远程资源不是允许的图片格式: "+mimeType)
		return
	}
	filename := path.Base(parsed.Path)
	if filename == "" || filename == "/" || filename == "." {
		filename = "remote_" + randomCode(6) + ".jpg"
	}
	if req.Visibility == "" {
		req.Visibility = "public"
	}

	asset, instant, err := s.storeRawBytes(r.Context(), p, policy, data, filename, mimeType, req.Engine, req.AlbumID, req.Visibility, "", nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"instant": instant, "asset": asset})
}

func (s *Server) storeRawBytes(ctx context.Context, p *middleware.AuthPrincipal, policy *models.RolePolicy, data []byte, filename, mimeType, engineReq string, albumID *int64, visibility, passHash string, expiresAt *time.Time) (*models.AssetView, bool, error) {
	sum := sha256.Sum256(data)
	shaHex := hex.EncodeToString(sum[:])

	var uidPtr *int64
	if p != nil {
		uid := p.UserID
		uidPtr = &uid
	}

	var objID int64
	var modStatus string
	if err := s.Pool.QueryRow(ctx, `SELECT id, moderation_status FROM storage_objects WHERE sha256 = $1`, shaHex).Scan(&objID, &modStatus); err == nil {
		if modStatus == "blocked" {
			return nil, false, errors.New("该图片命中违规黑名单")
		}
		asset, err := s.createAssetLink(ctx, uidPtr, objID, albumID, filename, visibility, passHash, expiresAt, int64(len(data)))
		return asset, true, err
	}

	if engineReq == "" || engineReq == "auto" {
		engineReq = policy.DefaultEngine
	}
	drv, err := s.Router.ResolveEngine(engineReq, policy.AllowedEngines, int64(len(data)))
	if err != nil {
		return nil, false, err
	}
	uname := "guest"
	if p != nil && p.Username != "" {
		uname = p.Username
	}
	objectKey := storage.BuildObjectKeyForUser(uname, shaHex, filename, mimeType)
	if err := drv.Put(ctx, objectKey, bytes.NewReader(data), int64(len(data)), mimeType); err != nil {
		return nil, false, err
	}

	meta := imaging.Inspect(bytes.NewReader(data))
	paletteJSON, _ := json.Marshal(meta.ColorPalette)
	exifJSON, _ := json.Marshal(meta.ExifData)
	st := "passed"
	if policy.RequireModeration {
		st = "pending"
	}
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO storage_objects (sha256, storage_engine, object_key, mime_type, size_bytes, width, height, dominant_color, color_palette, exif_data, moderation_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (sha256) DO UPDATE SET updated_at = NOW()
		RETURNING id
	`, shaHex, drv.Name(), objectKey, mimeType, int64(len(data)), meta.Width, meta.Height, meta.DominantColor, paletteJSON, exifJSON, st).Scan(&objID)
	if err != nil {
		return nil, false, err
	}
	asset, err := s.createAssetLink(ctx, uidPtr, objID, albumID, filename, visibility, passHash, expiresAt, int64(len(data)))
	return asset, false, err
}

var aliasRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,16}$`)

func (s *Server) createAssetLink(ctx context.Context, uidPtr *int64, objID int64, albumID *int64, origName, visibility, passHash string, expiresAt *time.Time, sizeBytes int64) (*models.AssetView, error) {
	return s.createAssetLinkWithAlias(ctx, uidPtr, objID, albumID, origName, visibility, passHash, expiresAt, sizeBytes, "")
}

func (s *Server) createAssetLinkWithAlias(ctx context.Context, uidPtr *int64, objID int64, albumID *int64, origName, visibility, passHash string, expiresAt *time.Time, sizeBytes int64, customAlias string) (*models.AssetView, error) {
	shortCode := randomCode(8)
	if alias := strings.TrimSpace(customAlias); alias != "" && aliasRe.MatchString(alias) {
		shortCode = alias
	}
	var assetID int64
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO user_assets (short_code, user_id, object_id, album_id, original_name, visibility, access_password_hash, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id
	`, shortCode, uidPtr, objID, albumID, origName, visibility, passHash, expiresAt).Scan(&assetID)
	if err != nil {
		return nil, err
	}
	_, _ = s.Pool.Exec(ctx, `UPDATE storage_objects SET ref_count = ref_count + 1, updated_at = NOW() WHERE id = $1`, objID)
	if uidPtr != nil {
		_, _ = s.Pool.Exec(ctx, `UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2`, sizeBytes, *uidPtr)
	}
	db.RecordDailyStat(ctx, s.Pool, uidPtr, 1, 0, sizeBytes)
	asset, err := s.fetchAssetByID(ctx, assetID)
	if err == nil && s.Worker != nil {
		s.Worker.EnqueueWebhook(worker.WebhookPayload{
			Event:     "asset.uploaded",
			ShortCode: asset.ShortCode,
			DirectURL: asset.DirectURL,
			Filename:  asset.OriginalName,
			SizeBytes: asset.SizeBytes,
		})
		s.Worker.EnqueueModeration(worker.ModerationPayload{
			ObjectID:  asset.ObjectID,
			ImageURL:  asset.DirectURL,
			SHA256:    asset.SHA256,
			Engine:    asset.StorageEngine,
			ObjectKey: asset.ObjectKey,
		})
	}
	return asset, err
}

func isPrivateHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return true
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return true
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true
		}
	}
	return false
}
