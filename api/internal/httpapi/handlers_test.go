package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"note-manager/api/internal/note"
)

const testOrigin = "http://localhost:5173"

var testNow = time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC)

// newTestAPI returns the /api handler backed by a real service and an
// in-memory repository holding notes.
func newTestAPI(t *testing.T, notes ...note.Note) (http.Handler, *note.Service) {
	t.Helper()
	repo := note.NewMemoryRepository()
	for _, n := range notes {
		if err := repo.Create(context.Background(), n); err != nil {
			t.Fatalf("seeding %q: %v", n.ID, err)
		}
	}
	svc := note.NewService(repo)
	return NewHandler(svc, testOrigin, slog.New(slog.DiscardHandler)), svc
}

// serve sends req to an API with no notes.
func serve(t *testing.T, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	h, _ := newTestAPI(t)
	return do(h, req)
}

func do(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func jsonRequest(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decoding %q: %v", rec.Body.String(), err)
	}
	return v
}

// assertError checks the status and that the body uses the shared error shape.
func assertError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) errorBody {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, status, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	body := decode[errorResponse](t, rec).Error
	if body.Code != code || body.Message == "" {
		t.Errorf("error = %+v, want code %q and a message", body, code)
	}
	return body
}

func noteIDs(notes []note.Note) []string {
	ids := make([]string, len(notes))
	for i, n := range notes {
		ids[i] = n.ID
	}
	return ids
}

var fixtures = []note.Note{
	{ID: "old", Title: "Go API design", Body: "Use the standard library.", Tags: []string{"backend"}, CreatedAt: testNow.Add(-2 * time.Hour)},
	{ID: "new", Title: "Sprint planning", Body: "Discuss the roadmap.", Tags: []string{"planning"}, CreatedAt: testNow},
	{ID: "mid", Title: "Lunch", Body: "Pizza on Friday.", Tags: []string{"team"}, CreatedAt: testNow.Add(-1 * time.Hour)},
}

