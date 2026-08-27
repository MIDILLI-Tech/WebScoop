import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { CrawlProject, AppSettings } from './types'
import { defaultAppSettings } from './types'

export class StateManager {
  private db: Database.Database

  constructor(dbPath: string) {
    // Ensure directory exists
    mkdirSync(join(dbPath, '..'), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        output_dir TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        config TEXT NOT NULL DEFAULT '{}',
        stats TEXT NOT NULL DEFAULT '{}',
        schedule TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS urls (
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
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_project_url
        ON urls(project_id, url);
      CREATE INDEX IF NOT EXISTS idx_urls_project_status
        ON urls(project_id, status);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        url TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_logs_project
        ON logs(project_id, id);
    `)

    // Lightweight column migrations for databases created before these
    // fields existed (incremental crawl validators).
    const urlCols = this.db.prepare('PRAGMA table_info(urls)').all() as Array<{ name: string }>
    const hasColumn = (name: string): boolean => urlCols.some((c) => c.name === name)
    if (!hasColumn('etag')) this.db.exec('ALTER TABLE urls ADD COLUMN etag TEXT')
    if (!hasColumn('last_modified')) this.db.exec('ALTER TABLE urls ADD COLUMN last_modified TEXT')
  }

  /* ---------------------------------------------------------------- */
  /*  Projects                                                         */
  /* ---------------------------------------------------------------- */

  createProject(project: CrawlProject): CrawlProject {
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, url, output_dir, status, config, stats, schedule, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      project.id,
      project.name,
      project.url,
      project.outputDir,
      project.status,
      JSON.stringify(project.config),
      JSON.stringify(project.stats),
      project.schedule ? JSON.stringify(project.schedule) : null,
      project.createdAt,
      project.updatedAt
    )
    return project
  }

  getProject(id: string): CrawlProject | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any
    return row ? this.rowToProject(row) : null
  }

  getAllProjects(): CrawlProject[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[]
    return rows.map((r) => this.rowToProject(r))
  }

  updateProject(id: string, updates: Partial<CrawlProject>): void {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.url !== undefined) { fields.push('url = ?'); values.push(updates.url) }
    if (updates.outputDir !== undefined) { fields.push('output_dir = ?'); values.push(updates.outputDir) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(updates.config)) }
    if (updates.stats !== undefined) { fields.push('stats = ?'); values.push(JSON.stringify(updates.stats)) }
    if (updates.schedule !== undefined) { fields.push('schedule = ?'); values.push(JSON.stringify(updates.schedule)) }

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    this.db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  /* ---------------------------------------------------------------- */
  /*  URL tracking (for resume)                                        */
  /* ---------------------------------------------------------------- */

  addUrl(
    projectId: string,
    url: string,
    parentUrl: string | null,
    depth: number
  ): boolean {
    try {
      this.db.prepare(`
        INSERT INTO urls (project_id, url, parent_url, depth, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `).run(projectId, url, parentUrl, depth, new Date().toISOString())
      return true
    } catch {
      return false // unique constraint violation = already tracked
    }
  }

  updateUrlStatus(
    projectId: string,
    url: string,
    status: string,
    localPath?: string,
    contentType?: string,
    size?: number,
    error?: string,
    etag?: string | null,
    lastModified?: string | null
  ): void {
    this.db.prepare(`
      UPDATE urls SET status = ?, local_path = ?, content_type = ?, size = ?, error = ?,
        etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified)
      WHERE project_id = ? AND url = ?
    `).run(
      status,
      localPath ?? null,
      contentType ?? null,
      size ?? 0,
      error ?? null,
      etag ?? null,
      lastModified ?? null,
      projectId,
      url
    )
  }

  /** Stored HTTP validators (incremental crawl) for a previously seen URL. */
  getUrlValidators(
    projectId: string,
    url: string
  ): { status: string; etag: string | null; lastModified: string | null } | null {
    const row = this.db
      .prepare('SELECT status, etag, last_modified AS lastModified FROM urls WHERE project_id = ? AND url = ?')
      .get(projectId, url) as
      | { status: string; etag: string | null; lastModified: string | null }
      | undefined
    return row ?? null
  }

  /** Move failed URLs back to pending (retry-failed feature). Returns count. */
  resetFailedUrls(projectId: string): number {
    const result = this.db
      .prepare(`UPDATE urls SET status = 'pending' WHERE project_id = ? AND status = 'failed'`)
      .run(projectId)
    return result.changes
  }

  getPendingUrls(projectId: string): Array<{ url: string; parentUrl: string | null; depth: number }> {
    return this.db.prepare(`
      SELECT url, parent_url as parentUrl, depth FROM urls
      WHERE project_id = ? AND status = 'pending'
      ORDER BY depth ASC
    `).all(projectId) as any[]
  }

  getCompletedUrls(projectId: string): string[] {
    const rows = this.db.prepare(
      `SELECT url FROM urls WHERE project_id = ? AND status = 'completed'`
    ).all(projectId) as any[]
    return rows.map((r) => r.url)
  }

  getUrlStats(projectId: string): { pending: number; completed: number; failed: number; skipped: number } {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'skipped'   THEN 1 ELSE 0 END) as skipped
      FROM urls WHERE project_id = ?
    `).get(projectId) as any
    return {
      pending: row?.pending ?? 0,
      completed: row?.completed ?? 0,
      failed: row?.failed ?? 0,
      skipped: row?.skipped ?? 0
    }
  }

  clearProjectUrls(projectId: string): void {
    this.db.prepare('DELETE FROM urls WHERE project_id = ?').run(projectId)
  }

  /* ---------------------------------------------------------------- */
  /*  Logs                                                             */
  /* ---------------------------------------------------------------- */

  private logInsertCount = 0

  /** Persist a crawl log entry; accepts ISO-string or epoch-ms timestamps. */
  addLog(
    projectId: string,
    entry: { level: string; message: string; url?: string; timestamp: number | string }
  ): void {
    const ts =
      typeof entry.timestamp === 'number' ? entry.timestamp : Date.parse(entry.timestamp) || Date.now()
    this.db
      .prepare('INSERT INTO logs (project_id, level, message, url, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, entry.level, entry.message, entry.url ?? null, ts)
    if (++this.logInsertCount % 500 === 0) this.pruneLogs()
  }

  /** Newest-last page of persisted logs for a project. */
  getLogs(projectId: string, limit: number): Array<{ level: string; message: string; url?: string; timestamp: number }> {
    const rows = this.db
      .prepare('SELECT level, message, url, timestamp FROM logs WHERE project_id = ? ORDER BY id DESC LIMIT ?')
      .all(projectId, limit) as any[]
    return rows
      .reverse()
      .map((r) => ({ level: r.level, message: r.message, url: r.url ?? undefined, timestamp: r.timestamp }))
  }

  /** Keep only the newest `maxLogEntries` rows overall (bounded growth). */
  pruneLogs(): void {
    const max = this.getAppSettings().maxLogEntries || 10_000
    this.db.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)').run(max)
  }

  clearProjectLogs(projectId: string): void {
    this.db.prepare('DELETE FROM logs WHERE project_id = ?').run(projectId)
  }

  /* ---------------------------------------------------------------- */
  /*  Settings                                                         */
  /* ---------------------------------------------------------------- */

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(key, value)
  }

  getAppSettings(): AppSettings {
    const json = this.getSetting('app_settings')
    if (!json) return defaultAppSettings()
    try {
      return { ...defaultAppSettings(), ...JSON.parse(json) }
    } catch {
      return defaultAppSettings()
    }
  }

  updateAppSettings(settings: AppSettings): void {
    this.setSetting('app_settings', JSON.stringify(settings))
  }

  /* ---------------------------------------------------------------- */
  /*  Cleanup                                                          */
  /* ---------------------------------------------------------------- */

  close(): void {
    this.db.close()
  }

  private rowToProject(row: any): CrawlProject {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      outputDir: row.output_dir,
      status: row.status,
      config: JSON.parse(row.config || '{}'),
      stats: JSON.parse(row.stats || '{}'),
      schedule: row.schedule ? JSON.parse(row.schedule) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
