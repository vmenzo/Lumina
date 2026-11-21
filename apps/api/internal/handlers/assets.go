package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
)

const assetSelectSQL = `
	SELECT ua.id, ua.short_code, ua.user_id, COALESCE(u.username, '游客'),
	       ua.object_id, ua.album_id, COALESCE(al.title, ''),
	       ua.original_name, ua.tags, ua.visibility, (ua.access_password_hash <> ''),
	       ua.view_count, COALESCE(ua.is_favorite, FALSE), COALESCE(ua.like_count, 0), ua.expires_at, ua.deleted_at, ua.created_at,
	       so.sha256, so.storage_engine, so.object_key, so.mime_type, so.size_bytes,
	       so.width, so.height, so.dominant_color, so.color_palette, so.thumbhash, so.exif_data,
	       so.ref_count, so.moderation_status
	FROM user_assets ua
	JOIN storage_objects so ON so.id = ua.object_id
	LEFT JOIN users u ON u.id = ua.user_id
	LEFT JOIN albums al ON al.id = ua.album_id
`

func scanAsset(row interface{ Scan(...any) error }) (*models.AssetView, error) {
	var a models.AssetView
	var paletteRaw []byte
	err := row.Scan(
		&a.ID, &a.ShortCode, &a.UserID, &a.Username,
		&a.ObjectID, &a.AlbumID, &a.AlbumTitle,
		&a.OriginalName, &a.Tags, &a.Visibility, &a.HasPassword,
		&a.ViewCount, &a.IsFavorite, &a.LikeCount, &a.ExpiresAt, &a.DeletedAt, &a.CreatedAt,
		&a.SHA256, &a.StorageEngine, &a.ObjectKey, &a.MimeType, &a.SizeBytes,
		&a.Width, &a.Height, &a.DominantColor, &paletteRaw, &a.ThumbHash, &a.ExifData,
		&a.RefCount, &a.ModerationStatus,
	)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(paletteRaw, &a.ColorPalette)
	if a.Tags == nil {
		a.Tags = []string{}
	}
	return &a, nil
}

func (s *Server) fetchAssetByID(ctx context.Context, id int64) (*models.AssetView, error) {
	a, err := scanAsset(s.Pool.QueryRow(ctx, assetSelectSQL+` WHERE ua.id = $1`, id))
	if err != nil {
		return nil, err
	}
	wp := s.getUserDefaultWatermark(ctx, a.UserID)
	s.populateAssetURLsWithWatermark(a, wp)
	return a, nil
}

