package note

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"slices"
	"strings"
	"time"
)

// ErrNotFound is returned when no note has the given id.
var ErrNotFound = errors.New("note not found")

// Repository stores notes. Implementations must be safe for concurrent use
// and must not share slices with callers.
type Repository interface {
	Create(ctx context.Context, n Note) error
	Get(ctx context.Context, id string) (Note, error)
	// Search returns the notes in which every term appears in the title, the
	// body or a tag, ignoring case. No terms matches every note. Results are
	// newest first, with ties broken by id, and the slice is never nil.
	Search(ctx context.Context, terms []string) ([]Note, error)
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

// Search splits query on whitespace and returns the notes that contain every
// term (ignoring case) in the title, the body or a tag, newest first. An empty
// query returns every note. Repeated terms are passed to the repository once,
// so a query like "a a a ..." costs no more than "a".
func (s *Service) Search(ctx context.Context, query string) ([]Note, error) {
	terms := strings.Fields(strings.ToLower(query))
	slices.Sort(terms)
	return s.repo.Search(ctx, slices.Compact(terms))
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
