// Command server runs the Team Notes API.
package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"note-manager/api/internal/config"
	"note-manager/api/internal/httpapi"
	"note-manager/api/internal/mcp"
	"note-manager/api/internal/note"
)

const shutdownTimeout = 10 * time.Second

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	// .env is optional; variables already set in the environment take priority.
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("loading .env: %w", err)
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	repo := note.NewMemoryRepository()
	if cfg.SeedNotes {
		if err := note.Seed(ctx, repo, time.Now()); err != nil {
			return fmt.Errorf("seeding notes: %w", err)
		}
	}

	handler, err := routes(note.NewService(repo), cfg.CORSAllowedOrigin, logger)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("server listening",
			"addr", srv.Addr,
			"rest", "/api",
			"mcp", "/mcp",
			"corsAllowedOrigin", cfg.CORSAllowedOrigin,
			"seedNotes", cfg.SeedNotes,
		)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		return err // ListenAndServe only returns here on failure, e.g. port in use.
	case <-ctx.Done():
	}
	// Restore the default signal handling, so a second Ctrl+C stops the
	// server at once instead of waiting for the graceful shutdown.
	stop()

	logger.Info("shutting down", "timeout", shutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	logger.Info("server stopped")
	return nil
}

// routes returns the server's handler: REST under /api (with CORS for
// allowedOrigin), MCP at /mcp, and a JSON 404 for everything else. Every
// request is logged, and a panic becomes a 500.
//
// REST (people, via the web app) and MCP (agents) share one service, so both
// see the same notes.
func routes(notes *note.Service, allowedOrigin string, logger *slog.Logger) (http.Handler, error) {
	mcpHandler, err := mcp.NewHandler(notes, allowedOrigin, logger)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", httpapi.NewHandler(notes, allowedOrigin, logger))
	mux.Handle("/mcp", mcpHandler)
	mux.Handle("/", httpapi.NotFoundHandler())

	return httpapi.LogRequests(logger, httpapi.Recover(logger, mux)), nil
}
