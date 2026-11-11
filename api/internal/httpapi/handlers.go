// Package httpapi serves the REST API under /api.
package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"

	"note-manager/api/internal/note"
)

// NoteService is what the handlers need from the note service.
type NoteService interface {
	Create(ctx context.Context, in note.CreateInput) (note.Note, error)
	Get(ctx context.Context, id string) (note.Note, error)
	Search(ctx context.Context, query string, offset, limit int) (note.Page, error)
	Delete(ctx context.Context, id string) (note.Note, error)
}

type handler struct {
	notes  NoteService
	logger *slog.Logger
}

// NewHandler returns the handler for everything under /api, wrapped in CORS
// that only allows allowedOrigin.
func NewHandler(notes NoteService, allowedOrigin string, logger *slog.Logger) http.Handler {
	h := &handler{notes: notes, logger: logger}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", h.health)
	mux.HandleFunc("GET /api/notes", h.listNotes)
	mux.HandleFunc("POST /api/notes", h.createNote)
	mux.HandleFunc("GET /api/notes/{id}", h.getNote)
	mux.HandleFunc("DELETE /api/notes/{id}", h.deleteNote)

	// The same paths with any other method get a 405 in the shared error
	// shape. Patterns with a method win over these, so they only catch the rest.
	mux.Handle("/api/health", methodNotAllowed("GET, HEAD"))
	mux.Handle("/api/notes", methodNotAllowed("GET, HEAD, POST"))
	mux.Handle("/api/notes/{id}", methodNotAllowed("GET, HEAD, DELETE"))
	mux.Handle("/api/", NotFoundHandler())

	return CORS(allowedOrigin, mux)
}

type healthResponse struct {
	Status string `json:"status"`
}

func (h *handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

type listResponse struct {
	Notes []note.Note `json:"notes"`
	Total int         `json:"total"`
}

// listNotes handles GET /api/notes?search=<text>&offset=<n>&limit=<n> and
// returns one page. No search text matches every note. offset defaults to 0
// and limit to note.DefaultPageSize. Values that aren't integers get a 400;
// the service checks the ranges (422).
func (h *handler) listNotes(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	offset, reqErr := intParam(query, "offset", 0)
	if reqErr != nil {
		reqErr.write(w)
		return
	}
	limit, reqErr := intParam(query, "limit", note.DefaultPageSize)
	if reqErr != nil {
		reqErr.write(w)
		return
	}

	page, err := h.notes.Search(r.Context(), query.Get("search"), offset, limit)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	notes := page.Notes
	if notes == nil {
		notes = []note.Note{} // always send [] rather than null
	}
	writeJSON(w, http.StatusOK, listResponse{Notes: notes, Total: page.Total})
}

// intParam reads an optional integer query parameter. A missing or empty
// value gives def.
func intParam(query url.Values, name string, def int) (int, *requestError) {
	raw := query.Get(name)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, badRequest(fmt.Sprintf("Query parameter %q must be an integer.", name))
	}
	return n, nil
}

func (h *handler) getNote(w http.ResponseWriter, r *http.Request) {
	n, err := h.notes.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, n)
}

func (h *handler) createNote(w http.ResponseWriter, r *http.Request) {
	var in note.CreateInput
	if reqErr := decodeJSON(w, r, &in); reqErr != nil {
		reqErr.write(w)
		return
	}
	n, err := h.notes.Create(r.Context(), in)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/notes/"+url.PathEscape(n.ID))
	writeJSON(w, http.StatusCreated, n)
}

func (h *handler) deleteNote(w http.ResponseWriter, r *http.Request) {
	if _, err := h.notes.Delete(r.Context(), r.PathValue("id")); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
