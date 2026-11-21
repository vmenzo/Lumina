package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"lumina-imagehost/internal/config"
)

type ctxKey string

const (
	UserCtxKey ctxKey = "lumina_user"
)

type AuthPrincipal struct {
	UserID    int64
	Username  string
	Role      string
	SessionID string
	IsToken   bool
	Scopes    []string
}

func (p *AuthPrincipal) HasScope(scope string) bool {
	if !p.IsToken {
		return true
	}
	for _, s := range p.Scopes {
		if s == scope || s == "admin" {
			return true
		}
	}
	return false
}

type Claims struct {
	UserID    int64  `json:"uid"`
	Username  string `json:"uname"`
	Role      string `json:"role"`
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

type Authenticator struct {
	cfg   *config.Config
	pool  *pgxpool.Pool
	redis *redis.Client
}

func NewAuthenticator(cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client) *Authenticator {
	return &Authenticator{cfg: cfg, pool: pool, redis: rdb}
}

func (a *Authenticator) IssueJWT(userID int64, username, role, sessionID string) (string, error) {
	claims := Claims{
		UserID:    userID,
		Username:  username,
		Role:      role,
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "lumina-imagehost",
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(a.cfg.JWTSecret))
}

func (a *Authenticator) resolvePrincipal(r *http.Request) *AuthPrincipal {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	tokenStr := ""
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		tokenStr = strings.TrimSpace(authHeader[7:])
	} else if t := strings.TrimSpace(r.Header.Get("X-API-Token")); t != "" {
		tokenStr = t
	}
	if tokenStr == "" {
		return nil
	}

	// 1. Check API Token (lum_...)
	if strings.HasPrefix(tokenStr, "lum_") {
		sum := sha256.Sum256([]byte(tokenStr))
		hashHex := hex.EncodeToString(sum[:])
		var p AuthPrincipal
		var status string
		err := a.pool.QueryRow(r.Context(), `
			SELECT t.user_id, u.username, u.role, u.status, t.scopes
			FROM api_tokens t
			JOIN users u ON u.id = t.user_id
			WHERE t.token_hash = $1 AND (t.expires_at IS NULL OR t.expires_at > NOW())
		`, hashHex).Scan(&p.UserID, &p.Username, &p.Role, &status, &p.Scopes)
		if err != nil || status != "active" {
			return nil
		}
		p.IsToken = true
		_, _ = a.pool.Exec(r.Context(), `UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = $1`, hashHex)
		return &p
	}

	// 2. Check JWT
	parsed, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (any, error) {
		return []byte(a.cfg.JWTSecret), nil
	})
	if err != nil || !parsed.Valid {
		return nil
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok {
		return nil
	}
	var revoked bool
	var status, role string
	err = a.pool.QueryRow(r.Context(), `
		SELECT s.revoked, u.status, u.role
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.id = $1 AND s.expires_at > NOW()
	`, claims.SessionID).Scan(&revoked, &status, &role)
	if err != nil || revoked || status != "active" {
		return nil
	}
	return &AuthPrincipal{
		UserID:    claims.UserID,
		Username:  claims.Username,
		Role:      role,
		SessionID: claims.SessionID,
	}
}

func (a *Authenticator) OptionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := a.resolvePrincipal(r); p != nil {
			r = r.WithContext(context.WithValue(r.Context(), UserCtxKey, p))
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Authenticator) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := a.resolvePrincipal(r)
		if p == nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized: valid login or api token required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), UserCtxKey, p)))
	})
}

func (a *Authenticator) RequireAdmin(next http.Handler) http.Handler {
	return a.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := PrincipalFromCtx(r.Context())
		if p == nil || p.Role != "admin" {
			writeJSONError(w, http.StatusForbidden, "forbidden: administrator privileges required")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

// RateLimit enforces a Redis-backed fixed-window rate limit per IP/User.
func (a *Authenticator) RateLimit(prefix string, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if a.redis == nil || limit <= 0 {
				next.ServeHTTP(w, r)
				return
			}
			ident := ClientIP(r)
			if p := PrincipalFromCtx(r.Context()); p != nil {
				ident = fmt.Sprintf("u:%d", p.UserID)
			}
			key := fmt.Sprintf("rl:%s:%s", prefix, ident)
			cnt, err := a.redis.Incr(r.Context(), key).Result()
			if err == nil {
				if cnt == 1 {
					_ = a.redis.Expire(r.Context(), key, window).Err()
				}
				if int(cnt) > limit {
					writeJSONError(w, http.StatusTooManyRequests, "rate limit exceeded, please slow down")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func PrincipalFromCtx(ctx context.Context) *AuthPrincipal {
	v := ctx.Value(UserCtxKey)
	if v == nil {
		return nil
	}
	p, _ := v.(*AuthPrincipal)
	return p
}

func ClientIP(r *http.Request) string {
	if cf := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cf != "" {
		return cf
	}
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg})
}
