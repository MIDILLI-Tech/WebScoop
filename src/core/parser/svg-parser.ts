import { load } from 'cheerio'
import type { DiscoveredUrl } from '../types'

export function parseSvg(svg: string, baseUrl: string): DiscoveredUrl[] {
  const urls: DiscoveredUrl[] = []
  const $ = load(svg, { xml: true })

  // <image href> and <image xlink:href>
  $('image').each((_, el) => {
    const href = $(el).attr('href') || $(el).attr('xlink:href')
    if (href) push(urls, href, baseUrl)
  })

  // <use href> and <use xlink:href>
  $('use').each((_, el) => {
    const href = $(el).attr('href') || $(el).attr('xlink:href')
    if (href && !href.startsWith('#')) push(urls, href, baseUrl)
  })

  // <feImage href>
  $('feImage').each((_, el) => {
    const href = $(el).attr('href') || $(el).attr('xlink:href')
    if (href) push(urls, href, baseUrl)
  })

  // style elements and attributes with url()
  $('[style]').each((_, el) => {
    const style = $(el).attr('style')
    if (style) extractCssUrls(style, baseUrl, urls)
  })

  $('style').each((_, el) => {
    const css = $(el).text()
    if (css) extractCssUrls(css, baseUrl, urls)
  })

  return urls
}

function extractCssUrls(css: string, baseUrl: string, urls: DiscoveredUrl[]): void {
  const matches = css.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)
  for (const m of matches) {
    push(urls, m[1], baseUrl)
  }
}

function push(urls: DiscoveredUrl[], rawUrl: string, baseUrl: string): void {
  const trimmed = rawUrl.trim()
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return

  try {
    const resolved = new URL(trimmed, baseUrl).toString()
    urls.push({
      url: resolved,
      type: 'image',
      sourceUrl: baseUrl,
      sourceAttribute: 'svg'
    })
  } catch {
    // skip
  }
}
