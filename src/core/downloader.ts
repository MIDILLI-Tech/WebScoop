import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'
import { EventEmitter } from 'node:events'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CookieJar } from 'tough-cookie'
import PQueue from 'p-queue'
import { request, ProxyAgent } from 'undici'
import type { CrawlConfig, DownloadResult } from './types'

export interface DownloadOptions {
  url: string
  headers?: Record<string, string>
}

interface RawResponse {
  data: Buffer
  statusCode: number
  headers: Record<string, string>
  contentType: string
  notModified?: boolean
  /** When set, the body was streamed to this temp file (data is empty). */
  size?: number
  file?: string
}

/** Error that must not be retried (e.g. max-size abort, cancellation). */
class NonRetryableError extends Error {}

/**
 * Responses larger than this (and not text-like) stream straight to a temp
 * file on disk instead of being buffered in memory.
 */
const STREAM_THRESHOLD = 8 * 1024 * 1024

function isTextContentType(contentType: string): boolean {
  const mime = contentType.toLowerCase()
  return (
    mime.includes('text/') ||
    mime.includes('html') ||
    mime.includes('css') ||
    mime.includes('javascript') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('svg')
  )
}

const COOKIE_ATTRIBUTE_KEYS =
  /^(path|domain|expires|max-age|secure|httponly|samesite|partitioned)$/i

export class Downloader extends EventEmitter {
  private queue: PQueue
  private cookieJar = new CookieJar()
  private config: CrawlConfig
  private dispatcher: ProxyAgent | null = null
  private activeRequests = new Map<string, AbortController>()
  private paused = false
  private cancelled = false
  private pauseWaiters: Array<() => void> = []
  private originHost = ''
  private totalBytesDownloaded = 0
  private speedSamples: { bytes: number; time: number }[] = []
  private downloadedData = new Map<string, Buffer>()
  private streamedFiles = new Map<string, string>()
  private streamCounter = 0
  private throttleWindowStart = Date.now()
  private throttleBytesInWindow = 0

  constructor(config: CrawlConfig) {
    super()
    this.config = config
    this.queue = new PQueue({ concurrency: Math.max(1, config.concurrency || 1) })

    if (config.proxy?.host && config.proxy.port > 0) {
      const protocol = config.proxy.protocol || 'http'
      const uri = `${protocol}://${config.proxy.host}:${config.proxy.port}`
      const token =
        config.proxy.username !== undefined
          ? 'Basic ' +
            Buffer.from(`${config.proxy.username}:${config.proxy.password || ''}`).toString(
              'base64'
            )
          : undefined
      this.dispatcher = new ProxyAgent({ uri, token })
    }
  }

  /** Restrict credential headers to the crawl's origin site (anti-leak). */
  setOriginHost(url: string): void {
    try {
      this.originHost = new URL(url).hostname
    } catch {
      this.originHost = ''
    }
  }

  get pending(): number {
    return this.queue.pending
  }

  get speed(): number {
    const now = Date.now()
    this.speedSamples = this.speedSamples.filter((s) => now - s.time < 5000)
    if (this.speedSamples.length < 2) return 0
    const oldest = this.speedSamples[0]
    const newest = this.speedSamples[this.speedSamples.length - 1]
    const elapsed = (newest.time - oldest.time) / 1000
    if (elapsed <= 0) return 0
    return (newest.bytes - oldest.bytes) / elapsed
  }

  setConcurrency(concurrency: number): void {
    this.queue.concurrency = concurrency
    this.config.concurrency = concurrency
  }

  setRequestDelay(delayMs: number): void {
    this.config.requestDelay = Math.max(0, Math.round(delayMs || 0))
  }

  setDownloadSpeedLimit(kbps: number): void {
    this.config.downloadSpeedLimit = Math.max(0, Math.round(kbps || 0))
  }

  async download(url: string, extraHeaders?: Record<string, string>): Promise<DownloadResult> {
    if (this.cancelled) {
      return this.errorResult(url, 'Download cancelled')
    }

    return (this.queue.add(async () => {
      // Pause gate: wait here instead of failing, so nothing is ever lost.
      while (this.paused && !this.cancelled) {
        await new Promise<void>((resolve) => this.pauseWaiters.push(resolve))
      }
      if (this.cancelled) return this.errorResult(url, 'Download cancelled')

      if (this.config.requestDelay > 0) {
        await this.delay(this.config.requestDelay)
        if (this.cancelled) return this.errorResult(url, 'Download cancelled')
      }

      return this.downloadWithRetry(url, extraHeaders ?? {}, this.config.retries)
    }) as Promise<DownloadResult>)
  }

  pause(): void {
    this.paused = true
    this.queue.pause()
  }

