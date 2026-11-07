package note

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
)

var fixedNow = time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC)

// newTestService returns a service with a fixed clock and the repository behind it.
func newTestService() (*Service, *MemoryRepository) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	svc.now = func() time.Time { return fixedNow }
	return svc, repo
}

func manyTags(n int) []string {
	tags := make([]string, n)
	for i := range tags {
		tags[i] = fmt.Sprintf("tag-%d", i)
	}
	return tags
}

func ids(notes []Note) []string {
	out := make([]string, len(notes))
	for i, n := range notes {
		out[i] = n.ID
	}
	return out
}

func TestServiceCreate(t *testing.T) {
	tests := []struct {
		name string
		in   CreateInput
		want CreateInput // expected title, body and tags after normalising
	}{
		{
			name: "trims title and body",
			in:   CreateInput{Title: "  Standup notes \n", Body: "\n  Blockers: none  \n"},
			want: CreateInput{Title: "Standup notes", Body: "Blockers: none", Tags: []string{}},
		},
		{
			name: "lowercases, trims and de-duplicates tags in order",
			in:   CreateInput{Title: "Tags", Tags: []string{" Go ", "API", "go", "api", "team-1"}},
			want: CreateInput{Title: "Tags", Tags: []string{"go", "api", "team-1"}},
		},
		{
			name: "nil tags become an empty list",
			in:   CreateInput{Title: "No tags", Tags: nil},
			want: CreateInput{Title: "No tags", Tags: []string{}},
		},
		{
			name: "values exactly at the limits are accepted",
			in: CreateInput{
				Title: strings.Repeat("é", MaxTitleLength), // counts characters, not bytes
				Body:  strings.Repeat("b", MaxBodyLength),
				Tags:  append(manyTags(MaxTags-1), strings.Repeat("t", MaxTagLength)),
			},
			want: CreateInput{
				Title: strings.Repeat("é", MaxTitleLength),
				Body:  strings.Repeat("b", MaxBodyLength),
				Tags:  append(manyTags(MaxTags-1), strings.Repeat("t", MaxTagLength)),
			},
		},
	}
	hexID := regexp.MustCompile(`^[0-9a-f]{32}$`)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _ := newTestService()
			ctx := context.Background()

			got, err := svc.Create(ctx, tt.in)
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			if !hexID.MatchString(got.ID) {
				t.Errorf("ID = %q, want 32 hex characters", got.ID)
			}
			if !got.CreatedAt.Equal(fixedNow) {
				t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, fixedNow)
			}
			if got.Title != tt.want.Title || got.Body != tt.want.Body {
				t.Errorf("title/body = %q/%q, want %q/%q", got.Title, got.Body, tt.want.Title, tt.want.Body)
			}
			if got.Tags == nil || !slices.Equal(got.Tags, tt.want.Tags) {
				t.Errorf("Tags = %#v, want %#v", got.Tags, tt.want.Tags)
			}

			stored, err := svc.Get(ctx, got.ID)
			if err != nil {
				t.Fatalf("Get() after Create() error = %v", err)
			}
			if stored.ID != got.ID || stored.Title != got.Title || !slices.Equal(stored.Tags, got.Tags) {
				t.Errorf("stored note = %+v, want %+v", stored, got)
			}
		})
	}
}

func TestServiceCreateValidation(t *testing.T) {
	tests := []struct {
		name       string
		in         CreateInput
		wantFields []string
		wantInMsg  string
	}{
		{"missing title", CreateInput{}, []string{"title"}, "is required"},
		{"whitespace-only title", CreateInput{Title: " \t\n "}, []string{"title"}, "is required"},
		{"title too long", CreateInput{Title: strings.Repeat("a", MaxTitleLength+1)}, []string{"title"}, "at most 120"},
		{"body too long", CreateInput{Title: "ok", Body: strings.Repeat("b", MaxBodyLength+1)}, []string{"body"}, "at most 10000"},
		{"tag with a space and a symbol", CreateInput{Title: "ok", Tags: []string{"Bad Tag!"}}, []string{"tags"}, `"bad tag!" is not a valid tag`},
		{"tag starting with a hyphen", CreateInput{Title: "ok", Tags: []string{"-draft"}}, []string{"tags"}, `"-draft"`},
		{"tag too long", CreateInput{Title: "ok", Tags: []string{strings.Repeat("t", MaxTagLength+1)}}, []string{"tags"}, "not a valid tag"},
		{"empty tag", CreateInput{Title: "ok", Tags: []string{"  "}}, []string{"tags"}, `""`},
		{"several invalid tags listed together", CreateInput{Title: "ok", Tags: []string{"a b", "ok", "c_d"}}, []string{"tags"}, `"a b", "c_d" are not valid tags`},
		{"too many tags", CreateInput{Title: "ok", Tags: manyTags(MaxTags + 1)}, []string{"tags"}, "at most 10 tags"},
		{
			name:       "every invalid field is reported at once",
			in:         CreateInput{Title: "", Body: strings.Repeat("b", MaxBodyLength+1), Tags: []string{"no way"}},
			wantFields: []string{"body", "tags", "title"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, repo := newTestService()
			ctx := context.Background()

			_, err := svc.Create(ctx, tt.in)

			var verr *ValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("Create() error = %v, want a *ValidationError", err)
			}
			if got := slices.Sorted(maps.Keys(verr.Fields)); !slices.Equal(got, tt.wantFields) {
				t.Errorf("invalid fields = %v, want %v", got, tt.wantFields)
			}
			if tt.wantInMsg != "" {
				msg := verr.Fields[tt.wantFields[0]]
				if !strings.Contains(msg, tt.wantInMsg) {
					t.Errorf("message = %q, want it to contain %q", msg, tt.wantInMsg)
				}
			}
			if all, _ := repo.Search(ctx, nil); len(all) != 0 {
				t.Errorf("repository has %d notes after a failed create, want 0", len(all))
			}
		})
	}
}

