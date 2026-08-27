import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileStorage } from '../storage'

let dir: string
let storage: FileStorage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'webscoop-storage-'))
  storage = new FileStorage(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('FileStorage.save', () => {
  it('writes the file and returns the relative path', async () => {
    const rel = await storage.save('example.com/css/style.css', Buffer.from('body{}'))
    expect(rel).toBe('example.com/css/style.css')
    expect(readFileSync(join(dir, 'example.com/css/style.css'), 'utf-8')).toBe('body{}')
    expect(await storage.exists('example.com/css/style.css')).toBe(true)
    expect(await storage.exists('example.com/css/missing.css')).toBe(false)
  })

  it('appends the correct extension for extension-less paths', async () => {
    const rel = await storage.save('example.com/page', Buffer.from('<h1>'), 'text/html; charset=utf-8')
    expect(rel).toBe('example.com/page.html')
  })

  it('rewrites dynamic server extensions to .html', async () => {
    const rel = await storage.save('example.com/page.php', Buffer.from('<h1>'), 'text/html')
    expect(rel).toBe('example.com/page.html')
  })

  it('leaves paths alone when the mime is unknown or extension already matches', async () => {
    expect(await storage.save('example.com/a.bin', Buffer.alloc(0), 'application/octet-stream')).toBe('example.com/a.bin')
    expect(await storage.save('example.com/a.png', Buffer.alloc(0), 'image/png')).toBe('example.com/a.png')
  })

  it('uniquifies colliding paths from different owner URLs', async () => {
    const s1 = await storage.save('example.com/dup', Buffer.from('A'), 'text/html', 'https://a.com/one')
    const s2 = await storage.save('example.com/dup', Buffer.from('B'), 'text/html', 'https://b.com/two')
    const again = await storage.save('example.com/dup', Buffer.from('A2'), 'text/html', 'https://a.com/one')

    expect(s1).toBe('example.com/dup.html')
    expect(s2).toBe('example.com/dup_1.html')
    expect(again).toBe('example.com/dup.html') // same owner updates in place
  })
})

describe('FileStorage url mappings', () => {
  it('registers and resolves URLs, canonicalizing fragments and slashes', () => {
    storage.register('https://example.com/page#section', 'example.com/page.html')
    expect(storage.getLocalPath('https://example.com/page#other')).toBe('example.com/page.html')
    expect(storage.getLocalPath('https://example.com/page/')).toBe('example.com/page.html')
    expect(storage.getLocalPath('https://EXAMPLE.com/page')).toBe('example.com/page.html')
    expect(storage.getLocalPath('https://example.com/missing')).toBeNull()

    const mappings = storage.getAllMappings()
    expect(mappings.get('https://example.com/page')).toBe('example.com/page.html')
  })

  it('exposes the output root', () => {
    expect(storage.root).toBe(dir)
  })
})
