// Package mcp exposes the notes to AI agents as MCP tools at /mcp. The tools
// call the same note service as the REST API, so agents and people see the
// same notes.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"note-manager/api/internal/note"
)

// maxRequestBytes caps MCP request bodies. A note at the size limits fits easily.
const maxRequestBytes = 256 << 10

// NoteService is what the tools need from the note service.
type NoteService interface {
	Create(ctx context.Context, in note.CreateInput) (note.Note, error)
	Search(ctx context.Context, query string, offset, limit int) (note.Page, error)
	Delete(ctx context.Context, id string) (note.Note, error)
}

type tools struct {
	notes  NoteService
	logger *slog.Logger
}

// NewServer returns an MCP server with the search_notes, create_note and
// delete_note tools.
func NewServer(notes NoteService, logger *slog.Logger) *sdk.Server {
	t := &tools{notes: notes, logger: logger}
	server := sdk.NewServer(&sdk.Implementation{
		Name:    "team-notes",
		Title:   "Team Notes",
		Version: "1.0.0",
	}, &sdk.ServerOptions{
		Instructions: "Team Notes is a shared notebook for a team of people and agents. " +
			"Use search_notes to find notes, create_note to add one, and delete_note only when the user asks to delete a note.",
	})
	sdk.AddTool(server, searchTool, t.search)
	sdk.AddTool(server, createTool, t.create)
	sdk.AddTool(server, deleteTool, t.delete)
	return server
}

// NewHandler serves the MCP server over Streamable HTTP.
//
// It is stateless (each request stands alone; the tools need no session) and
// answers with plain JSON. Browser requests are only accepted from
// allowedOrigin: other origins get 403. Non-browser clients such as agents
// send no Origin and are allowed. The SDK also rejects DNS-rebinding requests
// to localhost.
func NewHandler(notes NoteService, allowedOrigin string, logger *slog.Logger) (http.Handler, error) {
	server := NewServer(notes, logger)
	handler := sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return server }, &sdk.StreamableHTTPOptions{
		Stateless:           true,
		JSONResponse:        true,
		Logger:              logger,
		MaxRequestBodyBytes: maxRequestBytes,
	})

	protection := http.NewCrossOriginProtection()
	if err := protection.AddTrustedOrigin(allowedOrigin); err != nil {
		return nil, fmt.Errorf("mcp: trusted origin %q: %w", allowedOrigin, err)
	}
	protection.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger.Warn("mcp: cross-origin request refused", "origin", r.Header.Get("Origin"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{
			"code":    "forbidden",
			"message": "Cross-origin requests to /mcp are only allowed from the Team Notes web app.",
		}})
	}))
	return protection.Handler(handler), nil
}
