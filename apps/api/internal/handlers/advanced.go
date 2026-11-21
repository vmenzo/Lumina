package handlers

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/ai"
	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/imaging"
	"lumina-imagehost/internal/mail"
	"lumina-imagehost/internal/storage"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
)

// AnalyzeAssetAI runs Vision LLM (or local heuristic fallback) to generate caption & semantic tags for an image.
func (s *Server) AnalyzeAssetAI(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	asset, err := s.fetchAssetByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在")
		return
	}
	if (asset.UserID == nil || *asset.UserID != p.UserID) && p.Role != "admin" {
		writeErr(w, http.StatusForbidden, "无权分析他人图片")
		return
	}

	var imgBytes []byte
	if drv, err := s.Router.GetDriver(asset.StorageEngine); err == nil {
		if rc, _, _, err := drv.Get(r.Context(), asset.ObjectKey); err == nil {
			imgBytes, _ = io.ReadAll(io.LimitReader(rc, 12*1024*1024))
			rc.Close()
		}
	}

	res := ai.AnalyzeImage(r.Context(), s.Cfg, imgBytes, asset.MimeType, asset.OriginalName, asset.DominantColor, asset.Width, asset.Height)

	// Merge AI tags into asset.Tags without duplicates
	tagSet := map[string]bool{}
	merged := make([]string, 0, len(asset.Tags)+len(res.Tags))
	for _, t := range asset.Tags {
		t = strings.TrimSpace(t)
		if t != "" && !tagSet[t] {
			tagSet[t] = true
			merged = append(merged, t)
		}
	}
	for _, t := range res.Tags {
		t = strings.TrimSpace(t)
		if t != "" && !tagSet[t] {
			tagSet[t] = true
			merged = append(merged, t)
		}
	}

	_, _ = s.Pool.Exec(r.Context(), `
		UPDATE user_assets
		SET ai_caption = $1, ai_tags = $2, tags = $3, updated_at = NOW()
		WHERE id = $4
	`, res.Caption, res.Tags, merged, id)

	updated, _ := s.fetchAssetByID(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{
		"asset":    updated,
		"caption":  res.Caption,
		"ai_tags":  res.Tags,
		"provider": res.Provider,
	})
}

// FindSimilarAssets finds visually & semantically similar images using color distance + shared tags + aspect ratio.
func (s *Server) FindSimilarAssets(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	target, err := s.fetchAssetByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在")
		return
	}

	rows, err := s.Pool.Query(r.Context(), assetSelectSQL+`
		WHERE ua.user_id = $1 AND ua.id <> $2 AND ua.deleted_at IS NULL
		ORDER BY ua.created_at DESC LIMIT 300
	`, p.UserID, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "查询相似图失败")
		return
	}
	defer rows.Close()

	targetTags := map[string]bool{}
	for _, t := range target.Tags {
		targetTags[strings.ToLower(t)] = true
	}
	targetRatio := 1.0
	if target.Height > 0 {
		targetRatio = float64(target.Width) / float64(target.Height)
	}

	type scored struct {
		asset *models.AssetView
		score float64 // lower is more similar
	}
	var candidates []scored
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			continue
		}
		colorDist := ai.ColorDistanceHex(target.DominantColor, a.DominantColor) / 195075.0 // normalized 0..1
		ratio := 1.0
		if a.Height > 0 {
			ratio = float64(a.Width) / float64(a.Height)
		}
		ratioDiff := targetRatio - ratio
		if ratioDiff < 0 {
			ratioDiff = -ratioDiff
		}
		shared := 0
		for _, t := range a.Tags {
			if targetTags[strings.ToLower(t)] {
				shared++
			}
		}
		// Weighted distance: color + aspect ratio - tag overlap bonus
		dist := colorDist*1.2 + ratioDiff*0.25 - float64(shared)*0.22
		candidates = append(candidates, scored{asset: a, score: dist})
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].score < candidates[j].score })

	limit := 12
	if len(candidates) < limit {
		limit = len(candidates)
	}
	wp := s.getUserDefaultWatermark(r.Context(), &p.UserID)
	out := make([]*models.AssetView, 0, limit)
	for i := 0; i < limit; i++ {
		s.populateAssetURLsWithWatermark(candidates[i].asset, wp)
		out = append(out, candidates[i].asset)
	}
	writeJSON(w, http.StatusOK, map[string]any{"similar": out})
}

