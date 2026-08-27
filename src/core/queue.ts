import type { QueueItem, ResourceType } from './types'

const PRIORITY_MAP: Record<ResourceType, number> = {
  html: 0,
  css: 1,
  js: 2,
  image: 3,
  font: 4,
  media: 5,
  other: 6
}

export class UrlQueue {
  private queue: QueueItem[] = []
  private seen = new Set<string>()

  enqueue(item: QueueItem): boolean {
    const normalized = this.normalizeUrl(item.url)
    if (this.seen.has(normalized)) return false
    this.seen.add(normalized)
    item.priority = PRIORITY_MAP[item.type] ?? 6
    const idx = this.findInsertIndex(item.priority)
    this.queue.splice(idx, 0, item)
    return true
  }

  dequeue(): QueueItem | undefined {
    return this.queue.shift()
  }

  peek(): QueueItem | undefined {
    return this.queue[0]
  }

  get size(): number {
    return this.queue.length
  }

  get totalSeen(): number {
    return this.seen.size
  }

  isEmpty(): boolean {
    return this.queue.length === 0
  }

  has(url: string): boolean {
    return this.seen.has(this.normalizeUrl(url))
  }

  clear(): void {
    this.queue = []
    this.seen.clear()
  }

  markSeen(urls: string[]): void {
    for (const url of urls) {
      this.seen.add(this.normalizeUrl(url))
    }
  }

  getQueuedUrls(): string[] {
    return this.queue.map((item) => item.url)
  }

  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url)
      parsed.hash = ''

      // Canonicalize trailing slash + explicit index pages to one form
      let pathname = parsed.pathname
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1)
      }
      if (/\/index\.(html?|xhtml|php|aspx?)$/i.test(pathname)) {
        pathname = pathname.replace(/\/index\.(html?|xhtml|php|aspx?)$/i, '')
        if (!pathname) pathname = '/'
      }
      parsed.pathname = pathname
      parsed.searchParams.sort()

      // Lowercase only scheme/host — paths and queries are case-sensitive
      return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}`
    } catch {
      return url
    }
  }

  private findInsertIndex(priority: number): number {
    let lo = 0
    let hi = this.queue.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.queue[mid].priority <= priority) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
