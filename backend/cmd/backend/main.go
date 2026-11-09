package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/internal/config"
	"backend/internal/db"
	"backend/internal/handler"
	"backend/internal/model_a"
	"backend/internal/model_b"
	"backend/internal/news_digest"
	"backend/internal/prompt"
	"backend/internal/user_profile"
)

func main() {
	// 1. Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config load failed: %v", err)
	}
	log.Printf("config loaded: port=%s, postgres=%s:%d", cfg.Port, cfg.PostgresHost, cfg.PostgresPort)

	// 2. Initialize database pools and run migrations
	pools, err := db.NewPools(cfg.UsersDSN(), cfg.NewsDSN())
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}
	defer pools.Close()
	log.Println("database pools created")

	if err := db.RunMigrations(cfg.UsersDSN(), cfg.NewsDSN()); err != nil {
		log.Fatalf("migrations failed: %v", err)
	}
	log.Println("migrations applied")

	// 3. Initialize external model clients
	modelA := model_a.NewClient(cfg.ModelAConfig())
	modelB := model_b.NewClient(cfg.ModelBConfig())
	log.Println("model clients initialized")

	// 4. Initialize repositories
	userProfileRepo := user_profile.NewRepository(pools.Users)
	newsDigestRepo := news_digest.NewRepository(pools.News)

	// 5. Initialize prompt builder
	promptBuilder := prompt.NewBuilder(20) // max 20 digests in prompt

	// 6. Initialize HTTP router with all dependencies
	deps := &handler.Dependencies{
		Config:        cfg,
		ModelA:        modelA,
		ModelB:        modelB,
		UserProfile:   userProfileRepo,
		NewsDigest:    newsDigestRepo,
		PromptBuilder: promptBuilder,
	}
	router := handler.NewRouter(deps)

	// 7. Create HTTP server
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 8. Start server in background
	go func() {
		log.Printf("starting HTTP server on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	// 9. Start News Daemon (in background goroutine)
	// TODO: Implement daemon starter when daemon package is ready
	// go runDaemon(cfg)

	log.Println("backend started, waiting for signals...")

	// 10. Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("server forced to shutdown: %v", err)
	}

	log.Println("backend stopped")
}

// runDaemon starts the news daemon as a background goroutine
// Will be implemented when daemon package is ready
func runDaemon(cfg *config.Config) {
	log.Println("news daemon not yet implemented")
	// TODO: Initialize daemon with cfg.DaemonSourcesConfig
	// daemon := daemon.New(cfg.DaemonSourcesConfig, "http://localhost:"+cfg.Port+"/api/news")
	// daemon.Run()
}