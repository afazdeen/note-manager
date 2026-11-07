package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
)

// maxBodyBytes caps request bodies. A note at the size limits fits easily.
const maxBodyBytes = 64 << 10

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// The status is already sent, so an encoding error can't change the response.
	_ = json.NewEncoder(w).Encode(v)
}

// requestError is a problem with the request body. Its message is safe to
// send to the client.
type requestError struct {
	status  int
	code    string
	message string
}

func badRequest(message string) *requestError {
	return &requestError{status: http.StatusBadRequest, code: codeBadRequest, message: message}
}

func (e *requestError) write(w http.ResponseWriter) {
	writeError(w, e.status, e.code, e.message)
}

// decodeJSON reads exactly one JSON object into dst. It requires a JSON
// Content-Type (so browsers must send a CORS preflight), limits the body
// size and rejects unknown fields.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) *requestError {
	if mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mediaType != "application/json" {
		return &requestError{
			status:  http.StatusUnsupportedMediaType,
			code:    codeUnsupportedMediaType,
			message: "Content-Type must be application/json.",
		}
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return decodeError(err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if tooLarge := asTooLarge(err); tooLarge != nil {
			return tooLarge
		}
		return badRequest("Request body must contain a single JSON object.")
	}
	return nil
}

// decodeError turns a JSON decoding error into a safe message. Field names
// come from the client's own request, so they are fine to echo back.
func decodeError(err error) *requestError {
	if tooLarge := asTooLarge(err); tooLarge != nil {
		return tooLarge
	}
	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.Is(err, io.EOF):
		return badRequest("Request body is required.")
	case errors.As(err, &syntaxErr), errors.Is(err, io.ErrUnexpectedEOF):
		return badRequest("Request body must be valid JSON.")
	case errors.As(err, &typeErr) && typeErr.Field != "":
		return badRequest(fmt.Sprintf("Field %q has the wrong type.", typeErr.Field))
	case errors.As(err, &typeErr):
		return badRequest("Request body must be a JSON object.")
	}
	if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
		return badRequest(fmt.Sprintf("Unknown field %s.", field))
	}
	return badRequest("Request body must be valid JSON.")
}

func asTooLarge(err error) *requestError {
	var maxErr *http.MaxBytesError
	if !errors.As(err, &maxErr) {
		return nil
	}
	return &requestError{
		status:  http.StatusRequestEntityTooLarge,
		code:    codePayloadTooLarge,
		message: fmt.Sprintf("Request body must be at most %d KB.", maxBodyBytes>>10),
	}
}
