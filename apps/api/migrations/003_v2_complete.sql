-- Lumina-Img v2 Complete Schema Extensions
ALTER TABLE role_policies ADD COLUMN IF NOT EXISTS monthly_upload_limit INT NOT NULL DEFAULT 0;
UPDATE role_policies SET monthly_upload_limit = 50 WHERE role = 'guest' AND monthly_upload_limit = 0;
UPDATE role_policies SET monthly_upload_limit = 1000 WHERE role = 'user' AND monthly_upload_limit = 0;
UPDATE role_policies SET monthly_upload_limit = 20000 WHERE role = 'pro' AND monthly_upload_limit = 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_subject VARCHAR(128) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject) WHERE oauth_provider <> '';

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_token_hash CHAR(64) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh ON user_sessions(refresh_token_hash) WHERE refresh_token_hash <> '';

ALTER TABLE upload_intents ADD COLUMN IF NOT EXISTS custom_alias VARCHAR(16) NOT NULL DEFAULT '';

-- Resumable Chunked Multipart Uploads
CREATE TABLE IF NOT EXISTS multipart_uploads (
    id              UUID PRIMARY KEY,
    user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
    sha256          CHAR(64) NOT NULL,
    filename        VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(64) NOT NULL,
    total_size      BIGINT NOT NULL,
    chunk_size      BIGINT NOT NULL,
    total_parts     INT NOT NULL,
    uploaded_parts  INT[] NOT NULL DEFAULT '{}',
    storage_engine  VARCHAR(16) NOT NULL DEFAULT 'local',
    album_id        BIGINT,
    visibility      VARCHAR(16) NOT NULL DEFAULT 'public',
    custom_alias    VARCHAR(16) NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
