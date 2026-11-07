package httpapi

import (
	"errors"
	"net/http"

	"note-manager/api/internal/note"
)

// Error codes used in the "code" field of every error response.
const (
	codeBadRequest           = "bad_request"
	codeNotFound             = "not_found"
	codeMethodNotAllowed     = "method_not_allowed"
	codePayloadTooLarge      = "payload_too_large"
	codeUnsupportedMediaType = "unsupported_media_type"
	codeValidationFailed     = "validation_failed"
	codeInternal             = "internal"
)

// errorResponse is the single error shape used by every endpoint.
type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: errorBody{Code: code, Message: message}})
}

// writeInternalError sends a generic 500. The real cause is logged by the
// caller and never sent to the client.
func writeInternalError(w http.ResponseWriter) {
	writeError(w, http.StatusInternalServerError, codeInternal, "Something went wrong. Please try again.")
}

// writeServiceError maps an error from the note service to a response.
// Unexpected errors are logged and reported as a generic 500.
func (h *handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var verr *note.ValidationError
	switch {
	case errors.As(err, &verr):
		writeJSON(w, http.StatusUnprocessableEntity, errorResponse{Error: errorBody{
			Code:    codeValidationFailed,
			Message: "Some fields are invalid.",
			Fields:  verr.Fields,
		}})
	case errors.Is(err, note.ErrNotFound):
		writeError(w, http.StatusNotFound, codeNotFound, "Note not found.")
	default:
		h.logger.Error("note service failed", "method", r.Method, "path", r.URL.Path, "error", err)
		writeInternalError(w)
	}
}

// NotFoundHandler answers any unknown route with a 404 in the shared error shape.
func NotFoundHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, codeNotFound, "The requested resource does not exist.")
	})
}

// methodNotAllowed answers a known path called with an unsupported method.
func methodNotAllowed(allow string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", allow)
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed,
			"Method "+r.Method+" is not allowed here. Allowed: "+allow+".")
	})
}
