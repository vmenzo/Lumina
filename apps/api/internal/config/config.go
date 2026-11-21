package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                  string
	DatabaseURL           string
	RedisAddr             string
	RedisPassword         string
	AppPublicURL          string
	CDNPublicURL          string
	JWTSecret             string
	LocalSignSecret       string
	AdminUsername         string
	AdminEmail            string
	AdminPassword         string
	LocalStoragePath      string
	LocalEnabled          bool
	R2Enabled             bool
	R2AccountID           string
	R2Endpoint            string
	R2Bucket              string
	R2AccessKeyID         string
	R2SecretAccessKey     string
	R2PublicURL           string
	SmartRouteThresholdMB int64
	ImgproxyKey           string
	ImgproxySalt          string
	CFZoneID              string
	CFAPIToken            string
	ModerationWebhookURL  string
	ModerationSecret      string
	UploadWebhookURL      string
	UploadWebhookSecret   string
	GitHubClientID        string
	GitHubClientSecret    string
	GoogleClientID        string
	GoogleClientSecret    string
	// v4 AI Vision (OpenAI-compatible: OpenAI, Gemini, Qwen-VL, Ollama)
	AIAPIBase string
	AIAPIKey  string
	AIModel   string
	// v4 SMTP Mailer
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	SMTPFrom string
}

func Load() *Config {
	return &Config{
		Port:                  getEnv("PORT", "8080"),
		DatabaseURL:           getEnv("DATABASE_URL", "postgres://lumina:lumina@localhost:5432/lumina?sslmode=disable"),
		RedisAddr:             getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:         getEnv("REDIS_PASSWORD", ""),
		AppPublicURL:          strings.TrimRight(getEnv("APP_PUBLIC_URL", "http://localhost"), "/"),
		CDNPublicURL:          strings.TrimRight(getEnv("CDN_PUBLIC_URL", "http://localhost"), "/"),
		JWTSecret:             getEnv("JWT_SECRET", "dev_jwt_secret_change_me_please_32chars"),
		LocalSignSecret:       getEnv("LOCAL_SIGN_SECRET", "dev_local_sign_secret_change_me_32chars"),
		AdminUsername:         getEnv("ADMIN_USERNAME", "admin"),
		AdminEmail:            getEnv("ADMIN_EMAIL", "admin@example.com"),
		AdminPassword:         getEnv("ADMIN_PASSWORD", "ChangeMe_StrongPass123!"),
		LocalStoragePath:      getEnv("LOCAL_STORAGE_PATH", "/data/uploads"),
		LocalEnabled:          getBool("LOCAL_ENABLED", true),
		R2Enabled:             getBool("R2_ENABLED", false),
		R2AccountID:           getEnv("R2_ACCOUNT_ID", ""),
		R2Endpoint:            strings.TrimRight(getEnv("R2_ENDPOINT", ""), "/"),
		R2Bucket:              getEnv("R2_BUCKET", ""),
		R2AccessKeyID:         getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:     getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2PublicURL:           strings.TrimRight(getEnv("R2_PUBLIC_URL", ""), "/"),
		SmartRouteThresholdMB: getInt64("SMART_ROUTE_THRESHOLD_MB", 5),
		ImgproxyKey:           getEnv("IMGPROXY_KEY", ""),
		ImgproxySalt:          getEnv("IMGPROXY_SALT", ""),
		CFZoneID:              getEnv("CF_ZONE_ID", ""),
		CFAPIToken:            getEnv("CF_API_TOKEN", ""),
		ModerationWebhookURL:  getEnv("MODERATION_WEBHOOK_URL", ""),
		ModerationSecret:      getEnv("MODERATION_WEBHOOK_SECRET", ""),
		UploadWebhookURL:      getEnv("UPLOAD_WEBHOOK_URL", ""),
		UploadWebhookSecret:   getEnv("UPLOAD_WEBHOOK_SECRET", ""),
		GitHubClientID:        getEnv("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret:    getEnv("GITHUB_CLIENT_SECRET", ""),
		GoogleClientID:        getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:    getEnv("GOOGLE_CLIENT_SECRET", ""),
		AIAPIBase:             strings.TrimRight(getEnv("AI_API_BASE", "https://api.openai.com/v1"), "/"),
		AIAPIKey:              getEnv("AI_API_KEY", ""),
		AIModel:               getEnv("AI_MODEL", "gpt-4o-mini"),
		SMTPHost:              getEnv("SMTP_HOST", ""),
		SMTPPort:              int(getInt64("SMTP_PORT", 587)),
		SMTPUser:              getEnv("SMTP_USER", ""),
		SMTPPass:              getEnv("SMTP_PASS", ""),
		SMTPFrom:              getEnv("SMTP_FROM", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getBool(key string, fallback bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "true" || v == "1" || v == "yes" {
		return true
	}
	if v == "false" || v == "0" || v == "no" {
		return false
	}
	return fallback
}

func getInt64(key string, fallback int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		return n
	}
	return fallback
}