func TestHealth(t *testing.T) {
	rec := serve(t, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := decode[healthResponse](t, rec); got.Status != "ok" {
		t.Errorf("status field = %q, want %q", got.Status, "ok")
	}
}

func TestListNotes(t *testing.T) {
	h, _ := newTestAPI(t, fixtures...)

	tests := []struct {
		name    string
		path    string
		wantIDs []string
	}{
		{"no search lists all, newest first", "/api/notes", []string{"new", "mid", "old"}},
		{"empty search lists all", "/api/notes?search=", []string{"new", "mid", "old"}},
		{"search ignores case", "/api/notes?search=GO", []string{"old"}},
		{"search matches tags", "/api/notes?search=team", []string{"mid"}},
		{"every term must match", "/api/notes?search=sprint+roadmap", []string{"new"}},
		{"no match gives an empty list", "/api/notes?search=kubernetes", []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(h, httptest.NewRequest(http.MethodGet, tt.path, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}
			got := decode[listResponse](t, rec)
			if got.Notes == nil {
				t.Fatalf("body %s: notes is null, want an array", rec.Body)
			}
			if ids := noteIDs(got.Notes); !slices.Equal(ids, tt.wantIDs) {
				t.Errorf("ids = %v, want %v", ids, tt.wantIDs)
			}
		})
	}
}

func TestGetNote(t *testing.T) {
	h, _ := newTestAPI(t, fixtures...)

	t.Run("existing note", func(t *testing.T) {
		rec := do(h, httptest.NewRequest(http.MethodGet, "/api/notes/mid", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if got := decode[note.Note](t, rec); got.ID != "mid" || got.Title != "Lunch" {
			t.Errorf("note = %+v, want id mid, title Lunch", got)
		}
	})

	t.Run("unknown id", func(t *testing.T) {
		rec := do(h, httptest.NewRequest(http.MethodGet, "/api/notes/missing", nil))
		assertError(t, rec, http.StatusNotFound, codeNotFound)
	})
}

func TestCreateNote(t *testing.T) {
	h, _ := newTestAPI(t)

	rec := do(h, jsonRequest(http.MethodPost, "/api/notes",
		`{"title":"  Release plan ","body":"Ship on Friday","tags":["Release","release","Q4"]}`))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, http.StatusCreated, rec.Body)
	}
	created := decode[note.Note](t, rec)
	if created.ID == "" || created.CreatedAt.IsZero() {
		t.Errorf("note = %+v, want an id and createdAt", created)
	}
	if created.Title != "Release plan" || !slices.Equal(created.Tags, []string{"release", "q4"}) {
		t.Errorf("note = %+v, want trimmed title and normalised tags", created)
	}
	if loc := rec.Header().Get("Location"); loc != "/api/notes/"+created.ID {
		t.Errorf("Location = %q, want /api/notes/%s", loc, created.ID)
	}

	// The new note can be read back.
	got := do(h, httptest.NewRequest(http.MethodGet, "/api/notes/"+created.ID, nil))
	if got.Code != http.StatusOK {
		t.Errorf("GET after create: status = %d, want %d", got.Code, http.StatusOK)
	}
}

func TestCreateNoteErrors(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		body        string
		wantStatus  int
		wantCode    string
		wantInMsg   string   // optional text the message must contain
		wantFields  []string // for 422
	}{
		{"validation errors list every field", "application/json", `{"title":"  ","tags":["Bad Tag!"]}`,
			http.StatusUnprocessableEntity, codeValidationFailed, "", []string{"tags", "title"}},
		{"malformed JSON", "application/json", `{"title":`, http.StatusBadRequest, codeBadRequest, "valid JSON", nil},
		{"not JSON at all", "application/json", `hello`, http.StatusBadRequest, codeBadRequest, "valid JSON", nil},
		{"empty body", "application/json", ``, http.StatusBadRequest, codeBadRequest, "required", nil},
		{"unknown field", "application/json", `{"title":"x","colour":"red"}`, http.StatusBadRequest, codeBadRequest, `"colour"`, nil},
		{"wrong field type", "application/json", `{"title":42}`, http.StatusBadRequest, codeBadRequest, `"title"`, nil},
		{"array instead of object", "application/json", `[]`, http.StatusBadRequest, codeBadRequest, "JSON object", nil},
		{"two JSON objects", "application/json", `{"title":"a"}{"title":"b"}`, http.StatusBadRequest, codeBadRequest, "single JSON object", nil},
		{"body over 64 KB", "application/json", `{"title":"x","body":"` + strings.Repeat("a", 70<<10) + `"}`,
			http.StatusRequestEntityTooLarge, codePayloadTooLarge, "64 KB", nil},
		{"text/plain content type", "text/plain", `{"title":"x"}`, http.StatusUnsupportedMediaType, codeUnsupportedMediaType, "application/json", nil},
		{"missing content type", "", `{"title":"x"}`, http.StatusUnsupportedMediaType, codeUnsupportedMediaType, "application/json", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, svc := newTestAPI(t)
			req := httptest.NewRequest(http.MethodPost, "/api/notes", strings.NewReader(tt.body))
			if tt.contentType != "" {
				req.Header.Set("Content-Type", tt.contentType)
			}

			body := assertError(t, do(h, req), tt.wantStatus, tt.wantCode)

			if !strings.Contains(body.Message, tt.wantInMsg) {
				t.Errorf("message = %q, want it to contain %q", body.Message, tt.wantInMsg)
			}
			if gotFields := slices.Sorted(maps.Keys(body.Fields)); !slices.Equal(gotFields, tt.wantFields) {
				t.Errorf("fields = %v, want %v", body.Fields, tt.wantFields)
			}
			if all, _ := svc.Search(context.Background(), ""); len(all) != 0 {
				t.Errorf("%d notes stored after a failed create, want 0", len(all))
			}
		})
	}
}

func TestCreateNoteAcceptsCharsetParameter(t *testing.T) {
	h, _ := newTestAPI(t)
	req := httptest.NewRequest(http.MethodPost, "/api/notes", strings.NewReader(`{"title":"x"}`))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	if rec := do(h, req); rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}
}