  resume(): void {
    this.paused = false
    this.queue.start()
    const waiters = this.pauseWaiters.splice(0)
    for (const w of waiters) w()
  }

  cancel(): void {
    this.cancelled = true
    this.resume() // release pause-gated tasks so they can exit cleanly
    for (const [url, controller] of this.activeRequests) {
      controller.abort()
      this.activeRequests.delete(url)
    }
    // Remove temp files of streamed downloads that were never consumed
    for (const [, file] of this.streamedFiles) {
      unlink(file).catch(() => {})
    }
    this.streamedFiles.clear()
  }

  /**
   * Accepts either raw Set-Cookie lines ("sid=x; Path=/; HttpOnly", one per
   * line) or bare browser-style pairs ("name=value; name2=value2") without
   * losing attributes.
   */
  setCookies(url: string, cookies: string): void {
    const rebuilt: string[] = []

    for (const line of cookies.split(/\r?\n/)) {
      const trimmedLine = line.trim()
      if (!trimmedLine) continue

      // Full Set-Cookie line (possibly including the header name)
      if (/^set-cookie\s*:/i.test(trimmedLine) || (trimmedLine.includes(';') && this.looksLikeSetCookie(trimmedLine))) {
        const raw = trimmedLine.replace(/^set-cookie\s*:/i, '').trim()
        try {
          this.cookieJar.setCookieSync(raw, url)
        } catch { /* skip invalid */ }
        continue
      }

      // Browser-devtools style "name=value; name2=value2" pairs
      for (const part of trimmedLine.split(';')) {
        const frag = part.trim()
        if (!frag) continue
        const eq = frag.indexOf('=')
        const key = eq > 0 ? frag.slice(0, eq).trim() : ''
        if (eq <= 0 || COOKIE_ATTRIBUTE_KEYS.test(key)) {
          // Attribute fragment: attach to previously built cookie if possible
          if (rebuilt.length > 0) rebuilt[rebuilt.length - 1] += `; ${frag}`
          continue
        }
        rebuilt.push(frag)
      }
    }

    for (const raw of rebuilt) {
      try {
        this.cookieJar.setCookieSync(raw, url)
      } catch { /* skip invalid */ }
    }
  }

  private looksLikeSetCookie(line: string): boolean {
    const firstPair = line.split(';')[0] || ''
    const eq = firstPair.indexOf('=')
    if (eq <= 0) return false
    return !COOKIE_ATTRIBUTE_KEYS.test(firstPair.slice(0, eq).trim())
  }

  private async downloadWithRetry(
    url: string,
    extraHeaders: Record<string, string>,
    retriesLeft: number
  ): Promise<DownloadResult> {
    try {
      this.emit('download-start', { url })
      const response = await this.performRequest(url, extraHeaders, 0)

      const size = response.size ?? response.data.length
      const success = response.statusCode >= 200 && response.statusCode < 400

      // Retry transient server errors that returned a response body
      const retryableStatus =
        !success && (response.statusCode >= 500 || response.statusCode === 429)
      if (retryableStatus && retriesLeft > 0 && !this.cancelled) {
        await this.delay(this.config.retryDelay * (this.config.retries - retriesLeft + 1))
        return this.downloadWithRetry(url, extraHeaders, retriesLeft - 1)
      }

      this.emit('download-complete', { url, size, contentType: response.contentType })
      if (response.file) {
        // Large binary: hand the temp file to the crawler via takeStreamedFile
        this.streamedFiles.set(url, response.file)
      } else if (!response.notModified) {
        this.downloadedData.set(url, response.data)
      }

      return {
        url,
        localPath: '',
        statusCode: response.statusCode,
        contentType: response.contentType,
        size,
        success,
        headers: response.headers,
        notModified: response.notModified === true
      }
    } catch (err) {
      if (
        !(err instanceof NonRetryableError) &&
        retriesLeft > 0 &&
        !this.cancelled &&
        !this.paused
      ) {
        await this.delay(this.config.retryDelay * (this.config.retries - retriesLeft + 1))
        return this.downloadWithRetry(url, extraHeaders, retriesLeft - 1)
      }
      const message = err instanceof Error ? err.message : String(err)
      this.emit('download-error', { url, error: message })
      return this.errorResult(url, message)
    }
  }

