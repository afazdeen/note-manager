// Package httpapi serves the REST API under /api.
package httpapi

import "net/http"

// NewHandler returns the handler for everything under /api, wrapped in CORS
// that only allows allowedOrigin.
func NewHandler(allowedOrigin string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("/api/", handleNotFound)
	return CORS(allowedOrigin, mux)
}

type healthResponse struct {
	Status string `json:"status"`
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func handleNotFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "not_found", "The requested resource does not exist.")
}
