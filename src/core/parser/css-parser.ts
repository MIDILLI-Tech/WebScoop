import postcss from 'postcss'
import valueParser from 'postcss-value-parser'
import type { DiscoveredUrl } from '../types'

export function parseCss(css: string, baseUrl: string): DiscoveredUrl[] {
  const urls: DiscoveredUrl[] = []

  try {
    const root = postcss.parse(css)

    // Walk all declarations to find url() values
    root.walkDecls((decl) => {
      extractUrlsFromValue(decl.value, baseUrl, `css:${decl.prop}`, urls)
    })

    // Walk @import rules
    root.walkAtRules('import', (rule) => {
      const match = rule.params.match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i)
      if (match) {
        resolveAndPush(urls, match[1], baseUrl, '@import')
      } else {
        // @import "file.css" or @import 'file.css'
        const strMatch = rule.params.match(/['"]([^'"]+)['"]/i)
        if (strMatch) {
          resolveAndPush(urls, strMatch[1], baseUrl, '@import')
        }
      }
    })
    // Note: root.walkDecls above already visits declarations inside
    // @font-face blocks, so no separate font-face pass is needed.
  } catch {
    // If postcss fails, fall back to regex
    const matches = css.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)
    for (const m of matches) {
      resolveAndPush(urls, m[1], baseUrl, 'css:regex-fallback')
    }

    const importMatches = css.matchAll(/@import\s+['"]([^'"]+)['"]/gi)
    for (const m of importMatches) {
      resolveAndPush(urls, m[1], baseUrl, '@import')
    }
  }

  return urls
}

function extractUrlsFromValue(
  value: string,
  baseUrl: string,
  sourceAttr: string,
  urls: DiscoveredUrl[]
): void {
  const parsed = valueParser(value)
  parsed.walk((node) => {
    if (node.type === 'function' && node.value === 'url') {
      const inner = valueParser.stringify(node.nodes).trim()
      const cleaned = inner.replace(/^['"]|['"]$/g, '')
      if (cleaned && !cleaned.startsWith('data:')) {
        resolveAndPush(urls, cleaned, baseUrl, sourceAttr)
      }
    }
  })
}

function resolveAndPush(
  urls: DiscoveredUrl[],
  rawUrl: string,
  baseUrl: string,
  attr: string
): void {
  const trimmed = rawUrl.trim()
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return

  try {
    const resolved = new URL(trimmed, baseUrl).toString()
    const type = guessType(resolved)
    urls.push({ url: resolved, type, sourceUrl: baseUrl, sourceAttribute: attr })
  } catch {
    // skip
  }
}

function guessType(url: string): DiscoveredUrl['type'] {
  const path = new URL(url, 'http://localhost').pathname.toLowerCase()
  if (/\.(woff2?|ttf|otf|eot)$/i.test(path)) return 'font'
  if (/\.(png|jpe?g|gif|svg|webp|ico|avif|bmp)$/i.test(path)) return 'image'
  if (/\.css$/i.test(path)) return 'css'
  return 'other'
}
