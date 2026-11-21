package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/redis/go-redis/v9"

	"lumina-imagehost/internal/cdn"
	"lumina-imagehost/internal/config"
	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/db/sqlc"
	"lumina-imagehost/internal/handlers"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/moderation"
	"lumina-imagehost/internal/storage"
	"lumina-imagehost/internal/worker"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := config.Load()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect postgres: %v", err)
	}
	defer pool.Close()

	if err := db.BootstrapAdmin(ctx, pool, cfg); err != nil {
		log.Fatalf("failed to bootstrap admin: %v", err)
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("[warn] redis ping failed (%v), rate limiting degraded", err)
	}

	storageRouter, err := storage.NewRouter(ctx, cfg)
	if err != nil {
		log.Fatalf("failed to init storage router: %v", err)
	}

	purger := cdn.NewPurger(cfg)
	mod := moderation.NewWebhookModerator(cfg.ModerationWebhookURL, cfg.ModerationSecret)
	authMW := middleware.NewAuthenticator(cfg, pool, rdb)
	bgWorker := worker.New(cfg, pool, storageRouter, purger, mod)

	srv := &handlers.Server{
		Cfg:     cfg,
		Pool:    pool,
		Queries: sqlc.New(pool),
		Redis:   rdb,
		Router:  storageRouter,
		Auth:    authMW,
		Purger:  purger,
		Worker:  bgWorker,
	}

	chi.RegisterMethod("PROPFIND")
	chi.RegisterMethod("MKCOL")
	chi.RegisterMethod("PROPPATCH")
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Logger)
	r.Use(chimw.Compress(5))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-API-Token", "X-Share-Password"},
		ExposedHeaders:   []string{"Link", "ETag"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Health & Direct Raw Image Serving (with Referer Anti-Hotlink, IP Blacklist & Private/Signed URL check)
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"lumina-api-v3","queue":"asynq"}`))
	})
	r.With(authMW.OptionalAuth).Get("/raw/{code}", srv.ServeRawImage)
	r.With(authMW.OptionalAuth).Get("/raw/{code}/watermark", srv.ServeWatermarkedImage)
	r.Mount("/webdav", http.HandlerFunc(srv.ServeWebDAV))

	// API v1
	r.Route("/api/v1", func(api chi.Router) {
		// Auth, OAuth & HttpOnly Refresh Token
		api.With(authMW.RateLimit("auth", 20, time.Minute)).Post("/auth/register", srv.Register)
		api.With(authMW.RateLimit("auth", 20, time.Minute)).Post("/auth/login", srv.Login)
		api.With(authMW.RateLimit("auth", 10, time.Minute)).Post("/auth/forgot-password", srv.ForgotPassword)
		api.With(authMW.RateLimit("auth", 10, time.Minute)).Post("/auth/reset-password", srv.ResetPassword)
		api.Post("/auth/refresh", srv.RefreshSession)
		api.With(authMW.OptionalAuth).Post("/auth/logout", srv.Logout)
		api.Get("/auth/oauth/{provider}", srv.OAuthRedirect)
		api.Get("/auth/oauth/{provider}/callback", srv.OAuthCallback)

		// Public Explore, Share Landing Pages, Random Image API & Public User Profile
		api.With(authMW.OptionalAuth).Get("/explore", srv.ExplorePublic)
		api.With(authMW.OptionalAuth).Get("/share/i/{code}", srv.ShareImage)
		api.With(authMW.OptionalAuth).Get("/share/a/{slug}", srv.ShareAlbum)
		api.Get("/site/info", srv.PublicSiteInfo)
		api.With(authMW.RateLimit("like", 30, time.Minute)).Post("/share/i/{code}/like", srv.LikeShareImage)
		api.Get("/random", srv.RandomImage)
		api.Get("/users/{username}", srv.PublicUserProfile)

		// Direct Upload, Resumable Chunked Upload & Lsky Pro v2 Compatible Endpoint
		api.With(authMW.OptionalAuth, authMW.RateLimit("upload", 60, time.Minute)).Post("/upload/precheck", srv.UploadPrecheck)
		api.With(authMW.OptionalAuth).Post("/upload/complete", srv.UploadComplete)
		api.Put("/upload/local/{token}", srv.LocalDirectPut)
		api.With(authMW.OptionalAuth, authMW.RateLimit("upload", 60, time.Minute)).Post("/upload", srv.MultipartUpload)
		api.With(authMW.OptionalAuth, authMW.RateLimit("upload", 60, time.Minute)).Post("/lsky/upload", srv.LskyCompatUpload)
		api.With(authMW.OptionalAuth, authMW.RateLimit("upload", 30, time.Minute)).Post("/upload/remote", srv.RemoteFetchUpload)
		api.With(authMW.OptionalAuth).Post("/upload/chunked/init", srv.ChunkedInit)
		api.With(authMW.OptionalAuth).Put("/upload/chunked/{id}/part/{partNum}", srv.ChunkedPart)
		api.With(authMW.OptionalAuth).Post("/upload/chunked/{id}/complete", srv.ChunkedComplete)

		// Authenticated User Workspace
		api.Group(func(authed chi.Router) {
			authed.Use(authMW.RequireAuth)

			// Profile, Analytics & Security
			authed.Get("/me", srv.GetMe)
			authed.Get("/me/analytics", srv.MyAnalytics)
			authed.Patch("/me/profile", srv.UpdateProfile)
			authed.Post("/me/password", srv.ChangePassword)
			authed.Post("/me/2fa/setup", srv.Setup2FA)
			authed.Post("/me/2fa/verify", srv.Verify2FA)
			authed.Get("/me/sessions", srv.ListSessions)
			authed.Delete("/me/sessions/{id}", srv.RevokeSession)

			// Assets, Transform, Signed Links, Trash & Batch ZIP Export
			authed.Get("/assets", srv.ListMyAssets)
			authed.Patch("/assets/{id}", srv.UpdateAsset)
			authed.Delete("/assets/{id}", srv.DeleteAsset)
			authed.Post("/assets/{id}/restore", srv.RestoreAsset)
			authed.Post("/assets/{id}/migrate", srv.MigrateAsset)
			authed.Post("/assets/{id}/signed-url", srv.CreateSignedURL)
			authed.Post("/assets/{id}/transform", srv.BuildTransformURL)
			authed.Post("/assets/{id}/ai-analyze", srv.AnalyzeAssetAI)
			authed.Get("/assets/{id}/similar", srv.FindSimilarAssets)
			authed.Post("/assets/{id}/replace", srv.ReplaceAssetFile)
			authed.Post("/assets/{id}/favorite", srv.ToggleFavorite)
			authed.Delete("/assets/trash/empty", srv.EmptyTrash)
			authed.Post("/assets/batch", srv.BatchAssets)
			authed.Post("/assets/download-zip", srv.BatchDownloadZip)

			// Albums
			authed.Get("/albums", srv.ListAlbums)
			authed.Post("/albums", srv.CreateAlbum)
			authed.Patch("/albums/{id}", srv.UpdateAlbum)
			authed.Delete("/albums/{id}", srv.DeleteAlbum)

			// API Tokens & Watermarks
			authed.Get("/tokens", srv.ListAPITokens)
			authed.Post("/tokens", srv.CreateAPIToken)
			authed.Delete("/tokens/{id}", srv.DeleteAPIToken)

			authed.Get("/watermarks", srv.ListWatermarks)
			authed.Post("/watermarks", srv.SaveWatermark)
			authed.Patch("/watermarks/{id}/default", srv.SetDefaultWatermark)
			authed.Delete("/watermarks/{id}", srv.DeleteWatermark)
		})

		// Admin Console
		api.Route("/admin", func(adm chi.Router) {
			adm.Use(authMW.RequireAdmin)

			adm.Get("/dashboard", srv.AdminDashboard)
			adm.Get("/analytics", srv.AdminAnalytics)
			adm.Post("/storage/test", srv.AdminTestStorage)
			adm.Post("/mail/test", srv.AdminTestMail)
			adm.Get("/storage-profiles", srv.AdminListStorageProfiles)
			adm.Post("/storage-profiles", srv.AdminSaveStorageProfile)
			adm.Delete("/storage-profiles/{id}", srv.AdminDeleteStorageProfile)
			adm.Get("/users", srv.AdminListUsers)
			adm.Patch("/users/{id}", srv.AdminUpdateUser)
			adm.Get("/policies", srv.AdminListPolicies)
			adm.Put("/policies/{role}", srv.AdminUpdatePolicy)
			adm.Get("/moderation", srv.AdminModerationQueue)
			adm.Post("/moderation/{objectId}", srv.AdminModerationAction)
			adm.Get("/invites", srv.AdminListInvites)
			adm.Post("/invites", srv.AdminCreateInvites)
			adm.Get("/settings", srv.AdminGetSettings)
			adm.Put("/settings/{key}", srv.AdminSaveSetting)
			adm.Get("/logs", srv.AdminAuditLogs)
			adm.Post("/gc", srv.AdminRunGC)
		})
	})

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 15 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("[lumina-api-v3] listening on :%s (local=%v, r2=%v, queue=asynq)", cfg.Port, cfg.LocalEnabled, cfg.R2Enabled)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("[lumina-api-v3] shutting down gracefully...")
	cancel()
	bgWorker.Shutdown()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