func randomDigits(n int) string {
	b := make([]byte, n)
	ten := big.NewInt(10)
	for i := range b {
		v, _ := rand.Int(rand.Reader, ten)
		b[i] = byte('0' + v.Int64())
	}
	return string(b)
}

// ForgotPassword issues a 6-digit reset code and emails it via SMTP.
func (s *Server) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &req); err != nil || !strings.Contains(req.Email, "@") {
		writeErr(w, http.StatusBadRequest, "请输入有效的注册邮箱")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))

	var uid int64
	var username string
	err := s.Pool.QueryRow(r.Context(), `SELECT id, username FROM users WHERE LOWER(email) = $1 AND status = 'active'`, email).Scan(&uid, &username)
	if err != nil {
		// Do not leak user existence
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "如果该邮箱已注册，重置验证码已发送"})
		return
	}

	code := randomDigits(6)
	sum := sha256.Sum256([]byte(code))
	hashHex := hex.EncodeToString(sum[:])

	_, _ = s.Pool.Exec(r.Context(), `
		INSERT INTO password_reset_tokens (user_id, email, code_hash, expires_at)
		VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')
	`, uid, email, hashHex)

	html := fmt.Sprintf(`
		<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
			<h2 style="margin:0 0 12px;">Lumina 光匣 · 密码重置验证码</h2>
			<p>你好 <strong>%s</strong>，你正在申请重置账号密码，验证码为：</p>
			<div style="font-size:28px;font-weight:bold;letter-spacing:6px;padding:16px;background:#f4f4f5;border-radius:12px;text-align:center;margin:16px 0;">%s</div>
			<p style="color:#71717a;font-size:12px;">验证码 30 分钟内有效，如非本人操作请忽略此邮件。</p>
		</div>
	`, username, code)

	if err := mail.SendHTML(s.Cfg, email, "Lumina 光匣 - 密码重置验证码", html); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "邮件发送失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "6 位重置验证码已发送至你的邮箱（30 分钟有效）"})
}

