// The same tag rules as the Go API (Implementation_Guide.md section 3).

export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 24

const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Trims and lowercases, as the API does before validating. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Explains why a normalised tag is invalid, or returns null if it is fine. */
export function tagError(tag: string): string | null {
  if (tag.length > MAX_TAG_LENGTH) {
    return `"${tag}" is too long. Tags can be up to ${MAX_TAG_LENGTH} characters.`
  }
  if (!TAG_PATTERN.test(tag)) {
    return `"${tag}" isn't a valid tag. Use lowercase letters, numbers and hyphens, and don't start with a hyphen.`
  }
  return null
}

/** Normalises tags, dropping blanks, invalid tags and duplicates (first one wins). */
export function cleanTags(tags: Iterable<string>): string[] {
  const out: string[] = []
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (tag && tagError(tag) === null && !out.includes(tag)) out.push(tag)
  }
  return out
}
