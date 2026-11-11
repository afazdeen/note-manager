package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"note-manager/api/internal/note"
)

// Limits for search_notes results. The maximum is the service's, so the
// schema and the service agree.
const (
	defaultSearchLimit = 10
	maxSearchLimit     = note.MaxPageSize
)

// noteResult is a note as tools return it. It mirrors note.Note, with
// descriptions for the output schema.
type noteResult struct {
	ID        string   `json:"id" jsonschema:"Unique note id. Pass it to delete_note."`
	Title     string   `json:"title" jsonschema:"The note's title."`
	Body      string   `json:"body" jsonschema:"The note's text. Plain text; may be empty."`
	Tags      []string `json:"tags" jsonschema:"Lowercase tags, e.g. release or q4-planning. May be empty."`
	CreatedAt string   `json:"createdAt" jsonschema:"When the note was created, in RFC 3339 format (UTC)."`
}

func toResult(n note.Note) noteResult {
	tags := n.Tags
	if tags == nil {
		tags = []string{}
	}
	return noteResult{
		ID:        n.ID,
		Title:     n.Title,
		Body:      n.Body,
		Tags:      tags,
		CreatedAt: n.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

// ---- search_notes ----

type searchInput struct {
	Search string `json:"search,omitempty" jsonschema:"Words to look for in titles, bodies and tags. Every word must match and case is ignored. Leave empty to get the most recent notes."`
	Offset int    `json:"offset,omitempty" jsonschema:"How many matching notes to skip, for paging. 0 or more; defaults to 0. For the next page, pass the previous offset plus the number of notes returned, while that is less than total."`
	Limit  int    `json:"limit,omitempty" jsonschema:"Maximum number of notes to return (the page size), from 1 to 50. Defaults to 10."`
}

type searchOutput struct {
	Notes []noteResult `json:"notes" jsonschema:"This page of matching notes, newest first."`
	Total int          `json:"total" jsonschema:"How many notes match in total, across all pages. When offset plus the number of notes returned is less than this, there are more pages."`
}

// searchInputSchema adds the ranges and defaults of offset and limit to the
// inferred schema, so clients can check them before calling. The SDK
// validates against it too.
func searchInputSchema() *jsonschema.Schema {
	s := schemaFor[searchInput]()
	offset := s.Properties["offset"]
	offset.Minimum = ptr(0.0)
	offset.Default = json.RawMessage("0")
	limit := s.Properties["limit"]
	limit.Minimum = ptr(1.0)
	limit.Maximum = ptr(float64(maxSearchLimit))
	limit.Default = json.RawMessage(strconv.Itoa(defaultSearchLimit))
	return s
}

var searchTool = &sdk.Tool{
	Name:         "search_notes",
	Title:        "Search notes",
	InputSchema:  searchInputSchema(),
	OutputSchema: schemaFor[searchOutput](),
	Description: "Search the team's shared notes. Returns notes whose title, body or tags contain every word of `search` " +
		"(case-insensitive), newest first. Leave `search` empty to list the most recent notes. " +
		"Results come in pages of `limit` notes: to get the next page, call again with `offset` set to the previous " +
		"offset plus the number of notes returned, while that is less than `total`. Read-only.",
	Annotations: &sdk.ToolAnnotations{
		Title:         "Search notes",
		ReadOnlyHint:  true,
		OpenWorldHint: ptr(false),
	},
}

// search runs search_notes. The SDK has already checked offset (0 or more)
// and limit (1 to 50) against the schema and filled in the defaults when they
// were left out. The service does the paging, like the REST API.
func (t *tools) search(ctx context.Context, _ *sdk.CallToolRequest, in searchInput) (*sdk.CallToolResult, searchOutput, error) {
	page, err := t.notes.Search(ctx, in.Search, in.Offset, in.Limit)
	if err != nil {
		return nil, searchOutput{}, t.toolError("the search was not run", err)
	}
	out := searchOutput{Notes: make([]noteResult, 0, len(page.Notes)), Total: page.Total}
	for _, n := range page.Notes {
		out.Notes = append(out.Notes, toResult(n))
	}
	return nil, out, nil
}

// ---- create_note ----

type createInput struct {
	Title string   `json:"title" jsonschema:"Short title, 1 to 120 characters. Required."`
	Body  string   `json:"body,omitempty" jsonschema:"Optional note text, up to 10000 characters. Plain text; line breaks are kept."`
	Tags  []string `json:"tags,omitempty" jsonschema:"Optional tags, at most 10. Each is 1 to 24 lowercase letters, digits or hyphens and can't start with a hyphen, e.g. release or q4-planning. Tags are lowercased and duplicates are removed."`
}

var createTool = &sdk.Tool{
	Name:         "create_note",
	Title:        "Create note",
	InputSchema:  schemaFor[createInput](),
	OutputSchema: schemaFor[noteResult](),
	Description: "Create a note in the team's shared notes. People see it in the web app straight away. " +
		"Returns the saved note, including its id.",
	Annotations: &sdk.ToolAnnotations{
		Title:           "Create note",
		ReadOnlyHint:    false,
		DestructiveHint: ptr(false),
		IdempotentHint:  false, // calling twice creates two notes
		OpenWorldHint:   ptr(false),
	},
}

func (t *tools) create(ctx context.Context, _ *sdk.CallToolRequest, in createInput) (*sdk.CallToolResult, noteResult, error) {
	n, err := t.notes.Create(ctx, note.CreateInput{Title: in.Title, Body: in.Body, Tags: in.Tags})
	if err != nil {
		return nil, noteResult{}, t.toolError("the note was not saved", err)
	}
	return nil, toResult(n), nil
}

// ---- delete_note ----

type deleteInput struct {
	ID      string `json:"id" jsonschema:"The id of the note to delete, as returned by search_notes or create_note."`
	Confirm bool   `json:"confirm,omitempty" jsonschema:"Must be true. Set it only after the user has clearly confirmed they want this note deleted."`
}

type deleteOutput struct {
	Deleted string `json:"deleted" jsonschema:"The id of the deleted note."`
	Title   string `json:"title" jsonschema:"The title the deleted note had, to confirm the right note was removed."`
}

var deleteTool = &sdk.Tool{
	Name:         "delete_note",
	Title:        "Delete note",
	InputSchema:  schemaFor[deleteInput](),
	OutputSchema: schemaFor[deleteOutput](),
	Description: "Permanently delete a note for everyone on the team. This can't be undone. " +
		"Only use it when the user has clearly asked to delete this specific note, and pass confirm: true.",
	Annotations: &sdk.ToolAnnotations{
		Title:           "Delete note",
		ReadOnlyHint:    false,
		DestructiveHint: ptr(true),
		IdempotentHint:  true, // deleting an already deleted note changes nothing more
		OpenWorldHint:   ptr(false),
	},
}

func (t *tools) delete(ctx context.Context, _ *sdk.CallToolRequest, in deleteInput) (*sdk.CallToolResult, deleteOutput, error) {
	if !in.Confirm {
		return nil, deleteOutput{}, errors.New("not deleted: delete_note permanently removes the note for everyone. " +
			"Check with the user that they want it deleted, then call delete_note again with confirm: true")
	}
	n, err := t.notes.Delete(ctx, in.ID)
	if err != nil {
		return nil, deleteOutput{}, t.toolError("the note was not deleted", err)
	}
	t.logger.Info("note deleted via MCP", "id", n.ID, "title", n.Title)
	return nil, deleteOutput{Deleted: n.ID, Title: n.Title}, nil
}

// ---- errors ----

// toolError turns a service error into a message the agent can act on.
// outcome says what didn't happen, e.g. "the note was not saved", for
// validation errors. Unexpected errors are logged and reported generically,
// without internals.
func (t *tools) toolError(outcome string, err error) error {
	var verr *note.ValidationError
	switch {
	case errors.As(err, &verr):
		parts := make([]string, 0, len(verr.Fields))
		for _, field := range slices.Sorted(maps.Keys(verr.Fields)) {
			parts = append(parts, field+" "+verr.Fields[field])
		}
		return fmt.Errorf("%s because some fields are invalid: %s. Fix them and try again", outcome, strings.Join(parts, "; "))
	case errors.Is(err, note.ErrNotFound):
		return errors.New("no note has that id. It may already be deleted; use search_notes to find the right id")
	default:
		t.logger.Error("note service failed in MCP tool", "error", err)
		return errors.New("something went wrong on the server. Try again later")
	}
}

func ptr[T any](v T) *T { return &v }
