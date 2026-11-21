package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
)

func (s *Server) ListAPITokens(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, name, token_prefix, scopes, last_used_at, expires_at, created_at
		FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC
	`, p.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query tokens failed")
		return
	}
	defer rows.Close()
	list := []models.APIToken{}
	for rows.Next() {
		var t models.APIToken
		if rows.Scan(&t.ID, &t.Name, &t.TokenPrefix, &t.Scopes, &t.LastUsedAt, &t.ExpiresAt, &t.CreatedAt) == nil {
			list = append(list, t)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": list})
}

func (s *Server) CreateAPIToken(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	pol, _ := s.getRolePolicy(r.Context(), p.Role)
	if pol != nil && !pol.AllowAPIToken {
		writeErr(w, http.StatusForbidden, "当前角色组不允许创建 API Token")
		return
	}
	var req struct {
		Name       string   `json:"name"`
		Scopes     []string `json:"scopes"`
		ExpireDays int      `json:"expire_days"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeErr(w, http.StatusBadRequest, "令牌名称不能为空")
		return
	}
	if len(req.Scopes) == 0 {
		req.Scopes = []string{"upload", "read"}
	}
	plain := "lum_" + randomCode(36)
	prefix := plain[:12]
	sum := sha256.Sum256([]byte(plain))
	hashHex := hex.EncodeToString(sum[:])

	var exp *time.Time
	if req.ExpireDays > 0 {
		t := time.Now().Add(time.Duration(req.ExpireDays) * 24 * time.Hour)
		exp = &t
	}
	var t models.APIToken
	err := s.Pool.QueryRow(r.Context(), `
		INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, scopes, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, name, token_prefix, scopes, expires_at, created_at
	`, p.UserID, strings.TrimSpace(req.Name), prefix, hashHex, req.Scopes, exp).Scan(
		&t.ID, &t.Name, &t.TokenPrefix, &t.Scopes, &t.ExpiresAt, &t.CreatedAt,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建令牌失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"token":       t,
		"plain_token": plain, // Shown only once!
	})
}

func (s *Server) DeleteAPIToken(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	_, _ = s.Pool.Exec(r.Context(), `DELETE FROM api_tokens WHERE id = $1 AND user_id = $2`, id, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) ListWatermarks(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, user_id, name, mode, text_content, COALESCE(image_url,''), font_size, text_color, opacity, position,
		       offset_x, offset_y, scale, angle, tiled, is_default, created_at
		FROM watermark_presets WHERE user_id = $1 ORDER BY created_at DESC
	`, p.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query watermarks failed")
		return
	}
	defer rows.Close()
	list := []models.WatermarkPreset{}
	for rows.Next() {
		var wp models.WatermarkPreset
		if rows.Scan(&wp.ID, &wp.UserID, &wp.Name, &wp.Mode, &wp.TextContent, &wp.ImageURL, &wp.FontSize, &wp.TextColor, &wp.Opacity,
			&wp.Position, &wp.OffsetX, &wp.OffsetY, &wp.Scale, &wp.Angle, &wp.Tiled, &wp.IsDefault, &wp.CreatedAt) == nil {
			list = append(list, wp)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": list})
}

func (s *Server) SaveWatermark(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req models.WatermarkPreset
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeErr(w, http.StatusBadRequest, "水印预设名称不能为空")
		return
	}
	if req.Mode == "" {
		req.Mode = "text"
	}
	if req.Position == "" {
		req.Position = "soea"
	}
	if req.FontSize <= 0 {
		req.FontSize = 24
	}
	if req.IsDefault {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE watermark_presets SET is_default = FALSE WHERE user_id = $1`, p.UserID)
	}
	var err error
	if req.ID > 0 {
		err = s.Pool.QueryRow(r.Context(), `
			UPDATE watermark_presets
			SET name=$1, mode=$2, text_content=$3, image_url=$4, font_size=$5, text_color=$6,
			    opacity=$7, position=$8, offset_x=$9, offset_y=$10, scale=$11, angle=$12, tiled=$13, is_default=$14
			WHERE id=$15 AND user_id=$16
			RETURNING id, created_at
		`, req.Name, req.Mode, req.TextContent, req.ImageURL, req.FontSize, req.TextColor,
			req.Opacity, req.Position, req.OffsetX, req.OffsetY, req.Scale, req.Angle, req.Tiled, req.IsDefault, req.ID, p.UserID).Scan(&req.ID, &req.CreatedAt)
	} else {
		err = s.Pool.QueryRow(r.Context(), `
			INSERT INTO watermark_presets (user_id, name, mode, text_content, image_url, font_size, text_color, opacity, position, offset_x, offset_y, scale, angle, tiled, is_default)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
			RETURNING id, created_at
		`, p.UserID, req.Name, req.Mode, req.TextContent, req.ImageURL, req.FontSize, req.TextColor, req.Opacity, req.Position, req.OffsetX, req.OffsetY, req.Scale, req.Angle, req.Tiled, req.IsDefault).Scan(&req.ID, &req.CreatedAt)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "保存水印预设失败")
		return
	}
	req.UserID = p.UserID
	writeJSON(w, http.StatusCreated, map[string]any{"preset": req})
}

func (s *Server) DeleteWatermark(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	_, _ = s.Pool.Exec(r.Context(), `DELETE FROM watermark_presets WHERE id = $1 AND user_id = $2`, id, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) SetDefaultWatermark(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	_, _ = s.Pool.Exec(r.Context(), `UPDATE watermark_presets SET is_default = FALSE WHERE user_id = $1`, p.UserID)
	_, _ = s.Pool.Exec(r.Context(), `UPDATE watermark_presets SET is_default = TRUE WHERE id = $1 AND user_id = $2`, id, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
