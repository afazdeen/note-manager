package mcp

import (
	"fmt"
	"slices"

	"github.com/google/jsonschema-go/jsonschema"
)

// schemaFor infers T's JSON schema the same way the SDK does, then describes
// every slice as a plain "array".
//
// The library types Go slices as ["null", "array"] because a nil slice encodes
// as null. That is valid JSON Schema, but clients that only understand a single
// `type` (for example ones converting to Gemini's function format) may reject
// it. The tools never send null lists, and agents should omit a list rather
// than send null, so "array" is both accurate and more portable.
func schemaFor[T any]() *jsonschema.Schema {
	s, err := jsonschema.For[T](nil)
	if err != nil {
		// The types are fixed at compile time, so this is a programming error.
		panic(fmt.Sprintf("mcp: inferring schema for %T: %v", *new(T), err))
	}
	plainArrays(s)
	return s
}

func plainArrays(s *jsonschema.Schema) {
	if s == nil {
		return
	}
	if slices.Equal(s.Types, []string{"null", "array"}) {
		s.Types = nil
		s.Type = "array"
	}
	for _, prop := range s.Properties {
		plainArrays(prop)
	}
	plainArrays(s.Items)
}
