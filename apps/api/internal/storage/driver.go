package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"lumina-imagehost/internal/config"
)

type PresignedUpload struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Engine  string            `json:"engine"`
}

type Driver interface {
	Name() string
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	Delete(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, int64, error)
	PresignPut(ctx context.Context, key string, contentType string, size int64, ttl time.Duration) (*PresignedUpload, error)
	PublicURL(key string) string
	HealthCheck(ctx context.Context) error
}

type Router struct {
	mu           sync.RWMutex
	cfg          *config.Config
	localDriver  *LocalDriver
	r2Driver     *R2Driver
	thresholdMB  int64
}

func NewRouter(ctx context.Context, cfg *config.Config) (*Router, error) {
	r := &Router{
		cfg:         cfg,
		thresholdMB: cfg.SmartRouteThresholdMB,
	}
	if cfg.LocalEnabled {
		ld, err := NewLocalDriver(cfg)
		if err != nil {
			return nil, fmt.Errorf("init local driver: %w", err)
		}
		r.localDriver = ld
	}
	if cfg.R2Enabled && cfg.R2Endpoint != "" && cfg.R2Bucket != "" && cfg.R2AccessKeyID != "" {
		r2d, err := NewR2Driver(ctx, cfg)
		if err != nil {
			return nil, fmt.Errorf("init r2 driver: %w", err)
		}
		r.r2Driver = r2d
	}
	if r.localDriver == nil && r.r2Driver == nil {
		return nil, errors.New("at least one storage driver (local or r2) must be enabled")
	}
	return r, nil
}

func (r *Router) LocalDriver() *LocalDriver {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.localDriver
}

func (r *Router) GetDriver(engine string) (Driver, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	switch engine {
	case "local":
		if r.localDriver == nil {
			return nil, errors.New("local storage engine is disabled")
		}
		return r.localDriver, nil
	case "r2":
		if r.r2Driver == nil {
			return nil, errors.New("cloudflare r2 storage engine is not configured or disabled")
		}
		return r.r2Driver, nil
	default:
		return nil, fmt.Errorf("unknown storage engine: %s", engine)
	}
}

// ResolveEngine selects between local NVMe and Cloudflare R2 based on request, policy, and file size threshold.
func (r *Router) ResolveEngine(requested string, allowed []string, sizeBytes int64) (Driver, error) {
	r.mu.RLock()
	hasLocal := r.localDriver != nil
	hasR2 := r.r2Driver != nil
	thresholdBytes := r.thresholdMB * 1024 * 1024
	r.mu.RUnlock()

	isAllowed := func(eng string) bool {
		if len(allowed) == 0 {
			return true
		}
		for _, a := range allowed {
			if a == eng {
				return true
			}
		}
		return false
	}

	if requested == "local" {
		if !hasLocal {
			return nil, errors.New("本地存储引擎未启用")
		}
		if !isAllowed("local") {
			return nil, errors.New("当前角色组未开放本地存储权限")
		}
		return r.GetDriver("local")
	}
	if requested == "r2" {
		if !hasR2 {
			return nil, errors.New("Cloudflare R2 存储引擎未启用或配置不完整，请检查 .env 中的 R2 配置")
		}
		if !isAllowed("r2") {
			return nil, errors.New("当前角色组未开放 Cloudflare R2 存储权限")
		}
		return r.GetDriver("r2")
	}

	// Smart routing: larger files go to Cloudflare R2 (zero egress), smaller files to Local NVMe
	if hasR2 && isAllowed("r2") && sizeBytes >= thresholdBytes {
		return r.GetDriver("r2")
	}
	if hasLocal && isAllowed("local") {
		return r.GetDriver("local")
	}
	if hasR2 && isAllowed("r2") {
		return r.GetDriver("r2")
	}
	return nil, errors.New("no available storage engine allowed for this user role")
}

// Migrate streams an object directly from source engine to target engine and removes the source upon verification.
func (r *Router) Migrate(ctx context.Context, key, fromEngine, toEngine, contentType string) error {
	if fromEngine == toEngine {
		return nil
	}
	src, err := r.GetDriver(fromEngine)
	if err != nil {
		return err
	}
	dst, err := r.GetDriver(toEngine)
	if err != nil {
		return err
	}
	rc, size, ct, err := src.Get(ctx, key)
	if err != nil {
		return fmt.Errorf("read source (%s): %w", fromEngine, err)
	}
	defer rc.Close()
	if contentType == "" {
		contentType = ct
	}
	if err := dst.Put(ctx, key, rc, size, contentType); err != nil {
		return fmt.Errorf("write target (%s): %w", toEngine, err)
	}
	exists, _, err := dst.Exists(ctx, key)
	if err != nil || !exists {
		return errors.New("target verification failed after migration")
	}
	_ = src.Delete(ctx, key)
	return nil
}

func (r *Router) Status(ctx context.Context) map[string]any {
	res := map[string]any{
		"smart_route_threshold_mb": r.thresholdMB,
		"local":                    map[string]any{"enabled": false, "healthy": false},
		"r2":                       map[string]any{"enabled": false, "healthy": false},
	}
	if r.localDriver != nil {
		err := r.localDriver.HealthCheck(ctx)
		msg := "ok"
		if err != nil {
			msg = err.Error()
		}
		res["local"] = map[string]any{
			"enabled": true,
			"healthy": err == nil,
			"path":    r.cfg.LocalStoragePath,
			"message": msg,
		}
	}
	if r.r2Driver != nil {
		err := r.r2Driver.HealthCheck(ctx)
		msg := "ok"
		if err != nil {
			msg = err.Error()
		}
		res["r2"] = map[string]any{
			"enabled":    true,
			"healthy":    err == nil,
			"bucket":     r.cfg.R2Bucket,
			"endpoint":   r.cfg.R2Endpoint,
			"public_url": r.cfg.R2PublicURL,
			"message":    msg,
		}
	}
	return res
}

func sanitizePathSegment(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "guest"
	}
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		return "user"
	}
	if len(out) > 32 {
		out = out[:32]
	}
	return out
}

// BuildObjectKey organizes objects cleanly by Date (YYYY/MM/DD) and User: YYYY/MM/DD/<username>/<sha16><ext>.
func BuildObjectKey(sha256Hex, filename, mimeType string) string {
	return BuildObjectKeyForUser("guest", sha256Hex, filename, mimeType)
}

func BuildObjectKeyForUser(username, sha256Hex, filename, mimeType string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" || len(ext) > 8 {
		switch mimeType {
		case "image/jpeg":
			ext = ".jpg"
		case "image/png":
			ext = ".png"
		case "image/webp":
			ext = ".webp"
		case "image/gif":
			ext = ".gif"
		case "image/avif":
			ext = ".avif"
		case "image/svg+xml":
			ext = ".svg"
		default:
			ext = ".bin"
		}
	}
	userDir := sanitizePathSegment(username)
	datePath := time.Now().Format("2006/01/02")
	shortHash := sha256Hex
	if len(shortHash) > 16 {
		shortHash = shortHash[:16]
	}
	return fmt.Sprintf("%s/%s/%s%s", datePath, userDir, shortHash, ext)
}
