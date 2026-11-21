package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
	"lumina-imagehost/internal/security"
)

func (s *Server) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username   string `json:"username"`
		Email      string `json:"email"`
		Password   string `json:"password"`
		InviteCode string `json:"invite_code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json payload")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if len(req.Username) < 3 || len(req.Password) < 6 || !strings.Contains(req.Email, "@") {
		writeErr(w, http.StatusBadRequest, "用户名至少3位、密码至少6位且邮箱需合法")
		return
	}

	general := s.getSiteSetting(r.Context(), "general")
	if allow, ok := general["allow_registration"].(bool); ok && !allow {
		writeErr(w, http.StatusForbidden, "管理员已关闭新用户注册")
		return
	}
	requireInvite, _ := general["require_invite_code"].(bool)
	assignedRole := "user"

	if requireInvite || strings.TrimSpace(req.InviteCode) != "" {
		code := strings.TrimSpace(req.InviteCode)
		if code == "" {
			writeErr(w, http.StatusBadRequest, "当前站点需要有效邀请码才能注册")
			return
		}
		var invRole string
		err := s.Pool.QueryRow(r.Context(), `
			UPDATE invite_codes
			SET used_count = used_count + 1
			WHERE code = $1 AND used_count < max_uses AND (expires_at IS NULL OR expires_at > NOW())
			RETURNING role
		`, code).Scan(&invRole)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "邀请码无效、已过期或已达到使用上限")
			return
		}
		assignedRole = invRole
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	var uid int64
	err = s.Pool.QueryRow(r.Context(), `
		INSERT INTO users (username, email, password_hash, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, req.Username, req.Email, string(hash), assignedRole).Scan(&uid)
	if err != nil {
		writeErr(w, http.StatusConflict, "用户名或邮箱已被占用")
		return
	}

	db.WriteAudit(r.Context(), s.Pool, &uid, req.Username, "user.register", "user", fmt.Sprint(uid), map[string]any{"role": assignedRole}, middleware.ClientIP(r))
	s.issueSessionResponse(w, r, uid, req.Username, assignedRole)
}

func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Identifier string `json:"identifier"` // email or username
		Password   string `json:"password"`
		TOTPCode   string `json:"totp_code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json payload")
		return
	}
	ident := strings.TrimSpace(req.Identifier)

	var uid int64
	var username, role, passHash, status, totpSecret string
	var totpEnabled bool
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, username, role, password_hash, status, totp_secret, totp_enabled
		FROM users
		WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
	`, ident).Scan(&uid, &username, &role, &passHash, &status, &totpSecret, &totpEnabled)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	if status != "active" {
		writeErr(w, http.StatusForbidden, "该账号已被封禁，请联系管理员")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passHash), []byte(req.Password)); err != nil {
		writeErr(w, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	if totpEnabled {
		if req.TOTPCode == "" {
			writeJSON(w, http.StatusAccepted, map[string]any{"require_2fa": true, "message": "请输入两步验证 (2FA) 6位动态码"})
			return
		}
		if !security.VerifyTOTP(totpSecret, req.TOTPCode) {
			writeErr(w, http.StatusUnauthorized, "2FA 验证码错误")
			return
		}
	}

	_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET last_login_at = NOW() WHERE id = $1`, uid)
	db.WriteAudit(r.Context(), s.Pool, &uid, username, "user.login", "user", fmt.Sprint(uid), map[string]any{}, middleware.ClientIP(r))
	s.issueSessionResponse(w, r, uid, username, role)
}

func (s *Server) issueSessionResponse(w http.ResponseWriter, r *http.Request, uid int64, username, role string) {
	sid := uuid.New()
	refreshPlain := "lum_rt_" + randomCode(40)
	rSum := sha256.Sum256([]byte(refreshPlain))
	rHash := hex.EncodeToString(rSum[:])
	exp := time.Now().Add(30 * 24 * time.Hour)
	_, err := s.Pool.Exec(r.Context(), `
		INSERT INTO user_sessions (id, user_id, user_agent, ip_address, refresh_token_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, sid, uid, r.UserAgent(), middleware.ClientIP(r), rHash, exp)
	s.setRefreshCookie(w, refreshPlain, exp)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to create session")
		return
	}
	token, err := s.Auth.IssueJWT(uid, username, role, sid.String())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to sign token")
		return
	}
	user, _ := s.loadUserByID(r, uid)
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  user,
	})
}

