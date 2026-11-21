-- Lumina Image Host - Full Production Schema (PostgreSQL 16)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. 角色组策略矩阵 (游客 / 普通用户 / Pro / 管理员)
CREATE TABLE IF NOT EXISTS role_policies (
    role                  VARCHAR(32) PRIMARY KEY,
    display_name          VARCHAR(64) NOT NULL,
    storage_quota_bytes   BIGINT NOT NULL DEFAULT 5368709120,   -- 5GB
    max_file_size_bytes   BIGINT NOT NULL DEFAULT 15728640,     -- 15MB
    allowed_mimes         TEXT[] NOT NULL DEFAULT ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif'],
    rate_limit_per_min    INT NOT NULL DEFAULT 30,
    allowed_engines       TEXT[] NOT NULL DEFAULT ARRAY['local','r2'],
    default_engine        VARCHAR(16) NOT NULL DEFAULT 'smart', -- local, r2, smart
    require_moderation    BOOLEAN NOT NULL DEFAULT FALSE,
    allow_api_token       BOOLEAN NOT NULL DEFAULT TRUE,
    allow_custom_watermark BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO role_policies (role, display_name, storage_quota_bytes, max_file_size_bytes, allowed_mimes, rate_limit_per_min, allowed_engines, default_engine, require_moderation, allow_api_token, allow_custom_watermark)
VALUES
    ('guest', '游客', 524288000, 5242880, ARRAY['image/jpeg','image/png','image/webp'], 10, ARRAY['local'], 'local', TRUE, FALSE, FALSE),
    ('user',  '普通用户', 5368709120, 20971520, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif'], 30, ARRAY['local','r2'], 'smart', FALSE, TRUE, TRUE),
    ('pro',   'Pro 创作者', 53687091200, 52428800, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml'], 120, ARRAY['local','r2'], 'r2', FALSE, TRUE, TRUE),
    ('admin', '超级管理员', 1099511627776, 104857600, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml','image/bmp'], 600, ARRAY['local','r2'], 'smart', FALSE, TRUE, TRUE)
ON CONFLICT (role) DO NOTHING;

-- 2. 用户表
CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL PRIMARY KEY,
    username            VARCHAR(32) UNIQUE NOT NULL,
    email               VARCHAR(128) UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    role                VARCHAR(32) NOT NULL DEFAULT 'user' REFERENCES role_policies(role),
    avatar_url          TEXT NOT NULL DEFAULT '',
    bio                 TEXT NOT NULL DEFAULT '',
    public_profile      BOOLEAN NOT NULL DEFAULT TRUE,
    storage_quota_override BIGINT,
    storage_used_bytes  BIGINT NOT NULL DEFAULT 0,
    default_engine      VARCHAR(16) NOT NULL DEFAULT 'smart',
    totp_secret         TEXT NOT NULL DEFAULT '',
    totp_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    status              VARCHAR(16) NOT NULL DEFAULT 'active', -- active, banned
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 用户在线会话表 (支持多设备管理与踢出)
CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent      TEXT NOT NULL DEFAULT '',
    ip_address      VARCHAR(64) NOT NULL DEFAULT '',
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked);

-- 4. 物理对象表 (内容寻址 CAS 核心：全局 SHA-256 去重与引用计数)
CREATE TABLE IF NOT EXISTS storage_objects (
    id                  BIGSERIAL PRIMARY KEY,
    sha256              CHAR(64) UNIQUE NOT NULL,
    storage_engine      VARCHAR(16) NOT NULL,               -- local, r2
    object_key          TEXT NOT NULL,                      -- blobs/ab/cd/sha256.ext
    mime_type           VARCHAR(64) NOT NULL,
    size_bytes          BIGINT NOT NULL,
    width               INT NOT NULL DEFAULT 0,
    height              INT NOT NULL DEFAULT 0,
    dominant_color      CHAR(7) NOT NULL DEFAULT '#64748b',
    color_palette       JSONB NOT NULL DEFAULT '[]'::jsonb,
    exif_data           JSONB NOT NULL DEFAULT '{}'::jsonb,
    ref_count           INT NOT NULL DEFAULT 0,
    moderation_status   VARCHAR(16) NOT NULL DEFAULT 'passed', -- pending, passed, blocked
    moderation_reason   TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_storage_objects_gc ON storage_objects(ref_count) WHERE ref_count <= 0;
CREATE INDEX IF NOT EXISTS idx_storage_objects_mod ON storage_objects(moderation_status);

-- 5. 多级相册表
CREATE TABLE IF NOT EXISTS albums (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id           BIGINT REFERENCES albums(id) ON DELETE SET NULL,
    slug                VARCHAR(64) UNIQUE NOT NULL,
    title               VARCHAR(120) NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    visibility          VARCHAR(16) NOT NULL DEFAULT 'public', -- public, unlisted, private, password
    access_password_hash TEXT NOT NULL DEFAULT '',
    cover_short_code    VARCHAR(16) NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id, created_at DESC);

-- 6. 用户逻辑资产表
CREATE TABLE IF NOT EXISTS user_assets (
    id                  BIGSERIAL PRIMARY KEY,
    short_code          VARCHAR(16) UNIQUE NOT NULL,
    user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE, -- NULL 表示游客上传
    object_id           BIGINT NOT NULL REFERENCES storage_objects(id),
    album_id            BIGINT REFERENCES albums(id) ON DELETE SET NULL,
    original_name       VARCHAR(255) NOT NULL,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    visibility          VARCHAR(16) NOT NULL DEFAULT 'public', -- public, unlisted, private, password
    access_password_hash TEXT NOT NULL DEFAULT '',
    view_count          BIGINT NOT NULL DEFAULT 0,
    expires_at          TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_assets_feed ON user_assets(user_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_assets_explore ON user_assets(visibility, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_assets_name_trgm ON user_assets USING GIN (original_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_user_assets_tags ON user_assets USING GIN (tags);

-- 7. 上传预检会话 (用于直传完成后校验与入库)
CREATE TABLE IF NOT EXISTS upload_intents (
    id                  UUID PRIMARY KEY,
    user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE,
    sha256              CHAR(64) NOT NULL,
    object_key          TEXT NOT NULL,
    storage_engine      VARCHAR(16) NOT NULL,
    original_name       VARCHAR(255) NOT NULL,
    mime_type           VARCHAR(64) NOT NULL,
    size_bytes          BIGINT NOT NULL,
    album_id            BIGINT,
    visibility          VARCHAR(16) NOT NULL DEFAULT 'public',
    access_password_hash TEXT NOT NULL DEFAULT '',
    expires_at          TIMESTAMPTZ,
    strip_gps           BOOLEAN NOT NULL DEFAULT TRUE,
    completed           BOOLEAN NOT NULL DEFAULT FALSE,
    intent_expires_at   TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. 可视化水印预设表
CREATE TABLE IF NOT EXISTS watermark_presets (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(64) NOT NULL,
    mode            VARCHAR(16) NOT NULL DEFAULT 'text', -- text, image
    text_content    VARCHAR(128) NOT NULL DEFAULT '© Lumina Gallery',
    font_size       INT NOT NULL DEFAULT 24,
    text_color      VARCHAR(16) NOT NULL DEFAULT '#FFFFFF',
    opacity         NUMERIC(3,2) NOT NULL DEFAULT 0.45,
    position        VARCHAR(16) NOT NULL DEFAULT 'soea', -- imgproxy gravity: no, so, ea, we, ce, nowe, noea, sowe, soea
    offset_x        INT NOT NULL DEFAULT 20,
    offset_y        INT NOT NULL DEFAULT 20,
    scale           NUMERIC(3,2) NOT NULL DEFAULT 0.25,
    angle           INT NOT NULL DEFAULT -25,
    tiled           BOOLEAN NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. 开发者 API Token (兼容 PicGo / ShareX / Typora)
CREATE TABLE IF NOT EXISTS api_tokens (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(64) NOT NULL,
    token_prefix    VARCHAR(16) NOT NULL,
    token_hash      CHAR(64) UNIQUE NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT ARRAY['upload','read'],
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. 邀请码表
CREATE TABLE IF NOT EXISTS invite_codes (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(32) UNIQUE NOT NULL,
    role            VARCHAR(32) NOT NULL DEFAULT 'user' REFERENCES role_policies(role),
    max_uses        INT NOT NULL DEFAULT 1,
    used_count      INT NOT NULL DEFAULT 0,
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. 站点全局配置表
CREATE TABLE IF NOT EXISTS site_settings (
    key             VARCHAR(64) PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO site_settings (key, value) VALUES
    ('general', '{"site_name":"Lumina 光匣","site_subtitle":"高速、极简、双存储引擎现代图床","announcement":"","allow_registration":true,"require_invite_code":false,"allow_guest_upload":false,"guest_expire_hours":24}'::jsonb),
    ('security', '{"referer_mode":"off","referer_list":[],"auto_block_nsfw":false,"max_upload_concurrency":5}'::jsonb),
    ('storage', '{"default_engine":"smart","smart_route_threshold_mb":5,"local_enabled":true,"r2_enabled":false,"r2_public_url":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 12. 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    username        VARCHAR(64) NOT NULL DEFAULT 'system',
    action          VARCHAR(64) NOT NULL,
    target_type     VARCHAR(32) NOT NULL DEFAULT '',
    target_id       VARCHAR(64) NOT NULL DEFAULT '',
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address      VARCHAR(64) NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);
