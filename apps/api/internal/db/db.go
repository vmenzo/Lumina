package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/config"
)

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 25
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return pool, nil
}

// EnsureV3Schema runs idempotent DDL upgrades so existing v2 volumes upgrade seamlessly to v3.
func EnsureV3Schema(ctx context.Context, pool *pgxpool.Pool) {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS daily_stats (
			stat_date      DATE NOT NULL,
			user_id        BIGINT NOT NULL DEFAULT 0,
			uploads        BIGINT NOT NULL DEFAULT 0,
			views          BIGINT NOT NULL DEFAULT 0,
			bytes_uploaded BIGINT NOT NULL DEFAULT 0,
			PRIMARY KEY (stat_date, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_user_assets_user_deleted_created ON user_assets(user_id, deleted_at, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_user_assets_album_deleted ON user_assets(album_id, deleted_at)`,
		`ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS ai_caption TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS ai_tags TEXT[] NOT NULL DEFAULT '{}'`,
		`ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE`,
		`ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS like_count BIGINT NOT NULL DEFAULT 0`,
		`CREATE TABLE IF NOT EXISTS password_reset_tokens (
			id BIGSERIAL PRIMARY KEY,
			user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			email VARCHAR(255) NOT NULL,
			code_hash CHAR(64) NOT NULL,
			used BOOLEAN NOT NULL DEFAULT FALSE,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS storage_profiles (
			id BIGSERIAL PRIMARY KEY,
			name VARCHAR(64) NOT NULL UNIQUE,
			provider VARCHAR(32) NOT NULL DEFAULT 's3',
			endpoint TEXT NOT NULL DEFAULT '',
			region VARCHAR(64) NOT NULL DEFAULT 'auto',
			bucket VARCHAR(128) NOT NULL DEFAULT '',
			access_key_id TEXT NOT NULL DEFAULT '',
			secret_access_key TEXT NOT NULL DEFAULT '',
			public_url TEXT NOT NULL DEFAULT '',
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			is_default BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
	}
	for _, stmt := range stmts {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			log.Printf("[warn] v3 schema ensure stmt failed: %v", err)
		}
	}
}

// RecordDailyStat increments daily upload/view/bytes counters for analytics charts.
func RecordDailyStat(ctx context.Context, pool *pgxpool.Pool, userID *int64, uploads, views, bytesUploaded int64) {
	var uid int64
	if userID != nil {
		uid = *userID
	}
	_, _ = pool.Exec(ctx, `
		INSERT INTO daily_stats (stat_date, user_id, uploads, views, bytes_uploaded)
		VALUES (CURRENT_DATE, $1, $2, $3, $4)
		ON CONFLICT (stat_date, user_id)
		DO UPDATE SET
			uploads = daily_stats.uploads + EXCLUDED.uploads,
			views = daily_stats.views + EXCLUDED.views,
			bytes_uploaded = daily_stats.bytes_uploaded + EXCLUDED.bytes_uploaded
	`, uid, uploads, views, bytesUploaded)
}

// BootstrapAdmin ensures the initial administrator user exists on first boot.
func BootstrapAdmin(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config) error {
	EnsureV3Schema(ctx, pool)

	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO users (username, email, password_hash, role, default_engine)
		VALUES ($1, $2, $3, 'admin', 'smart')
		ON CONFLICT (email) DO NOTHING
	`, cfg.AdminUsername, cfg.AdminEmail, string(hash))
	if err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
	}
	log.Printf("[bootstrap] created initial admin account: %s (%s)", cfg.AdminUsername, cfg.AdminEmail)

	// Sync initial R2/Local settings from env into site_settings
	storageCfg, _ := json.Marshal(map[string]any{
		"default_engine":           "smart",
		"smart_route_threshold_mb": cfg.SmartRouteThresholdMB,
		"local_enabled":            cfg.LocalEnabled,
		"r2_enabled":               cfg.R2Enabled,
		"r2_public_url":            cfg.R2PublicURL,
	})
	_, _ = pool.Exec(ctx, `
		INSERT INTO site_settings(key, value) VALUES ('storage', $1)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, storageCfg)

	return nil
}

func WriteAudit(ctx context.Context, pool *pgxpool.Pool, userID *int64, username, action, targetType, targetID string, detail any, ip string) {
	b, _ := json.Marshal(detail)
	_, _ = pool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail, ip_address)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, userID, username, action, targetType, targetID, b, ip)
}
