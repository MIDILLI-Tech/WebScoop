/* WebScoop CLI — download sites from the terminal without opening the app.
 *
 * Uses the exact same crawling engine as the desktop app (src/core/crawler),
 * with a lightweight JSON state store instead of SQLite so it runs under a
 * plain Node.js installation.
 *
 * Examples:
 *   npm run cli -- https://example.com                      # mirror site (depth 3)
 *   npm run cli -- https://example.com --single             # one page + its assets
 *   npm run cli -- https://example.com --js                 # render JavaScript (SPA)
 *   npm run cli -- https://example.com -o D:\mirrors\ex -d 5 -c 8
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { Crawler } from '../src/core/crawler'
import { JsRenderer } from '../src/core/renderer'
import type { CrawlProject, CrawlStats } from '../src/core/types'
import type { UrlStatusRow } from './cli-types'

interface CliOptions {
  url: string
  out: string
  depth: number
  maxPages: number
  concurrency: number
  delay: number
  speedLimit: number
  userAgent?: string
  timeout: number
  retries: number
  domain: 'same-host' | 'same-domain' | 'any'
  includeExt: string[]
  excludeExt: string[]
  jsRendering: boolean
  chromiumPath?: string
  ignoreRobots: boolean
  single: boolean
}

const USAGE = `Usage: npm run cli -- <url> [options]

Options:
  -o, --out <dir>          Output directory (default: ./webscoop-output/<host>)
  -d, --depth <n>          Max link depth (default: 3, 0 = unlimited)
  -p, --max-pages <n>      Max pages to download (default: 0 = unlimited)
  -c, --concurrency <n>    Parallel downloads (default: 4)
      --delay <ms>         Delay between requests (default: 150)
      --speed-limit <kbps> Global download speed limit (0 = unlimited)
  -u, --user-agent <str>   Custom User-Agent
      --timeout <s>        Request timeout in seconds (default: 30)
      --retries <n>        Retry count per request (default: 3)
      --domain <mode>      same-host | same-domain | any (default: same-host)
      --include-ext <list> Only save these extensions (.html,.png,...)
      --exclude-ext <list> Never save these extensions
      --js                 Render pages with headless Chrome/Chromium
      --chromium-path <p>  Explicit browser executable for --js
      --ignore-robots      Do not respect robots.txt (default: respect)
      --single             Single page mode: start page + assets only
  -h, --help               Show this help

Resume: re-running with the same output directory continues where the
previous crawl stopped (state is kept in <out>/.webscoop-state.json).`

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    url: '',
    out: '',
    depth: 3,
    maxPages: 0,
    concurrency: 4,
    delay: 150,
    speedLimit: 0,
    timeout: 30,
    retries: 3,
    domain: 'same-host',
    includeExt: [],
    excludeExt: [],
    jsRendering: false,
    ignoreRobots: false,
    single: false
  }

  const list = (value: string): string[] =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('.') ? s : '.' + s))

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => argv[++i] ?? ''

    switch (arg) {
      case '-h':
      case '--help':
        console.log(USAGE)
        process.exit(0)
      // falls through — process.exit above ends execution
      case '-o':
      case '--out':
        opts.out = next()
        break
      case '-d':
      case '--depth':
        opts.depth = Number(next())
        break
      case '-p':
      case '--max-pages':
        opts.maxPages = Number(next())
        break
      case '-c':
      case '--concurrency':
        opts.concurrency = Number(next())
        break
      case '--delay':
        opts.delay = Number(next())
        break
      case '--speed-limit':
        opts.speedLimit = Number(next())
        break
      case '-u':
      case '--user-agent':
        opts.userAgent = next()
        break
      case '--timeout':
        opts.timeout = Number(next())
        break
      case '--retries':
        opts.retries = Number(next())
        break
      case '--domain':
        opts.domain = next() as CliOptions['domain']
        break
      case '--include-ext':
        opts.includeExt = list(next())
        break
      case '--exclude-ext':
        opts.excludeExt = list(next())
        break
      case '--js':
        opts.jsRendering = true
        break
      case '--chromium-path':
        opts.chromiumPath = next()
        break
      case '--ignore-robots':
        opts.ignoreRobots = true
        break
      case '--single':
        opts.single = true
        break
      default:
        if (!arg.startsWith('-') && !opts.url) {
          opts.url = arg
        } else {
          console.error(`Unknown option: ${arg}`)
          console.error(USAGE)
          process.exit(1)
        }
    }
  }

  return opts
}

/** Minimal persistent state store (duck-typed replacement for SQLite StateManager). */
class JsonStateStore {
  private file: string
  private rows = new Map<string, UrlStatusRow>()
  private flushTimer: NodeJS.Timeout | null = null
  lastStats: Record<string, unknown> | null = null

