// Package config loads the server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Defaults used when a variable is unset or empty.
const (
	DefaultHost              = "127.0.0.1"
	DefaultPort              = 8080
	DefaultCORSAllowedOrigin = "http://localhost:5173"
	DefaultSeedNotes         = true
)

// Config is the validated server configuration.
type Config struct {
	Host              string // an IP address or "localhost"
	Port              int
	CORSAllowedOrigin string // normalised to scheme://host[:port]
	SeedNotes         bool
}

// Addr returns the listen address for http.Server.
func (c Config) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

// Load reads the configuration through getenv (usually os.Getenv). Unset or
// empty variables fall back to the defaults. Invalid values are not replaced
// by defaults: every problem is reported in one error so the server can fail
// fast at startup.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		Host:              DefaultHost,
		Port:              DefaultPort,
		CORSAllowedOrigin: DefaultCORSAllowedOrigin,
		SeedNotes:         DefaultSeedNotes,
	}
	var errs []error

	if v := strings.TrimSpace(getenv("HOST")); v != "" {
		if v != "localhost" && net.ParseIP(v) == nil {
			errs = append(errs, fmt.Errorf("HOST must be an IP address or localhost, got %q", v))
		} else {
			cfg.Host = v
		}
	}

	if v := strings.TrimSpace(getenv("PORT")); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil || port < 1 || port > 65535 {
			errs = append(errs, fmt.Errorf("PORT must be a whole number from 1 to 65535, got %q", v))
		} else {
			cfg.Port = port
		}
	}

	if v := strings.TrimSpace(getenv("CORS_ALLOWED_ORIGIN")); v != "" {
		origin, err := parseOrigin(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("CORS_ALLOWED_ORIGIN %w", err))
		} else {
			cfg.CORSAllowedOrigin = origin
		}
	}

	if v := strings.TrimSpace(getenv("SEED_NOTES")); v != "" {
		seed, err := strconv.ParseBool(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("SEED_NOTES must be true or false, got %q", v))
		} else {
			cfg.SeedNotes = seed
		}
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, fmt.Errorf("invalid configuration: %w", err)
	}
	return cfg, nil
}

// parseOrigin accepts a single http(s) origin, such as http://localhost:5173,
// and returns it in the form browsers send in the Origin header: lowercase,
// and without a default port (:80 for http, :443 for https).
func parseOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("must be an http(s) origin such as http://localhost:5173, got %q", raw)
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", fmt.Errorf("must be only scheme, host and optional port (no path or query), got %q", raw)
	}
	host := strings.ToLower(u.Host)
	if (u.Scheme == "http" && u.Port() == "80") || (u.Scheme == "https" && u.Port() == "443") {
		host = strings.TrimSuffix(host, ":"+u.Port()) // keeps the brackets of an IPv6 host
	}
	return u.Scheme + "://" + host, nil
}
