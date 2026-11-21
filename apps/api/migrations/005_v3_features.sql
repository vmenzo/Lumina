-- Lumina-Img v3 Full-Featured Schema Extensions
-- Daily upload & view statistics for personal & admin analytics dashboards
CREATE TABLE IF NOT EXISTS daily_stats (
    stat_date      DATE NOT NULL,
    user_id        BIGINT NOT NULL DEFAULT 0, -- 0 = anonymous/guest or site rollup
    uploads        BIGINT NOT NULL DEFAULT 0,
    views          BIGINT NOT NULL DEFAULT 0,
    bytes_uploaded BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date, user_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_assets_visibility_created ON user_assets(visibility, created_at DESC) WHERE deleted_at IS NULL;
