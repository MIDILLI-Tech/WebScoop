import { EventEmitter } from 'node:events'
import { basename } from 'node:path'
import { unlink } from 'node:fs/promises'
import type {
  CrawlProject,
  CrawlConfig,
  CrawlStats,
  DownloadResult,
  DiscoveredUrl,
  ResourceType,
  LogEntry
} from './types'
import { defaultStats } from './types'
import { UrlQueue } from './queue'
import { Downloader } from './downloader'
import { FilterEngine, guessResourceType } from './filters'
import { FileStorage } from './storage'
import { StateManager } from './state-manager'
import { RobotsParser } from './robots'
import { JsRenderer } from './renderer'
import { parseHtml } from './parser/html-parser'
import { parseCss } from './parser/css-parser'
import { parseJs } from './parser/js-parser'
import { parseSvg } from './parser/svg-parser'
import { urlToFilePath, rewriteHtml, rewriteCss } from './url-rewriter'

export class Crawler extends EventEmitter {
  private project: CrawlProject
  private config: CrawlConfig
  private queue: UrlQueue
  private downloader: Downloader
  private filter: FilterEngine
  private storage: FileStorage
  private stateManager: StateManager
  private robots: RobotsParser
  private renderer: JsRenderer | null = null
  private stats: CrawlStats
  private paused = false
  private cancelled = false
  private processing = false
  private activeCount = 0
  /** url -> content-type of saved files (tiny; used for post-processing) */
  private savedContentTypes = new Map<string, string>()
  private activeDownloads = new Map<string, { downloaded: number; total: number }>()

  constructor(project: CrawlProject, stateManager: StateManager) {
    super()
    this.project = project
    this.config = project.config
    this.stateManager = stateManager
    this.queue = new UrlQueue()
    this.downloader = new Downloader(this.config)
    this.downloader.setOriginHost(project.url)
    this.filter = new FilterEngine(
      this.config.filters,
      this.config.maxDepth,
      this.config.maxFileSize,
      this.config.domainRestriction,
      project.url
    )
    this.storage = new FileStorage(project.outputDir)
    this.robots = new RobotsParser()
    this.stats = { ...defaultStats() }

    // Forward downloader events and keep active slot state for UI
    this.downloader.on('download-start', (data: { url: string }) => {
      this.activeDownloads.set(data.url, { downloaded: 0, total: 0 })
      this.emitActiveDownloads()
    })

    this.downloader.on('download-progress', (data: { url: string; downloaded: number; total: number }) => {
      this.activeDownloads.set(data.url, {
        downloaded: data.downloaded || 0,
        total: data.total || 0
      })
      this.emitEvent('download-progress', data)
      this.emitActiveDownloads()
    })

    this.downloader.on('download-complete', (data: { url: string }) => {
      this.activeDownloads.delete(data.url)
      this.emitActiveDownloads()
    })

    this.downloader.on('download-error', (data: { url: string }) => {
      this.activeDownloads.delete(data.url)
      this.emitActiveDownloads()
    })
  }

