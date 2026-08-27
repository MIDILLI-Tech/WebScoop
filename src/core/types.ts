/* ------------------------------------------------------------------ */
/*  WebScoop — Shared type definitions                                */
/* ------------------------------------------------------------------ */

export interface CrawlProject {
  id: string
  name: string
  url: string
  outputDir: string
  status: ProjectStatus
  config: CrawlConfig
  stats: CrawlStats
  schedule?: ScheduleConfig
  createdAt: string
  updatedAt: string
}

export type ProjectStatus =
  | 'idle'
  | 'crawling'
  | 'paused'
  | 'completed'
  | 'error'
  | 'scheduled'

export interface CrawlConfig {
  maxDepth: number
  maxPages: number
  maxFileSize: number
  concurrency: number
  requestDelay: number
  downloadSpeedLimit: number
  timeout: number
  userAgent: string
  respectRobotsTxt: boolean
  enableJsRendering: boolean
  jsRenderWaitTime: number
  chromiumPath?: string
  domainRestriction: 'same-host' | 'same-domain' | 'any'
  filters: FilterConfig
  auth?: AuthConfig
  proxy?: ProxyConfig
  retries: number
  retryDelay: number
}

export interface FilterConfig {
  includePatterns: string[]
  excludePatterns: string[]
  includeExtensions: string[]
  excludeExtensions: string[]
  includeMimeTypes: string[]
  excludeMimeTypes: string[]
}

export interface AuthConfig {
  type: 'none' | 'basic' | 'cookie' | 'form-login'
  username?: string
  password?: string
  cookies?: string
  loginUrl?: string
  headers?: Record<string, string>
}

export interface ProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
  protocol: 'http' | 'https' | 'socks5'
}

export interface ScheduleConfig {
  enabled: boolean
  cron: string
  incrementalOnly: boolean
  lastRun?: string
  nextRun?: string
}

export interface CrawlStats {
  totalUrls: number
  downloadedUrls: number
  failedUrls: number
  skippedUrls: number
  totalBytes: number
  filesDownloaded: number
  startTime?: string
  endTime?: string
  duration?: number
  currentUrl?: string
  downloadSpeed?: number
  byType: Record<string, { count: number; bytes: number }>
}

export interface QueueItem {
  url: string
  parentUrl: string | null
  depth: number
  priority: number
  type: ResourceType
  retries: number
}

export type ResourceType =
  | 'html'
  | 'css'
  | 'js'
  | 'image'
  | 'font'
  | 'media'
  | 'other'

export interface DownloadResult {
  url: string
  localPath: string
  statusCode: number
  contentType: string
  size: number
  success: boolean
  error?: string
  headers: Record<string, string>
  /** Conditional request hit (HTTP 304) — the local copy is still current. */
  notModified?: boolean
}

export interface DiscoveredUrl {
  url: string
  type: ResourceType
  sourceUrl: string
  sourceAttribute: string
}

export interface CrawlEvent {
  type: CrawlEventType
  data: unknown
  timestamp: string
}

export type CrawlEventType =
  | 'url-queued'
  | 'download-start'
  | 'download-complete'
  | 'download-error'
  | 'download-progress'
  | 'parse-complete'
  | 'crawl-complete'
  | 'crawl-paused'
  | 'crawl-resumed'
  | 'crawl-error'
  | 'stats-update'
  | 'log'

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  url?: string
  timestamp: string
  details?: unknown
}

export interface AppSettings {
  language: string
  theme: 'light' | 'dark' | 'system'
  defaultOutputDir: string
  defaultConcurrency: number
  defaultDownloadSpeedLimit: number
  defaultUserAgent: string
  defaultMaxDepth: number
  chromiumPath: string
  chromiumInstalled: boolean
  respectRobotsTxt: boolean
  proxyEnabled: boolean
  proxyHost: string
  proxyPort: number
  proxyUsername: string
  proxyPassword: string
  maxLogEntries: number
  minimizeToTray: boolean
  checkForUpdates: boolean
  autoResumeOnLaunch: boolean
  defaultRequestDelay: number
}

/* ------------------------------------------------------------------ */
/*  Default values                                                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_USER_AGENT =
  'WebScoop/1.0 (https://github.com/midilli-tech/webscoop)'

export function defaultCrawlConfig(): CrawlConfig {
  return {
    maxDepth: 5,
    maxPages: 0,
    maxFileSize: 100 * 1024 * 1024,
    concurrency: 4,
    requestDelay: 100,
    downloadSpeedLimit: 0,
    timeout: 30_000,
    userAgent: DEFAULT_USER_AGENT,
    respectRobotsTxt: true,
    enableJsRendering: false,
    jsRenderWaitTime: 3000,
    domainRestriction: 'same-host',
    filters: {
      includePatterns: [],
      excludePatterns: [],
      includeExtensions: [],
      excludeExtensions: [],
      includeMimeTypes: [],
      excludeMimeTypes: []
    },
    retries: 3,
    retryDelay: 1000
  }
}

export function defaultStats(): CrawlStats {
  return {
    totalUrls: 0,
    downloadedUrls: 0,
    failedUrls: 0,
    skippedUrls: 0,
    totalBytes: 0,
    filesDownloaded: 0,
    byType: {}
  }
}

export function defaultAppSettings(): AppSettings {
  return {
    language: 'en',
    theme: 'system',
    defaultOutputDir: '',
    defaultConcurrency: 4,
    defaultDownloadSpeedLimit: 0,
    defaultUserAgent: DEFAULT_USER_AGENT,
    defaultMaxDepth: 5,
    chromiumPath: '',
    chromiumInstalled: false,
    respectRobotsTxt: true,
    proxyEnabled: false,
    proxyHost: '',
    proxyPort: 8080,
    proxyUsername: '',
    proxyPassword: '',
    maxLogEntries: 10_000,
    minimizeToTray: false,
    checkForUpdates: true,
    autoResumeOnLaunch: false,
    defaultRequestDelay: 100
  }
}
