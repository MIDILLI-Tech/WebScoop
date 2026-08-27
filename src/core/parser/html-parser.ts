import { load, type CheerioAPI } from 'cheerio'
import type { DiscoveredUrl, ResourceType } from '../types'
import { parseSrcset } from './srcset-parser'

export function parseHtml(html: string, baseUrl: string): DiscoveredUrl[] {
  const $ = load(html)
  const urls: DiscoveredUrl[] = []
  const base = resolveBaseUrl($, baseUrl)

  // <a href>
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) push(urls, href, 'html', base, 'href')
  })

  // <link href> (stylesheets, icons, preload)
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href')
    const rel = ($(el).attr('rel') || '').toLowerCase()
    if (!href) return
    if (rel.includes('stylesheet')) push(urls, href, 'css', base, 'href')
    else if (rel.includes('icon') || rel.includes('apple-touch')) push(urls, href, 'image', base, 'href')
    else if (rel === 'preload') {
      const as = ($(el).attr('as') || '').toLowerCase()
      const type = asToType(as)
      push(urls, href, type, base, 'href')
    } else push(urls, href, 'other', base, 'href')
  })

  // <script src>
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) push(urls, src, 'js', base, 'src')
  })

  // <img src> and <img srcset>
  $('img').each((_, el) => {
    const src = $(el).attr('src')
    if (src) push(urls, src, 'image', base, 'src')
    const srcset = $(el).attr('srcset')
    if (srcset) {
      for (const entry of parseSrcset(srcset)) {
        push(urls, entry, 'image', base, 'srcset')
      }
    }
  })

  // <picture> <source srcset>
  $('picture source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset')
    if (srcset) {
      for (const entry of parseSrcset(srcset)) {
        push(urls, entry, 'image', base, 'srcset')
      }
    }
  })

  // <video>, <audio>, <source>
  $('video[src], audio[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) push(urls, src, 'media', base, 'src')
  })
  $('video[poster]').each((_, el) => {
    const poster = $(el).attr('poster')
    if (poster) push(urls, poster, 'image', base, 'poster')
  })
  $('source[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) push(urls, src, 'media', base, 'src')
  })

  // <iframe src>
  $('iframe[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) push(urls, src, 'html', base, 'src')
  })

  // <object data>
  $('object[data]').each((_, el) => {
    const data = $(el).attr('data')
    if (data) push(urls, data, 'other', base, 'data')
  })

  // <embed src>
  $('embed[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) push(urls, src, 'other', base, 'src')
  })

  // <meta content> for og:image, twitter:image
  $('meta[content]').each((_, el) => {
    const property = $(el).attr('property') || $(el).attr('name') || ''
    const content = $(el).attr('content') || ''
    if (/og:image|twitter:image|msapplication-TileImage/i.test(property)) {
      if (content.startsWith('http') || content.startsWith('/')) {
        push(urls, content, 'image', base, 'content')
      }
    }
  })

  // Inline style attributes with url()
  $('[style]').each((_, el) => {
    const style = $(el).attr('style')
    if (style) {
      const matches = style.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)
      for (const m of matches) {
        push(urls, m[1], 'image', base, 'style')
      }
    }
  })

  // <style> blocks
  $('style').each((_, el) => {
    const css = $(el).text()
    if (css) {
      const matches = css.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)
      for (const m of matches) {
        push(urls, m[1], 'image', base, 'style')
      }
    }
  })

  // Favicon
  if (!urls.some((u) => u.sourceAttribute === 'href' && /favicon/i.test(u.url))) {
    push(urls, '/favicon.ico', 'image', base, 'implicit')
  }

  return urls
}

function resolveBaseUrl($: CheerioAPI, pageUrl: string): string {
  const baseTag = $('base[href]').first().attr('href')
  if (baseTag) {
    try {
      return new URL(baseTag, pageUrl).toString()
    } catch { /* fall through */ }
  }
  return pageUrl
}

function push(
  urls: DiscoveredUrl[],
  rawUrl: string,
  type: ResourceType,
  base: string,
  attr: string
): void {
  const trimmed = rawUrl.trim()
  if (!trimmed) return
  if (trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:')) return
  if (trimmed.startsWith('#')) return

  try {
    const resolved = new URL(trimmed, base).toString()
    urls.push({ url: resolved, type, sourceUrl: base, sourceAttribute: attr })
  } catch {
    // skip invalid URLs
  }
}

function asToType(as: string): ResourceType {
  switch (as) {
    case 'style': return 'css'
    case 'script': return 'js'
    case 'image': return 'image'
    case 'font': return 'font'
    case 'video': case 'audio': return 'media'
    default: return 'other'
  }
}