  async start(): Promise<void> {
    if (this.processing) return
    this.processing = true
    this.cancelled = false
    this.paused = false
    this.stats.startTime = new Date().toISOString()

    this.log('info', `Starting crawl: ${this.project.url}`)
    this.updateStatus('crawling')

    // Initialize JS renderer if needed
    if (this.config.enableJsRendering) {
      try {
        this.renderer = new JsRenderer()
        await this.renderer.launch(this.config)
        this.log('info', 'JS renderer initialized')
      } catch (err) {
        this.log('warn', `JS renderer failed to start: ${err}. Falling back to static crawling.`)
        this.renderer = null
      }
    }

    // Fetch robots.txt
    if (this.config.respectRobotsTxt) {
      await this.fetchRobots()
    }

    // Check for resume state
    const pendingUrls = this.stateManager.getPendingUrls(this.project.id)
    const completedUrls = this.stateManager.getCompletedUrls(this.project.id)
    const incremental = this.project.schedule?.incrementalOnly === true

    if (pendingUrls.length > 0) {
      this.log('info', `Resuming: ${pendingUrls.length} pending URLs`)
      this.queue.markSeen(completedUrls)
      for (const pu of pendingUrls) {
        this.queue.enqueue({
          url: pu.url,
          parentUrl: pu.parentUrl,
          depth: pu.depth,
          priority: 0,
          // Type is not persisted; re-guess from the URL so assets keep
          // asset semantics (depth/renderer/limit handling) after resume.
          type: guessResourceType(pu.url),
          retries: 0
        })
      }
    } else if (incremental && completedUrls.length > 0) {
      // Incremental update: re-visit every known URL with conditional
      // requests (If-None-Match / If-Modified-Since). Unchanged files come
      // back as 304 and are skipped; new links are discovered from pages.
      this.log('info', `Incremental update: checking ${completedUrls.length} known URLs for changes`)
      this.queue.enqueue({
        url: this.project.url,
        parentUrl: null,
        depth: 0,
        priority: 0,
        type: 'html',
        retries: 0
      })
      for (const url of completedUrls) {
        this.queue.enqueue({
          url,
          parentUrl: null,
          depth: 0,
          priority: 0,
          type: guessResourceType(url),
          retries: 0
        })
      }
    } else {
      // Fresh start
      this.stateManager.clearProjectUrls(this.project.id)
      this.queue.enqueue({
        url: this.project.url,
        parentUrl: null,
        depth: 0,
        priority: 0,
        type: 'html',
        retries: 0
      })
      this.stateManager.addUrl(this.project.id, this.project.url, null, 0)
    }

    // Auth cookies
    if (this.config.auth?.cookies) {
      this.downloader.setCookies(this.project.url, this.config.auth.cookies)
    }

    // Process queue
    await this.processQueue()

    // Post-processing: rewrite URLs in all HTML and CSS files
    if (!this.cancelled) {
      await this.rewriteAllUrls()
    }

    // Cleanup
    if (this.renderer) {
      await this.renderer.close()
    }

    this.stats.endTime = new Date().toISOString()
    this.stats.duration =
      new Date(this.stats.endTime).getTime() - new Date(this.stats.startTime!).getTime()

    this.processing = false

    if (this.cancelled) {
      this.updateStatus('idle')
      this.log('info', 'Crawl cancelled')
    } else if (this.stats.failedUrls > 0 && this.stats.downloadedUrls === 0) {
      this.updateStatus('error')
      this.log('error', 'Crawl completed with all failures')
    } else {
      this.updateStatus('completed')
      this.log('info', `Crawl completed: ${this.stats.downloadedUrls} files, ${formatBytes(this.stats.totalBytes)}`)
    }

    this.activeDownloads.clear()
    this.emitActiveDownloads()

    this.emitEvent('crawl-complete', this.stats)
  }

  pause(): void {
    this.paused = true
    this.downloader.pause()
    this.updateStatus('paused')
    this.log('info', 'Crawl paused')
    this.emitEvent('crawl-paused', null)
  }

  resume(): void {
    this.paused = false
    this.downloader.resume()
    this.updateStatus('crawling')
    this.log('info', 'Crawl resumed')
    this.emitEvent('crawl-resumed', null)
    if (!this.processing) {
      this.processing = true
      this.processQueue().then(() => {
        this.processing = false
      })
    }
  }

  cancel(): void {
    this.cancelled = true
    this.paused = false
    this.downloader.cancel()
    this.log('info', 'Crawl cancellation requested')
  }

  setConcurrency(concurrency: number): void {
    this.downloader.setConcurrency(concurrency)
    this.config.concurrency = concurrency
    this.log('info', `Concurrency changed to ${concurrency}`)
  }

  setRequestDelay(delayMs: number): void {
    this.downloader.setRequestDelay(delayMs)
    this.config.requestDelay = Math.max(0, Math.round(delayMs || 0))
    this.log('info', `Request delay changed to ${this.config.requestDelay}ms`)
  }

  setDownloadSpeedLimit(kbps: number): void {
    this.downloader.setDownloadSpeedLimit(kbps)
    this.config.downloadSpeedLimit = Math.max(0, Math.round(kbps || 0))
    this.log('info', `Download speed limit changed to ${this.config.downloadSpeedLimit}KB/s`)
  }

  getStats(): CrawlStats {
    return {
      ...this.stats,
      currentUrl: this.stats.currentUrl,
      downloadSpeed: this.downloader.speed
    }
  }

  isPaused(): boolean {
    return this.paused
  }

  getOutputDir(): string {
    return this.project.outputDir
  }

  /* ---- Private methods ---- */

