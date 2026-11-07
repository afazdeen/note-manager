package config

import (
	"strings"
	"testing"
)

// env returns a getenv function backed by a map.
func env(vars map[string]string) func(string) string {
	return func(key string) string { return vars[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env(nil))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	want := Config{Port: 8080, CORSAllowedOrigin: "http://localhost:5173", SeedNotes: true}
	if cfg != want {
		t.Errorf("Load() = %+v, want %+v", cfg, want)
	}
	if got := cfg.Addr(); got != ":8080" {
		t.Errorf("Addr() = %q, want %q", got, ":8080")
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"PORT":                " 9090 ",
		"CORS_ALLOWED_ORIGIN": "https://Notes.Example.com/",
		"SEED_NOTES":          "false",
	}))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	want := Config{Port: 9090, CORSAllowedOrigin: "https://notes.example.com", SeedNotes: false}
	if cfg != want {
		t.Errorf("Load() = %+v, want %+v", cfg, want)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name    string
		vars    map[string]string
		wantErr string
	}{
		{"port not a number", map[string]string{"PORT": "abc"}, "PORT"},
		{"port zero", map[string]string{"PORT": "0"}, "PORT"},
		{"port too high", map[string]string{"PORT": "70000"}, "PORT"},
		{"origin wildcard", map[string]string{"CORS_ALLOWED_ORIGIN": "*"}, "CORS_ALLOWED_ORIGIN"},
		{"origin without scheme", map[string]string{"CORS_ALLOWED_ORIGIN": "localhost:5173"}, "CORS_ALLOWED_ORIGIN"},
		{"origin with path", map[string]string{"CORS_ALLOWED_ORIGIN": "http://localhost:5173/app"}, "CORS_ALLOWED_ORIGIN"},
		{"origin with ftp scheme", map[string]string{"CORS_ALLOWED_ORIGIN": "ftp://example.com"}, "CORS_ALLOWED_ORIGIN"},
		{"seed not a bool", map[string]string{"SEED_NOTES": "maybe"}, "SEED_NOTES"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Load(env(tt.vars))
			if err == nil {
				t.Fatal("Load() error = nil, want an error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Load() error = %q, want it to mention %s", err, tt.wantErr)
			}
		})
	}
}

func TestLoadReportsAllProblemsAtOnce(t *testing.T) {
	_, err := Load(env(map[string]string{"PORT": "x", "SEED_NOTES": "y"}))
	if err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
	for _, name := range []string{"PORT", "SEED_NOTES"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("Load() error = %q, want it to mention %s", err, name)
		}
	}
}
