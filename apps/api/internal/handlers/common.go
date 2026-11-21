package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"lumina-imagehost/internal/cdn"
	"lumina-imagehost/internal/config"
	"lumina-imagehost/internal/db/sqlc"
	"lumina-imagehost/internal/imaging"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
	"lumina-imagehost/internal/storage"
	"lumina-imagehost/internal/worker"
)

type Server struct {
	Cfg     *config.Config
	Pool    *pgxpool.Pool
	Queries *sqlc.Queries
	Redis   *redis.Client
	Router  *storage.Router
	Auth    *middleware.Authenticator
	Purger  *cdn.Purger
	Worker  *worker.BackgroundWorker
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	return dec.Decode(dst)
}

const shortAlphabet = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"

func randomCode(n int) string {
	b := make([]byte, n)
	max := big.NewInt(int64(len(shortAlphabet)))
	for i := range b {
		v, _ := rand.Int(rand.Reader, max)
		b[i] = shortAlphabet[v.Int64()]
	}
	return string(b)
}

func (s *Server) getRolePolicy(ctx context.Context, role string) (*models.RolePolicy, error) {
	if s.Queries != nil {
		return s.Queries.GetRolePolicy(ctx, role)
	}
	var p models.RolePolicy
	err := s.Pool.QueryRow(ctx, `
		SELECT role, display_name, storage_quota_bytes, max_file_size_bytes, allowed_mimes,
		       rate_limit_per_min, COALESCE(monthly_upload_limit, 0), allowed_engines, default_engine, require_moderation,
		       allow_api_token, allow_custom_watermark, updated_at
		FROM role_policies WHERE role = $1
	`, role).Scan(
		&p.Role, &p.DisplayName, &p.StorageQuotaBytes, &p.MaxFileSizeBytes, &p.AllowedMimes,
		&p.RateLimitPerMin, &p.MonthlyUploadLimit, &p.AllowedEngines, &p.DefaultEngine, &p.RequireModeration,
		&p.AllowAPIToken, &p.AllowCustomWatermark, &p.UpdatedAt,
	)
	return &p, err
}

func (s *Server) getSiteSetting(ctx context.Context, key string) map[string]any {
	res := map[string]any{}
	if s.Queries != nil {
		if raw, err := s.Queries.GetSiteSettingRaw(ctx, key); err == nil {
			_ = json.Unmarshal(raw, &res)
		}
		return res
	}
	var raw []byte
	if err := s.Pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, key).Scan(&raw); err == nil {
		_ = json.Unmarshal(raw, &res)
	}
	return res
}