func (s *Server) ListMyAssets(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	q := r.URL.Query()
	trash := q.Get("trash") == "true"
	search := strings.TrimSpace(q.Get("q"))
	engine := strings.TrimSpace(q.Get("engine"))
	mime := strings.TrimSpace(q.Get("mime"))
	visibility := strings.TrimSpace(q.Get("visibility"))
	tag := strings.TrimSpace(q.Get("tag"))
	favOnly := q.Get("favorite") == "true"
	albumIDStr := strings.TrimSpace(q.Get("album_id"))

	args := []any{p.UserID}
	where := []string{"ua.user_id = $1"}
	if trash {
		where = append(where, "ua.deleted_at IS NOT NULL")
	} else {
		where = append(where, "ua.deleted_at IS NULL")
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		idx := len(args)
		where = append(where, fmt.Sprintf("(ua.original_name ILIKE $%d OR so.sha256 ILIKE $%d OR ua.short_code ILIKE $%d OR ua.ai_caption ILIKE $%d OR array_to_string(ua.tags, ',') ILIKE $%d OR array_to_string(ua.ai_tags, ',') ILIKE $%d)", idx, idx, idx, idx, idx, idx))
	}
	if engine == "local" || engine == "r2" {
		args = append(args, engine)
		where = append(where, fmt.Sprintf("so.storage_engine = $%d", len(args)))
	}
	if mime != "" {
		args = append(args, mime)
		where = append(where, fmt.Sprintf("so.mime_type = $%d", len(args)))
	}
	if visibility != "" {
		args = append(args, visibility)
		where = append(where, fmt.Sprintf("ua.visibility = $%d", len(args)))
	}
	if favOnly {
		where = append(where, "ua.is_favorite = TRUE")
	}
	if tag != "" {
		args = append(args, tag)
		where = append(where, fmt.Sprintf("$%d = ANY(ua.tags)", len(args)))
	}
	if albumIDStr != "" {
		if aid, err := strconv.ParseInt(albumIDStr, 10, 64); err == nil {
			args = append(args, aid)
			where = append(where, fmt.Sprintf("ua.album_id = $%d", len(args)))
		}
	}

	limit := 60
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 && l <= 200 {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(q.Get("offset")); err == nil && o >= 0 {
		offset = o
	}
	args = append(args, limit, offset)

	orderBy := "ua.created_at DESC"
	switch strings.TrimSpace(q.Get("sort")) {
	case "oldest":
		orderBy = "ua.created_at ASC"
	case "largest":
		orderBy = "so.size_bytes DESC"
	case "smallest":
		orderBy = "so.size_bytes ASC"
	case "popular":
		orderBy = "ua.view_count DESC, ua.created_at DESC"
	case "name":
		orderBy = "ua.original_name ASC"
	}
	sql := assetSelectSQL + " WHERE " + strings.Join(where, " AND ") +
		fmt.Sprintf(" ORDER BY %s LIMIT $%d OFFSET $%d", orderBy, len(args)-1, len(args))

	rows, err := s.Pool.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "查询图片列表失败: "+err.Error())
		return
	}
	defer rows.Close()

	wp := s.getUserDefaultWatermark(r.Context(), &p.UserID)
	items := []*models.AssetView{}
	for rows.Next() {
		if a, err := scanAsset(rows); err == nil {
			s.populateAssetURLsWithWatermark(a, wp)
			items = append(items, a)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": items})
}

func (s *Server) UpdateAsset(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	var req struct {
		OriginalName *string  `json:"original_name"`
		AlbumID      *int64   `json:"album_id"`
		ClearAlbum   bool     `json:"clear_album"`
		Tags         []string `json:"tags"`
		Visibility   *string  `json:"visibility"`
		Password     *string  `json:"password"`
		ExpireHours  *int     `json:"expire_hours"`
		ShortCode    *string  `json:"short_code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	var ownerID *int64
	if err := s.Pool.QueryRow(r.Context(), `SELECT user_id FROM user_assets WHERE id = $1`, id).Scan(&ownerID); err != nil {
		writeErr(w, http.StatusNotFound, "asset not found")
		return
	}
	if (ownerID == nil || *ownerID != p.UserID) && p.Role != "admin" {
		writeErr(w, http.StatusForbidden, "无权修改他人资产")
		return
	}

	if req.ShortCode != nil && aliasRe.MatchString(strings.TrimSpace(*req.ShortCode)) {
		_, err := s.Pool.Exec(r.Context(), `UPDATE user_assets SET short_code = $1, updated_at = NOW() WHERE id = $2`, strings.TrimSpace(*req.ShortCode), id)
		if err != nil {
			writeErr(w, http.StatusConflict, "该短链别名已被占用")
			return
		}
	}
	if req.OriginalName != nil {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET original_name = $1, updated_at = NOW() WHERE id = $2`, *req.OriginalName, id)
	}
	if req.ClearAlbum {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET album_id = NULL, updated_at = NOW() WHERE id = $1`, id)
	} else if req.AlbumID != nil {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET album_id = $1, updated_at = NOW() WHERE id = $2`, *req.AlbumID, id)
	}
	if req.Tags != nil {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET tags = $1, updated_at = NOW() WHERE id = $2`, req.Tags, id)
	}
	if req.Visibility != nil {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET visibility = $1, updated_at = NOW() WHERE id = $2`, *req.Visibility, id)
	}
	if req.Password != nil {
		if *req.Password == "" {
			_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET access_password_hash = '' WHERE id = $1`, id)
		} else {
			h, _ := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
			_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET access_password_hash = $1, visibility = 'password' WHERE id = $2`, string(h), id)
		}
	}
	if req.ExpireHours != nil {
		if *req.ExpireHours <= 0 {
			_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET expires_at = NULL WHERE id = $1`, id)
		} else {
			exp := time.Now().Add(time.Duration(*req.ExpireHours) * time.Hour)
			_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET expires_at = $1 WHERE id = $2`, exp, id)
		}
	}

	asset, _ := s.fetchAssetByID(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"asset": asset})
}

