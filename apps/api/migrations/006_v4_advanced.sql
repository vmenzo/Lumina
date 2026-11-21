-- Lumina-Img v4 Advanced Schema Extensions
-- 1. AI Vision Caption & Semantic Tags
ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS ai_caption TEXT NOT NULL DEFAULT '';
ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS ai_tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_user_assets_ai_tags ON user_assets USING GIN (ai_tags);

-- 2. SMTP Password Reset Tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       VARCHAR(255) NOT NULL,
    code_hash   CHAR(64) NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_email ON password_reset_tokens(email, created_at DESC);

-- 3. Multi-S3 / OSS / COS / R2 / MinIO Storage Profiles
CREATE TABLE IF NOT EXISTS storage_profiles (
    id                BIGSERIAL PRIMARY KEY,
    name              VARCHAR(64) NOT NULL UNIQUE,
    provider          VARCHAR(32) NOT NULL DEFAULT 's3', -- r2, oss, cos, s3, minio, b2
    endpoint          TEXT NOT NULL DEFAULT '',
    region            VARCHAR(64) NOT NULL DEFAULT 'auto',
    bucket            VARCHAR(128) NOT NULL DEFAULT '',
    access_key_id     TEXT NOT NULL DEFAULT '',
    secret_access_key TEXT NOT NULL DEFAULT '',
    public_url        TEXT NOT NULL DEFAULT '',
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    is_default        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_assets_user_deleted_created ON user_assets(user_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_assets_album_deleted ON user_assets(album_id, deleted_at);

ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_assets ADD COLUMN IF NOT EXISTS like_count BIGINT NOT NULL DEFAULT 0;
