import { describe, it, expect } from 'vitest'
import { FilterEngine, guessResourceType } from '../filters'
import type { FilterConfig } from '../types'

function config(overrides: Partial<FilterConfig> = {}): FilterConfig {
  return {
    includePatterns: [],
    excludePatterns: [],
    includeExtensions: [],
    excludeExtensions: [],
    includeMimeTypes: [],
    excludeMimeTypes: [],
    ...overrides
  }
}

describe('guessResourceType', () => {
  it('maps extensions to resource types', () => {
    expect(guessResourceType('https://example.com/a.png')).toBe('image')
    expect(guessResourceType('https://example.com/a.css')).toBe('css')
    expect(guessResourceType('https://example.com/a.js')).toBe('js')
    expect(guessResourceType('https://example.com/a.woff2')).toBe('font')
    expect(guessResourceType('https://example.com/a.mp4')).toBe('media')
  })

  it('prefers content type over extension', () => {
    expect(guessResourceType('https://example.com/a', 'text/html; charset=utf-8')).toBe('html')
    expect(guessResourceType('https://example.com/a.bin', 'image/png')).toBe('image')
  })

  it('treats extension-less routes as other', () => {
    expect(guessResourceType('https://example.com/app/users')).toBe('other')
  })
})

describe('FilterEngine domain restriction', () => {
  it('same-host blocks subdomains', () => {
    const f = new FilterEngine(config(), 3, 0, 'same-host', 'https://example.com/')
    expect(f.isDomainAllowed('example.com')).toBe(true)
    expect(f.isDomainAllowed('sub.example.com')).toBe(false)
    expect(f.isDomainAllowed('other.com')).toBe(false)
  })

  it('same-domain allows subdomains including multi-label suffixes', () => {
    const f = new FilterEngine(config(), 3, 0, 'same-domain', 'https://example.com/')
    expect(f.isDomainAllowed('sub.example.com')).toBe(true)
    expect(f.isDomainAllowed('other.com')).toBe(false)

    const tr = new FilterEngine(config(), 3, 0, 'same-domain', 'https://example.com.tr/')
    expect(tr.isDomainAllowed('www.example.com.tr')).toBe(true)
    expect(tr.isDomainAllowed('example.com')).toBe(false)
  })

  it('any allows everything', () => {
    const f = new FilterEngine(config(), 3, 0, 'any', 'https://example.com/')
    expect(f.isDomainAllowed('cdn.other.net')).toBe(true)
  })
})

describe('FilterEngine.shouldCrawl', () => {
  const f = new FilterEngine(
    config({
      excludeExtensions: ['.zip'],
      includePatterns: ['example\\.com']
    }),
    2,
    0,
    'same-host',
    'https://example.com/'
  )

  it('respects max depth', () => {
    expect(f.shouldCrawl('https://example.com/a', 2)).toBe(true)
    expect(f.shouldCrawl('https://example.com/a', 3)).toBe(false)
  })

  it('applies extension excludes', () => {
    expect(f.shouldCrawl('https://example.com/file.zip', 1)).toBe(false)
    expect(f.shouldCrawl('https://example.com/file.html', 1)).toBe(true)
  })

  it('applies include patterns', () => {
    expect(f.shouldCrawl('https://evil.com/page', 1)).toBe(false)
  })

  it('rejects non-http protocols and invalid URLs', () => {
    expect(f.shouldCrawl('ftp://example.com/a', 1)).toBe(false)
    expect(f.shouldCrawl('not a url', 1)).toBe(false)
  })
})

describe('FilterEngine.shouldDownloadByMime', () => {
  it('honors include and exclude mime lists', () => {
    const f = new FilterEngine(
      config({ includeMimeTypes: ['text/html'], excludeMimeTypes: ['video/'] }),
      3,
      0,
      'same-host',
      'https://example.com/'
    )
    expect(f.shouldDownloadByMime('text/html; charset=utf-8')).toBe(true)
    expect(f.shouldDownloadByMime('application/json')).toBe(false)
    expect(f.shouldDownloadByMime('video/mp4')).toBe(false)
  })
})

describe('FilterEngine.shouldPersist', () => {
  it('with includeExtensions, keeps only listed extensions', () => {
    const f = new FilterEngine(
      config({ includeExtensions: ['.html', '.css'] }),
      3,
      0,
      'same-host',
      'https://example.com/'
    )
    expect(f.shouldPersist('https://example.com/a.html', 'text/html')).toBe(true)
    expect(f.shouldPersist('https://example.com/a.js', 'text/javascript')).toBe(false)
    // extension-less HTML inferred from mime still persists
    expect(f.shouldPersist('https://example.com/b', 'text/html')).toBe(true)
  })
})
