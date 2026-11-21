package handlers

import (
	"crypto/md5"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/imaging"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
)

// EmptyTrash permanently deletes all soft-deleted assets for the current user and reclaims quota.
func (s *Server) EmptyTrash(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	rows, err := s.Pool.Query(r.Context(), `
		SELECT ua.id, ua.object_id, so.size_bytes
		FROM user_assets ua
		JOIN storage_objects so ON so.id = ua.object_id
		WHERE ua.user_id = $1 AND ua.deleted_at IS NOT NULL
	`, p.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "查询回收站失败")
		return
	}
	type trashRow struct {
		id    int64
		objID int64
		size  int64
	}
	var list []trashRow
	for rows.Next() {
		var tr trashRow
		if rows.Scan(&tr.id, &tr.objID, &tr.size) == nil {
			list = append(list, tr)
		}
	}
	rows.Close()

	var freedBytes int64
	for _, tr := range list {
		tag, err := s.Pool.Exec(r.Context(), `DELETE FROM user_assets WHERE id = $1 AND user_id = $2`, tr.id, p.UserID)
		if err == nil && tag.RowsAffected() > 0 {
			_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_objects SET ref_count = GREATEST(ref_count - 1, 0), updated_at = NOW() WHERE id = $1`, tr.objID)
			freedBytes += tr.size
		}
	}
	if freedBytes > 0 {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - $1, 0) WHERE id = $2`, freedBytes, p.UserID)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"deleted":     len(list),
		"freed_bytes": freedBytes,
	})
}

// CreateSignedURL generates an expiring HMAC-SHA256 signed direct link for private or password-protected images.
func (s *Server) CreateSignedURL(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	var req struct {
		TTLMinutes int `json:"ttl_minutes"`
	}
	_ = decodeJSON(r, &req)
	if req.TTLMinutes <= 0 {
		req.TTLMinutes = 60
	}
	if req.TTLMinutes > 60*24*30 {
		req.TTLMinutes = 60 * 24 * 30
	}

	asset, err := s.fetchAssetByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在")
		return
	}
	if (asset.UserID == nil || *asset.UserID != p.UserID) && p.Role != "admin" {
		writeErr(w, http.StatusForbidden, "无权为他人图片签发临时链接")
		return
	}

	exp := time.Now().Add(time.Duration(req.TTLMinutes) * time.Minute)
	sig := s.signRawURL(asset.ShortCode, exp.Unix())
	signedURL := fmt.Sprintf("%s/raw/%s?exp=%d&sig=%s", s.Cfg.CDNPublicURL, asset.ShortCode, exp.Unix(), sig)
	writeJSON(w, http.StatusOK, map[string]any{
		"signed_url": signedURL,
		"expires_at": exp,
	})
}

