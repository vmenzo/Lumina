-- Lumina ImageHost v2 sqlc Queries (PostgreSQL 16)

-- name: GetRolePolicy :one
SELECT role, display_name, storage_quota_bytes, max_file_size_bytes, allowed_mimes,
       rate_limit_per_min, allowed_engines, default_engine, require_moderation,
       allow_api_token, allow_custom_watermark, updated_at
FROM role_policies WHERE role = $1;

-- name: ListRolePolicies :many
SELECT role, display_name, storage_quota_bytes, max_file_size_bytes, allowed_mimes,
       rate_limit_per_min, allowed_engines, default_engine, require_moderation,
       allow_api_token, allow_custom_watermark, updated_at
FROM role_policies ORDER BY storage_quota_bytes ASC;

-- name: GetSiteSetting :one
SELECT value FROM site_settings WHERE key = $1;

-- name: UpsertSiteSetting :exec
INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- name: GetStorageObjectBySHA256 :one
SELECT id, moderation_status FROM storage_objects WHERE sha256 = $1;

-- name: IncrementStorageRefCount :exec
UPDATE storage_objects SET ref_count = ref_count + 1, updated_at = NOW() WHERE id = $1;

-- name: DecrementStorageRefCount :one
UPDATE storage_objects SET ref_count = GREATEST(ref_count - 1, 0), updated_at = NOW()
WHERE id = $1 RETURNING size_bytes;

-- name: IncrementUserStorageUsed :exec
UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2;

-- name: DecrementUserStorageUsed :exec
UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - $1, 0) WHERE id = $2;

-- name: SoftDeleteAsset :exec
UPDATE user_assets SET deleted_at = NOW() WHERE id = $1;

-- name: RestoreAsset :exec
UPDATE user_assets SET deleted_at = NULL WHERE id = $1 AND user_id = $2;

-- name: RevokeSession :exec
UPDATE user_sessions SET revoked = TRUE WHERE id = $1 AND user_id = $2;

-- name: DeleteAlbum :exec
DELETE FROM albums WHERE id = $1 AND user_id = $2;

-- name: DeleteAPIToken :exec
DELETE FROM api_tokens WHERE id = $1 AND user_id = $2;

-- name: DeleteWatermark :exec
DELETE FROM watermark_presets WHERE id = $1 AND user_id = $2;

-- name: IncrementAssetViewCount :exec
UPDATE user_assets SET view_count = view_count + 1 WHERE id = $1;
