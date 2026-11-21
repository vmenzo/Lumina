package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/middleware"
)

func (s *Server) ServeRawImage(w http.ResponseWriter, r *http.Request) {
	sec := s.getSiteSetting(r.Context(), "security")

	// 1. IP Blacklist check
	clientIP := middleware.ClientIP(r)
	if ipList, ok := sec["ip_blacklist"].([]any); ok {
		for _, item := range ipList {
			if ipStr, ok := item.(string); ok && strings.TrimSpace(ipStr) != "" && strings.TrimSpace(ipStr) == clientIP {
				http.Error(w, "Access denied by Lumina IP policy", http.StatusForbidden)
				return
			}
		}
	}

	// 2. Referer hotlink check (with optional block_empty_referer)
	refMode, _ := sec["referer_mode"].(string)
	blockEmpty, _ := sec["block_empty_referer"].(bool)
	if refMode == "whitelist" || refMode == "blacklist" {
		ref := strings.TrimSpace(r.Header.Get("Referer"))
		if ref == "" {
			if refMode == "whitelist" && blockEmpty {
				http.Error(w, "Empty referer blocked by Lumina policy", http.StatusForbidden)
				return
			}
		} else if u, err := url.Parse(ref); err == nil {
			host := strings.ToLower(u.Hostname())
			matched := false
			if arr, ok := sec["referer_list"].([]any); ok {
				for _, item := range arr {
					if d, ok := item.(string); ok && strings.TrimSpace(d) != "" && strings.HasSuffix(host, strings.ToLower(strings.TrimSpace(d))) {
						matched = true
						break
					}
				}
			}
			if (refMode == "whitelist" && !matched) || (refMode == "blacklist" && matched) {
				http.Error(w, "Hotlink blocked by Lumina referer policy", http.StatusForbidden)
				return
			}
		}
	}

	code := chi.URLParam(r, "code")
	// Strip optional extension (e.g. /raw/abc12345.webp -> abc12345)
	if dot := strings.IndexByte(code, '.'); dot > 0 {
		code = code[:dot]
	}

	var (
		assetID    int64
		ownerID    *int64
		engine     string
		key        string
		mimeType   string
		shaHex     string
		modStatus  string
		visibility string
		passHash   string
		expiresAt  *time.Time
	)
	err := s.Pool.QueryRow(r.Context(), `
		SELECT ua.id, ua.user_id, so.storage_engine, so.object_key, so.mime_type, so.sha256,
		       so.moderation_status, ua.visibility, ua.access_password_hash, ua.expires_at
		FROM user_assets ua
		JOIN storage_objects so ON so.id = ua.object_id
		WHERE ua.short_code = $1 AND ua.deleted_at IS NULL
	`, code).Scan(&assetID, &ownerID, &engine, &key, &mimeType, &shaHex, &modStatus, &visibility, &passHash, &expiresAt)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if modStatus == "blocked" {
		http.Error(w, "Image blocked", http.StatusUnavailableForLegalReasons)
		return
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		http.Error(w, "Image expired", http.StatusGone)
		return
	}

	// 3. Enforce private / password visibility with HMAC signed link, owner auth, or password
	if visibility == "private" || visibility == "password" {
		allowed := false
		// Check expiring HMAC signed URL (?exp=...&sig=...)
		if s.verifyRawSignature(code, r.URL.Query().Get("exp"), r.URL.Query().Get("sig")) {
			allowed = true
		}
		// Check authenticated owner/admin
		if !allowed {
			if p := middleware.PrincipalFromCtx(r.Context()); p != nil {
				if p.Role == "admin" || (ownerID != nil && *ownerID == p.UserID) {
					allowed = true
				}
			}
		}
		// Check password header/query for password-protected assets
		if !allowed && visibility == "password" && passHash != "" {
			pwd := r.URL.Query().Get("password")
			if pwd == "" {
				pwd = r.Header.Get("X-Share-Password")
			}
			if pwd != "" && bcrypt.CompareHashAndPassword([]byte(passHash), []byte(pwd)) == nil {
				allowed = true
			}
		}
		if !allowed {
			http.Error(w, "Private or password-protected image requires a signed URL or authentication", http.StatusForbidden)
			return
		}
	}

	// Async view count & daily analytics update
	go func(aid int64, uid *int64) {
		bgCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = s.Pool.Exec(bgCtx, `UPDATE user_assets SET view_count = view_count + 1 WHERE id = $1`, aid)
		db.RecordDailyStat(bgCtx, s.Pool, uid, 0, 1, 0)
	}(assetID, ownerID)

	// If stored in R2 and public R2 URL is configured (and not private/password), 302 redirect to Cloudflare edge directly
	if engine == "r2" && s.Cfg.R2PublicURL != "" && visibility != "private" && visibility != "password" {
		http.Redirect(w, r, fmt.Sprintf("%s/%s", s.Cfg.R2PublicURL, key), http.StatusFound)
		return
	}

	etag := `"` + shaHex[:16] + `"`
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	drv, err := s.Router.GetDriver(engine)
	if err != nil {
		http.Error(w, "Storage engine unavailable", http.StatusServiceUnavailable)
		return
	}
	rc, size, ct, err := drv.Get(r.Context(), key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rc.Close()

	if mimeType != "" {
		ct = mimeType
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("ETag", etag)
	if visibility == "private" || visibility == "password" {
		w.Header().Set("Cache-Control", "private, max-age=300")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, code))
	}
	if size > 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	}
	_, _ = io.Copy(w, rc)
}