  private async processQueue(): Promise<void> {
    const promises: Promise<void>[] = []

    while (!this.cancelled) {
      if (this.paused) {
        await this.delay(500)
        continue
      }

      if (this.queue.isEmpty() && this.activeCount === 0) break
      if (this.queue.isEmpty()) {
        await this.delay(100)
        continue
      }

      // Fill up to concurrency limit (read dynamically so live changes take effect)
      while (this.activeCount < this.config.concurrency && !this.queue.isEmpty() && !this.paused && !this.cancelled) {
        const item = this.queue.dequeue()
        if (!item) break

        this.activeCount++
        const p = this.processUrl(item).finally(() => {
          this.activeCount--
        })
        promises.push(p)
      }

      await this.delay(50)
    }

    // Wait for all in-flight downloads
    await Promise.allSettled(promises)
  }

  private async processUrl(item: { url: string; parentUrl: string | null; depth: number; type: ResourceType }): Promise<void> {
    const { url, depth, type } = item
    this.stats.currentUrl = url
    this.emitStats()

    if (this.hasReachedPageLimit() && this.isPageResource(type)) {
      this.stateManager.updateUrlStatus(this.project.id, url, 'skipped', undefined, undefined, undefined, 'page-limit-reached')
      this.stats.skippedUrls++
      return
    }

    // Check robots.txt
    if (this.config.respectRobotsTxt && !this.robots.isAllowed(url)) {
      this.log('debug', `Blocked by robots.txt: ${url}`)
      this.stateManager.updateUrlStatus(this.project.id, url, 'skipped', undefined, undefined, undefined, 'robots.txt')
      this.stats.skippedUrls++
      return
    }

    // Check filters
    if (!this.filter.shouldCrawl(url, depth)) {
      this.stateManager.updateUrlStatus(this.project.id, url, 'skipped', undefined, undefined, undefined, 'filtered')
      this.stats.skippedUrls++
      return
    }

    try {
      let htmlContent: string | null = null
      let buffer: Buffer
      let contentType: string
      let responseHeaders: Record<string, string> = {}

      // Incremental mode: conditional request for previously completed URLs
      let extraHeaders: Record<string, string> | undefined
      if (this.project.schedule?.incrementalOnly === true) {
        const validators = this.stateManager.getUrlValidators(this.project.id, url)
        if (validators && validators.status === 'completed') {
          if (validators.etag) {
            extraHeaders = { 'If-None-Match': validators.etag }
          } else if (validators.lastModified) {
            extraHeaders = { 'If-Modified-Since': validators.lastModified }
          }
        }
      }

      // Use JS renderer for HTML pages if enabled
      if (this.renderer && (type === 'html' || type === 'other')) {
        const rendered = await this.renderer.render(url, this.config.jsRenderWaitTime)
        if (rendered) {
          htmlContent = rendered.html
          buffer = Buffer.from(rendered.html, 'utf-8')
          contentType = 'text/html'

          // Process dynamically discovered resources
          for (const res of rendered.resources) {
            this.enqueueUrl(res, url, depth, guessResourceType(res))
          }
        } else {
          // Fallback to static download
          const result = await this.downloader.download(url, extraHeaders)
          if (result.notModified) {
            this.stats.skippedUrls++
            this.log('debug', `Unchanged (304): ${url}`)
            this.emitStats()
            return
          }
          if (!result.success) {
            this.handleFailure(url, result.error || 'Download failed')
            return
          }
          contentType = result.contentType
          responseHeaders = result.headers

          // Large binaries stream to disk without touching memory
          const streamedPath = this.downloader.takeStreamedFile(url)
          if (streamedPath) {
            await this.saveStreamedFile(url, streamedPath, contentType, result, responseHeaders)
            return
          }

          buffer = await this.downloader.getBuffer(url)
        }
      } else {
        // Static download
        const result = await this.downloader.download(url, extraHeaders)
        if (result.notModified) {
          this.stats.skippedUrls++
          this.log('debug', `Unchanged (304): ${url}`)
          this.emitStats()
          return
        }
        if (!result.success) {
          this.handleFailure(url, result.error || 'Download failed')
          return
        }
        contentType = result.contentType
        responseHeaders = result.headers

        // Large binaries stream to disk without touching memory
        const streamedPath = this.downloader.takeStreamedFile(url)
        if (streamedPath) {
          await this.saveStreamedFile(url, streamedPath, contentType, result, responseHeaders)
          return
        }

        buffer = await this.downloader.getBuffer(url)
      }

      // MIME filter
      if (!this.filter.shouldDownloadByMime(contentType)) {
        this.stateManager.updateUrlStatus(this.project.id, url, 'skipped', undefined, undefined, undefined, 'mime-filtered')
        this.stats.skippedUrls++
        this.downloader.discardBuffer(url)
        return
      }

      const shouldPersist = this.filter.shouldPersist(url, contentType)

      // Still parse HTML/CSS/JS for discovery, but do not save files excluded by extension filters.
      if (!shouldPersist) {
        this.stateManager.updateUrlStatus(this.project.id, url, 'skipped', undefined, contentType, buffer.length, 'extension-filtered')
        this.stats.skippedUrls++

        if (!htmlContent) {
          htmlContent = contentType.includes('html') ? buffer.toString('utf-8') : null
        }

        const discoveredUrls = this.parseContent(url, buffer, contentType, htmlContent)
        this.downloader.discardBuffer(url)
        for (const discovered of discoveredUrls) {
          this.enqueueUrl(discovered.url, url, depth)
        }

        this.emitStats()
        return
      }

      // Determine local path and save
      const localPath = urlToFilePath(url)
      const savedPath = await this.storage.save(localPath, buffer, contentType, url)
      this.storage.register(url, savedPath)
      this.savedContentTypes.set(url, contentType)

      // Update state
      this.stateManager.updateUrlStatus(
        this.project.id,
        url,
        'completed',
        savedPath,
        contentType,
        buffer.length,
        undefined,
        responseHeaders['etag'] || undefined,
        responseHeaders['last-modified'] || undefined
      )

      // Update stats
      this.stats.downloadedUrls++
      this.stats.filesDownloaded++
      this.stats.totalBytes += buffer.length
      const resourceType = guessResourceType(url, contentType)
      const typeStats = this.stats.byType[resourceType] || { count: 0, bytes: 0 }
      this.stats.byType[resourceType] = {
        count: typeStats.count + 1,
        bytes: typeStats.bytes + buffer.length
      }

      // Parse for more URLs
      if (!htmlContent) {
        htmlContent = contentType.includes('html') ? buffer.toString('utf-8') : null
      }

      const discoveredUrls = this.parseContent(url, buffer, contentType, htmlContent)
      for (const discovered of discoveredUrls) {
        this.enqueueUrl(discovered.url, url, depth, discovered.type)
      }

      this.emitStats()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.handleFailure(url, message)
    }
  }

