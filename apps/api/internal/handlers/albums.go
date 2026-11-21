package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
)

func (s *Server) ListAlbums(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	rows, err := s.Pool.Query(r.Context(), `
		SELECT a.id, a.user_id, a.parent_id, a.slug, a.title, a.description, a.visibility,
		       (a.access_password_hash <> ''),
		       COALESCE(NULLIF(a.cover_short_code, ''), (
		           SELECT ua2.short_code FROM user_assets ua2
		           WHERE ua2.album_id = a.id AND ua2.deleted_at IS NULL
		           ORDER BY ua2.created_at DESC LIMIT 1
		       ), '') AS cover_code,
		       a.created_at,
		       COUNT(ua.id) FILTER (WHERE ua.deleted_at IS NULL) AS asset_count
		FROM albums a
		LEFT JOIN user_assets ua ON ua.album_id = a.id
		WHERE a.user_id = $1
		GROUP BY a.id
		ORDER BY a.created_at DESC
	`, p.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "查询相册失败")
		return
	}
	defer rows.Close()
	list := []models.Album{}
	for rows.Next() {
		var al models.Album
		if rows.Scan(&al.ID, &al.UserID, &al.ParentID, &al.Slug, &al.Title, &al.Description, &al.Visibility, &al.HasPassword, &al.CoverCode, &al.CreatedAt, &al.AssetCount) == nil {
			if al.CoverCode != "" {
				al.CoverURL = fmt.Sprintf("%s/raw/%s", s.Cfg.CDNPublicURL, al.CoverCode)
			}
			list = append(list, al)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"albums": list})
}

func (s *Server) CreateAlbum(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Visibility  string `json:"visibility"`
		Password    string `json:"password"`
		ParentID    *int64 `json:"parent_id"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Title) == "" {
		writeErr(w, http.StatusBadRequest, "相册标题不能为空")
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
	slug := strings.ToLower(randomCode(8))
	var al models.Album
	err := s.Pool.QueryRow(r.Context(), `
		INSERT INTO albums (user_id, parent_id, slug, title, description, visibility, access_password_hash)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, user_id, parent_id, slug, title, description, visibility, created_at
	`, p.UserID, req.ParentID, slug, strings.TrimSpace(req.Title), req.Description, req.Visibility, passHash).Scan(
		&al.ID, &al.UserID, &al.ParentID, &al.Slug, &al.Title, &al.Description, &al.Visibility, &al.CreatedAt,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建相册失败")
		return
	}
	al.HasPassword = passHash != ""
	writeJSON(w, http.StatusCreated, map[string]any{"album": al})
}

func (s *Server) UpdateAlbum(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid album id")
		return
	}
	var req struct {
		Title          *string `json:"title"`
		Description    *string `json:"description"`
		Visibility     *string `json:"visibility"`
		Password       *string `json:"password"`
		CoverShortCode *string `json:"cover_short_code"`
		ParentID       *int64  `json:"parent_id"`
		ClearParent    bool    `json:"clear_parent"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	var ownerID int64
	if err := s.Pool.QueryRow(r.Context(), `SELECT user_id FROM albums WHERE id = $1`, id).Scan(&ownerID); err != nil {
		writeErr(w, http.StatusNotFound, "相册不存在")
		return
	}
	if ownerID != p.UserID && p.Role != "admin" {
		writeErr(w, http.StatusForbidden, "无权编辑他人相册")
		return
	}

	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET title = $1 WHERE id = $2`, strings.TrimSpace(*req.Title), id)
	}
	if req.Description != nil {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET description = $1 WHERE id = $2`, *req.Description, id)
	}
	if req.Visibility != nil {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET visibility = $1 WHERE id = $2`, *req.Visibility, id)
	}
	if req.Password != nil {
		if *req.Password == "" {
			_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET access_password_hash = '' WHERE id = $1`, id)
		} else {
			h, _ := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
			_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET access_password_hash = $1, visibility = 'password' WHERE id = $2`, string(h), id)
		}
	}
	if req.CoverShortCode != nil {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET cover_short_code = $1 WHERE id = $2`, strings.TrimSpace(*req.CoverShortCode), id)
	}
	if req.ClearParent {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET parent_id = NULL WHERE id = $1`, id)
	} else if req.ParentID != nil && *req.ParentID != id {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE albums SET parent_id = $1 WHERE id = $2`, *req.ParentID, id)
	}

	var al models.Album
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT a.id, a.user_id, a.parent_id, a.slug, a.title, a.description, a.visibility,
		       (a.access_password_hash <> ''), a.cover_short_code, a.created_at,
		       (SELECT COUNT(*) FROM user_assets ua WHERE ua.album_id = a.id AND ua.deleted_at IS NULL)
		FROM albums a WHERE a.id = $1
	`, id).Scan(&al.ID, &al.UserID, &al.ParentID, &al.Slug, &al.Title, &al.Description, &al.Visibility, &al.HasPassword, &al.CoverCode, &al.CreatedAt, &al.AssetCount)
	if al.CoverCode != "" {
		al.CoverURL = fmt.Sprintf("%s/raw/%s", s.Cfg.CDNPublicURL, al.CoverCode)
	}
	writeJSON(w, http.StatusOK, map[string]any{"album": al})
}

func (s *Server) DeleteAlbum(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	_, _ = s.Pool.Exec(r.Context(), `DELETE FROM albums WHERE id = $1 AND user_id = $2`, id, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
