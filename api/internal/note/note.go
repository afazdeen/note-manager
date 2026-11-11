// Package note holds the notes domain: the Note type, its validation rules,
// the service used by REST and MCP, and an in-memory repository.
package note

import (
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Limits from the validation rules in Implementation_Guide.md.
const (
	MaxTitleLength = 120
	MaxBodyLength  = 10_000
	MaxTags        = 10
	MaxTagLength   = 24
)

var tagPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// Note is a saved note. Notes can't be edited, so there is no UpdatedAt.
type Note struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Tags      []string  `json:"tags"`
	CreatedAt time.Time `json:"createdAt"`
}

// CreateInput is what a caller provides to create a note.
type CreateInput struct {
	Title string   `json:"title"`
	Body  string   `json:"body"`
	Tags  []string `json:"tags"`
}

// ValidationError lists every invalid field, with one message per field.
type ValidationError struct {
	Fields map[string]string
}

func (e *ValidationError) Error() string {
	parts := make([]string, 0, len(e.Fields))
	for _, field := range slices.Sorted(maps.Keys(e.Fields)) {
		parts = append(parts, field+" "+e.Fields[field])
	}
	return "invalid input: " + strings.Join(parts, "; ")
}

// Validate normalises the input and then checks it. Title and body are
// trimmed. Tags are trimmed, lowercased and de-duplicated (first occurrence
// kept), and Tags is never nil. It returns the normalised input, or a
// *ValidationError that lists every invalid field.
func (in CreateInput) Validate() (CreateInput, error) {
	in = in.normalize()
	fields := map[string]string{}

	switch n := utf8.RuneCountInString(in.Title); {
	case n == 0:
		fields["title"] = "is required"
	case n > MaxTitleLength:
		fields["title"] = fmt.Sprintf("must be at most %d characters (got %d)", MaxTitleLength, n)
	case strings.ContainsFunc(in.Title, isTitleControl):
		fields["title"] = "must be a single line without control characters"
	}

	if n := utf8.RuneCountInString(in.Body); n > MaxBodyLength {
		fields["body"] = fmt.Sprintf("must be at most %d characters (got %d)", MaxBodyLength, n)
	}

	if msg := validateTags(in.Tags); msg != "" {
		fields["tags"] = msg
	}

	if len(fields) > 0 {
		return in, &ValidationError{Fields: fields}
	}
	return in, nil
}

func (in CreateInput) normalize() CreateInput {
	out := CreateInput{
		Title: strings.TrimSpace(in.Title),
		Body:  strings.TrimSpace(in.Body),
		Tags:  make([]string, 0, len(in.Tags)),
	}
	for _, tag := range in.Tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if !slices.Contains(out.Tags, tag) {
			out.Tags = append(out.Tags, tag)
		}
	}
	return out
}

// isTitleControl reports whether r is not allowed in a title: control
// characters such as line breaks and tabs, and bidirectional controls such as
// U+202E, which make text display in a different order than it is stored.
func isTitleControl(r rune) bool {
	return unicode.IsControl(r) || unicode.Is(unicode.Bidi_Control, r)
}

// validateTags returns a message for the tags field, or "" if the tags are valid.
func validateTags(tags []string) string {
	var invalid []string
	for _, tag := range tags {
		if utf8.RuneCountInString(tag) > MaxTagLength || !tagPattern.MatchString(tag) {
			invalid = append(invalid, fmt.Sprintf("%q", tag))
		}
	}
	const rule = "use 1-24 lowercase letters, digits or hyphens, not starting with a hyphen"
	switch {
	case len(invalid) == 1:
		return fmt.Sprintf("%s is not a valid tag (%s)", invalid[0], rule)
	case len(invalid) > 1:
		return fmt.Sprintf("%s are not valid tags (%s)", strings.Join(invalid, ", "), rule)
	case len(tags) > MaxTags:
		return fmt.Sprintf("must have at most %d tags (got %d)", MaxTags, len(tags))
	}
	return ""
}