// BuildTransformURL signs a custom imgproxy transformation URL on demand (resize, crop, format, quality, blur, rotate, watermark).
func (s *Server) BuildTransformURL(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	var req struct {
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		Fit         string `json:"fit"` // fit, fill, auto
		Quality     int    `json:"quality"`
		Format      string `json:"format"` // webp, avif, jpg, png
		Blur        int    `json:"blur"`
		Rotate      int    `json:"rotate"` // 0, 90, 180, 270
		WatermarkID *int64 `json:"watermark_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	asset, err := s.fetchAssetByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "图片不存在")
		return
	}
	if asset.Visibility == "private" && (p == nil || (asset.UserID != nil && *asset.UserID != p.UserID && p.Role != "admin")) {
		writeErr(w, http.StatusForbidden, "无权访问该私密图片")
		return
	}

	var opts []string
	if req.Width > 0 || req.Height > 0 {
		fit := req.Fit
		if fit != "fit" && fit != "fill" && fit != "auto" {
			fit = "fit"
		}
		if req.Width > 4096 {
			req.Width = 4096
		}
		if req.Height > 4096 {
			req.Height = 4096
		}
		opts = append(opts, fmt.Sprintf("rs:%s:%d:%d", fit, req.Width, req.Height))
	}
	if req.Rotate == 90 || req.Rotate == 180 || req.Rotate == 270 {
		opts = append(opts, fmt.Sprintf("rot:%d", req.Rotate))
	}
	if req.Blur > 0 {
		if req.Blur > 50 {
			req.Blur = 50
		}
		opts = append(opts, fmt.Sprintf("bl:%d", req.Blur))
	}
	if req.WatermarkID != nil && *req.WatermarkID > 0 && p != nil {
		var wp models.WatermarkPreset
		err := s.Pool.QueryRow(r.Context(), `
			SELECT id, user_id, name, mode, text_content, COALESCE(image_url,''), font_size, text_color,
			       opacity, position, offset_x, offset_y, scale, angle, tiled, is_default, created_at
			FROM watermark_presets WHERE id = $1 AND user_id = $2
		`, *req.WatermarkID, p.UserID).Scan(
			&wp.ID, &wp.UserID, &wp.Name, &wp.Mode, &wp.TextContent, &wp.ImageURL, &wp.FontSize, &wp.TextColor,
			&wp.Opacity, &wp.Position, &wp.OffsetX, &wp.OffsetY, &wp.Scale, &wp.Angle, &wp.Tiled, &wp.IsDefault, &wp.CreatedAt,
		)
		if err == nil {
			opts = append(opts, buildWatermarkOpt(&wp))
		}
	}
	q := req.Quality
	if q <= 0 || q > 100 {
		q = 85
	}
	opts = append(opts, fmt.Sprintf("q:%d", q))

	ext := strings.ToLower(strings.TrimSpace(req.Format))
	if ext != "webp" && ext != "avif" && ext != "jpg" && ext != "png" {
		ext = "webp"
	}

	url := imaging.BuildImgproxyURL(s.Cfg, asset.StorageEngine, asset.ObjectKey, strings.Join(opts, "/"), ext)
	writeJSON(w, http.StatusOK, map[string]any{
		"url":      url,
		"markdown": fmt.Sprintf("![%s](%s)", asset.OriginalName, url),
		"html":     fmt.Sprintf(`<img src="%s" alt="%s" />`, url, asset.OriginalName),
	})
}

// RandomImage returns a random public image (302 redirect by default, or JSON if ?format=json).
func (s *Server) RandomImage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	albumSlug := strings.TrimSpace(q.Get("album"))
	tag := strings.TrimSpace(q.Get("tag"))
	format := strings.TrimSpace(q.Get("format"))

	where := []string{
		"ua.visibility = 'public'",
		"ua.deleted_at IS NULL",
		"(ua.expires_at IS NULL OR ua.expires_at > NOW())",
		"so.moderation_status = 'passed'",
	}
	args := []any{}
	if albumSlug != "" {
		args = append(args, albumSlug)
		where = append(where, fmt.Sprintf("al.slug = $%d", len(args)))
	}
	if tag != "" {
		args = append(args, tag)
		where = append(where, fmt.Sprintf("$%d = ANY(ua.tags)", len(args)))
	}

	sql := assetSelectSQL + " WHERE " + strings.Join(where, " AND ") + " ORDER BY RANDOM() LIMIT 1"
	asset, err := scanAsset(s.Pool.QueryRow(r.Context(), sql, args...))
	if err != nil {
		writeErr(w, http.StatusNotFound, "没有找到符合条件的公开图片")
		return
	}
	s.populateAssetURLs(asset)

	if format == "json" {
		writeJSON(w, http.StatusOK, map[string]any{"asset": asset, "url": asset.DirectURL})
		return
	}
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	http.Redirect(w, r, asset.DirectURL, http.StatusFound)
}

// PublicUserProfile serves /api/v1/users/{username} for public creator galleries.
func (s *Server) PublicUserProfile(w http.ResponseWriter, r *http.Request) {
	username := strings.TrimSpace(chi.URLParam(r, "username"))
	var u models.User
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, username, role, avatar_url, bio, public_profile, created_at
		FROM users WHERE username = $1 AND status = 'active'
	`, username).Scan(&u.ID, &u.Username, &u.Role, &u.AvatarURL, &u.Bio, &u.PublicProfile, &u.CreatedAt)
	if err != nil {
		writeErr(w, http.StatusNotFound, "用户不存在")
		return
	}
	if !u.PublicProfile {
		writeErr(w, http.StatusForbidden, "该用户未开启公开个人主页")
		return
	}

	// Public albums
	alRows, err := s.Pool.Query(r.Context(), `
		SELECT a.id, a.user_id, a.parent_id, a.slug, a.title, a.description, a.visibility,
		       FALSE,
		       COALESCE(NULLIF(a.cover_short_code, ''), (
		           SELECT ua2.short_code FROM user_assets ua2
		           WHERE ua2.album_id = a.id AND ua2.deleted_at IS NULL AND ua2.visibility = 'public'
		           ORDER BY ua2.created_at DESC LIMIT 1
		       ), ''),
		       a.created_at,
		       COUNT(ua.id) FILTER (WHERE ua.deleted_at IS NULL AND ua.visibility = 'public')
		FROM albums a
		LEFT JOIN user_assets ua ON ua.album_id = a.id
		WHERE a.user_id = $1 AND a.visibility = 'public'
		GROUP BY a.id
		ORDER BY a.created_at DESC
	`, u.ID)
	albums := []models.Album{}
	if err == nil {
		defer alRows.Close()
		for alRows.Next() {
			var al models.Album
			if alRows.Scan(&al.ID, &al.UserID, &al.ParentID, &al.Slug, &al.Title, &al.Description, &al.Visibility, &al.HasPassword, &al.CoverCode, &al.CreatedAt, &al.AssetCount) == nil {
				if al.CoverCode != "" {
					al.CoverURL = fmt.Sprintf("%s/raw/%s", s.Cfg.CDNPublicURL, al.CoverCode)
				}
				albums = append(albums, al)
			}
		}
	}

	// Public assets
	rows, err := s.Pool.Query(r.Context(), assetSelectSQL+`
		WHERE ua.user_id = $1 AND ua.visibility = 'public' AND ua.deleted_at IS NULL
		  AND (ua.expires_at IS NULL OR ua.expires_at > NOW())
		  AND so.moderation_status = 'passed'
		ORDER BY ua.created_at DESC LIMIT 80
	`, u.ID)
	assets := []*models.AssetView{}
	var totalViews int64
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			if a, err := scanAsset(rows); err == nil {
				s.populateAssetURLs(a)
				assets = append(assets, a)
				totalViews += a.ViewCount
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user":   u,
		"albums": albums,
		"assets": assets,
		"stats": map[string]any{
			"public_assets": len(assets),
			"public_albums": len(albums),
			"total_views":   totalViews,
		},
	})
}

