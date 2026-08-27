import { URL } from 'node:url'
import { posix } from 'node:path'

/**
 * Rewrites all URLs in HTML content from absolute to relative local paths.
 * This is the key to making downloaded sites work offline.
 */
export function rewriteHtml(
  html: string,
  pageUrl: string,
  urlToLocalPath: (url: string) => string | null
): string {
  let result = html

  // Rewrite tag attributes: href, src, srcset, poster, data, action, content
  const attrPattern = /((?:href|src|poster|data|action)\s*=\s*)(['"])([^'"]*?)\2/gi
  result = result.replace(attrPattern, (full, prefix, quote, value) => {
    const rewritten = rewriteUrl(value.trim(), pageUrl, urlToLocalPath)
    return `${prefix}${quote}${rewritten}${quote}`
  })

  // Rewrite srcset
  const srcsetPattern = /(srcset\s*=\s*)(['"])([^'"]*?)\2/gi
  result = result.replace(srcsetPattern, (full, prefix, quote, value) => {
    const rewritten = rewriteSrcset(value, pageUrl, urlToLocalPath)
    return `${prefix}${quote}${rewritten}${quote}`
  })

  // Rewrite url() in inline styles
  result = rewriteCssUrls(result, pageUrl, urlToLocalPath)

  // Rewrite meta content with image URLs
  const metaPattern = /(<meta[^>]+content\s*=\s*['"])([^'"]+)(['"][^>]*>)/gi
  result = result.replace(metaPattern, (full, prefix, content, suffix) => {
    if (/^https?:\/\//i.test(content)) {
      const rewritten = rewriteUrl(content, pageUrl, urlToLocalPath)
      return `${prefix}${rewritten}${suffix}`
    }
    return full
  })

  return result
}

/**
 * Rewrites all url() references in CSS content.
 */
export function rewriteCss(
  css: string,
  cssUrl: string,
  urlToLocalPath: (url: string) => string | null
): string {
  // Rewrite @import url() and @import ""
  let result = css.replace(
    /@import\s+(?:url\(\s*['"]?([^'")\s]+)['"]?\s*\)|['"]([^'"]+)['"])/gi,
    (full, urlVal, strVal) => {
      const raw = urlVal || strVal
      const rewritten = rewriteUrl(raw, cssUrl, urlToLocalPath)
      return `@import url("${rewritten}")`
    }
  )

  // Rewrite url() in property values
  result = rewriteCssUrls(result, cssUrl, urlToLocalPath)

  return result
}

function rewriteCssUrls(
  content: string,
  baseUrl: string,
  urlToLocalPath: (url: string) => string | null
): string {
  return content.replace(
    /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,
    (full, quote, rawUrl) => {
      const rewritten = rewriteUrl(rawUrl.trim(), baseUrl, urlToLocalPath)
      return `url(${quote}${rewritten}${quote})`
    }
  )
}

const SRCSET_DESCRIPTOR = String.raw`(?:[\d.]+[wx]|\d+h)`
const SRCSET_BOUNDARY = new RegExp(
  `,(?=\\s*(?:\\S+\\s+)?${SRCSET_DESCRIPTOR}\\s*(?:,|$))`
)

function rewriteSrcset(
  srcset: string,
  baseUrl: string,
  urlToLocalPath: (url: string) => string | null
): string {
  return srcset
    .split(SRCSET_BOUNDARY)
    .map((entry) => {
      const parts = entry.trim().split(/\s+/)
      if (parts.length === 0 || !parts[0]) return entry
      parts[0] = rewriteUrl(parts[0], baseUrl, urlToLocalPath)
      return parts.join(' ')
    })
    .join(', ')
}

function rewriteUrl(
  rawUrl: string,
  baseUrl: string,
  urlToLocalPath: (url: string) => string | null
): string {
  if (!rawUrl) return rawUrl
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('javascript:') || rawUrl.startsWith('mailto:')) {
    return rawUrl
  }
  if (rawUrl.startsWith('#')) return rawUrl

  try {
    const absoluteUrl = new URL(rawUrl, baseUrl).toString()
    const localPath = urlToLocalPath(absoluteUrl)
    if (!localPath) return rawUrl

    // Calculate relative path from the page's local path to the target's local path
    const pageLocalPath = urlToLocalPath(baseUrl)
    if (!pageLocalPath) return localPath

    return computeRelativePath(pageLocalPath, localPath)
  } catch {
    return rawUrl
  }
}

/**
 * Compute relative path from `from` file to `to` file.
 * Both paths should be relative to the output root (using / separators).
 */
export function computeRelativePath(from: string, to: string): string {
  const fromDir = posix.dirname(from.replace(/\\/g, '/'))
  const toNorm = to.replace(/\\/g, '/')
  let relative = posix.relative(fromDir, toNorm)
  if (!relative.startsWith('.')) relative = './' + relative
  return relative
}

/**
 * Convert a URL to a local file path (relative to output dir).
 * This creates a directory structure that mirrors the URL structure.
 */
export function urlToFilePath(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return sanitizeFilename(url)
  }

  const host = parsed.hostname
  let pathname = safeDecode(parsed.pathname)

  // Handle query strings by hashing them into the filename
  if (parsed.search) {
    const hash = simpleHash(canonicalQuery(parsed))
    const ext = posix.extname(pathname)
    if (ext) {
      pathname = pathname.slice(0, -ext.length) + '_' + hash + ext
    } else {
      pathname += '_' + hash
    }
  }

  // If path ends with / or has no extension, assume it's an index page
  if (pathname.endsWith('/') || !posix.extname(pathname)) {
    pathname = posix.join(pathname, 'index.html')
  }

  // Build local path: hostname/path
  let localPath = posix.join(host, pathname)

  // Sanitize each path segment
  localPath = localPath
    .split('/')
    .map(sanitizeFilename)
    .join('/')

  // Limit total path length
  if (localPath.length > 240) {
    const ext = posix.extname(localPath)
    localPath = localPath.slice(0, 200) + '_' + simpleHash(localPath) + ext
  }

  return localPath
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function canonicalQuery(parsed: URL): string {
  const params = [...parsed.searchParams.entries()]
  params.sort(([a], [b]) => a.localeCompare(b))
  return new URLSearchParams(params).toString()
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function sanitizeFilename(name: string): string {
  // Remove characters not allowed in file names
  // eslint-disable-next-line no-control-regex -- intentional: strip control chars
  let sanitized = name.replace(/[<>:"|?*\x00-\x1f]/g, '_')
  // Windows reserved device names (CON, NUL, COM1, ...)
  if (WINDOWS_RESERVED.test(sanitized)) {
    sanitized = '_' + sanitized
  }
  // Limit segment length
  if (sanitized.length > 100) {
    const ext = posix.extname(sanitized)
    sanitized = sanitized.slice(0, 80) + '_' + simpleHash(sanitized) + ext
  }
  return sanitized || '_'
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36).slice(0, 8)
}
