package httpapi

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

const otherOrigin = "https://evil.example.com"

func preflight(origin, method string) *http.Request {
	req := httptest.NewRequest(http.MethodOptions, "/api/notes", nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", method)
	req.Header.Set("Access-Control-Request-Headers", "content-type")
	return req
}

func TestCORSPreflightAllowedOrigin(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			rec := serve(t, preflight(testOrigin, method))

			if rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
			}
			h := rec.Header()
			if got := h.Get("Access-Control-Allow-Origin"); got != testOrigin {
				t.Errorf("Allow-Origin = %q, want %q", got, testOrigin)
			}
			if got := h.Get("Access-Control-Allow-Methods"); got != "GET, POST, DELETE" {
				t.Errorf("Allow-Methods = %q, want %q", got, "GET, POST, DELETE")
			}
			if got := h.Get("Access-Control-Allow-Headers"); got != "Content-Type" {
				t.Errorf("Allow-Headers = %q, want %q", got, "Content-Type")
			}
			if !slices.Contains(h.Values("Vary"), "Origin") {
				t.Errorf("Vary = %v, want it to include Origin", h.Values("Vary"))
			}
		})
	}
}

func TestCORSPreflightRefused(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		method string
	}{
		{"other origin POST", otherOrigin, http.MethodPost},
		{"other origin DELETE", otherOrigin, http.MethodDelete},
		{"allowed origin, method not allowed", testOrigin, http.MethodPut},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(t, preflight(tt.origin, tt.method))

			if rec.Code != http.StatusForbidden {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusForbidden)
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
				t.Errorf("Allow-Origin = %q, want none", got)
			}
		})
	}
}

func TestCORSSimpleRequest(t *testing.T) {
	tests := []struct {
		name       string
		origin     string
		wantHeader string
	}{
		{"allowed origin", testOrigin, testOrigin},
		{"other origin", otherOrigin, ""},
		{"no origin (curl, servers)", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := serve(t, req)

			// The request is still served; the browser decides whether the page can read it.
			if rec.Code != http.StatusOK {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != tt.wantHeader {
				t.Errorf("Allow-Origin = %q, want %q", got, tt.wantHeader)
			}
		})
	}
}
