package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lumina-imagehost/internal/middleware"
)

func (s *Server) setRefreshCookie(w http.ResponseWriter, refreshPlain string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     "lumina_refresh_token",
		Value:    refreshPlain,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   strings.HasPrefix(s.Cfg.AppPublicURL, "https://"),
		Expires:  exp,
	})
}

// RefreshSession rotates an HttpOnly refresh token and issues a fresh short-lived JWT.
func (s *Server) RefreshSession(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("lumina_refresh_token")
	if err != nil || strings.TrimSpace(c.Value) == "" {
		writeErr(w, http.StatusUnauthorized, "missing refresh token")
		return
	}
	sum := sha256.Sum256([]byte(c.Value))
	hashHex := hex.EncodeToString(sum[:])

	var sid uuid.UUID
	var uid int64
	var username, role string
	err = s.Pool.QueryRow(r.Context(), `
		SELECT us.id, u.id, u.username, u.role
		FROM user_sessions us
		JOIN users u ON u.id = us.user_id
		WHERE us.refresh_token_hash = $1 AND us.revoked = FALSE AND us.expires_at > NOW() AND u.status = 'active'
	`, hashHex).Scan(&sid, &uid, &username, &role)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "refresh token expired or revoked")
		return
	}

	newPlain := "lum_rt_" + randomCode(40)
	newSum := sha256.Sum256([]byte(newPlain))
	newHash := hex.EncodeToString(newSum[:])
	newExp := time.Now().Add(30 * 24 * time.Hour)

	_, _ = s.Pool.Exec(r.Context(), `UPDATE user_sessions SET refresh_token_hash = $1, expires_at = $2 WHERE id = $3`, newHash, newExp, sid)
	token, err := s.Auth.IssueJWT(uid, username, role, sid.String())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to sign jwt")
		return
	}
	s.setRefreshCookie(w, newPlain, newExp)
	user, _ := s.loadUserByID(r, uid)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) OAuthRedirect(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	callback := fmt.Sprintf("%s/api/v1/auth/oauth/%s/callback", s.Cfg.AppPublicURL, provider)

	switch provider {
	case "github":
		if s.Cfg.GitHubClientID == "" {
			writeErr(w, http.StatusNotImplemented, "管理员尚未配置 GITHUB_CLIENT_ID")
			return
		}
		target := fmt.Sprintf("https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=user:email",
			url.QueryEscape(s.Cfg.GitHubClientID), url.QueryEscape(callback))
		http.Redirect(w, r, target, http.StatusFound)
	case "google":
		if s.Cfg.GoogleClientID == "" {
			writeErr(w, http.StatusNotImplemented, "管理员尚未配置 GOOGLE_CLIENT_ID")
			return
		}
		target := fmt.Sprintf("https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=openid%%20email%%20profile",
			url.QueryEscape(s.Cfg.GoogleClientID), url.QueryEscape(callback))
		http.Redirect(w, r, target, http.StatusFound)
	default:
		writeErr(w, http.StatusBadRequest, "unsupported oauth provider")
	}
}

