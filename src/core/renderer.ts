import puppeteer, { type Browser, type CookieData, type Page } from 'puppeteer-core'
import type { CrawlConfig } from './types'

export interface RenderResult {
  html: string
  resources: string[]
}

const COOKIE_ATTRIBUTE = /^(path|domain|expires|max-age|secure|httponly|samesite)$/i

export class JsRenderer {
  private browser: Browser | null = null
  private chromiumPath = ''
  private cookieHeader = ''
  private userAgent = ''

  async launch(config: CrawlConfig): Promise<void> {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run'
    ]

    if (config.proxy?.host) {
      const protocol = config.proxy.protocol || 'http'
      args.push(`--proxy-server=${protocol}://${config.proxy.host}:${config.proxy.port}`)
    }

    // Carry the crawl's identity + auth session into the headless browser so
    // login-protected and SPA pages render as the real user sees them.
    this.userAgent = config.userAgent || ''
    this.cookieHeader = config.auth?.cookies || ''

    // Prefer a user-configured Chromium path; fall back to auto-detection.
    this.chromiumPath = await this.resolveChromiumPath(config)
    if (!this.chromiumPath) {
      throw new Error('No Chromium/Chrome installation found. Enable JS rendering in settings with a valid Chromium path.')
    }

    this.browser = await puppeteer.launch({
      executablePath: this.chromiumPath,
      headless: true,
      args
    })
  }

  async render(url: string, waitTime: number): Promise<RenderResult | null> {
    if (!this.browser) return null

    let page: Page | null = null
    const interceptedResources: string[] = []

    try {
      page = await this.browser.newPage()

      // Share auth cookies + User-Agent before navigating
      await this.applySession(page, url)

      // Intercept network requests to capture dynamically loaded resources
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        const resourceUrl = req.url()
        const type = req.resourceType()
        if (['image', 'stylesheet', 'script', 'font', 'media'].includes(type)) {
          interceptedResources.push(resourceUrl)
        }
        req.continue()
      })

      // Navigate
      await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: 30_000
      })

      // Extra wait for JS rendering
      if (waitTime > 0) {
        await page.evaluate(
          (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          waitTime
        )
      }

      // Scroll to bottom to trigger lazy-loaded content
      await this.autoScroll(page)

      // Wait a bit more after scrolling
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)))

      // Get rendered HTML
      const html = await page.content()

      return { html, resources: [...new Set(interceptedResources)] }
    } catch {
      return null
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  private async applySession(page: Page, url: string): Promise<void> {
    if (this.userAgent) {
      await page.setUserAgent(this.userAgent).catch(() => {})
    }
    if (!this.cookieHeader) return

    let hostname: string
    try {
      hostname = new URL(url).hostname
    } catch {
      return
    }

    // Accepts browser-style pairs ("sid=x; theme=dark") and raw Set-Cookie
    // lines; attribute fragments are skipped.
    const cookies: CookieData[] = []
    for (const frag of this.cookieHeader.split(/[;\r\n]+/)) {
      const eq = frag.indexOf('=')
      if (eq <= 0) continue
      const name = frag.slice(0, eq).trim()
      if (!name || COOKIE_ATTRIBUTE.test(name)) continue
      cookies.push({ name, value: frag.slice(eq + 1).trim(), domain: hostname, path: '/' })
    }
    if (cookies.length > 0) {
      await page.browserContext().setCookie(...cookies).catch(() => {})
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }

  private async autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0
        const distance = 300
        const maxScrolls = 50
        let scrollCount = 0

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance
          scrollCount++

          if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
            clearInterval(timer)
            window.scrollTo(0, 0) // scroll back to top
            resolve()
          }
        }, 100)
      })
    })
  }

  static async findChromiumPath(): Promise<string> {
    const renderer = new JsRenderer()
    return renderer.findChromium()
  }

  private async resolveChromiumPath(config: CrawlConfig): Promise<string> {
    if (config.chromiumPath) {
      const { existsSync } = await import('node:fs')
      if (existsSync(config.chromiumPath)) {
        return config.chromiumPath
      }
    }
    return this.findChromium()
  }

  private async findChromium(): Promise<string> {
    const { execSync } = await import('node:child_process')
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { platform, env } = await import('node:process')

    const candidates: string[] = []

    if (platform === 'win32') {
      const programFiles = env['PROGRAMFILES'] || 'C:\\Program Files'
      const programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
      const localAppData = env['LOCALAPPDATA'] || ''
      candidates.push(
        join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
        join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
        join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      )
    } else if (platform === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      )
    } else {
      // Linux
      candidates.push(
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge'
      )
      // Try which
      try {
        const path = execSync('which google-chrome || which chromium || which chromium-browser', {
          encoding: 'utf-8'
        }).trim()
        if (path) candidates.unshift(path)
      } catch { /* ignore */ }
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }

    return ''
  }
}