func (s *Server) DeleteAsset(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	permanent := r.URL.Query().Get("permanent") == "true"

	var ownerID *int64
	var objID int64
	if err := s.Pool.QueryRow(r.Context(), `SELECT user_id, object_id FROM user_assets WHERE id = $1`, id).Scan(&ownerID, &objID); err != nil {
		writeErr(w, http.StatusNotFound, "asset not found")
		return
	}
	if (ownerID == nil || *ownerID != p.UserID) && p.Role != "admin" {
		writeErr(w, http.StatusForbidden, "无权删除他人资产")
		return
	}

	if !permanent {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET deleted_at = NOW() WHERE id = $1`, id)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "soft_deleted": true})
		return
	}

	_, _ = s.Pool.Exec(r.Context(), `DELETE FROM user_assets WHERE id = $1`, id)
	var sz int64
	_ = s.Pool.QueryRow(r.Context(), `UPDATE storage_objects SET ref_count = GREATEST(ref_count - 1, 0), updated_at = NOW() WHERE id = $1 RETURNING size_bytes`, objID).Scan(&sz)
	if ownerID != nil && sz > 0 {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - $1, 0) WHERE id = $2`, sz, *ownerID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "permanent": true})
}

func (s *Server) RestoreAsset(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET deleted_at = NULL WHERE id = $1 AND user_id = $2`, id, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// MigrateAsset performs live zero-downtime migration of an asset's physical blob between Local NVMe and Cloudflare R2.
func (s *Server) MigrateAsset(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req struct {
		TargetEngine string `json:"target_engine"` // local or r2
	}
	if err := decodeJSON(r, &req); err != nil || (req.TargetEngine != "local" && req.TargetEngine != "r2") {
		writeErr(w, http.StatusBadRequest, "target_engine 必须为 local 或 r2")
		return
	}
	asset, err := s.fetchAssetByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "asset not found")
		return
	}
	if (asset.UserID == nil || *asset.UserID != p.UserID) && p.Role != "admin" {
		writeErr(w, http.StatusForbidden, "无权迁移他人资产")
		return
	}
	if asset.StorageEngine == req.TargetEngine {
		writeJSON(w, http.StatusOK, map[string]any{"asset": asset, "migrated": false})
		return
	}
	if err := s.Router.Migrate(r.Context(), asset.ObjectKey, asset.StorageEngine, req.TargetEngine, asset.MimeType); err != nil {
		writeErr(w, http.StatusBadGateway, "迁移失败: "+err.Error())
		return
	}
	_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_objects SET storage_engine = $1, updated_at = NOW() WHERE id = $2`, req.TargetEngine, asset.ObjectID)
	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "asset.migrate", "storage_object", fmt.Sprint(asset.ObjectID),
		map[string]any{"from": asset.StorageEngine, "to": req.TargetEngine}, middleware.ClientIP(r))

	updated, _ := s.fetchAssetByID(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"asset": updated, "migrated": true})
}

