import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { StateManager } from '../state-manager'
import { defaultCrawlConfig, defaultStats, type CrawlProject } from '../types'

let dir: string
let dbPath: string
let sm: StateManager

function makeProject(id: string, overrides: Partial<CrawlProject> = {}): CrawlProject {
  const now = new Date().toISOString()
  return {
    id,
    name: `Project ${id}`,
    url: 'https://example.com/',
    outputDir: join(dir, id),
    status: 'idle',
    config: defaultCrawlConfig(),
    stats: defaultStats(),
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'webscoop-sm-'))
  dbPath = join(dir, 'test.db')
  sm = new StateManager(dbPath)
})

afterEach(() => {
  sm.close()
  // Windows can briefly hold WAL locks after close — cleanup is best-effort
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dir left behind; OS cleans tmp */
  }
})

describe('StateManager projects', () => {
  it('creates, reads and lists projects', () => {
    sm.createProject(makeProject('p1'))
    sm.createProject(makeProject('p2', { status: 'crawling' }))

    const all = sm.getAllProjects()
    expect(all).toHaveLength(2)

    const p1 = sm.getProject('p1')
    expect(p1?.name).toBe('Project p1')
    expect(p1?.config.maxDepth).toBe(defaultCrawlConfig().maxDepth)
    expect(sm.getProject('missing')).toBeNull()
  })

  it('updates project fields', () => {
    sm.createProject(makeProject('p1'))
    sm.updateProject('p1', { status: 'paused', outputDir: '/tmp/out' })

    const p = sm.getProject('p1')
    expect(p?.status).toBe('paused')
    expect(p?.outputDir).toBe('/tmp/out')
  })
})

describe('StateManager url tracking', () => {
  it('tracks pending → completed lifecycle', () => {
    sm.createProject(makeProject('p1'))
    sm.addUrl('p1', 'https://example.com/a', null, 0)
    sm.addUrl('p1', 'https://example.com/b', 'https://example.com/a', 1)

    expect(sm.getPendingUrls('p1')).toHaveLength(2)
    expect(sm.getCompletedUrls('p1')).toHaveLength(0)

    sm.updateUrlStatus('p1', 'https://example.com/a', 'completed', 'example.com/a/index.html', 'text/html', 1234)
    expect(sm.getPendingUrls('p1')).toHaveLength(1)
    expect(sm.getCompletedUrls('p1')).toEqual(['https://example.com/a'])

    sm.updateUrlStatus('p1', 'https://example.com/b', 'failed', undefined, undefined, undefined, 'HTTP 500')
    expect(sm.resetFailedUrls('p1')).toBe(1)
    expect(sm.getPendingUrls('p1')).toHaveLength(1) // b is pending again
    expect(sm.resetFailedUrls('p1')).toBe(0) // nothing failed anymore
  })

  it('addUrl is idempotent per (project, url)', () => {
    sm.createProject(makeProject('p1'))
    expect(sm.addUrl('p1', 'https://example.com/a', null, 0)).toBe(true)
    expect(sm.addUrl('p1', 'https://example.com/a', null, 0)).toBe(false)
  })

  it('clearProjectUrls removes all rows for a project only', () => {
    sm.createProject(makeProject('p1'))
    sm.createProject(makeProject('p2'))
    sm.addUrl('p1', 'https://example.com/a', null, 0)
    sm.addUrl('p2', 'https://example.com/b', null, 0)

    sm.clearProjectUrls('p1')
    expect(sm.getPendingUrls('p1')).toHaveLength(0)
    expect(sm.getPendingUrls('p2')).toHaveLength(1)
  })
})

