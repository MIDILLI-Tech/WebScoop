import { describe, it, expect } from 'vitest'
import { UrlQueue } from '../queue'
import type { QueueItem } from '../types'

function item(url: string, type: QueueItem['type'] = 'html'): QueueItem {
  return { url, parentUrl: null, depth: 0, priority: 0, type, retries: 0 }
}

describe('UrlQueue', () => {
  it('deduplicates identical URLs', () => {
    const q = new UrlQueue()
    expect(q.enqueue(item('https://example.com/a'))).toBe(true)
    expect(q.enqueue(item('https://example.com/a'))).toBe(false)
    expect(q.size).toBe(1)
  })

  it('treats URL fragments as the same resource', () => {
    const q = new UrlQueue()
    expect(q.enqueue(item('https://example.com/page'))).toBe(true)
    expect(q.enqueue(item('https://example.com/page#section'))).toBe(false)
    expect(q.enqueue(item('https://example.com/page#other'))).toBe(false)
  })

  it('canonicalizes trailing slashes and index pages', () => {
    const q = new UrlQueue()
    expect(q.enqueue(item('https://example.com/'))).toBe(true)
    expect(q.enqueue(item('https://example.com'))).toBe(false)
    expect(q.enqueue(item('https://example.com/index.html'))).toBe(false)
    expect(q.enqueue(item('https://example.com/about/'))).toBe(true)
    expect(q.enqueue(item('https://example.com/about'))).toBe(false)
  })

  it('canonicalizes query parameter order', () => {
    const q = new UrlQueue()
    expect(q.enqueue(item('https://example.com/s?b=2&a=1'))).toBe(true)
    expect(q.enqueue(item('https://example.com/s?a=1&b=2'))).toBe(false)
  })

  it('keeps path case sensitivity but lowercases host', () => {
    const q = new UrlQueue()
    expect(q.enqueue(item('https://EXAMPLE.com/Page'))).toBe(true)
    expect(q.enqueue(item('https://example.com/Page'))).toBe(false)
    expect(q.enqueue(item('https://example.com/page'))).toBe(true)
  })

  it('dequeues higher-priority types (html) first', () => {
    const q = new UrlQueue()
    q.enqueue(item('https://example.com/img.png', 'image'))
    q.enqueue(item('https://example.com/style.css', 'css'))
    q.enqueue(item('https://example.com/', 'html'))
    const first = q.dequeue()
    const second = q.dequeue()
    expect(first?.type).toBe('html')
    expect(second?.type).toBe('css')
  })

  it('markSeen prevents re-enqueueing completed URLs', () => {
    const q = new UrlQueue()
    q.markSeen(['https://example.com/done'])
    expect(q.enqueue(item('https://example.com/done#top'))).toBe(false)
  })
})
