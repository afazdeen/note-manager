package note

import (
	"context"
	"fmt"
	"time"
)

// seedNote is a demo note and how long before "now" it was written.
type seedNote struct {
	input CreateInput
	age   time.Duration
}

var seedNotes = []seedNote{
	{
		input: CreateInput{
			Title: "Sprint 14 planning",
			Body:  "Goals: ship note search and the MCP server.\nStretch: tag picker polish.\nDemo on Friday.",
			Tags:  []string{"planning", "sprint"},
		},
		age: 30 * time.Minute,
	},
	{
		input: CreateInput{
			Title: "API conventions",
			Body:  "Every error uses one JSON shape: {\"error\": {\"code\", \"message\", \"fields\"}}.\nList endpoints return newest first.",
			Tags:  []string{"api", "go", "conventions"},
		},
		age: 3 * time.Hour,
	},
	{
		input: CreateInput{
			Title: "Onboarding checklist",
			Body:  "1. Clone the repo and copy the .env.example files.\n2. Run the API and the web app.\n3. Connect your AI agent to /mcp.",
			Tags:  []string{"onboarding", "team"},
		},
		age: 26 * time.Hour,
	},
	{
		input: CreateInput{
			Title: "Retro: what went well",
			Body:  "Pairing on the CORS setup saved time. Keep PRs small. Write the tests first for tricky rules.",
			Tags:  []string{"retro", "team"},
		},
		age: 3 * 24 * time.Hour,
	},
	{
		input: CreateInput{
			Title: "Accessibility reminders",
			Body:  "Label every input, keep a visible focus ring, check the layout at 375px, and test with the keyboard only.",
			Tags:  []string{"a11y", "frontend"},
		},
		age: 7 * 24 * time.Hour,
	},
}

// Seed adds the demo notes to repo, dated relative to now, so the app isn't
// empty on first run. The notes go through the same validation as any other.
func Seed(ctx context.Context, repo Repository, now time.Time) error {
	for _, s := range seedNotes {
		in, err := s.input.Validate()
		if err != nil {
			return fmt.Errorf("seed note %q: %w", s.input.Title, err)
		}
		n := Note{
			ID:        newID(),
			Title:     in.Title,
			Body:      in.Body,
			Tags:      in.Tags,
			CreatedAt: now.Add(-s.age).UTC(),
		}
		if err := repo.Create(ctx, n); err != nil {
			return fmt.Errorf("seed note %q: %w", n.Title, err)
		}
	}
	return nil
}
