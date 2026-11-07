package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"note-manager/api/internal/httpapi"
	"note-manager/api/internal/note"
)

const webOrigin = "http://localhost:5173"

var quiet = slog.New(slog.DiscardHandler)

// connect returns a client session talking to a fresh MCP server over in-memory transports.
func connect(t *testing.T, notes NoteService) *sdk.ClientSession {
	t.Helper()
	ctx := context.Background()
	serverTransport, clientTransport := sdk.NewInMemoryTransports()
	if _, err := NewServer(notes, quiet).Connect(ctx, serverTransport, nil); err != nil {
		t.Fatalf("server connect: %v", err)
	}
	return connectClient(t, clientTransport)
}

func connectClient(t *testing.T, transport sdk.Transport) *sdk.ClientSession {
	t.Helper()
	client := sdk.NewClient(&sdk.Implementation{Name: "test-agent", Version: "1.0.0"}, nil)
	session, err := client.Connect(context.Background(), transport, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func newService() *note.Service {
	return note.NewService(note.NewMemoryRepository())
}

// call invokes a tool and fails the test on protocol errors (tool errors are returned in the result).
func call(t *testing.T, session *sdk.ClientSession, name string, args map[string]any) *sdk.CallToolResult {
	t.Helper()
	res, err := session.CallTool(context.Background(), &sdk.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("CallTool(%s) protocol error: %v", name, err)
	}
	return res
}

func text(res *sdk.CallToolResult) string {
	var parts []string
	for _, c := range res.Content {
		if tc, ok := c.(*sdk.TextContent); ok {
			parts = append(parts, tc.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// structured decodes a successful result's structured content into T.
func structured[T any](t *testing.T, res *sdk.CallToolResult) T {
	t.Helper()
	if res.IsError {
		t.Fatalf("tool error: %s", text(res))
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatalf("marshal structured content: %v", err)
	}
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode structured content %s: %v", raw, err)
	}
	return out
}

// schemaProperties returns property name -> description from a JSON schema.
func schemaProperties(t *testing.T, schema any) map[string]string {
	t.Helper()
	raw, err := json.Marshal(schema)
	if err != nil {
		t.Fatalf("marshal schema: %v", err)
	}
	var s struct {
		Properties map[string]struct {
			Description string `json:"description"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("decode schema %s: %v", raw, err)
	}
	props := make(map[string]string, len(s.Properties))
	for name, p := range s.Properties {
		props[name] = p.Description
	}
	return props
}

// assertDescribedFields checks a schema has exactly the wanted fields, each with a description.
func assertDescribedFields(t *testing.T, kind string, schema any, want []string) {
	t.Helper()
	props := schemaProperties(t, schema)
	if names := slices.Sorted(maps.Keys(props)); !slices.Equal(names, want) {
		t.Errorf("%s fields = %v, want %v", kind, names, want)
	}
	for name, desc := range props {
		if desc == "" {
			t.Errorf("%s field %q has no description", kind, name)
		}
	}
}

// assertHints checks the read-only and destructive hints. destructiveHint only
// means something when the tool isn't read-only.
func assertHints(t *testing.T, a *sdk.ToolAnnotations, wantReadOnly, wantDestructive bool) {
	t.Helper()
	if a == nil {
		t.Fatal("tool has no annotations")
	}
	if a.ReadOnlyHint != wantReadOnly {
		t.Errorf("readOnlyHint = %v, want %v", a.ReadOnlyHint, wantReadOnly)
	}
	if !wantReadOnly && (a.DestructiveHint == nil || *a.DestructiveHint != wantDestructive) {
		t.Errorf("destructiveHint = %v, want %v", a.DestructiveHint, wantDestructive)
	}
}

// assertSingleTypes fails if any part of the schema has a multi-type "type"
// such as ["null","array"], which some clients can't handle.
func assertSingleTypes(t *testing.T, kind string, schema any) {
	t.Helper()
	raw, err := json.Marshal(schema)
	if err != nil {
		t.Fatalf("marshal schema: %v", err)
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	var walk func(path string, node any)
	walk = func(path string, node any) {
		switch n := node.(type) {
		case map[string]any:
			if types, ok := n["type"].([]any); ok {
				t.Errorf("%s schema at %s has type %v, want a single type", kind, path, types)
			}
			for key, child := range n {
				walk(path+"."+key, child)
			}
		case []any:
			for i, child := range n {
				walk(fmt.Sprintf("%s[%d]", path, i), child)
			}
		}
	}
	walk(kind+"Schema", doc)
}

func TestListTools(t *testing.T) {
	session := connect(t, newService())

	res, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	byName := map[string]*sdk.Tool{}
	for _, tool := range res.Tools {
		byName[tool.Name] = tool
	}
	if names := slices.Sorted(maps.Keys(byName)); !slices.Equal(names, []string{"create_note", "delete_note", "search_notes"}) {
		t.Fatalf("tools = %v, want create_note, delete_note, search_notes", names)
	}

	tests := []struct {
		name            string
		wantReadOnly    bool
		wantDestructive bool
		wantInputs      []string
		wantOutputs     []string
	}{
		{"search_notes", true, false, []string{"limit", "search"}, []string{"notes", "total"}},
		{"create_note", false, false, []string{"body", "tags", "title"}, []string{"body", "createdAt", "id", "tags", "title"}},
		{"delete_note", false, true, []string{"confirm", "id"}, []string{"deleted", "title"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tool := byName[tt.name]
			if tool.Description == "" {
				t.Error("tool has no description")
			}
			assertHints(t, tool.Annotations, tt.wantReadOnly, tt.wantDestructive)
			assertDescribedFields(t, "input", tool.InputSchema, tt.wantInputs)
			assertDescribedFields(t, "output", tool.OutputSchema, tt.wantOutputs)
			assertSingleTypes(t, "input", tool.InputSchema)
			assertSingleTypes(t, "output", tool.OutputSchema)
		})
	}
}

// The limit's range and default are in the schema, so clients can check them
// before calling, and the default applies when limit is left out.
func TestSearchLimit(t *testing.T) {
	session := connect(t, newService())

	res, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	idx := slices.IndexFunc(res.Tools, func(tool *sdk.Tool) bool { return tool.Name == "search_notes" })
	raw, err := json.Marshal(res.Tools[idx].InputSchema)
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Properties struct {
			Limit struct {
				Minimum, Maximum, Default *float64
			} `json:"limit"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatalf("decoding %s: %v", raw, err)
	}
	if l := schema.Properties.Limit; l.Minimum == nil || *l.Minimum != 1 || l.Maximum == nil || *l.Maximum != 50 || l.Default == nil || *l.Default != 10 {
		t.Errorf("limit schema = %s, want minimum 1, maximum 50 and default 10", raw)
	}

	for i := range 12 {
		call(t, session, "create_note", map[string]any{"title": fmt.Sprintf("Note %d", i)})
	}
	out := structured[searchOutput](t, call(t, session, "search_notes", map[string]any{}))
	if out.Total != 12 || len(out.Notes) != 10 {
		t.Errorf("without a limit: total=%d, %d notes; want total=12, 10 notes", out.Total, len(out.Notes))
	}
	out = structured[searchOutput](t, call(t, session, "search_notes", map[string]any{"limit": 50}))
	if len(out.Notes) != 12 {
		t.Errorf("with limit 50: %d notes, want 12", len(out.Notes))
	}
}

func TestCreateThenSearch(t *testing.T) {
	session := connect(t, newService())

	created := structured[noteResult](t, call(t, session, "create_note", map[string]any{
		"title": "  Release plan ",
		"body":  "Ship on Friday.",
		"tags":  []string{"Release", "q4", "release"},
	}))
	if created.ID == "" || created.Title != "Release plan" || !slices.Equal(created.Tags, []string{"release", "q4"}) {
		t.Fatalf("created = %+v, want an id, trimmed title and normalised tags", created)
	}
	for _, title := range []string{"Older note", "Another note"} {
		call(t, session, "create_note", map[string]any{"title": title})
	}

	tests := []struct {
		name      string
		args      map[string]any
		wantTotal int
		wantFirst string // title of the first result, "" for none
		wantCount int
	}{
		{"finds it by a word in the body, ignoring case", map[string]any{"search": "FRIDAY"}, 1, "Release plan", 1},
		{"finds it by tag", map[string]any{"search": "q4"}, 1, "Release plan", 1},
		{"empty search returns recent notes", map[string]any{}, 3, "", 3},
		{"limit cuts the list but total counts all matches", map[string]any{"search": "note", "limit": 1}, 2, "", 1},
		{"no match", map[string]any{"search": "kubernetes"}, 0, "", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := structured[searchOutput](t, call(t, session, "search_notes", tt.args))
			if out.Total != tt.wantTotal || len(out.Notes) != tt.wantCount {
				t.Fatalf("total=%d, %d notes; want total=%d, %d notes", out.Total, len(out.Notes), tt.wantTotal, tt.wantCount)
			}
			if tt.wantFirst != "" && out.Notes[0].Title != tt.wantFirst {
				t.Errorf("first = %q, want %q", out.Notes[0].Title, tt.wantFirst)
			}
			if out.Notes == nil {
				t.Error("notes is null, want an array")
			}
		})
	}
}

func TestDeleteNote(t *testing.T) {
	session := connect(t, newService())
	created := structured[noteResult](t, call(t, session, "create_note", map[string]any{"title": "Temporary"}))

	out := structured[deleteOutput](t, call(t, session, "delete_note", map[string]any{"id": created.ID, "confirm": true}))

	if out.Deleted != created.ID || out.Title != "Temporary" {
		t.Errorf("delete result = %+v, want id %s and title Temporary", out, created.ID)
	}
	if found := structured[searchOutput](t, call(t, session, "search_notes", map[string]any{})); found.Total != 0 {
		t.Errorf("search after delete found %d notes, want 0", found.Total)
	}
}

func TestToolErrors(t *testing.T) {
	tests := []struct {
		name     string
		tool     string
		args     map[string]any
		wantText string
	}{
		{"blank title", "create_note", map[string]any{"title": "   "}, "title is required"},
		{"title too long", "create_note", map[string]any{"title": strings.Repeat("x", 121)}, "title must be at most 120 characters"},
		{"invalid tag", "create_note", map[string]any{"title": "ok", "tags": []string{"Bad Tag!"}}, `"bad tag!" is not a valid tag`},
		{"several invalid fields at once", "create_note", map[string]any{"title": "", "tags": []string{"-x"}}, "tags "},
		{"delete without confirm", "delete_note", map[string]any{"id": "seed"}, "confirm: true"},
		{"delete with confirm false", "delete_note", map[string]any{"id": "seed", "confirm": false}, "confirm: true"},
		{"delete an unknown id", "delete_note", map[string]any{"id": "missing", "confirm": true}, "no note has that id"},
		{"search limit too high", "search_notes", map[string]any{"limit": 51}, "limit: maximum"},
		{"search limit zero", "search_notes", map[string]any{"limit": 0}, "limit: minimum"},
		{"search limit negative", "search_notes", map[string]any{"limit": -1}, "limit: minimum"},
		{"missing required title", "create_note", map[string]any{}, "title"},
		{"wrong argument type", "create_note", map[string]any{"title": 42}, "title"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := note.NewMemoryRepository()
			if err := repo.Create(context.Background(), note.Note{ID: "seed", Title: "Keep me", Tags: []string{}}); err != nil {
				t.Fatal(err)
			}
			session := connect(t, note.NewService(repo))

			res := call(t, session, tt.tool, tt.args)

			if !res.IsError {
				t.Fatalf("IsError = false, want a tool error (content: %s)", text(res))
			}
			if got := text(res); !strings.Contains(got, tt.wantText) {
				t.Errorf("error text = %q, want it to contain %q", got, tt.wantText)
			}
			if _, err := repo.Get(context.Background(), "seed"); err != nil {
				t.Errorf("seed note is gone after a failed call: %v", err)
			}
		})
	}
}

// failingService fails every call, like a broken database would.
type failingService struct{}

var errSecret = errors.New("sqlite: database is locked at /var/data/notes.db")

func (failingService) Create(context.Context, note.CreateInput) (note.Note, error) {
	return note.Note{}, errSecret
}
func (failingService) Search(context.Context, string) ([]note.Note, error) { return nil, errSecret }
func (failingService) Delete(context.Context, string) (note.Note, error) {
	return note.Note{}, errSecret
}

func TestUnexpectedErrorsDoNotLeakDetails(t *testing.T) {
	session := connect(t, failingService{})

	for _, c := range []struct {
		tool string
		args map[string]any
	}{
		{"search_notes", map[string]any{}},
		{"create_note", map[string]any{"title": "x"}},
		{"delete_note", map[string]any{"id": "x", "confirm": true}},
	} {
		t.Run(c.tool, func(t *testing.T) {
			res := call(t, session, c.tool, c.args)
			if !res.IsError || strings.Contains(text(res), "sqlite") {
				t.Errorf("result = %q (IsError %v), want a generic tool error", text(res), res.IsError)
			}
		})
	}
}

// TestRESTAndMCPShareNotes runs both handlers on one real HTTP server, as main.go does.
func TestRESTAndMCPShareNotes(t *testing.T) {
	notes := newService()
	mcpHandler, err := NewHandler(notes, webOrigin, quiet)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", httpapi.NewHandler(notes, webOrigin, quiet))
	mux.Handle("/mcp", mcpHandler)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	// A person creates a note in the web app (REST)...
	resp, err := http.Post(srv.URL+"/api/notes", "application/json",
		strings.NewReader(`{"title":"Created through REST","tags":["web"]}`))
	if err != nil {
		t.Fatal(err)
	}
	var created note.Note
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()

	// ...and an agent finds it over MCP (Streamable HTTP).
	session := connectClient(t, &sdk.StreamableClientTransport{Endpoint: srv.URL + "/mcp", MaxRetries: -1})
	found := structured[searchOutput](t, call(t, session, "search_notes", map[string]any{"search": "rest"}))
	if found.Total != 1 || found.Notes[0].ID != created.ID {
		t.Fatalf("MCP search = %+v, want the REST note %s", found, created.ID)
	}

	// The agent deletes it, and the web app no longer sees it.
	call(t, session, "delete_note", map[string]any{"id": created.ID, "confirm": true})
	get, err := http.Get(srv.URL + "/api/notes/" + created.ID)
	if err != nil {
		t.Fatal(err)
	}
	_ = get.Body.Close()
	if get.StatusCode != http.StatusNotFound {
		t.Errorf("REST GET after MCP delete = %d, want 404", get.StatusCode)
	}
}

func TestCrossOriginRequests(t *testing.T) {
	handler, err := NewHandler(newService(), webOrigin, quiet)
	if err != nil {
		t.Fatal(err)
	}
	const initialize = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`

	tests := []struct {
		name          string
		origin        string
		fetchSite     string
		wantForbidden bool
	}{
		{"agent (no Origin header)", "", "", false},
		{"our web app", webOrigin, "cross-site", false},
		{"another site", "https://evil.example.com", "cross-site", true},
		{"another site, older browser without Sec-Fetch-Site", "https://evil.example.com", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(initialize))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json, text/event-stream")
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tt.fetchSite)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if forbidden := rec.Code == http.StatusForbidden; forbidden != tt.wantForbidden {
				t.Fatalf("status = %d (body %s), want forbidden=%v", rec.Code, rec.Body, tt.wantForbidden)
			}
			if tt.wantForbidden && !strings.Contains(rec.Body.String(), `"code":"forbidden"`) {
				t.Errorf("body = %s, want the forbidden error shape", rec.Body)
			}
		})
	}
}

func TestNewHandlerRejectsABadOrigin(t *testing.T) {
	if _, err := NewHandler(newService(), "not a url", quiet); err == nil {
		t.Error("NewHandler accepted an invalid trusted origin")
	}
}
