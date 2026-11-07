package main

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"note-manager/api/internal/note"
)

const webOrigin = "http://localhost:5173"

const initialize = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`

// newTestServer serves routes on a real loopback listener, so the SDK's
// DNS-rebinding check runs as it does in production. It returns the logs too.
func newTestServer(t *testing.T) (*httptest.Server, *bytes.Buffer) {
	t.Helper()
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler, err := routes(note.NewService(note.NewMemoryRepository()), webOrigin, logger)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv, &logs
}

func send(t *testing.T, req *http.Request) (*http.Response, string) {
	t.Helper()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res, string(body)
}

func mcpRequest(t *testing.T, url string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url+"/mcp", strings.NewReader(initialize))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	return req
}

func TestRoutes(t *testing.T) {
	srv, _ := newTestServer(t)

	newRequest := func(method, path string) *http.Request {
		req, err := http.NewRequest(method, srv.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		return req
	}

	t.Run("REST is under /api", func(t *testing.T) {
		res, body := send(t, newRequest(http.MethodGet, "/api/health"))
		if res.StatusCode != http.StatusOK || !strings.Contains(body, `"ok"`) {
			t.Errorf("GET /api/health = %d %s, want 200 ok", res.StatusCode, body)
		}
	})

	t.Run("/api has CORS for the web app", func(t *testing.T) {
		req := newRequest(http.MethodOptions, "/api/notes")
		req.Header.Set("Origin", webOrigin)
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		res, _ := send(t, req)
		if res.StatusCode != http.StatusNoContent || res.Header.Get("Access-Control-Allow-Origin") != webOrigin {
			t.Errorf("preflight = %d, Allow-Origin %q; want 204 and %q",
				res.StatusCode, res.Header.Get("Access-Control-Allow-Origin"), webOrigin)
		}
	})

	t.Run("an agent can call /mcp", func(t *testing.T) {
		res, body := send(t, mcpRequest(t, srv.URL))
		if res.StatusCode != http.StatusOK || !strings.Contains(body, `"team-notes"`) {
			t.Errorf("initialize = %d %s, want 200 from the team-notes server", res.StatusCode, body)
		}
		if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("/mcp sent Access-Control-Allow-Origin %q, want none", got)
		}
	})

	t.Run("/mcp refuses other sites", func(t *testing.T) {
		req := mcpRequest(t, srv.URL)
		req.Header.Set("Origin", "https://evil.example.com")
		req.Header.Set("Sec-Fetch-Site", "cross-site")
		if res, body := send(t, req); res.StatusCode != http.StatusForbidden {
			t.Errorf("cross-site initialize = %d %s, want 403", res.StatusCode, body)
		}
	})

	t.Run("/mcp refuses DNS rebinding", func(t *testing.T) {
		req := mcpRequest(t, srv.URL)
		req.Host = "evil.example.com"
		if res, body := send(t, req); res.StatusCode != http.StatusForbidden {
			t.Errorf("initialize with Host evil.example.com = %d %s, want 403", res.StatusCode, body)
		}
	})

	t.Run("unknown routes get the JSON 404", func(t *testing.T) {
		for _, path := range []string{"/", "/nope", "/mcp/extra"} {
			res, body := send(t, newRequest(http.MethodGet, path))
			if res.StatusCode != http.StatusNotFound || !strings.Contains(body, `"code":"not_found"`) {
				t.Errorf("GET %s = %d %s, want 404 not_found", path, res.StatusCode, body)
			}
		}
	})
}

func TestRoutesLogEveryRequest(t *testing.T) {
	srv, logs := newTestServer(t)

	get, err := http.NewRequest(http.MethodGet, srv.URL+"/api/notes/missing", nil)
	if err != nil {
		t.Fatal(err)
	}
	send(t, get)
	send(t, mcpRequest(t, srv.URL))

	for _, want := range []string{
		"method=GET path=/api/notes/missing status=404",
		"method=POST path=/mcp status=200",
	} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("logs do not contain %q:\n%s", want, logs)
		}
	}
}