  constructor(stateFile: string) {
    this.file = stateFile
    try {
      if (existsSync(stateFile)) {
        const raw = JSON.parse(readFileSync(stateFile, 'utf-8')) as Array<
          [string, UrlStatusRow]
        >
        this.rows = new Map(raw)
      }
    } catch {
      this.rows = new Map()
    }
  }

  getPendingUrls(): Array<{ url: string; parentUrl: string | null; depth: number }> {
    return [...this.rows.entries()]
      .filter(([, r]) => r.status === 'pending')
      .map(([url, r]) => ({ url, parentUrl: r.parentUrl, depth: r.depth }))
  }

  getCompletedUrls(): string[] {
    return [...this.rows.entries()]
      .filter(([, r]) => r.status === 'completed')
      .map(([url]) => url)
  }

  clearProjectUrls(): void {
    this.rows.clear()
    this.flush()
  }

  addUrl(_projectId: string, url: string, parentUrl: string | null, depth: number): boolean {
    if (this.rows.has(url)) return false
    this.rows.set(url, { status: 'pending', parentUrl, depth })
    this.scheduleFlush()
    return true
  }

  updateUrlStatus(
    _projectId: string,
    url: string,
    status: string,
    _localPath?: string,
    _contentType?: string,
    _size?: number,
    error?: string
  ): void {
    const row = this.rows.get(url)
    if (row) {
      row.status = status
      row.error = error
    } else {
      this.rows.set(url, { status, parentUrl: null, depth: 0, error })
    }
    this.scheduleFlush()
  }

  updateProject(_projectId: string, updates: { stats?: Record<string, unknown> }): void {
    // The crawler pushes its live stats here on every status change.
    if (updates?.stats) this.lastStats = updates.stats
  }

  close(): void {
    this.flushNow()
  }

