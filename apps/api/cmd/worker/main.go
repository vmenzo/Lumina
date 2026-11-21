package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"lumina-imagehost/internal/cdn"
	"lumina-imagehost/internal/config"
	"lumina-imagehost/internal/db"
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
		log.Fatalf("[lumina-worker] failed to connect postgres: %v", err)
	}
	defer pool.Close()

	storageRouter, err := storage.NewRouter(ctx, cfg)
	if err != nil {
		log.Fatalf("[lumina-worker] failed to init storage router: %v", err)
	}

	purger := cdn.NewPurger(cfg)
	mod := moderation.NewWebhookModerator(cfg.ModerationWebhookURL, cfg.ModerationSecret)
	bgWorker := worker.New(cfg, pool, storageRouter, purger, mod)

	log.Println("[lumina-worker] starting Asynq server & scheduler...")
	go bgWorker.Start(ctx)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("[lumina-worker] shutting down...")
	cancel()
}