func (s *Server) BatchAssets(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		IDs          []int64 `json:"ids"`
		Action       string  `json:"action"` // trash, restore, delete, move_album, visibility, migrate, add_tag
		AlbumID      *int64  `json:"album_id"`
		Visibility   string  `json:"visibility"`
		TargetEngine string  `json:"target_engine"`
		Tag          string  `json:"tag"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.IDs) == 0 {
		writeErr(w, http.StatusBadRequest, "请选择至少一张图片")
		return
	}

	processed := 0
	for _, id := range req.IDs {
		switch req.Action {
		case "trash":
			tag, err := s.Pool.Exec(r.Context(), `UPDATE user_assets SET deleted_at = NOW() WHERE id = $1 AND user_id = $2`, id, p.UserID)
			if err == nil && tag.RowsAffected() > 0 {
				processed++
			}
		case "restore":
			tag, err := s.Pool.Exec(r.Context(), `UPDATE user_assets SET deleted_at = NULL WHERE id = $1 AND user_id = $2`, id, p.UserID)
			if err == nil && tag.RowsAffected() > 0 {
				processed++
			}
		case "delete":
			var objID int64
			if err := s.Pool.QueryRow(r.Context(), `DELETE FROM user_assets WHERE id = $1 AND user_id = $2 RETURNING object_id`, id, p.UserID).Scan(&objID); err == nil {
				var sz int64
				_ = s.Pool.QueryRow(r.Context(), `UPDATE storage_objects SET ref_count = GREATEST(ref_count - 1, 0), updated_at = NOW() WHERE id = $1 RETURNING size_bytes`, objID).Scan(&sz)
				if sz > 0 {
					_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - $1, 0) WHERE id = $2`, sz, p.UserID)
				}
				processed++
			}
		case "move_album":
			tag, err := s.Pool.Exec(r.Context(), `UPDATE user_assets SET album_id = $1 WHERE id = $2 AND user_id = $3`, req.AlbumID, id, p.UserID)
			if err == nil && tag.RowsAffected() > 0 {
				processed++
			}
		case "visibility":
			tag, err := s.Pool.Exec(r.Context(), `UPDATE user_assets SET visibility = $1 WHERE id = $2 AND user_id = $3`, req.Visibility, id, p.UserID)
			if err == nil && tag.RowsAffected() > 0 {
				processed++
			}
		case "add_tag":
			if req.Tag != "" {
				tag, err := s.Pool.Exec(r.Context(), `UPDATE user_assets SET tags = array_append(tags, $1) WHERE id = $2 AND user_id = $3 AND NOT ($1 = ANY(tags))`, req.Tag, id, p.UserID)
				if err == nil && tag.RowsAffected() > 0 {
					processed++
				}
			}
		case "migrate":
			asset, err := s.fetchAssetByID(r.Context(), id)
			if err == nil && asset.UserID != nil && *asset.UserID == p.UserID && asset.StorageEngine != req.TargetEngine {
				if err := s.Router.Migrate(r.Context(), asset.ObjectKey, asset.StorageEngine, req.TargetEngine, asset.MimeType); err == nil {
					_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_objects SET storage_engine = $1, updated_at = NOW() WHERE id = $2`, req.TargetEngine, asset.ObjectID)
					processed++
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"processed": processed})
}

func (s *Server) ExplorePublic(w http.ResponseWriter, r *http.Request) {
	sortBy := r.URL.Query().Get("sort")
	order := "ua.created_at DESC"
	if sortBy == "popular" {
		order = "ua.view_count DESC, ua.created_at DESC"
	}
	rows, err := s.Pool.Query(r.Context(), assetSelectSQL+`
		WHERE ua.visibility = 'public' AND ua.deleted_at IS NULL
		  AND (ua.expires_at IS NULL OR ua.expires_at > NOW())
		  AND so.moderation_status = 'passed'
		ORDER BY `+order+` LIMIT 60
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "加载广场失败")
		return
	}
	defer rows.Close()
	items := []*models.AssetView{}
	for rows.Next() {
		if a, err := scanAsset(rows); err == nil {
			s.populateAssetURLs(a)
			items = append(items, a)
		}
	}
	general := s.getSiteSetting(r.Context(), "general")
	writeJSON(w, http.StatusOK, map[string]any{
		"assets": items,
		"site":   general,
	})
}