  private parseContent(
    url: string,
    buffer: Buffer,
    contentType: string,
    htmlContent: string | null
  ): DiscoveredUrl[] {
    const content = htmlContent ?? buffer.toString('utf-8')
    const mime = contentType.split(';')[0].trim().toLowerCase()

    if (mime.includes('html')) {
      return parseHtml(content, url)
    }
    if (mime.includes('css')) {
      return parseCss(content, url)
    }
    if (mime.includes('javascript')) {
      return parseJs(content, url)
    }
    if (mime.includes('svg')) {
      return parseSvg(content, url)
    }

    return []
  }

  private enqueueUrl(rawUrl: string, parentUrl: string, parentDepth: number, discoveredType?: ResourceType): void {
    const type = discoveredType || guessResourceType(rawUrl)
    const depth = type === 'html' ? parentDepth + 1 : parentDepth

    if (this.hasReachedPageLimit() && this.isPageResource(type)) {
      return
    }

    const added = this.queue.enqueue({
      url: rawUrl,
      parentUrl,
      depth,
      priority: 0,
      type,
      retries: 0
    })

    if (added) {
      this.stateManager.addUrl(this.project.id, rawUrl, parentUrl, depth)
      this.stats.totalUrls++
      this.emitEvent('url-queued', { url: rawUrl, depth, type })
    }
  }

  private async rewriteAllUrls(): Promise<void> {
    this.log('info', 'Rewriting URLs for offline browsing...')
    const lookup = (url: string): string | null => this.storage.getLocalPath(url)
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    let rewrittenCount = 0
    for (const [url, localPath] of this.storage.getAllMappings()) {
      const mime = this.savedContentTypes.get(url) || ''
      const isHtml = mime.includes('html') || /\.x?html?$/i.test(localPath)
      const isCss = mime.includes('css') || /\.css$/i.test(localPath)
      if (!isHtml && !isCss) continue

      try {
        // Mappings store output-root-relative paths; resolve before reading.
        const absoluteFile = join(this.storage.root, localPath)
        const content = await readFile(absoluteFile, 'utf-8')
        const rewritten = isHtml
          ? rewriteHtml(content, url, lookup)
          : rewriteCss(content, url, lookup)

        if (rewritten !== null && rewritten !== content) {
          await this.storage.save(localPath, Buffer.from(rewritten, 'utf-8'))
          rewrittenCount++
        }
      } catch { /* skip unreadable file */ }
    }

    // Free memory
    this.savedContentTypes.clear()
    this.log('info', `URL rewriting complete (${rewrittenCount} files updated)`)
  }