// signRawURL creates an expiring HMAC-SHA256 signature for private/password-protected direct image URLs.
func (s *Server) signRawURL(shortCode string, expUnix int64) string {
	mac := hmac.New(sha256.New, []byte(s.Cfg.JWTSecret))
	mac.Write([]byte(fmt.Sprintf("raw:%s:%d", shortCode, expUnix)))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

func (s *Server) verifyRawSignature(shortCode, expStr, sig string) bool {
	if expStr == "" || sig == "" {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	expected := s.signRawURL(shortCode, exp)
	return hmac.Equal([]byte(expected), []byte(sig))
}

// buildWatermarkOpt turns a user's watermark preset into an imgproxy wm: processing directive.
func buildWatermarkOpt(wp *models.WatermarkPreset) string {
	if wp == nil {
		return "wm:0.5:soea:20:20:0.25"
	}
	pos := wp.Position
	if wp.Tiled {
		pos = "re"
	} else if pos == "" {
		pos = "soea"
	}
	opacity := wp.Opacity
	if opacity <= 0 || opacity > 1 {
		opacity = 0.5
	}
	scale := wp.Scale
	if scale <= 0 || scale > 1 {
		scale = 0.25
	}
	return fmt.Sprintf("wm:%.2f:%s:%d:%d:%.2f", opacity, pos, wp.OffsetX, wp.OffsetY, scale)
}

func (s *Server) getUserDefaultWatermark(ctx context.Context, userID *int64) *models.WatermarkPreset {
	if userID == nil || *userID <= 0 {
		return nil
	}
	var wp models.WatermarkPreset
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, name, mode, text_content, COALESCE(image_url,''), font_size, text_color,
		       opacity, position, offset_x, offset_y, scale, angle, tiled, is_default, created_at
		FROM watermark_presets
		WHERE user_id = $1 AND is_default = TRUE
		ORDER BY created_at DESC LIMIT 1
	`, *userID).Scan(
		&wp.ID, &wp.UserID, &wp.Name, &wp.Mode, &wp.TextContent, &wp.ImageURL, &wp.FontSize, &wp.TextColor,
		&wp.Opacity, &wp.Position, &wp.OffsetX, &wp.OffsetY, &wp.Scale, &wp.Angle, &wp.Tiled, &wp.IsDefault, &wp.CreatedAt,
	)
	if err != nil {
		return nil
	}
	return &wp
}

func (s *Server) populateAssetURLs(a *models.AssetView) {
	s.populateAssetURLsWithWatermark(a, nil)
}

func (s *Server) populateAssetURLsWithWatermark(a *models.AssetView, wp *models.WatermarkPreset) {
	// Private/password images always route through /raw/{code} with an expiring HMAC signature
	// so the authenticated owner / unlocked viewer can render <img> cleanly even across a separate CDN domain.
	if a.Visibility == "private" || a.Visibility == "password" {
		exp := time.Now().Add(2 * time.Hour).Unix()
		sig := s.signRawURL(a.ShortCode, exp)
		a.DirectURL = fmt.Sprintf("%s/raw/%s?exp=%d&sig=%s", s.Cfg.CDNPublicURL, a.ShortCode, exp, sig)
	} else if a.StorageEngine == "r2" && s.Cfg.R2PublicURL != "" {
		a.DirectURL = fmt.Sprintf("%s/%s", s.Cfg.R2PublicURL, a.ObjectKey)
	} else {
		a.DirectURL = fmt.Sprintf("%s/raw/%s", s.Cfg.CDNPublicURL, a.ShortCode)
	}
	a.ThumbURL = imaging.BuildImgproxyURL(s.Cfg, a.StorageEngine, a.ObjectKey, "rs:fit:720:0/q:82", "webp")
	a.WebPURL = imaging.BuildImgproxyURL(s.Cfg, a.StorageEngine, a.ObjectKey, "q:85", "webp")
	a.AVIFURL = imaging.BuildImgproxyURL(s.Cfg, a.StorageEngine, a.ObjectKey, "q:75", "avif")
	if a.Visibility == "private" || a.Visibility == "password" {
		exp := time.Now().Add(2 * time.Hour).Unix()
		sig := s.signRawURL(a.ShortCode, exp)
		if wp != nil {
			a.WatermarkURL = fmt.Sprintf("%s/raw/%s/watermark?preset_id=%d&exp=%d&sig=%s", s.Cfg.CDNPublicURL, a.ShortCode, wp.ID, exp, sig)
		} else {
			a.WatermarkURL = fmt.Sprintf("%s/raw/%s/watermark?exp=%d&sig=%s", s.Cfg.CDNPublicURL, a.ShortCode, exp, sig)
		}
	} else if wp != nil {
		a.WatermarkURL = fmt.Sprintf("%s/raw/%s/watermark?preset_id=%d", s.Cfg.CDNPublicURL, a.ShortCode, wp.ID)
	} else {
		a.WatermarkURL = fmt.Sprintf("%s/raw/%s/watermark", s.Cfg.CDNPublicURL, a.ShortCode)
	}
	a.ShareURL = fmt.Sprintf("%s/i/%s", s.Cfg.AppPublicURL, a.ShortCode)
}

func containsStr(list []string, target string) bool {
	t := strings.ToLower(target)
	for _, s := range list {
		if strings.ToLower(s) == t {
			return true
		}
	}
	return false
}

func detectImageMime(data []byte, filename string) string {
	lower := strings.ToLower(strings.TrimSpace(filename))
	if strings.HasSuffix(lower, ".svg") {
		return "image/svg+xml"
	}
	if len(data) >= 12 && bytes.Equal(data[4:8], []byte("ftyp")) {
		brand := string(data[8:12])
		if brand == "avif" || brand == "avis" || strings.HasSuffix(lower, ".avif") {
			return "image/avif"
		}
	}
	if strings.HasSuffix(lower, ".avif") {
		return "image/avif"
	}
	mt := http.DetectContentType(data)
	if mt == "application/octet-stream" && strings.HasSuffix(lower, ".webp") {
		return "image/webp"
	}
	return mt
}