// LskyCompatUpload provides Lsky Pro v2 API-compatible upload response for PicGo/PicList/Obsidian plugins.
func (s *Server) LskyCompatUpload(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	_, policy, quota, used, err := s.resolveUploadRoleAndQuota(r.Context(), p)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"status": false, "message": err.Error()})
		return
	}
	if err := r.ParseMultipartForm(policy.MaxFileSizeBytes + 1024*1024); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "解析表单失败或文件超出上限"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("image")
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "缺少 file 字段"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, policy.MaxFileSizeBytes+1))
	if err != nil || int64(len(data)) > policy.MaxFileSizeBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"status": false, "message": "文件超出大小限制"})
		return
	}
	if p != nil && used+int64(len(data)) > quota {
		writeJSON(w, http.StatusInsufficientStorage, map[string]any{"status": false, "message": "存储配额已满"})
		return
	}
	mimeType := detectImageMime(data, header.Filename)
	if !containsStr(policy.AllowedMimes, mimeType) {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"status": false, "message": "不支持的格式: " + mimeType})
		return
	}

	var albumID *int64
	if aidStr := r.FormValue("album_id"); aidStr != "" {
		if aid, err := strconv.ParseInt(aidStr, 10, 64); err == nil {
			albumID = &aid
		}
	}
	vis := r.FormValue("visibility")
	if vis == "" {
		vis = "public"
	}
	asset, _, err := s.storeRawBytes(r.Context(), p, policy, data, header.Filename, mimeType, r.FormValue("engine"), albumID, vis, "", nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": false, "message": err.Error()})
		return
	}

	md5Sum := md5.Sum(data)
	sha1Sum := sha1.Sum(data)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  true,
		"message": "success",
		"data": map[string]any{
			"key":         asset.ShortCode,
			"name":        asset.ShortCode,
			"pathname":    asset.ObjectKey,
			"origin_name": asset.OriginalName,
			"size":        float64(asset.SizeBytes) / 1024.0,
			"mimetype":    asset.MimeType,
			"extension":   strings.TrimPrefix(strings.ToLower(filepath.Ext(header.Filename)), "."),
			"md5":         hex.EncodeToString(md5Sum[:]),
			"sha1":        hex.EncodeToString(sha1Sum[:]),
			"links": map[string]any{
				"url":                asset.DirectURL,
				"html":               fmt.Sprintf(`<img src="%s" alt="%s" title="%s" />`, asset.DirectURL, asset.OriginalName, asset.OriginalName),
				"bbcode":             fmt.Sprintf("[img]%s[/img]", asset.DirectURL),
				"markdown":           fmt.Sprintf("![%s](%s)", asset.OriginalName, asset.DirectURL),
				"markdown_with_link": fmt.Sprintf("[![%s](%s)](%s)", asset.OriginalName, asset.ThumbURL, asset.ShareURL),
				"thumbnail_url":      asset.ThumbURL,
			},
		},
	})
}

