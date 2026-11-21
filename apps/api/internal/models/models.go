package models

import (
	"encoding/json"
	"time"
)

type RolePolicy struct {
	Role                 string    `json:"role"`
	DisplayName          string    `json:"display_name"`
	StorageQuotaBytes    int64     `json:"storage_quota_bytes"`
	MaxFileSizeBytes     int64     `json:"max_file_size_bytes"`
	AllowedMimes         []string  `json:"allowed_mimes"`
	RateLimitPerMin      int       `json:"rate_limit_per_min"`
	MonthlyUploadLimit   int       `json:"monthly_upload_limit"`
	AllowedEngines       []string  `json:"allowed_engines"`
	DefaultEngine        string    `json:"default_engine"`
	RequireModeration    bool      `json:"require_moderation"`
	AllowAPIToken        bool      `json:"allow_api_token"`
	AllowCustomWatermark bool      `json:"allow_custom_watermark"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type User struct {
	ID                int64      `json:"id"`
	Username          string     `json:"username"`
	Email             string     `json:"email"`
	Role              string     `json:"role"`
	AvatarURL         string     `json:"avatar_url"`
	Bio               string     `json:"bio"`
	PublicProfile     bool       `json:"public_profile"`
	StorageQuotaBytes int64      `json:"storage_quota_bytes"`
	StorageUsedBytes  int64      `json:"storage_used_bytes"`
	DefaultEngine     string     `json:"default_engine"`
	TOTPEnabled       bool       `json:"totp_enabled"`
	Status            string     `json:"status"`
	LastLoginAt       *time.Time `json:"last_login_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type AssetView struct {
	ID               int64           `json:"id"`
	ShortCode        string          `json:"short_code"`
	UserID           *int64          `json:"user_id,omitempty"`
	Username         string          `json:"username,omitempty"`
	ObjectID         int64           `json:"object_id"`
	AlbumID          *int64          `json:"album_id,omitempty"`
	AlbumTitle       string          `json:"album_title,omitempty"`
	OriginalName     string          `json:"original_name"`
	Tags             []string        `json:"tags"`
	Visibility       string          `json:"visibility"`
	HasPassword      bool            `json:"has_password"`
	ViewCount        int64           `json:"view_count"`
	IsFavorite       bool            `json:"is_favorite"`
	LikeCount        int64           `json:"like_count"`
	ExpiresAt        *time.Time      `json:"expires_at,omitempty"`
	DeletedAt        *time.Time      `json:"deleted_at,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	SHA256           string          `json:"sha256"`
	StorageEngine    string          `json:"storage_engine"`
	ObjectKey        string          `json:"object_key"`
	MimeType         string          `json:"mime_type"`
	SizeBytes        int64           `json:"size_bytes"`
	Width            int             `json:"width"`
	Height           int             `json:"height"`
	DominantColor    string          `json:"dominant_color"`
	ColorPalette     []string        `json:"color_palette"`
	ThumbHash        string          `json:"thumbhash"`
	ExifData         json.RawMessage `json:"exif_data"`
	RefCount         int             `json:"ref_count"`
	ModerationStatus string          `json:"moderation_status"`
	DirectURL        string          `json:"direct_url"`
	ThumbURL         string          `json:"thumb_url"`
	WebPURL          string          `json:"webp_url"`
	AVIFURL          string          `json:"avif_url"`
	WatermarkURL     string          `json:"watermark_url,omitempty"`
	ShareURL         string          `json:"share_url"`
}

type Album struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"user_id"`
	ParentID    *int64    `json:"parent_id,omitempty"`
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Visibility  string    `json:"visibility"`
	HasPassword bool      `json:"has_password"`
	CoverCode   string    `json:"cover_short_code"`
	CoverURL    string    `json:"cover_url"`
	AssetCount  int64     `json:"asset_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type WatermarkPreset struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"user_id"`
	Name        string    `json:"name"`
	Mode        string    `json:"mode"`
	TextContent string    `json:"text_content"`
	ImageURL    string    `json:"image_url"`
	FontSize    int       `json:"font_size"`
	TextColor   string    `json:"text_color"`
	Opacity     float64   `json:"opacity"`
	Position    string    `json:"position"`
	OffsetX     int       `json:"offset_x"`
	OffsetY     int       `json:"offset_y"`
	Scale       float64   `json:"scale"`
	Angle       int       `json:"angle"`
	Tiled       bool      `json:"tiled"`
	IsDefault   bool      `json:"is_default"`
	CreatedAt   time.Time `json:"created_at"`
}

type APIToken struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	TokenPrefix string     `json:"token_prefix"`
	Scopes      []string   `json:"scopes"`
	LastUsedAt  *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type InviteCode struct {
	ID        int64      `json:"id"`
	Code      string     `json:"code"`
	Role      string     `json:"role"`
	MaxUses   int        `json:"max_uses"`
	UsedCount int        `json:"used_count"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type AuditLog struct {
	ID         int64           `json:"id"`
	UserID     *int64          `json:"user_id,omitempty"`
	Username   string          `json:"username"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Detail     json.RawMessage `json:"detail"`
	IPAddress  string          `json:"ip_address"`
	CreatedAt  time.Time       `json:"created_at"`
}