func (s *Server) OAuthCallback(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Redirect(w, r, "/login?error=oauth_cancelled", http.StatusFound)
		return
	}
	callback := fmt.Sprintf("%s/api/v1/auth/oauth/%s/callback", s.Cfg.AppPublicURL, provider)

	var subject, email, username string
	switch provider {
	case "github":
		form := url.Values{
			"client_id":     {s.Cfg.GitHubClientID},
			"client_secret": {s.Cfg.GitHubClientSecret},
			"code":          {code},
			"redirect_uri":  {callback},
		}
		req, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
		if err != nil {
			http.Redirect(w, r, "/login?error=github_token_failed", http.StatusFound)
			return
		}
		var tok struct {
			AccessToken string `json:"access_token"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&tok)
		resp.Body.Close()

		uReq, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://api.github.com/user", nil)
		uReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		uResp, err := (&http.Client{Timeout: 10 * time.Second}).Do(uReq)
		if err != nil {
			http.Redirect(w, r, "/login?error=github_user_failed", http.StatusFound)
			return
		}
		var gu struct {
			ID    int64  `json:"id"`
			Login string `json:"login"`
			Email string `json:"email"`
		}
		_ = json.NewDecoder(uResp.Body).Decode(&gu)
		uResp.Body.Close()
		subject = fmt.Sprint(gu.ID)
		username = gu.Login
		email = gu.Email
		if email == "" {
			email = fmt.Sprintf("%s@users.noreply.github.com", gu.Login)
		}

	case "google":
		form := url.Values{
			"client_id":     {s.Cfg.GoogleClientID},
			"client_secret": {s.Cfg.GoogleClientSecret},
			"code":          {code},
			"grant_type":    {"authorization_code"},
			"redirect_uri":  {callback},
		}
		resp, err := http.PostForm("https://oauth2.googleapis.com/token", form)
		if err != nil {
			http.Redirect(w, r, "/login?error=google_token_failed", http.StatusFound)
			return
		}
		var tok struct {
			AccessToken string `json:"access_token"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&tok)
		resp.Body.Close()

		uReq, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://www.googleapis.com/oauth2/v2/userinfo", nil)
		uReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		uResp, err := (&http.Client{Timeout: 10 * time.Second}).Do(uReq)
		if err != nil {
			http.Redirect(w, r, "/login?error=google_user_failed", http.StatusFound)
			return
		}
		raw, _ := io.ReadAll(uResp.Body)
		uResp.Body.Close()
		var gu struct {
			ID    string `json:"id"`
			Email string `json:"email"`
			Name  string `json:"name"`
		}
		_ = json.Unmarshal(raw, &gu)
		subject = gu.ID
		email = gu.Email
		username = strings.Split(gu.Email, "@")[0]
	default:
		http.Redirect(w, r, "/login?error=unsupported", http.StatusFound)
		return
	}

	if subject == "" {
		http.Redirect(w, r, "/login?error=oauth_empty_profile", http.StatusFound)
		return
	}

	var uid int64
	var uname, role string
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, username, role FROM users WHERE oauth_provider = $1 AND oauth_subject = $2
	`, provider, subject).Scan(&uid, &uname, &role)
	if err != nil {
		// Create new user or link by email
		err = s.Pool.QueryRow(r.Context(), `
			INSERT INTO users (username, email, password_hash, role, oauth_provider, oauth_subject)
			VALUES ($1, $2, '', 'user', $3, $4)
			ON CONFLICT (email) DO UPDATE SET oauth_provider = EXCLUDED.oauth_provider, oauth_subject = EXCLUDED.oauth_subject
			RETURNING id, username, role
		`, username+"_"+randomCode(4), strings.ToLower(email), provider, subject).Scan(&uid, &uname, &role)
		if err != nil {
			http.Redirect(w, r, "/login?error=oauth_user_create_failed", http.StatusFound)
			return
		}
	}

	sid := uuid.New()
	refreshPlain := "lum_rt_" + randomCode(40)
	rSum := sha256.Sum256([]byte(refreshPlain))
	rHash := hex.EncodeToString(rSum[:])
	exp := time.Now().Add(30 * 24 * time.Hour)

	_, _ = s.Pool.Exec(r.Context(), `
		INSERT INTO user_sessions (id, user_id, user_agent, ip_address, refresh_token_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, sid, uid, r.UserAgent(), middleware.ClientIP(r), rHash, exp)

	jwtTok, _ := s.Auth.IssueJWT(uid, uname, role, sid.String())
	s.setRefreshCookie(w, refreshPlain, exp)
	http.Redirect(w, r, fmt.Sprintf("/login?oauth_token=%s", url.QueryEscape(jwtTok)), http.StatusFound)
}