  private handleFailure(url: string, error: string): void {
    this.stats.failedUrls++
    this.stateManager.updateUrlStatus(this.project.id, url, 'failed', undefined, undefined, undefined, error)
    this.log('error', `Failed: ${url} — ${error}`)
    this.emitStats()
  }

  /**
   * Move a streamed large binary into the output directory. Streamed files
   * are non-text by construction, so there is nothing to parse for link
   * discovery — MIME/extension filters still apply.
   */
  private async saveStreamedFile(
    url: string,
    tempPath: string,
    contentType: string,
    result: DownloadResult,
    responseHeaders: Record<string, string>
  ): Promise<void> {
    try {
      if (!this.filter.shouldDownloadByMime(contentType)) {
        await unlink(tempPath).catch(() => {})
        this.stateManager.updateUrlStatus(
          this.project.id, url, 'skipped', undefined, contentType, result.size, 'mime-filtered'
        )
        this.stats.skippedUrls++
        this.emitStats()
        return
      }

      const localPath = urlToFilePath(url)
      const savedPath = await this.storage.saveFromFile(tempPath, localPath, contentType, url)
      this.storage.register(url, savedPath)
      this.savedContentTypes.set(url, contentType)

      this.stateManager.updateUrlStatus(
        this.project.id,
        url,
        'completed',
        savedPath,
        contentType,
        result.size,
        undefined,
        responseHeaders['etag'] || undefined,
        responseHeaders['last-modified'] || undefined
      )

      this.stats.downloadedUrls++
      this.stats.filesDownloaded++
      this.stats.totalBytes += result.size
      const resourceType = guessResourceType(url, contentType)
      const typeStats = this.stats.byType[resourceType] || { count: 0, bytes: 0 }
      this.stats.byType[resourceType] = {
        count: typeStats.count + 1,
        bytes: typeStats.bytes + result.size
      }
      this.log('info', `Saved (streamed, ${Math.round(result.size / 1024 / 1024)}MB): ${url}`)
      this.emitStats()
    } catch (err) {
      await unlink(tempPath).catch(() => {})
      this.handleFailure(url, err instanceof Error ? err.message : String(err))
    }
  }

  private async fetchRobots(): Promise<void> {
    try {
      const parsed = new URL(this.project.url)
      const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`
      const buffer = await this.downloader.getBuffer(robotsUrl)
      this.robots.parse(robotsUrl, buffer.toString('utf-8'), this.config.userAgent)

      const delay = this.robots.getCrawlDelay()
      if (delay > 0 && delay > this.config.requestDelay) {
        this.config.requestDelay = delay
        this.log('info', `robots.txt crawl-delay applied: ${delay}ms`)
      }
    } catch {
      this.log('debug', 'No robots.txt found or failed to fetch')
    }
  }

  private updateStatus(status: CrawlProject['status']): void {
    this.project.status = status
    this.stateManager.updateProject(this.project.id, {
      status,
      stats: this.stats
    })
  }

  private emitStats(): void {
    this.stats.downloadSpeed = this.downloader.speed
    this.emitEvent('stats-update', this.stats)
  }

  private emitEvent(type: string, data: unknown): void {
    this.emit('crawl-event', {
      type,
      data,
      timestamp: new Date().toISOString()
    })
  }

  private hasReachedPageLimit(): boolean {
    return this.config.maxPages > 0 && this.getDownloadedPageCount() >= this.config.maxPages
  }

  private getDownloadedPageCount(): number {
    return this.stats.byType.html?.count || 0
  }

  private isPageResource(type: ResourceType): boolean {
    return type === 'html'
  }

  private emitActiveDownloads(): void {
    const rows = Array.from(this.activeDownloads.entries()).map(([url, state]) => {
      const parsed = new URL(url)
      const filename = basename(parsed.pathname) || parsed.hostname
      const percent = state.total > 0
        ? Math.max(0, Math.min(100, Math.round((state.downloaded / state.total) * 100)))
        : 0

      return {
        url,
        filename,
        percent
      }
    })

    this.emitEvent('active-downloads', rows)
  }

  private log(level: LogEntry['level'], message: string, url?: string): void {
    const entry: LogEntry = {
      level,
      message,
      url,
      timestamp: new Date().toISOString()
    }
    this.emit('log', entry)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}
