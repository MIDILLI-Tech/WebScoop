import type { DiscoveredUrl } from '../types'

/**
 * Best-effort URL extraction from JavaScript source code.
 * This is inherently imperfect — not all URLs can be statically detected.
 * We scan for common patterns: string literals containing URLs,
 * dynamic import paths, fetch/XMLHttpRequest calls, and known loaders.
 */
/** Common analytics/tracker endpoints — never worth mirroring. */
const TRACKER_HINTS =
  /(google-analytics|googletagmanager|doubleclick|facebook\.net|connect\.facebook|hotjar|segment\.io|segment\.com|mixpanel|clarity\.ms|scorecardresearch|criteo|taboola|adservice|adnxs)/i

export function parseJs(source: string, baseUrl: string): DiscoveredUrl[] {
  const urls: DiscoveredUrl[] = []
  const seen = new Set<string>()

  // Pattern 1: Full URLs in string literals (exclude template-literal
  // leftovers and punctuation that commonly trails wiki-style URLs)
  const fullUrlPattern = /['"`](https?:\/\/[^'"`\s}{(),;]+)['"`]/gi
  for (const match of source.matchAll(fullUrlPattern)) {
    add(match[1])
  }

  // Pattern 2: Absolute paths (starting with /)
  const absolutePathPattern = /['"`](\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]{1,10})['"`]/g
  for (const match of source.matchAll(absolutePathPattern)) {
    const path = match[1]
    if (isLikelyAsset(path)) add(path)
  }

  // Pattern 3: Relative paths to common asset files
  const relativeAssetPattern = /['"`](\.{0,2}\/[a-zA-Z0-9_./-]+\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|json|html?))['"`]/gi
  for (const match of source.matchAll(relativeAssetPattern)) {
    add(match[1])
  }

  // Pattern 4: Dynamic import()
  const dynamicImportPattern = /import\(\s*['"`]([^'"`]+)['"`]\s*\)/g
  for (const match of source.matchAll(dynamicImportPattern)) {
    add(match[1])
  }

  // Pattern 5: Webpack/Vite chunk patterns (path-anchored only; bare
  // filenames like "chunks/x.js" resolve against the bundle's own directory
  // and produce bogus doubled paths)
  const chunkPattern = /['"](\.{0,2}\/[\w./-]*chunk[\w./-]*\.js)['"]/gi
  for (const match of source.matchAll(chunkPattern)) {
    add(match[1])
  }

  // Pattern 6: Common asset loading patterns
  const srcPattern = /\.(?:src|href|poster|url|backgroundImage)\s*=\s*['"`]([^'"`\s]+)['"`]/g
  for (const match of source.matchAll(srcPattern)) {
    if (isLikelyAsset(match[1])) add(match[1])
  }

  return urls

  function add(rawUrl: string): void {
    const trimmed = rawUrl.trim()
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return
    // Unresolvable template-literal fragments (e.g. `${base}/chunk.js`)
    if (trimmed.includes('${')) return
    if (TRACKER_HINTS.test(trimmed)) return
    if (seen.has(trimmed)) return
    seen.add(trimmed)

    try {
      const resolved = new URL(trimmed, baseUrl).toString()
      urls.push({
        url: resolved,
        type: guessType(trimmed),
        sourceUrl: baseUrl,
        sourceAttribute: 'js-scan'
      })
    } catch {
      // skip
    }
  }
}

function isLikelyAsset(path: string): boolean {
  return /\.(js|css|html?|png|jpe?g|gif|svg|webp|ico|avif|woff2?|ttf|otf|eot|json|xml|mp[34]|webm|ogg|wav|pdf)$/i.test(path)
}

function guessType(url: string): DiscoveredUrl['type'] {
  if (/\.(html?|php|asp)$/i.test(url)) return 'html'
  if (/\.css$/i.test(url)) return 'css'
  if (/\.(js|mjs|cjs)$/i.test(url)) return 'js'
  if (/\.(png|jpe?g|gif|svg|webp|ico|avif|bmp)$/i.test(url)) return 'image'
  if (/\.(woff2?|ttf|otf|eot)$/i.test(url)) return 'font'
  if (/\.(mp[34]|webm|ogg|wav|flac)$/i.test(url)) return 'media'
  return 'other'
}
