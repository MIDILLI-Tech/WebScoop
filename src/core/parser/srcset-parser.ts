/**
 * Parse HTML srcset attribute values.
 * Returns an array of image URLs (descriptors stripped).
 *
 * srcset format: "url1 1x, url2 2x" or "url1 300w, url2 600w"
 *
 * Splitting is descriptor-aware so URLs that legitimately contain
 * commas (query strings, path segments) are not cut in half.
 */
const DESCRIPTOR = String.raw`(?:[\d.]+[wx]|\d+h)`
const CANDIDATE_BOUNDARY = new RegExp(
  `,(?=\\s*(?:\\S+\\s+)?${DESCRIPTOR}\\s*(?:,|$))`
)

export function parseSrcset(srcset: string): string[] {
  if (!srcset) return []

  return srcset
    .split(CANDIDATE_BOUNDARY)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      // Each entry is "url descriptor" — we only need the url part
      const parts = entry.split(/\s+/)
      return parts[0]
    })
    .filter((url) => url && !url.startsWith('data:'))
}
