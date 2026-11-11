package note

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// ErrNotFound is returned when no note has the given id.
var ErrNotFound = errors.New("note not found")

// Page sizes for Search. DefaultPageSize is the web app's page size and the
// REST default; MaxPageSize caps every caller.
const (
	DefaultPageSize = 2
	MaxPageSize     = 50
)

// Page is one page of search results.
type Page struct {
	Notes []Note // never nil
	Total int    // how many notes matched before paging
}

// Repository stores notes. Implementations must be safe for concurrent use
// and must not share slices with callers.
type Repository interface {
	Create(ctx context.Context, n Note) error
	Get(ctx context.Context, id string) (Note, error)
	// Search returns one page of the notes in which every term appears in the
	// title, the body or a tag, ignoring case. No terms matches every note.
	// Matches are ordered newest first, with ties broken by id, then the first
	// offset are skipped and at most limit are returned, like SQL's
	// LIMIT/OFFSET. Total counts every match. An offset at or past the end
	// gives no notes. The Service ensures offset >= 0 and limit >= 1.
	Search(ctx context.Context, terms []string, offset, limit int) (Page, error)
	// Delete removes the note and returns it as it was.
	Delete(ctx context.Context, id string) (Note, error)
}

// Service holds the notes rules. REST and MCP both call it, so people and
// agents see the same notes.
type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() string
}

// NewService returns a Service that stores notes in repo.
func NewService(repo Repository) *Service {
	return &Service{
		repo:  repo,
		now:   func() time.Time { return time.Now().UTC() },
		newID: newID,
	}
}

// Create validates the input, then saves a new note with a fresh id and
// createdAt. Invalid input returns a *ValidationError.
func (s *Service) Create(ctx context.Context, in CreateInput) (Note, error) {
	in, err := in.Validate()
	if err != nil {
		return Note{}, err
	}
	n := Note{
		ID:        s.newID(),
		Title:     in.Title,
		Body:      in.Body,
		Tags:      in.Tags,
		CreatedAt: s.now(),
	}
	if err := s.repo.Create(ctx, n); err != nil {
		return Note{}, err
	}
	return n, nil
}

// Get returns the note with the given id, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id string) (Note, error) {
	return s.repo.Get(ctx, strings.TrimSpace(id))
}

// Search splits query on whitespace and returns one page of the notes that
// contain every term (ignoring case) in the title, the body or a tag, newest
// first. An empty query matches every note. offset must be 0 or more and
// limit from 1 to MaxPageSize; otherwise it returns a *ValidationError.
// Repeated terms are passed to the repository once, so a query like
// "a a a ..." costs no more than "a".
func (s *Service) Search(ctx context.Context, query string, offset, limit int) (Page, error) {
	fields := map[string]string{}
	if offset < 0 {
		fields["offset"] = fmt.Sprintf("must be 0 or more (got %d)", offset)
	}
	if limit < 1 || limit > MaxPageSize {
		fields["limit"] = fmt.Sprintf("must be from 1 to %d (got %d)", MaxPageSize, limit)
	}
	if len(fields) > 0 {
		return Page{}, &ValidationError{Fields: fields}
	}

	terms := strings.Fields(strings.ToLower(query))
	slices.Sort(terms)
	return s.repo.Search(ctx, slices.Compact(terms), offset, limit)
}

// Delete removes the note with the given id and returns it, or ErrNotFound.
func (s *Service) Delete(ctx context.Context, id string) (Note, error) {
	return s.repo.Delete(ctx, strings.TrimSpace(id))
}

// newID returns 16 random bytes, hex encoded.
func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b) // crypto/rand.Read never returns an error (Go 1.24+).
	return hex.EncodeToString(b)
}