// ResetPassword validates the 6-digit email code and updates the user's password.
func (s *Server) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.NewPassword) < 6 || strings.TrimSpace(req.Code) == "" {
		writeErr(w, http.StatusBadRequest, "请填写完整的邮箱、6位验证码与至少6位新密码")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	sum := sha256.Sum256([]byte(strings.TrimSpace(req.Code)))
	hashHex := hex.EncodeToString(sum[:])

	var tokID, uid int64
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, user_id FROM password_reset_tokens
		WHERE email = $1 AND code_hash = $2 AND used = FALSE AND expires_at > NOW()
		ORDER BY created_at DESC LIMIT 1
	`, email, hashHex).Scan(&tokID, &uid)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "验证码无效或已过期")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "密码加密失败")
		return
	}
	_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, string(hash), uid)
	_, _ = s.Pool.Exec(r.Context(), `UPDATE password_reset_tokens SET used = TRUE WHERE id = $1`, tokID)
	_, _ = s.Pool.Exec(r.Context(), `UPDATE user_sessions SET revoked = TRUE WHERE user_id = $1`, uid)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "密码已重置，请使用新密码登录"})
}

// AdminTestMail sends a test email via configured SMTP server.
func (s *Server) AdminTestMail(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		To string `json:"to"`
	}
	_ = decodeJSON(r, &req)
	to := strings.TrimSpace(req.To)
	if to == "" {
		to = s.Cfg.AdminEmail
	}
	err := mail.SendHTML(s.Cfg, to, "Lumina 光匣 - SMTP 邮件服务测试", "<p>恭喜！你的 Lumina 光匣 SMTP 邮件服务已成功连通。</p>")
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "admin.mail.test", "smtp", to, map[string]any{"ok": true}, middleware.ClientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "to": to})
}

// StorageProfile represents an S3-compatible multi-bucket strategy profile.
type StorageProfile struct {
	ID              int64     `json:"id"`
	Name            string    `json:"name"`
	Provider        string    `json:"provider"`
	Endpoint        string    `json:"endpoint"`
	Region          string    `json:"region"`
	Bucket          string    `json:"bucket"`
	AccessKeyID     string    `json:"access_key_id"`
	SecretAccessKey string    `json:"secret_access_key,omitempty"`
	PublicURL       string    `json:"public_url"`
	IsActive        bool      `json:"is_active"`
	IsDefault       bool      `json:"is_default"`
	CreatedAt       time.Time `json:"created_at"`
}

func (s *Server) AdminListStorageProfiles(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, name, provider, endpoint, region, bucket, access_key_id, public_url, is_active, is_default, created_at
		FROM storage_profiles ORDER BY is_default DESC, created_at DESC
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "查询存储策略组失败")
		return
	}
	defer rows.Close()
	list := []StorageProfile{}
	for rows.Next() {
		var sp StorageProfile
		if rows.Scan(&sp.ID, &sp.Name, &sp.Provider, &sp.Endpoint, &sp.Region, &sp.Bucket, &sp.AccessKeyID, &sp.PublicURL, &sp.IsActive, &sp.IsDefault, &sp.CreatedAt) == nil {
			list = append(list, sp)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"profiles": list})
}

func (s *Server) AdminSaveStorageProfile(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req StorageProfile
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Bucket) == "" {
		writeErr(w, http.StatusBadRequest, "策略名称与 Bucket 不能为空")
		return
	}
	if req.Provider == "" {
		req.Provider = "s3"
	}
	if req.Region == "" {
		req.Region = "auto"
	}
	if req.IsDefault {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_profiles SET is_default = FALSE`)
	}
	err := s.Pool.QueryRow(r.Context(), `
		INSERT INTO storage_profiles (name, provider, endpoint, region, bucket, access_key_id, secret_access_key, public_url, is_active, is_default)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (name) DO UPDATE SET
			provider = EXCLUDED.provider,
			endpoint = EXCLUDED.endpoint,
			region = EXCLUDED.region,
			bucket = EXCLUDED.bucket,
			access_key_id = EXCLUDED.access_key_id,
			secret_access_key = COALESCE(NULLIF(EXCLUDED.secret_access_key,''), storage_profiles.secret_access_key),
			public_url = EXCLUDED.public_url,
			is_active = EXCLUDED.is_active,
			is_default = EXCLUDED.is_default,
			updated_at = NOW()
		RETURNING id, created_at
	`, strings.TrimSpace(req.Name), req.Provider, strings.TrimRight(req.Endpoint, "/"), req.Region, req.Bucket,
		req.AccessKeyID, req.SecretAccessKey, strings.TrimRight(req.PublicURL, "/"), req.IsActive, req.IsDefault).Scan(&req.ID, &req.CreatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "保存存储策略组失败: "+err.Error())
		return
	}
	req.SecretAccessKey = ""
	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "admin.storage_profile.save", "storage_profile", req.Name, req, middleware.ClientIP(r))
	writeJSON(w, http.StatusCreated, map[string]any{"profile": req})
}