func (s *Server) loadUserByID(r *http.Request, uid int64) (*models.User, error) {
	var u models.User
	var quotaOverride *int64
	var policyQuota int64
	err := s.Pool.QueryRow(r.Context(), `
		SELECT u.id, u.username, u.email, u.role, u.avatar_url, u.bio, u.public_profile,
		       u.storage_quota_override, rp.storage_quota_bytes, u.storage_used_bytes,
		       u.default_engine, u.totp_enabled, u.status, u.last_login_at, u.created_at
		FROM users u
		JOIN role_policies rp ON rp.role = u.role
		WHERE u.id = $1
	`, uid).Scan(
		&u.ID, &u.Username, &u.Email, &u.Role, &u.AvatarURL, &u.Bio, &u.PublicProfile,
		&quotaOverride, &policyQuota, &u.StorageUsedBytes,
		&u.DefaultEngine, &u.TOTPEnabled, &u.Status, &u.LastLoginAt, &u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	if quotaOverride != nil {
		u.StorageQuotaBytes = *quotaOverride
	} else {
		u.StorageQuotaBytes = policyQuota
	}
	return &u, nil
}

func (s *Server) GetMe(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	u, err := s.loadUserByID(r, p.UserID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	policy, _ := s.getRolePolicy(r.Context(), u.Role)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":   u,
		"policy": policy,
	})
}

func (s *Server) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		Bio           string `json:"bio"`
		AvatarURL     string `json:"avatar_url"`
		PublicProfile bool   `json:"public_profile"`
		DefaultEngine string `json:"default_engine"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.DefaultEngine != "local" && req.DefaultEngine != "r2" && req.DefaultEngine != "smart" {
		req.DefaultEngine = "smart"
	}
	_, err := s.Pool.Exec(r.Context(), `
		UPDATE users SET bio = $1, avatar_url = $2, public_profile = $3, default_engine = $4, updated_at = NOW()
		WHERE id = $5
	`, req.Bio, req.AvatarURL, req.PublicProfile, req.DefaultEngine, p.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update profile failed")
		return
	}
	u, _ := s.loadUserByID(r, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (s *Server) ChangePassword(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.NewPassword) < 6 {
		writeErr(w, http.StatusBadRequest, "新密码至少 6 位")
		return
	}
	var currentHash string
	_ = s.Pool.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id = $1`, p.UserID).Scan(&currentHash)
	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.CurrentPassword)); err != nil {
		writeErr(w, http.StatusUnauthorized, "当前密码不正确")
		return
	}
	newHash, _ := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, string(newHash), p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) Setup2FA(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	secret, err := security.GenerateTOTPSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "generate secret failed")
		return
	}
	_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET totp_secret = $1 WHERE id = $2`, secret, p.UserID)
	otpAuth := fmt.Sprintf("otpauth://totp/Lumina:%s?secret=%s&issuer=Lumina", p.Username, secret)
	writeJSON(w, http.StatusOK, map[string]any{
		"secret":      secret,
		"otpauth_url": otpAuth,
	})
}

func (s *Server) Verify2FA(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		Code   string `json:"code"`
		Enable bool   `json:"enable"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if !req.Enable {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET totp_enabled = FALSE, totp_secret = '' WHERE id = $1`, p.UserID)
		writeJSON(w, http.StatusOK, map[string]any{"totp_enabled": false})
		return
	}
	var secret string
	_ = s.Pool.QueryRow(r.Context(), `SELECT totp_secret FROM users WHERE id = $1`, p.UserID).Scan(&secret)
	if !security.VerifyTOTP(secret, req.Code) {
		writeErr(w, http.StatusBadRequest, "验证码不正确，请确认手机时间同步")
		return
	}
	_, _ = s.Pool.Exec(r.Context(), `UPDATE users SET totp_enabled = TRUE WHERE id = $1`, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"totp_enabled": true})
}

func (s *Server) ListSessions(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, user_agent, ip_address, created_at, expires_at
		FROM user_sessions
		WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()
		ORDER BY created_at DESC
	`, p.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query sessions failed")
		return
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		var id, ua, ip string
		var createdAt, expAt time.Time
		if rows.Scan(&id, &ua, &ip, &createdAt, &expAt) == nil {
			list = append(list, map[string]any{
				"id":         id,
				"user_agent": ua,
				"ip_address": ip,
				"current":    id == p.SessionID,
				"created_at": createdAt,
				"expires_at": expAt,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": list})
}

func (s *Server) RevokeSession(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	sid := chi.URLParam(r, "id")
	_, _ = s.Pool.Exec(r.Context(), `UPDATE user_sessions SET revoked = TRUE WHERE id = $1 AND user_id = $2`, sid, p.UserID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	if p != nil && p.SessionID != "" {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE user_sessions SET revoked = TRUE WHERE id = $1`, p.SessionID)
	}
	s.setRefreshCookie(w, "", time.Unix(0, 0))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
