import { describe, it, expect } from 'vitest'
import { urlToFilePath, computeRelativePath, rewriteHtml } from '../url-rewriter'

describe('urlToFilePath', () => {
  it('mirrors the URL structure under the hostname', () => {
    expect(urlToFilePath('https://example.com/images/logo.png')).toBe('example.com/images/logo.png')
  })

  it('maps extension-less and root URLs to index.html', () => {
    expect(urlToFilePath('https://example.com/')).toBe('example.com/index.html')
    expect(urlToFilePath('https://example.com/app/users')).toBe('example.com/app/users/index.html')
  })

  it('hashes query strings into the filename', () => {
    const a = urlToFilePath('https://example.com/s?b=2&a=1')
    const b = urlToFilePath('https://example.com/s?a=1&b=2')
    const plain = urlToFilePath('https://example.com/s')
    expect(a).toBe(b)
    expect(a).not.toBe(plain)
    expect(a).toMatch(/^example\.com\/s_[a-z0-9]+\/index\.html$/)
  })

  it('sanitizes illegal filename characters', () => {
    const p = urlToFilePath('https://example.com/a<b>/file name?.png')
    expect(p).not.toMatch(/[<>:"|?*]/)
    expect(p).toContain('example.com')
  })

  it('guards Windows reserved device names', () => {
    const p = urlToFilePath('https://example.com/con')
    expect(p).toBe('example.com/_con/index.html')
  })

  it('caps very long paths', () => {
    const long = 'x'.repeat(300)
    const p = urlToFilePath(`https://example.com/${long}.html`)
    expect(p.length).toBeLessThanOrEqual(240)
  })
})

describe('computeRelativePath', () => {
  it('walks up and across directories', () => {
    expect(computeRelativePath('example.com/a/b/page.html', 'example.com/style.css')).toBe('../../style.css')
    expect(computeRelativePath('example.com/page.html', 'example.com/img/logo.png')).toBe('./img/logo.png')
  })
})

describe('rewriteHtml', () => {
  it('rewrites absolute URLs to relative local paths', () => {
    const mapping = (url: string): string | null => {
      if (url === 'https://example.com/page') return 'example.com/page/index.html'
      if (url === 'https://example.com/style.css') return 'example.com/style.css'
      if (url === 'https://example.com/img.png') return 'example.com/img.png'
      return null
    }
    const html = rewriteHtml(
      '<link href="https://example.com/style.css"><a href="https://example.com/page"><img src="https://example.com/img.png"></a>',
      'https://example.com/page',
      mapping
    )
    expect(html).toContain('href="../style.css"')
    expect(html).toContain('href="./index.html"')
    expect(html).toContain('src="../img.png"')
  })

  it('leaves data:, mailto:, javascript: and anchors untouched', () => {
    const html = rewriteHtml(
      '<a href="mailto:a@b.c">m</a><a href="#top">t</a><img src="data:image/png;base64,AAA">',
      'https://example.com/',
      () => null
    )
    expect(html).toContain('mailto:a@b.c')
    expect(html).toContain('href="#top"')
    expect(html).toContain('data:image/png;base64,AAA')
  })
})