func TestDeleteNote(t *testing.T) {
	tests := []struct {
		name       string
		id         string
		wantStatus int
	}{
		{"existing note", "mid", http.StatusNoContent},
		{"unknown id", "missing", http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, _ := newTestAPI(t, fixtures...)

			rec := do(h, httptest.NewRequest(http.MethodDelete, "/api/notes/"+tt.id, nil))

			if tt.wantStatus == http.StatusNotFound {
				assertError(t, rec, http.StatusNotFound, codeNotFound)
				return
			}
			if rec.Code != tt.wantStatus || rec.Body.Len() != 0 {
				t.Fatalf("status = %d, body %q; want %d and no body", rec.Code, rec.Body, tt.wantStatus)
			}
			after := do(h, httptest.NewRequest(http.MethodGet, "/api/notes/"+tt.id, nil))
			assertError(t, after, http.StatusNotFound, codeNotFound)
		})
	}
}

func TestMethodNotAllowed(t *testing.T) {
	tests := []struct {
		method, path, wantAllow string
	}{
		{http.MethodPut, "/api/notes", "GET, HEAD, POST"},
		{http.MethodDelete, "/api/notes", "GET, HEAD, POST"},
		{http.MethodPatch, "/api/notes/abc", "GET, HEAD, DELETE"},
		{http.MethodPost, "/api/notes/abc", "GET, HEAD, DELETE"},
		{http.MethodPost, "/api/health", "GET, HEAD"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := serve(t, httptest.NewRequest(tt.method, tt.path, nil))

			assertError(t, rec, http.StatusMethodNotAllowed, codeMethodNotAllowed)
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}

func TestUnknownRoutes(t *testing.T) {
	for _, path := range []string{"/api/nope", "/api/notes/a/b", "/api/notes/"} {
		t.Run(path, func(t *testing.T) {
			assertError(t, serve(t, httptest.NewRequest(http.MethodGet, path, nil)), http.StatusNotFound, codeNotFound)
		})
	}

	t.Run("outside /api", func(t *testing.T) {
		rec := do(NotFoundHandler(), httptest.NewRequest(http.MethodGet, "/favicon.ico", nil))
		assertError(t, rec, http.StatusNotFound, codeNotFound)
	})
}

// failingService fails every call, like a broken database would.
type failingService struct{ err error }

func (f failingService) Create(context.Context, note.CreateInput) (note.Note, error) {
	return note.Note{}, f.err
}
func (f failingService) Get(context.Context, string) (note.Note, error)      { return note.Note{}, f.err }
func (f failingService) Search(context.Context, string) ([]note.Note, error) { return nil, f.err }
func (f failingService) Delete(context.Context, string) (note.Note, error)   { return note.Note{}, f.err }

func TestServiceFailuresDoNotLeakDetails(t *testing.T) {
	const secret = "sqlite: database is locked at /var/data/notes.db"
	h := NewHandler(failingService{err: errors.New(secret)}, testOrigin, slog.New(slog.DiscardHandler))

	for _, req := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/api/notes", nil),
		httptest.NewRequest(http.MethodGet, "/api/notes/abc", nil),
		jsonRequest(http.MethodPost, "/api/notes", `{"title":"x"}`),
		httptest.NewRequest(http.MethodDelete, "/api/notes/abc", nil),
	} {
		t.Run(req.Method+" "+req.URL.Path, func(t *testing.T) {
			rec := do(h, req)
			assertError(t, rec, http.StatusInternalServerError, codeInternal)
			if strings.Contains(rec.Body.String(), "sqlite") {
				t.Errorf("body %q leaks the internal error", rec.Body)
			}
		})
	}
}

func TestRecover(t *testing.T) {
	panicking := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("nil map write in secret/internal.go")
	})
	h := Recover(slog.New(slog.DiscardHandler), panicking)

	rec := do(h, httptest.NewRequest(http.MethodGet, "/api/notes", nil))

	assertError(t, rec, http.StatusInternalServerError, codeInternal)
	if strings.Contains(rec.Body.String(), "secret") {
		t.Errorf("body %q leaks the panic value", rec.Body)
	}
}
