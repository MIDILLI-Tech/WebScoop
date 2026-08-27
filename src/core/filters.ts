import type { FilterConfig, ResourceType } from './types'
import { URL } from 'node:url'
import { extname } from 'node:path'

/** Common multi-label public suffixes for same-domain matching (PSL-lite). */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp',
  'com.au', 'net.au', 'org.au', 'edu.au',
  'co.nz', 'net.nz', 'org.nz',
  'com.br', 'net.br', 'org.br',
  'com.tr', 'net.tr', 'org.tr', 'web.tr',
  'com.cn', 'net.cn', 'org.cn',
  'com.mx', 'com.ar', 'com.co',
  'co.in', 'net.in', 'org.in',
  'co.za', 'com.sg', 'com.hk', 'co.kr',
  'com.tw', 'co.il', 'com.sa'
])

export class FilterEngine {
  private config: FilterConfig
  private maxDepth: number
  private maxFileSize: number
  private domainRestriction: 'same-host' | 'same-domain' | 'any'
  private seedHost: string
  private seedDomain: string

  constructor(
    config: FilterConfig,
    maxDepth: number,
    maxFileSize: number,
    domainRestriction: 'same-host' | 'same-domain' | 'any',
    seedUrl: string
  ) {
    this.config = config
    this.maxDepth = maxDepth
    this.maxFileSize = maxFileSize
    this.domainRestriction = domainRestriction

    const parsed = new URL(seedUrl)
    this.seedHost = parsed.hostname
    this.seedDomain = this.extractDomain(parsed.hostname)
  }

  shouldCrawl(url: string, depth: number): boolean {
    if (this.maxDepth > 0 && depth > this.maxDepth) return false

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }

    // Protocol check
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    // Domain restriction
    if (!this.isDomainAllowed(parsed.hostname)) return false

    // Extension filters
    const ext = extname(parsed.pathname).toLowerCase()
    if (this.config.excludeExtensions.length > 0) {
      if (ext && this.config.excludeExtensions.includes(ext)) return false
    }
    if (this.config.includeExtensions.length > 0) {
      if (ext && !this.config.includeExtensions.includes(ext)) return false
    }

    // URL pattern filters
    const urlStr = parsed.toString()
    if (this.config.excludePatterns.length > 0) {
      for (const pattern of this.config.excludePatterns) {
        try {
          if (new RegExp(pattern, 'i').test(urlStr)) return false
        } catch { /* skip invalid regex */ }
      }
    }
    if (this.config.includePatterns.length > 0) {
      let matched = false
      for (const pattern of this.config.includePatterns) {
        try {
          if (new RegExp(pattern, 'i').test(urlStr)) { matched = true; break }
        } catch { /* skip */ }
      }
      if (!matched) return false
    }

    return true
  }

  shouldDownloadByMime(mimeType: string): boolean {
    const mime = mimeType.split(';')[0].trim().toLowerCase()

    if (this.config.excludeMimeTypes.length > 0) {
      if (this.config.excludeMimeTypes.some((m) => mime.includes(m))) return false
    }
    if (this.config.includeMimeTypes.length > 0) {
      if (!this.config.includeMimeTypes.some((m) => mime.includes(m))) return false
    }

    return true
  }

  shouldPersist(url: string, contentType: string): boolean {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }

    const ext = extname(parsed.pathname).toLowerCase()
    const mime = contentType.split(';')[0].trim().toLowerCase()
    const inferredExtensions = this.getExtensionsForMime(mime)

    if (this.config.excludeExtensions.length > 0) {
      if ((ext && this.config.excludeExtensions.includes(ext)) || inferredExtensions.some((value) => this.config.excludeExtensions.includes(value))) {
        return false
      }
    }

    if (this.config.includeExtensions.length > 0) {
      if (ext) {
        return this.config.includeExtensions.includes(ext)
      }
      return inferredExtensions.some((value) => this.config.includeExtensions.includes(value))
    }

    return true
  }

  shouldDownloadBySize(size: number): boolean {
    if (this.maxFileSize === 0) return true
    return size <= this.maxFileSize
  }

  isDomainAllowed(hostname: string): boolean {
    switch (this.domainRestriction) {
      case 'same-host':
        return hostname.toLowerCase() === this.seedHost.toLowerCase()
      case 'same-domain':
        return this.extractDomain(hostname) === this.seedDomain
      case 'any':
        return true
    }
  }

  private extractDomain(hostname: string): string {
    const parts = hostname.toLowerCase().split('.')
    if (parts.length <= 2) return parts.join('.')

    // Multi-label public suffixes (co.uk, com.tr, ...) need 3 labels
    const lastTwo = parts.slice(-2).join('.')
    if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
      return parts.slice(-3).join('.')
    }
    return lastTwo
  }

  private getExtensionsForMime(mime: string): string[] {
    if (mime.includes('html')) return ['.html', '.htm']
    if (mime.includes('css')) return ['.css']
    if (mime.includes('javascript') || mime.includes('ecmascript')) return ['.js', '.mjs', '.cjs']
    if (mime === 'text/plain') return ['.txt']
    if (mime === 'application/json' || mime.endsWith('+json')) return ['.json']
    if (mime === 'application/xml' || mime === 'text/xml' || mime.endsWith('+xml')) return ['.xml']
    if (mime === 'application/pdf') return ['.pdf']
    if (mime.startsWith('image/jpeg')) return ['.jpg', '.jpeg']
    if (mime.startsWith('image/png')) return ['.png']
    if (mime.startsWith('image/gif')) return ['.gif']
    if (mime.startsWith('image/webp')) return ['.webp']
    if (mime.startsWith('image/svg')) return ['.svg']
    if (mime.startsWith('font/')) return ['.woff', '.woff2', '.ttf', '.otf']
    return []
  }
}

export function guessResourceType(url: string, contentType?: string): ResourceType {
  if (contentType) {
    const mime = contentType.split(';')[0].trim().toLowerCase()
    if (mime.includes('html')) return 'html'
    if (mime.includes('css')) return 'css'
    if (mime.includes('javascript') || mime.includes('ecmascript')) return 'js'
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('font/') || mime.includes('woff') || mime.includes('opentype')) return 'font'
    if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media'
  }

  let pathname: string
  try {
    pathname = new URL(url, 'http://localhost').pathname
  } catch {
    return 'other'
  }
  const ext = extname(pathname).toLowerCase()
  const map: Record<string, ResourceType> = {
    '.html': 'html', '.htm': 'html', '.xhtml': 'html',
    '.css': 'css',
    '.js': 'js', '.mjs': 'js', '.cjs': 'js',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image',
    '.svg': 'image', '.webp': 'image', '.ico': 'image', '.avif': 'image', '.bmp': 'image',
    '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.otf': 'font', '.eot': 'font',
    '.mp4': 'media', '.webm': 'media', '.mp3': 'media', '.ogg': 'media',
    '.wav': 'media', '.flac': 'media', '.m4a': 'media'
  }

  return map[ext] || 'other'
}