  private async performRequest(
    url: string,
    extraHeaders: Record<string, string>,
    redirectCount: number
  ): Promise<RawResponse> {
    if (redirectCount > 10) {
      throw new Error('Too many redirects')
    }

    const parsed = new URL(url)

    let cookieHeader = ''
    try {
      cookieHeader = this.cookieJar.getCookieStringSync(url)
    } catch { /* ignore */ }

    const headers: Record<string, string> = {
      'User-Agent': this.config.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(parsed.hostname === this.originHost ? this.getAuthHeaders() : {}),
      ...extraHeaders
    }

    const controller = new AbortController()
    this.activeRequests.set(url, controller)

    let res
    try {
      res = await request(url, {
        method: 'GET',
        headers,
        dispatcher: this.dispatcher ?? undefined,
        signal: controller.signal,
        headersTimeout: this.config.timeout,
        bodyTimeout: this.config.timeout
      })
    } finally {
      this.activeRequests.delete(url)
    }

    const statusCode = res.statusCode

    // Capture cookies
    const setCookies = res.headers['set-cookie']
    if (Array.isArray(setCookies)) {
      for (const raw of setCookies) {
        try { this.cookieJar.setCookieSync(raw, url) } catch { /* skip */ }
      }
    }

    // Redirects
    const location = res.headers.location
    if (statusCode >= 300 && statusCode < 400 && location) {
      const redirectUrl = new URL(Array.isArray(location) ? location[0] : location, url).toString()
      await res.body.dump()
      return this.performRequest(redirectUrl, extraHeaders, redirectCount + 1)
    }

    // Conditional request hit — nothing changed, nothing to buffer
    if (statusCode === 304) {
      res.body.destroy()
      return {
        data: Buffer.alloc(0),
        statusCode: 304,
        headers: {},
        contentType: '',
        notModified: true
      }
    }

    // Decompression pipeline
    const encodingHeader = res.headers['content-encoding']
    const encoding = Array.isArray(encodingHeader) ? encodingHeader[0] : encodingHeader
    let stream: NodeJS.ReadableStream = res.body as unknown as NodeJS.ReadableStream
    if (encoding === 'gzip') stream = stream.pipe(createGunzip())
    else if (encoding === 'deflate') stream = stream.pipe(createInflate())
    else if (encoding === 'br') stream = stream.pipe(createBrotliDecompress())

    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(res.headers)) {
      responseHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '')
    }

    // Reject oversized responses up front so their bytes never hit memory
    const contentLength = parseInt(responseHeaders['content-length'] || '0', 10)
    if (this.config.maxFileSize > 0 && contentLength > this.config.maxFileSize) {
      res.body.destroy()
      this.activeRequests.delete(url)
      throw new NonRetryableError(`File exceeds max size: ${this.config.maxFileSize} bytes`)
    }

    // Large non-text responses stream straight to a temp file — the full
    // body never sits in memory. Text-like content always buffers (it is
    // parsed for link discovery afterwards).
    const contentTypeRaw = responseHeaders['content-type'] || ''
    if (contentLength > STREAM_THRESHOLD && !isTextContentType(contentTypeRaw)) {
      return await this.streamToFile(url, res.body as unknown as NodeJS.ReadableStream, {
        statusCode,
        totalSize: contentLength,
        responseHeaders,
        contentType: contentTypeRaw.split(';')[0].trim()
      })
    }

    return await new Promise<RawResponse>((resolve, reject) => {
      const chunks: Buffer[] = []
      let downloaded = 0
      let settled = false
      const totalSize = parseInt(responseHeaders['content-length'] || '0', 10)
      const maxSize = this.config.maxFileSize
      const cleanup = (): void => {
        res.body.destroy()
        this.activeRequests.delete(url)
      }

      stream.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        if (maxSize > 0 && downloaded > maxSize) {
          settled = true
          cleanup()
          reject(new NonRetryableError(`File exceeds max size: ${maxSize} bytes`))
          return
        }
        chunks.push(chunk)
        this.totalBytesDownloaded += chunk.length
        this.speedSamples.push({ bytes: this.totalBytesDownloaded, time: Date.now() })
        this.emit('download-progress', { url, downloaded, total: totalSize })
        this.applyDownloadSpeedThrottle(chunk.length, stream)
      })

      stream.on('end', () => {
        if (settled) return
        settled = true
        this.activeRequests.delete(url)
        resolve({
          data: Buffer.concat(chunks),
          statusCode,
          headers: responseHeaders,
          contentType: (contentTypeRaw || '').split(';')[0].trim()
        })
      })

      stream.on('error', (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }

  async getBuffer(url: string): Promise<Buffer> {
    const cached = this.downloadedData.get(url)
    if (cached) {
      this.downloadedData.delete(url)
      return cached
    }
    const response = await this.performRequest(url, {}, 0)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`HTTP ${response.statusCode} for ${url}`)
    }
    return response.data
  }

  /** Drop a cached buffer that will never be consumed (memory hygiene). */
  discardBuffer(url: string): void {
    this.downloadedData.delete(url)
    const streamed = this.streamedFiles.get(url)
    if (streamed !== undefined) {
      this.streamedFiles.delete(url)
      unlink(streamed).catch(() => {})
    }
  }

  /**
   * Pop the temp file for a streamed (large binary) download, if any.
   * The caller takes ownership of the file and must move or delete it.
   */
  takeStreamedFile(url: string): string | null {
    const file = this.streamedFiles.get(url)
    if (file === undefined) return null
    this.streamedFiles.delete(url)
    return file
  }

  private getAuthHeaders(): Record<string, string> {
    const auth = this.config.auth
    if (!auth || auth.type === 'none') return {}

    if (auth.type === 'basic' && auth.username) {
      const encoded = Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }

    return auth.headers || {}
  }

  private errorResult(url: string, error: string): DownloadResult {
    return {
      url,
      localPath: '',
      statusCode: 0,
      contentType: '',
      size: 0,
      success: false,
      error,
      headers: {}
    }
  }

  /**
   * Stream a large binary body to a temp file. The crawler moves the file
   * into the output directory via FileStorage.saveFromFile, so the full
   * content never sits in memory.
   */
  private async streamToFile(
    url: string,
    stream: NodeJS.ReadableStream,
    meta: {
      statusCode: number
      totalSize: number
      responseHeaders: Record<string, string>
      contentType: string
    }
  ): Promise<RawResponse> {
    const tempPath = join(
      tmpdir(),
      `webscoop-dl-${process.pid}-${Date.now()}-${this.streamCounter++}.part`
    )

    return await new Promise<RawResponse>((resolve, reject) => {
      let settled = false
      let written = 0
      const maxSize = this.config.maxFileSize
      const out = createWriteStream(tempPath)

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        out.destroy()
        ;(stream as unknown as { destroy?: () => void }).destroy?.()
        unlink(tempPath).catch(() => {})
        reject(err)
      }

      stream.on('data', (chunk: Buffer) => {
        if (settled) return
        written += chunk.length
        this.totalBytesDownloaded += chunk.length
        this.speedSamples.push({ bytes: this.totalBytesDownloaded, time: Date.now() })
        this.emit('download-progress', { url, downloaded: written, total: meta.totalSize })
        this.applyDownloadSpeedThrottle(chunk.length, stream)
        if (maxSize > 0 && written > maxSize) {
          fail(new NonRetryableError(`File exceeds max size: ${maxSize} bytes`))
          return
        }
        // Respect backpressure: pause reads until the file catches up
        if (!out.write(chunk)) {
          stream.pause()
          out.once('drain', () => stream.resume())
        }
      })

      stream.on('error', fail)
      out.on('error', fail)

      stream.on('end', () => {
        out.end()
      })

      out.on('finish', () => {
        if (settled) return
        settled = true
        resolve({
          data: Buffer.alloc(0),
          size: written,
          statusCode: meta.statusCode,
          headers: meta.responseHeaders,
          contentType: meta.contentType,
          file: tempPath
        })
      })
    })
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Global throughput limiter. Byte accounting is shared across streams, but
   * pause/resume state is per-stream so concurrent downloads cannot stall
   * each other's resume timers.
   */
  private applyDownloadSpeedThrottle(bytes: number, stream: NodeJS.ReadableStream): void {
    const limitKbps = Number(this.config.downloadSpeedLimit || 0)
    if (!Number.isFinite(limitKbps) || limitKbps <= 0) return

    const pauseable = stream as NodeJS.ReadableStream & {
      pause?: () => void
      resume?: () => void
      readableFlowing?: boolean
    }
    if (typeof pauseable.pause !== 'function' || typeof pauseable.resume !== 'function') return
    if (pauseable.readableFlowing === false) return // already throttled

    const now = Date.now()
    const elapsed = now - this.throttleWindowStart
    if (elapsed >= 1000) {
      this.throttleWindowStart = now
      this.throttleBytesInWindow = 0
    }

    const limitBytesPerSec = Math.max(1, Math.round(limitKbps * 1024))
    this.throttleBytesInWindow += bytes

    const expectedElapsedMs = (this.throttleBytesInWindow / limitBytesPerSec) * 1000
    const actualElapsedMs = Math.max(0, Date.now() - this.throttleWindowStart)
    const waitMs = Math.ceil(expectedElapsedMs - actualElapsedMs)
    if (waitMs <= 0) return

    pauseable.pause!()

    const timer = setTimeout(() => {
      pauseable.resume!()
      if (Date.now() - this.throttleWindowStart >= 1000) {
        this.throttleWindowStart = Date.now()
        this.throttleBytesInWindow = 0
      }
    }, waitMs)
    timer.unref?.()
  }
}
