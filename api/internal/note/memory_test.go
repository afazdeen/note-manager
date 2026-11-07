package note

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"
)

func mustCreate(t *testing.T, repo *MemoryRepository, notes ...Note) {
	t.Helper()
	for _, n := range notes {
		if err := repo.Create(context.Background(), n); err != nil {
			t.Fatalf("Create(%q) error = %v", n.ID, err)
		}
	}
}

func TestMemoryRepositoryCreate(t *testing.T) {
	tests := []struct {
		name      string
		create    Note
		wantErr   bool
		wantTitle string // title stored under id "n1" afterwards
	}{
		{"new id is stored", Note{ID: "n2", Title: "Second"}, false, "First"},
		{"duplicate id is rejected and the original kept", Note{ID: "n1", Title: "Duplicate"}, true, "First"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := NewMemoryRepository()
			mustCreate(t, repo, Note{ID: "n1", Title: "First", CreatedAt: fixedNow})

			err := repo.Create(context.Background(), tt.create)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Create() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got, _ := repo.Get(context.Background(), "n1"); got.Title != tt.wantTitle {
				t.Errorf("note n1 title = %q, want %q", got.Title, tt.wantTitle)
			}
		})
	}
}

func TestMemoryRepositoryGet(t *testing.T) {
	repo := NewMemoryRepository()
	mustCreate(t, repo, Note{ID: "n1", Title: "First", Tags: nil, CreatedAt: fixedNow})

	tests := []struct {
		name      string
		id        string
		wantTitle string
		wantErr   error
	}{
		{"existing id", "n1", "First", nil},
		{"unknown id", "missing", "", ErrNotFound},
		{"empty id", "", "", ErrNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := repo.Get(context.Background(), tt.id)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Get() error = %v, want %v", err, tt.wantErr)
			}
			if got.Title != tt.wantTitle {
				t.Errorf("Get() title = %q, want %q", got.Title, tt.wantTitle)
			}
			if err == nil && got.Tags == nil {
				t.Error("Get() Tags = nil, want a non-nil slice")
			}
		})
	}
}

func TestMemoryRepositoryReturnsCopies(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	input := Note{ID: "n1", Title: "Copy me", Tags: []string{"original"}, CreatedAt: fixedNow}
	mustCreate(t, repo, input)

	input.Tags[0] = "changed-input" // caller changes its slice after Create
	got, _ := repo.Get(ctx, "n1")
	got.Tags[0] = "changed-get"
	found, _ := repo.Search(ctx, nil)
	found[0].Tags[0] = "changed-search"

	stored, _ := repo.Get(ctx, "n1")
	if !slices.Equal(stored.Tags, []string{"original"}) {
		t.Errorf("stored Tags = %v, want [original]; callers must not be able to change stored notes", stored.Tags)
	}
}

func TestMemoryRepositorySearch(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	mustCreate(t, repo,
		Note{ID: "old", Title: "Release checklist", Body: "Tag the release.", Tags: []string{"release"}, CreatedAt: fixedNow.Add(-48 * time.Hour)},
		Note{ID: "y", Title: "Design review", Body: "Colours and spacing.", Tags: []string{"design", "ui"}, CreatedAt: fixedNow},
		Note{ID: "x", Title: "UI polish", Body: "Focus rings everywhere.", Tags: []string{"frontend"}, CreatedAt: fixedNow},
	)

	tests := []struct {
		name    string
		terms   []string
		wantIDs []string
	}{
		{"nil terms match all, newest first, ties by id", nil, []string{"x", "y", "old"}},
		{"empty terms match all", []string{}, []string{"x", "y", "old"}},
		{"term in a mixed-case title", []string{"release"}, []string{"old"}},
		{"term only in a tag", []string{"design"}, []string{"y"}},
		{"term in tag of one note and title of another", []string{"ui"}, []string{"x", "y"}},
		{"all terms must match", []string{"ui", "focus"}, []string{"x"}},
		{"no match", []string{"nothing"}, []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := repo.Search(ctx, tt.terms)
			if err != nil {
				t.Fatalf("Search() error = %v", err)
			}
			if gotIDs := ids(got); !slices.Equal(gotIDs, tt.wantIDs) {
				t.Errorf("Search(%v) = %v, want %v", tt.terms, gotIDs, tt.wantIDs)
			}
		})
	}
}

func TestMemoryRepositoryDelete(t *testing.T) {
	tests := []struct {
		name    string
		id      string
		wantErr error
		wantID  string // id of the returned note ("" when nothing was deleted)
		wantLen int    // notes left afterwards
	}{
		{"existing note is removed and returned", "n1", nil, "n1", 1},
		{"unknown id is not found", "missing", ErrNotFound, "", 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := NewMemoryRepository()
			ctx := context.Background()
			mustCreate(t, repo,
				Note{ID: "n1", Title: "One", CreatedAt: fixedNow},
				Note{ID: "n2", Title: "Two", CreatedAt: fixedNow},
			)

			deleted, err := repo.Delete(ctx, tt.id)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Delete() error = %v, want %v", err, tt.wantErr)
			}
			if deleted.ID != tt.wantID {
				t.Errorf("Delete() returned id %q, want %q", deleted.ID, tt.wantID)
			}
			if all, _ := repo.Search(ctx, nil); len(all) != tt.wantLen {
				t.Errorf("%d notes left, want %d", len(all), tt.wantLen)
			}
			if _, err := repo.Get(ctx, tt.id); !errors.Is(err, ErrNotFound) {
				t.Errorf("Get(%q) after Delete() error = %v, want ErrNotFound", tt.id, err)
			}
		})
	}
}

// Run with -race (CI does) to catch unsynchronised access.
func TestMemoryRepositoryConcurrentUse(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	const workers = 50

	var wg sync.WaitGroup
	for i := range workers {
		wg.Go(func() {
			id := fmt.Sprintf("n%d", i)
			if err := repo.Create(ctx, Note{ID: id, Title: id, Tags: []string{"load"}, CreatedAt: fixedNow}); err != nil {
				t.Errorf("Create(%q) error = %v", id, err)
			}
			_, _ = repo.Search(ctx, []string{"load"})
			_, _ = repo.Get(ctx, id)
			if i%2 == 0 {
				if _, err := repo.Delete(ctx, id); err != nil {
					t.Errorf("Delete(%q) error = %v", id, err)
				}
			}
		})
	}
	wg.Wait()

	if all, _ := repo.Search(ctx, nil); len(all) != workers/2 {
		t.Errorf("%d notes left, want %d", len(all), workers/2)
	}
}
