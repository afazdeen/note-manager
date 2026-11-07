package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recover turns a panic in next into a logged error and a generic 500, so
// one bad request can't crash the server or leak details to the client.
func Recover(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			// net/http uses this panic on purpose to abort a response; let it through.
			if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
				panic(v)
			}
			logger.Error("panic serving request",
				"method", r.Method,
				"path", r.URL.Path,
				"panic", v,
				"stack", string(debug.Stack()),
			)
			writeInternalError(w)
		}()
		next.ServeHTTP(w, r)
	})
}