// MyAnalytics returns personal storage breakdown, 14-day upload/view trends, and top viewed assets.
func (s *Server) MyAnalytics(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())

	var totalAssets, totalViews, totalAlbums, trashCount int64
	var localBytes, r2Bytes int64
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL),
		       COALESCE(SUM(view_count) FILTER (WHERE deleted_at IS NULL), 0),
		       COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)
		FROM user_assets WHERE user_id = $1
	`, p.UserID).Scan(&totalAssets, &totalViews, &trashCount)
	_ = s.Pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM albums WHERE user_id = $1`, p.UserID).Scan(&totalAlbums)
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(so.size_bytes) FILTER (WHERE so.storage_engine = 'local'), 0),
		       COALESCE(SUM(so.size_bytes) FILTER (WHERE so.storage_engine = 'r2'), 0)
		FROM user_assets ua
		JOIN storage_objects so ON so.id = ua.object_id
		WHERE ua.user_id = $1 AND ua.deleted_at IS NULL
	`, p.UserID).Scan(&localBytes, &r2Bytes)

	// Breakdown by MIME type
	mimeBreakdown := []map[string]any{}
	if rows, err := s.Pool.Query(r.Context(), `
		SELECT so.mime_type, COUNT(*), COALESCE(SUM(so.size_bytes), 0)
		FROM user_assets ua
		JOIN storage_objects so ON so.id = ua.object_id
		WHERE ua.user_id = $1 AND ua.deleted_at IS NULL
		GROUP BY so.mime_type ORDER BY COUNT(*) DESC
	`, p.UserID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var m string
			var cnt, sz int64
			if rows.Scan(&m, &cnt, &sz) == nil {
				mimeBreakdown = append(mimeBreakdown, map[string]any{"mime": m, "count": cnt, "bytes": sz})
			}
		}
	}

	// 14-day trend (filled with 0 for missing days)
	trendMap := map[string]map[string]int64{}
	if rows, err := s.Pool.Query(r.Context(), `
		SELECT to_char(stat_date, 'YYYY-MM-DD'), uploads, views, bytes_uploaded
		FROM daily_stats
		WHERE user_id = $1 AND stat_date >= CURRENT_DATE - INTERVAL '13 days'
		ORDER BY stat_date ASC
	`, p.UserID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d string
			var up, vw, bt int64
			if rows.Scan(&d, &up, &vw, &bt) == nil {
				trendMap[d] = map[string]int64{"uploads": up, "views": vw, "bytes": bt}
			}
		}
	}
	trend := make([]map[string]any, 0, 14)
	for i := 13; i >= 0; i-- {
		day := time.Now().AddDate(0, 0, -i).Format("2006-01-02")
		entry := trendMap[day]
		trend = append(trend, map[string]any{
			"date":    day[5:], // MM-DD
			"uploads": entry["uploads"],
			"views":   entry["views"],
			"bytes":   entry["bytes"],
		})
	}

	// Top 5 popular images
	topAssets := []*models.AssetView{}
	if rows, err := s.Pool.Query(r.Context(), assetSelectSQL+`
		WHERE ua.user_id = $1 AND ua.deleted_at IS NULL
		ORDER BY ua.view_count DESC, ua.created_at DESC LIMIT 5
	`, p.UserID); err == nil {
		defer rows.Close()
		for rows.Next() {
			if a, err := scanAsset(rows); err == nil {
				s.populateAssetURLs(a)
				topAssets = append(topAssets, a)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"summary": map[string]any{
			"total_assets": totalAssets,
			"total_views":  totalViews,
			"total_albums": totalAlbums,
			"trash_count":  trashCount,
			"local_bytes":  localBytes,
			"r2_bytes":     r2Bytes,
		},
		"mime_breakdown": mimeBreakdown,
		"trend":          trend,
		"top_assets":     topAssets,
	})
}

// AdminAnalytics returns site-wide 14-day trends and format breakdown for the admin console.
func (s *Server) AdminAnalytics(w http.ResponseWriter, r *http.Request) {
	trendMap := map[string]map[string]int64{}
	if rows, err := s.Pool.Query(r.Context(), `
		SELECT to_char(stat_date, 'YYYY-MM-DD'), SUM(uploads), SUM(views), SUM(bytes_uploaded)
		FROM daily_stats
		WHERE stat_date >= CURRENT_DATE - INTERVAL '13 days'
		GROUP BY stat_date ORDER BY stat_date ASC
	`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d string
			var up, vw, bt int64
			if rows.Scan(&d, &up, &vw, &bt) == nil {
				trendMap[d] = map[string]int64{"uploads": up, "views": vw, "bytes": bt}
			}
		}
	}
	trend := make([]map[string]any, 0, 14)
	for i := 13; i >= 0; i-- {
		day := time.Now().AddDate(0, 0, -i).Format("2006-01-02")
		entry := trendMap[day]
		trend = append(trend, map[string]any{
			"date":    day[5:],
			"uploads": entry["uploads"],
			"views":   entry["views"],
			"bytes":   entry["bytes"],
		})
	}

	mimeBreakdown := []map[string]any{}
	if rows, err := s.Pool.Query(r.Context(), `
		SELECT mime_type, COUNT(*), COALESCE(SUM(size_bytes), 0)
		FROM storage_objects
		GROUP BY mime_type ORDER BY COUNT(*) DESC
	`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var m string
			var cnt, sz int64
			if rows.Scan(&m, &cnt, &sz) == nil {
				mimeBreakdown = append(mimeBreakdown, map[string]any{"mime": m, "count": cnt, "bytes": sz})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"trend":          trend,
		"mime_breakdown": mimeBreakdown,
	})
}

// AdminTestStorage probes all configured storage drivers and returns health & latency.
func (s *Server) AdminTestStorage(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	start := time.Now()
	status := s.Router.Status(r.Context())
	elapsedMs := time.Since(start).Milliseconds()
	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "admin.storage.test", "storage", "all",
		map[string]any{"elapsed_ms": elapsedMs}, middleware.ClientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{
		"storage":    status,
		"elapsed_ms": elapsedMs,
	})
}