  failed(): Array<[string, UrlStatusRow]> {
    return [...this.rows.entries()].filter(([, r]) => r.status === 'failed')
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, 500)
    this.flushTimer.unref?.()
  }

  private flush(): void {
    this.flushNow()
  }

  private flushNow(): void {
    try {
      writeFileSync(this.file, JSON.stringify([...this.rows.entries()], null, 1))
    } catch { /* best-effort */ }
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))

  if (!opts.url) {
    console.error('Error: target URL is required\n')
    console.error(USAGE)
    process.exit(1)
  }
  let parsedUrl: URL
  try {
    parsedUrl = new URL(opts.url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('protocol')
  } catch {
    console.error(`Error: invalid URL "${opts.url}" (must be http/https)`)
    process.exit(1)
  }

  if (!opts.out) {
    opts.out = join('webscoop-output', parsedUrl.hostname)
  }
  opts.out = resolve(opts.out)

  if (opts.single) {
    // One page plus its direct assets.
    opts.depth = Math.min(opts.depth === 0 ? 1 : opts.depth, 1)
    opts.maxPages = 1
  }

  mkdirSync(opts.out, { recursive: true })

  let chromiumPath = ''
  if (opts.jsRendering) {
    chromiumPath =
      opts.chromiumPath && existsSync(opts.chromiumPath)
        ? opts.chromiumPath
        : await JsRenderer.findChromiumPath()
    if (!chromiumPath) {
      console.error('Error: no Chrome/Chromium found for --js. Install Chrome or pass --chromium-path.')
      process.exit(1)
    }
    console.log(`JS rendering enabled (${basename(chromiumPath)})`)
  }

  const now = new Date().toISOString()
  const project: CrawlProject = {
    id: 'cli',
    name: basename(opts.out),
    url: opts.url,
    outputDir: opts.out,
    status: 'idle',
    config: {
      maxDepth: opts.depth,
      maxPages: opts.maxPages,
      maxFileSize: 100 * 1024 * 1024,
      concurrency: opts.concurrency,
      requestDelay: opts.delay,
      downloadSpeedLimit: opts.speedLimit,
      timeout: opts.timeout * 1000,
      userAgent: opts.userAgent || 'WebScoop-CLI/1.0',
      respectRobotsTxt: !opts.ignoreRobots,
      enableJsRendering: opts.jsRendering,
      jsRenderWaitTime: 3000,
      ...(chromiumPath ? { chromiumPath } : {}),
      domainRestriction: opts.domain,
      filters: {
        includePatterns: [],
        excludePatterns: [],
        includeExtensions: opts.includeExt,
        excludeExtensions: opts.excludeExt,
        includeMimeTypes: [],
        excludeMimeTypes: []
      },
      retries: opts.retries,
      retryDelay: 1000
    },
    stats: {} as CrawlStats,
    createdAt: now,
    updatedAt: now
  }

  const store = new JsonStateStore(join(opts.out, '.webscoop-state.json'))
  const crawler = new Crawler(project, store as never)

  let lastLine = 0
  crawler.on('log', (entry: { level: string; message: string }) => {
    if (entry.level === 'error') console.error(`[error] ${entry.message}`)
    else if (entry.level === 'warn') console.warn(`[warn] ${entry.message}`)
    else console.log(`[info] ${entry.message}`)
  })

  crawler.on('crawl-event', (event: { type: string; data: unknown }) => {
    const data = event.data as Record<string, unknown> | null
    if (event.type !== 'stats-update' || !data || !('downloadedUrls' in data)) return
    const nowMs = Date.now()
    if (nowMs - lastLine < 2000) return
    lastLine = nowMs
    const s = event.data as CrawlStats
    process.stdout.write(
      `\r... downloaded=${s.downloadedUrls} failed=${s.failedUrls} skipped=${s.skippedUrls} known=${s.totalUrls}   `
    )
  })

  console.log(`Target : ${opts.url}`)
  console.log(`Output : ${opts.out}`)
  console.log(`Mode   : ${opts.single ? 'single page' : `mirror (depth ${opts.depth || 'unlimited'})`}${opts.jsRendering ? ' + JS rendering' : ''}`)

  const startedAt = Date.now()
  await crawler.start()
  store.close()

  const stats = (store.lastStats ?? {}) as unknown as CrawlStats
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  process.stdout.write('\n')
  console.log('──────────────────────────────')
  console.log(`Downloaded : ${stats.downloadedUrls} files / ${formatBytes(stats.totalBytes)} in ${seconds}s`)
  console.log(`HTML pages : ${stats.byType?.html?.count ?? 0}`)
  console.log(`Failed     : ${stats.failedUrls}   Skipped: ${stats.skippedUrls}`)

  const failures = store.failed()
  if (failures.length > 0) {
    console.log('Failed URLs (first 10):')
    for (const [url, row] of failures.slice(0, 10)) {
      console.log(`  ${url} — ${row.error ?? 'unknown'}`)
    }
    if (failures.length > 10) console.log(`  ... ${failures.length - 10} more`)
    process.exitCode = 2
  }
}

function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

main().catch((err) => {
  console.error('Crawl failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