// ShareImage serves metadata for /i/:code standalone landing page (supports password unlock & expiry).
func (s *Server) ShareImage(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	password := r.URL.Query().Get("password")
	if password == "" {
		password = r.Header.Get("X-Share-Password")
	}

	var passHash string
	var assetID int64
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, access_password_hash FROM user_assets
		WHERE short_code = $1 AND deleted_at IS NULL
	`, code).Scan(&assetID, &passHash)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在或已被删除")
		return
	}

	asset, err := s.fetchAssetByID(r.Context(), assetID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在")
		return
	}
	if asset.ModerationStatus == "blocked" {
		writeErr(w, http.StatusUnavailableForLegalReasons, "该图片因违反内容安全规范已被屏蔽")
		return
	}
	if asset.ExpiresAt != nil && time.Now().After(*asset.ExpiresAt) {
		writeErr(w, http.StatusGone, "该图片已超过阅后即焚有效期")
		return
	}
	if asset.Visibility == "private" {
		p := middleware.PrincipalFromCtx(r.Context())
		if p == nil || (asset.UserID != nil && *asset.UserID != p.UserID && p.Role != "admin") {
			writeErr(w, http.StatusForbidden, "这是一张私密图片")
			return
		}
	}
	if asset.Visibility == "password" && passHash != "" {
		if password == "" || bcrypt.CompareHashAndPassword([]byte(passHash), []byte(password)) != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"locked":       true,
				"short_code":   asset.ShortCode,
				"original_name": asset.OriginalName,
				"error":        "请输入访问密码解锁此图片",
			})
			return
		}
	}

	_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET view_count = view_count + 1 WHERE id = $1`, asset.ID)
	asset.ViewCount++
	writeJSON(w, http.StatusOK, map[string]any{"asset": asset})
}

// ShareAlbum serves public/password-protected album landing page /a/:slug
func (s *Server) ShareAlbum(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	password := r.URL.Query().Get("password")
	if password == "" {
		password = r.Header.Get("X-Share-Password")
	}

	var al models.Album
	var passHash string
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, user_id, parent_id, slug, title, description, visibility, access_password_hash, cover_short_code, created_at
		FROM albums WHERE slug = $1
	`, slug).Scan(&al.ID, &al.UserID, &al.ParentID, &al.Slug, &al.Title, &al.Description, &al.Visibility, &passHash, &al.CoverCode, &al.CreatedAt)
	if err != nil {
		writeErr(w, http.StatusNotFound, "相册不存在")
		return
	}
	al.HasPassword = passHash != ""
	if al.Visibility == "private" {
		p := middleware.PrincipalFromCtx(r.Context())
		if p == nil || (p.UserID != al.UserID && p.Role != "admin") {
			writeErr(w, http.StatusForbidden, "该相册为私密相册")
			return
		}
	}
	if al.Visibility == "password" && passHash != "" {
		if password == "" || bcrypt.CompareHashAndPassword([]byte(passHash), []byte(password)) != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"locked": true,
				"title":  al.Title,
				"slug":   al.Slug,
				"error":  "请输入相册密码",
			})
			return
		}
	}

	rows, err := s.Pool.Query(r.Context(), assetSelectSQL+`
		WHERE ua.album_id = $1 AND ua.deleted_at IS NULL AND so.moderation_status = 'passed'
		ORDER BY ua.created_at DESC
	`, al.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "加载相册图片失败")
		return
	}
	defer rows.Close()
	items := []*models.AssetView{}
	for rows.Next() {
		if a, err := scanAsset(rows); err == nil {
			s.populateAssetURLs(a)
			items = append(items, a)
		}
	}
	al.AssetCount = int64(len(items))
	writeJSON(w, http.StatusOK, map[string]any{"album": al, "assets": items})
}
