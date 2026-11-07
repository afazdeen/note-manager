package httpapi

import "net/http"

const (
	corsAllowedMethods = "GET, POST, DELETE"
	corsAllowedHeaders = "Content-Type"
	corsMaxAgeSeconds  = "600"
)

// CORS lets browser pages on allowedOrigin call next. Requests from any other
// origin get no CORS headers, so the browser blocks them, and their preflights
// are refused with 403. Requests without an Origin header (curl, servers)
// pass through unchanged.
func CORS(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		allowed := origin != "" && origin == allowedOrigin

		if isPreflight(r) {
			h.Add("Vary", "Access-Control-Request-Method")
			h.Add("Vary", "Access-Control-Request-Headers")
			if !allowed || !corsMethodAllowed(r.Header.Get("Access-Control-Request-Method")) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", corsAllowedMethods)
			h.Set("Access-Control-Allow-Headers", corsAllowedHeaders)
			h.Set("Access-Control-Max-Age", corsMaxAgeSeconds)
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if allowed {
			h.Set("Access-Control-Allow-Origin", origin)
		}
		next.ServeHTTP(w, r)
	})
}

func isPreflight(r *http.Request) bool {
	return r.Method == http.MethodOptions &&
		r.Header.Get("Origin") != "" &&
		r.Header.Get("Access-Control-Request-Method") != ""
}

func corsMethodAllowed(method string) bool {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodDelete:
		return true
	default:
		return false
	}
}
