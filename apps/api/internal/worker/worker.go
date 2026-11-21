package worker

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"

	"lumina-imagehost/internal/cdn"
	"lumina-imagehost/internal/config"
	"lumina-imagehost/internal/moderation"
	"lumina-imagehost/internal/storage"
)

const (
	TypeGCSweep         = "task:gc:sweep"
	TypeCDNPurge        = "task:cdn:purge"
	TypeAssetMigrate    = "task:asset:migrate"
	TypeModerationCheck = "task:moderation:check"
	TypeWebhookNotify   = "task:webhook:notify"
)

type CDNPurgePayload struct {
	URLs []string `json:"urls"`
}

type AssetMigratePayload struct {
	ObjectID     int64  `json:"object_id"`
	ObjectKey    string `json:"object_key"`
	SourceEngine string `json:"source_engine"`
	TargetEngine string `json:"target_engine"`
	MimeType     string `json:"mime_type"`
}

type ModerationPayload struct {
	ObjectID  int64  `json:"object_id"`
	ImageURL  string `json:"image_url"`
	SHA256    string `json:"sha256"`
	Engine    string `json:"engine"`
	ObjectKey string `json:"object_key"`
}

type WebhookPayload struct {
	Event     string `json:"event"`
	ShortCode string `json:"short_code"`
	DirectURL string `json:"direct_url"`
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"size_bytes"`
}

type BackgroundWorker struct {
	cfg       *config.Config
	pool      *pgxpool.Pool
	router    *storage.Router
	purger    *cdn.Purger
	moderator moderation.Moderator
	client    *asynq.Client
	server    *asynq.Server
	scheduler *asynq.Scheduler
	inspector *asynq.Inspector
}

func New(cfg *config.Config, pool *pgxpool.Pool, router *storage.Router, purger *cdn.Purger, mod moderation.Moderator) *BackgroundWorker {
	redisOpt := asynq.RedisClientOpt{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
	}

	return &BackgroundWorker{
		cfg:       cfg,
		pool:      pool,
		router:    router,
		purger:    purger,
		moderator: mod,
		client:    asynq.NewClient(redisOpt),
		inspector: asynq.NewInspector(redisOpt),
		server: asynq.NewServer(redisOpt, asynq.Config{
			Concurrency: 10,
			Queues: map[string]int{
				"critical": 6,
				"default":  3,
				"low":      1,
			},
		}),
		scheduler: asynq.NewScheduler(redisOpt, nil),
	}
}

func (w *BackgroundWorker) Start(ctx context.Context) {
	mux := asynq.NewServeMux()
	mux.HandleFunc(TypeGCSweep, func(tCtx context.Context, _ *asynq.Task) error {
		res := w.RunOnce(tCtx)
		log.Printf("[asynq] gc sweep completed: %+v", res)
		return nil
	})
	mux.HandleFunc(TypeCDNPurge, func(tCtx context.Context, t *asynq.Task) error {
		var p CDNPurgePayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return err
		}
		if len(p.URLs) > 0 && w.purger != nil {
			return w.purger.PurgeURLs(tCtx, p.URLs)
		}
		return nil
	})
	mux.HandleFunc(TypeAssetMigrate, func(tCtx context.Context, t *asynq.Task) error {
		var p AssetMigratePayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return err
		}
		if err := w.router.Migrate(tCtx, p.ObjectKey, p.SourceEngine, p.TargetEngine, p.MimeType); err != nil {
			return err
		}
		_, err := w.pool.Exec(tCtx, `UPDATE storage_objects SET storage_engine = $1, updated_at = NOW() WHERE id = $2`, p.TargetEngine, p.ObjectID)
		return err
	})
	mux.HandleFunc(TypeModerationCheck, func(tCtx context.Context, t *asynq.Task) error {
		if w.moderator == nil {
			return nil
		}
		var p ModerationPayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return err
		}
		verdict, err := w.moderator.CheckImage(tCtx, p.ImageURL, p.SHA256)
		if err != nil {
			return err
		}
		if !verdict.Passed {
			_, _ = w.pool.Exec(tCtx, `UPDATE storage_objects SET moderation_status = 'blocked', moderation_reason = $1, updated_at = NOW() WHERE id = $2`, verdict.Reason, p.ObjectID)
			if drv, err := w.router.GetDriver(p.Engine); err == nil {
				_ = drv.Delete(tCtx, p.ObjectKey)
			}
			w.EnqueueCDNPurge([]string{p.ImageURL})
		} else {
			_, _ = w.pool.Exec(tCtx, `UPDATE storage_objects SET moderation_status = 'passed', updated_at = NOW() WHERE id = $1 AND moderation_status = 'pending'`, p.ObjectID)
		}
		return nil
	})
	mux.HandleFunc(TypeWebhookNotify, func(tCtx context.Context, t *asynq.Task) error {
		if w.cfg == nil || w.cfg.UploadWebhookURL == "" {
			return nil
		}
		body := t.Payload()
		req, err := http.NewRequestWithContext(tCtx, http.MethodPost, w.cfg.UploadWebhookURL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if w.cfg.UploadWebhookSecret != "" {
			mac := hmac.New(sha256.New, []byte(w.cfg.UploadWebhookSecret))
			mac.Write(body)
			req.Header.Set("X-Lumina-Signature", hex.EncodeToString(mac.Sum(nil)))
		}
		resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return fmt.Errorf("webhook returned status %d", resp.StatusCode)
		}
		return nil
	})

	if _, err := w.scheduler.Register("@every 5m", asynq.NewTask(TypeGCSweep, nil), asynq.Queue("low")); err != nil {
		log.Printf("[asynq] failed registering periodic GC task: %v", err)
	}

	go func() {
		if err := w.server.Run(mux); err != nil {
			log.Printf("[asynq] server stopped: %v", err)
		}
	}()
	go func() {
		if err := w.scheduler.Run(); err != nil {
			log.Printf("[asynq] scheduler stopped: %v", err)
		}
	}()

	<-ctx.Done()
	w.Shutdown()
}

func (w *BackgroundWorker) Shutdown() {
	if w.scheduler != nil {
		w.scheduler.Shutdown()
	}
	if w.server != nil {
		w.server.Shutdown()
	}
	if w.client != nil {
		_ = w.client.Close()
	}
	if w.inspector != nil {
		_ = w.inspector.Close()
	}
}

func (w *BackgroundWorker) EnqueueCDNPurge(urls []string) {
	if len(urls) == 0 || w.client == nil {
		return
	}
	payload, _ := json.Marshal(CDNPurgePayload{URLs: urls})
	_, _ = w.client.Enqueue(asynq.NewTask(TypeCDNPurge, payload), asynq.Queue("critical"), asynq.MaxRetry(3), asynq.Timeout(30*time.Second))
}

func (w *BackgroundWorker) EnqueueModeration(p ModerationPayload) {
	if w.client == nil || w.cfg == nil || w.cfg.ModerationWebhookURL == "" {
		return
	}
	payload, _ := json.Marshal(p)
	_, _ = w.client.Enqueue(asynq.NewTask(TypeModerationCheck, payload), asynq.Queue("default"), asynq.MaxRetry(3))
}

func (w *BackgroundWorker) EnqueueWebhook(p WebhookPayload) {
	if w.client == nil || w.cfg == nil || w.cfg.UploadWebhookURL == "" {
		return
	}
	payload, _ := json.Marshal(p)
	_, _ = w.client.Enqueue(asynq.NewTask(TypeWebhookNotify, payload), asynq.Queue("low"), asynq.MaxRetry(3))
}

func (w *BackgroundWorker) QueueStats() map[string]any {
	res := map[string]any{"engine": "asynq-redis"}
	if w.inspector == nil {
		return res
	}
	queues := []string{"critical", "default", "low"}
	details := map[string]any{}
	for _, q := range queues {
		if info, err := w.inspector.GetQueueInfo(q); err == nil {
			details[q] = map[string]any{
				"pending":   info.Pending,
				"active":    info.Active,
				"scheduled": info.Scheduled,
				"retry":     info.Retry,
				"completed": info.Completed,
			}
		}
	}
	res["queues"] = details
	return res
}

func (w *BackgroundWorker) RunOnce(ctx context.Context) map[string]int {
	stats := map[string]int{"expired_assets": 0, "purged_trash": 0, "gc_objects": 0}

	rows, err := w.pool.Query(ctx, `
		DELETE FROM user_assets
		WHERE (expires_at IS NOT NULL AND expires_at < NOW())
		   OR (deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
		RETURNING user_id, object_id
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var uid *int64
			var oid int64
			if err := rows.Scan(&uid, &oid); err == nil {
				stats["expired_assets"]++
				var sz int64
				_ = w.pool.QueryRow(ctx, `UPDATE storage_objects SET ref_count = GREATEST(ref_count - 1, 0), updated_at = NOW() WHERE id = $1 RETURNING size_bytes`, oid).Scan(&sz)
				if uid != nil && sz > 0 {
					_, _ = w.pool.Exec(ctx, `UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - $1, 0) WHERE id = $2`, sz, *uid)
				}
			}
		}
	}

	_, _ = w.pool.Exec(ctx, `DELETE FROM upload_intents WHERE intent_expires_at < NOW() - INTERVAL '1 hour'`)
	_, _ = w.pool.Exec(ctx, `DELETE FROM multipart_uploads WHERE expires_at < NOW()`)

	gcRows, err := w.pool.Query(ctx, `
		SELECT id, storage_engine, object_key, moderation_status
		FROM storage_objects
		WHERE ref_count <= 0 AND updated_at < NOW() - INTERVAL '1 minute'
		LIMIT 100
	`)
	if err == nil {
		defer gcRows.Close()
		for gcRows.Next() {
			var id int64
			var engine, key, modStatus string
			if err := gcRows.Scan(&id, &engine, &key, &modStatus); err != nil {
				continue
			}
			if drv, err := w.router.GetDriver(engine); err == nil {
				if err := drv.Delete(ctx, key); err != nil {
					log.Printf("[gc] failed deleting %s:%s: %v", engine, key, err)
					continue
				}
			}
			if modStatus != "blocked" {
				_, _ = w.pool.Exec(ctx, `DELETE FROM storage_objects WHERE id = $1 AND ref_count <= 0`, id)
			}
			stats["gc_objects"]++
		}
	}
	return stats
}
