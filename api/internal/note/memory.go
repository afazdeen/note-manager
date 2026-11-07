package note

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
)

// MemoryRepository keeps notes in a map. It is safe for concurrent use, and
// it copies notes on the way in and out so callers can't change stored data.
type MemoryRepository struct {
	mu    sync.RWMutex
	notes map[string]Note
}

// Compile-time check that MemoryRepository implements Repository.
var _ Repository = (*MemoryRepository)(nil)

// NewMemoryRepository returns an empty repository.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{notes: make(map[string]Note)}
}

// Create stores n. It fails if a note with the same id already exists.
func (r *MemoryRepository) Create(_ context.Context, n Note) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.notes[n.ID]; exists {
		return fmt.Errorf("note %q already exists", n.ID)
	}
	r.notes[n.ID] = clone(n)
	return nil
}

// Get returns the note with the given id, or ErrNotFound.
func (r *MemoryRepository) Get(_ context.Context, id string) (Note, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	n, ok := r.notes[id]
	if !ok {
		return Note{}, ErrNotFound
	}
	return clone(n), nil
}

// Search returns the notes that contain every term, newest first. Terms are
// expected in lowercase; the Service takes care of that.
func (r *MemoryRepository) Search(_ context.Context, terms []string) ([]Note, error) {
	r.mu.RLock()
	results := make([]Note, 0, len(r.notes))
	for _, n := range r.notes {
		if matches(n, terms) {
			results = append(results, clone(n))
		}
	}
	r.mu.RUnlock()

	slices.SortFunc(results, func(a, b Note) int {
		if c := b.CreatedAt.Compare(a.CreatedAt); c != 0 {
			return c
		}
		return strings.Compare(a.ID, b.ID)
	})
	return results, nil
}

// Delete removes the note with the given id and returns it, or ErrNotFound.
func (r *MemoryRepository) Delete(_ context.Context, id string) (Note, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n, ok := r.notes[id]
	if !ok {
		return Note{}, ErrNotFound
	}
	delete(r.notes, id)
	return n, nil
}

// matches reports whether every term appears in the title, the body or a tag.
func matches(n Note, terms []string) bool {
	title, body := strings.ToLower(n.Title), strings.ToLower(n.Body)
	for _, term := range terms {
		found := strings.Contains(title, term) ||
			strings.Contains(body, term) ||
			slices.ContainsFunc(n.Tags, func(tag string) bool { return strings.Contains(tag, term) })
		if !found {
			return false
		}
	}
	return true
}

// clone copies n so the stored note and the caller's note don't share a Tags slice.
func clone(n Note) Note {
	n.Tags = slices.Clone(n.Tags)
	if n.Tags == nil {
		n.Tags = []string{}
	}
	return n
}
