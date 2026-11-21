package sqlc

import (
	"context"

	"github.com/google/uuid"
	"lumina-imagehost/internal/models"
)

func (q *Queries) GetRolePolicy(ctx context.Context, role string) (*models.RolePolicy, error) {
	var p models.RolePolicy
	err := q.db.QueryRow(ctx, `
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

func (q *Queries) GetSiteSettingRaw(ctx context.Context, key string) ([]byte, error) {
	var raw []byte
	err := q.db.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, key).Scan(&raw)
	return raw, err
}

func (q *Queries) UpsertSiteSetting(ctx context.Context, key string, raw []byte) error {
	_, err := q.db.Exec(ctx, `
		INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, key, raw)
	return err
}

func (q *Queries) IncrementStorageRefCount(ctx context.Context, objID int64) error {
	_, err := q.db.Exec(ctx, `UPDATE storage_objects SET ref_count = ref_count + 1, updated_at = NOW() WHERE id = $1`, objID)
	return err
}

func (q *Queries) IncrementUserStorageUsed(ctx context.Context, sizeBytes, userID int64) error {
	_, err := q.db.Exec(ctx, `UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2`, sizeBytes, userID)
	return err
}

func (q *Queries) DecrementStorageRefCount(ctx context.Context, objID int64) (int64, error) {
	var sz int64
	err := q.db.QueryRow(ctx, `UPDATE storage_objects SET ref_count = GREATEST(ref_count - 1, 0), updated_at = NOW() WHERE id = $1 RETURNING size_bytes`, objID).Scan(&sz)
	return sz, err
}

func (q *Queries) DecrementUserStorageUsed(ctx context.Context, sizeBytes, userID int64) error {
	_, err := q.db.Exec(ctx, `UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - $1, 0) WHERE id = $2`, sizeBytes, userID)
	return err
}

func (q *Queries) RevokeSession(ctx context.Context, sessionID uuid.UUID, userID int64) error {
	_, err := q.db.Exec(ctx, `UPDATE user_sessions SET revoked = TRUE WHERE id = $1 AND user_id = $2`, sessionID, userID)
	return err
}

func (q *Queries) IncrementAssetViewCount(ctx context.Context, assetID int64) error {
	_, err := q.db.Exec(ctx, `UPDATE user_assets SET view_count = view_count + 1 WHERE id = $1`, assetID)
	return err
}