func (s *Server) AdminDeleteStorageProfile(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	_, _ = s.Pool.Exec(r.Context(), `DELETE FROM storage_profiles WHERE id = $1`, id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ReplaceAssetFile replaces the underlying image blob in-place while keeping the exact short_code & URL intact!
func (s *Server) ReplaceAssetFile(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	existing, err := s.fetchAssetByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在")
		return
	}
	if (existing.UserID == nil || *existing.UserID != p.UserID) && p.Role != "admin" {
		writeErr(w, http.StatusForbidden, "无权替换他人图片")
		return
	}
	_, policy, _, _, err := s.resolveUploadRoleAndQuota(r.Context(), p)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if err := r.ParseMultipartForm(policy.MaxFileSizeBytes + 1024*1024); err != nil {
		writeErr(w, http.StatusBadRequest, "解析表单失败或文件过大")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少 file 字段")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, policy.MaxFileSizeBytes+1))
	if err != nil || int64(len(data)) == 0 || int64(len(data)) > policy.MaxFileSizeBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "文件体积超出限制")
		return
	}
	mimeType := detectImageMime(data, header.Filename)
	if !containsStr(policy.AllowedMimes, mimeType) {
		writeErr(w, http.StatusUnsupportedMediaType, "不支持的格式: "+mimeType)
		return
	}

	sum := sha256.Sum256(data)
	shaHex := hex.EncodeToString(sum[:])

	var newObjID int64
	if err := s.Pool.QueryRow(r.Context(), `SELECT id FROM storage_objects WHERE sha256 = $1`, shaHex).Scan(&newObjID); err != nil {
		drv, err := s.Router.ResolveEngine(existing.StorageEngine, policy.AllowedEngines, int64(len(data)))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		objectKey := storage.BuildObjectKeyForUser(p.Username, shaHex, header.Filename, mimeType)
		if err := drv.Put(r.Context(), objectKey, bytes.NewReader(data), int64(len(data)), mimeType); err != nil {
			writeErr(w, http.StatusInternalServerError, "写入存储失败: "+err.Error())
			return
		}
		meta := imaging.Inspect(bytes.NewReader(data))
		palJSON, _ := json.Marshal(meta.ColorPalette)
		exifJSON, _ := json.Marshal(meta.ExifData)
		if err := s.Pool.QueryRow(r.Context(), `
			INSERT INTO storage_objects (sha256, storage_engine, object_key, mime_type, size_bytes, width, height, dominant_color, color_palette, exif_data, moderation_status)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'passed')
			ON CONFLICT (sha256) DO UPDATE SET updated_at = NOW()
			RETURNING id
		`, shaHex, drv.Name(), objectKey, mimeType, int64(len(data)), meta.Width, meta.Height, meta.DominantColor, palJSON, exifJSON).Scan(&newObjID); err != nil {
			writeErr(w, http.StatusInternalServerError, "写入对象记录失败")
			return
		}
	}

	if newObjID != existing.ObjectID {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET object_id = $1, updated_at = NOW() WHERE id = $2`, newObjID, id)
		_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_objects SET ref_count = ref_count + 1 WHERE id = $1`, newObjID)
		_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_objects SET ref_count = GREATEST(ref_count - 1, 0) WHERE id = $1`, existing.ObjectID)
	}
	updated, _ := s.fetchAssetByID(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"asset": updated, "replaced": true})
}

func (s *Server) ToggleFavorite(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var fav bool
	err = s.Pool.QueryRow(r.Context(), `
		UPDATE user_assets SET is_favorite = NOT COALESCE(is_favorite, FALSE), updated_at = NOW()
		WHERE id = $1 AND user_id = $2 RETURNING is_favorite
	`, id, p.UserID).Scan(&fav)
	if err != nil {
		writeErr(w, http.StatusNotFound, "asset not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"is_favorite": fav})
}

func (s *Server) LikeShareImage(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	var likes int64
	err := s.Pool.QueryRow(r.Context(), `
		UPDATE user_assets SET like_count = COALESCE(like_count, 0) + 1
		WHERE short_code = $1 AND deleted_at IS NULL RETURNING like_count
	`, code).Scan(&likes)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"like_count": likes})
}

func (s *Server) PublicSiteInfo(w http.ResponseWriter, r *http.Request) {
	general := s.getSiteSetting(r.Context(), "general")
	writeJSON(w, http.StatusOK, map[string]any{"site": general})
}