func TestServiceSearch(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	for _, n := range []Note{
		{ID: "a", Title: "Go API design", Body: "Use the standard library.", Tags: []string{"backend"}, CreatedAt: fixedNow.Add(-3 * time.Hour)},
		{ID: "b", Title: "Sprint planning", Body: "Discuss the API roadmap.", Tags: []string{"planning"}, CreatedAt: fixedNow.Add(-1 * time.Hour)},
		{ID: "c", Title: "Lunch order", Body: "Pizza on Friday.", Tags: []string{"team", "fun"}, CreatedAt: fixedNow.Add(-2 * time.Hour)},
		{ID: "d", Title: "Same time as b", Body: "Ties are ordered by id.", Tags: []string{}, CreatedAt: fixedNow.Add(-1 * time.Hour)},
	} {
		if err := repo.Create(ctx, n); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}

	tests := []struct {
		name    string
		query   string
		wantIDs []string
	}{
		{"empty query returns all, newest first", "", []string{"b", "d", "c", "a"}},
		{"whitespace-only query returns all", "  \t ", []string{"b", "d", "c", "a"}},
		{"matches title and body, ignoring case", "api", []string{"b", "a"}},
		{"upper-case query matches body", "PIZZA", []string{"c"}},
		{"matches a tag", "fun", []string{"c"}},
		{"matches part of a word", "plan", []string{"b"}},
		{"every term must match", "api roadmap", []string{"b"}},
		{"terms can match different fields", "lunch team", []string{"c"}},
		{"extra whitespace between terms is ignored", "  go   standard ", []string{"a"}},
		{"terms that never appear together", "api pizza", []string{}},
		{"no match returns an empty list", "kubernetes", []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := svc.Search(ctx, tt.query)
			if err != nil {
				t.Fatalf("Search() error = %v", err)
			}
			if got == nil {
				t.Fatal("Search() = nil, want a non-nil slice")
			}
			if gotIDs := ids(got); !slices.Equal(gotIDs, tt.wantIDs) {
				t.Errorf("Search(%q) = %v, want %v", tt.query, gotIDs, tt.wantIDs)
			}
		})
	}
}

func TestServiceGetAndDelete(t *testing.T) {
	tests := []struct {
		name    string
		id      func(created string) string
		wantErr error
	}{
		{"existing note", func(id string) string { return id }, nil},
		{"id with surrounding spaces", func(id string) string { return "  " + id + " " }, nil},
		{"unknown id", func(string) string { return "does-not-exist" }, ErrNotFound},
		{"empty id", func(string) string { return "" }, ErrNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _ := newTestService()
			ctx := context.Background()
			created, err := svc.Create(ctx, CreateInput{Title: "To delete", Tags: []string{"tmp"}})
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			id := tt.id(created.ID)

			if _, err := svc.Get(ctx, id); !errors.Is(err, tt.wantErr) {
				t.Fatalf("Get() error = %v, want %v", err, tt.wantErr)
			}

			deleted, err := svc.Delete(ctx, id)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Delete() error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil {
				if _, err := svc.Get(ctx, created.ID); err != nil {
					t.Errorf("Get() after a failed delete error = %v, want the note to remain", err)
				}
				return
			}

			if deleted.ID != created.ID || deleted.Title != created.Title {
				t.Errorf("Delete() returned %+v, want %+v", deleted, created)
			}
			if _, err := svc.Get(ctx, created.ID); !errors.Is(err, ErrNotFound) {
				t.Errorf("Get() after delete error = %v, want ErrNotFound", err)
			}
			if _, err := svc.Delete(ctx, created.ID); !errors.Is(err, ErrNotFound) {
				t.Errorf("second Delete() error = %v, want ErrNotFound", err)
			}
		})
	}
}

func TestSeed(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()

	if err := Seed(ctx, repo, fixedNow); err != nil {
		t.Fatalf("Seed() error = %v", err)
	}

	got, _ := repo.Search(ctx, nil)
	if len(got) != len(seedNotes) {
		t.Fatalf("seeded %d notes, want %d", len(got), len(seedNotes))
	}
	for i, n := range got {
		if !n.CreatedAt.Before(fixedNow) {
			t.Errorf("note %q CreatedAt = %v, want before %v", n.Title, n.CreatedAt, fixedNow)
		}
		if i > 0 && !n.CreatedAt.Before(got[i-1].CreatedAt) {
			t.Errorf("seed notes should have distinct times, newest first; %q is not older than %q", n.Title, got[i-1].Title)
		}
	}
}