describe('StateManager validators (incremental crawl)', () => {
  it('stores and returns etag / last-modified', () => {
    sm.createProject(makeProject('p1'))
    sm.addUrl('p1', 'https://example.com/a', null, 0)

    sm.updateUrlStatus(
      'p1', 'https://example.com/a', 'completed', 'a.html', 'text/html', 10,
      undefined, 'W/"abc123"', 'Wed, 26 Aug 2026 08:00:00 GMT'
    )

    const v = sm.getUrlValidators('p1', 'https://example.com/a')
    expect(v?.status).toBe('completed')
    expect(v?.etag).toBe('W/"abc123"')
    expect(v?.lastModified).toBe('Wed, 26 Aug 2026 08:00:00 GMT')
  })

  it('COALESCE keeps old validators when a new response has none', () => {
    sm.createProject(makeProject('p1'))
    sm.addUrl('p1', 'https://example.com/a', null, 0)
    sm.updateUrlStatus('p1', 'https://example.com/a', 'completed', 'a.html', 'text/html', 10, undefined, '"e1"')

    // Re-crawl completes again without validator headers
    sm.updateUrlStatus('p1', 'https://example.com/a', 'completed', 'a.html', 'text/html', 20)
    expect(sm.getUrlValidators('p1', 'https://example.com/a')?.etag).toBe('"e1"')
  })

  it('migrates databases created before validator columns existed', () => {
    // Start from a clean file: the beforeEach StateManager must not hold it
    sm.close()
    rmSync(dbPath, { force: true })

    // Simulate an old database: same urls schema but without etag/last_modified
    const old = new Database(dbPath)
    old.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
        output_dir TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle',
        config TEXT NOT NULL DEFAULT '{}', stats TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        url TEXT NOT NULL,
        parent_url TEXT,
        depth INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        local_path TEXT,
        content_type TEXT,
        size INTEGER DEFAULT 0,
        error TEXT,
        retries INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO projects (id, name, url, output_dir, created_at, updated_at)
        VALUES ('old', 'Old', 'https://example.com/', '/tmp', '2026-01-01', '2026-01-01');
      INSERT INTO urls (project_id, url, depth, status, created_at)
        VALUES ('old', 'https://example.com/x', 0, 'completed', '2026-01-01');
    `)
    old.close()

    // Opening with StateManager must add the missing columns without losing data
    const migrated = new StateManager(dbPath)
    try {
      const v = migrated.getUrlValidators('old', 'https://example.com/x')
      expect(v?.status).toBe('completed')
      expect(v?.etag).toBeNull()
      migrated.updateUrlStatus('old', 'https://example.com/x', 'completed', 'x.html', 'text/html', 5, undefined, '"new"')
      expect(migrated.getUrlValidators('old', 'https://example.com/x')?.etag).toBe('"new"')
    } finally {
      migrated.close()
    }
  })
})

describe('StateManager settings', () => {
  it('returns defaults and persists overrides', () => {
    const defaults = sm.getAppSettings()
    expect(defaults.language).toBe('en')
    expect(defaults.maxLogEntries).toBe(10_000)

    sm.updateAppSettings({ ...defaults, language: 'tr', maxLogEntries: 500 })
    const updated = sm.getAppSettings()
    expect(updated.language).toBe('tr')
    expect(updated.maxLogEntries).toBe(500)
  })
})

describe('StateManager logs', () => {
  it('persists and returns logs newest-last', () => {
    sm.createProject(makeProject('p1'))
    sm.addLog('p1', { level: 'info', message: 'first', timestamp: 1000 })
    sm.addLog('p1', { level: 'error', message: 'second', url: 'https://example.com/x', timestamp: 2000 })

    const logs = sm.getLogs('p1', 100)
    expect(logs).toHaveLength(2)
    expect(logs[0].message).toBe('first')
    expect(logs[1].message).toBe('second')
    expect(logs[1].url).toBe('https://example.com/x')
  })

  it('accepts ISO-string timestamps', () => {
    sm.createProject(makeProject('p1'))
    sm.addLog('p1', { level: 'info', message: 'iso', timestamp: '2026-08-26T12:00:00.000Z' })
    const logs = sm.getLogs('p1', 10)
    expect(logs[0].timestamp).toBe(Date.parse('2026-08-26T12:00:00.000Z'))
  })

  it('pruneLogs keeps only the newest N entries', () => {
    sm.createProject(makeProject('p1'))
    const settings = sm.getAppSettings()
    sm.updateAppSettings({ ...settings, maxLogEntries: 5 })

    for (let i = 0; i < 20; i++) {
      sm.addLog('p1', { level: 'info', message: `m${i}`, timestamp: i })
    }
    sm.pruneLogs()

    const logs = sm.getLogs('p1', 100)
    expect(logs).toHaveLength(5)
    expect(logs[0].message).toBe('m15')
    expect(logs[4].message).toBe('m19')
  })

  it('clearProjectLogs removes only that project\u2019s logs', () => {
    sm.createProject(makeProject('p1'))
    sm.createProject(makeProject('p2'))
    sm.addLog('p1', { level: 'info', message: 'a', timestamp: 1 })
    sm.addLog('p2', { level: 'info', message: 'b', timestamp: 2 })

    sm.clearProjectLogs('p1')
    expect(sm.getLogs('p1', 10)).toHaveLength(0)
    expect(sm.getLogs('p2', 10)).toHaveLength(1)
  })
})
