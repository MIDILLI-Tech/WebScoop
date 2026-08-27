import robotsParser from 'robots-parser'

/**
 * Thin wrapper around the well-tested `robots-parser` package, keeping the
 * same interface the crawler already uses.
 */
export class RobotsParser {
  private robot: ReturnType<typeof robotsParser> | null = null
  private userAgent = ''

  parse(robotsUrl: string, robotsTxt: string, userAgent: string): void {
    this.userAgent = userAgent
    try {
      this.robot = robotsParser(robotsUrl, robotsTxt)
    } catch {
      this.robot = null
    }
  }

  /** Undefined from upstream means "no rule" — treat as allowed. */
  isAllowed(url: string): boolean {
    if (!this.robot) return true
    return this.robot.isAllowed(url, this.userAgent) !== false
  }

  /** Crawl-delay in milliseconds (0 when unset). */
  getCrawlDelay(): number {
    if (!this.robot) return 0
    const seconds = this.robot.getCrawlDelay(this.userAgent)
    return seconds && seconds > 0 ? seconds * 1000 : 0
  }

  getSitemaps(): string[] {
    return this.robot ? this.robot.getSitemaps() : []
  }
}
