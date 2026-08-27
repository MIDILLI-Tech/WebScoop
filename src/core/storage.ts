import { mkdir, writeFile, stat, rename, copyFile, unlink } from 'node:fs/promises'
import { dirname, join, extname } from 'node:path'

const MIME_TO_EXT: Record<string, string> = {
  'text/html': '.html',
  'application/xhtml+xml': '.xhtml',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/avif': '.avif',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
  'application/font-woff': '.woff',
  'application/font-woff2': '.woff2',
  'application/x-font-ttf': '.ttf',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'application/pdf': '.pdf'
}

// Dynamic server extensions that break offline browsing when served as HTML
const DYNAMIC_HTML_EXT = /^\.(php[0-9]?|asp|aspx|jsp|cgi|pl|shtml)$/i

export class FileStorage {
  private outputDir: string
  private writtenFiles = new Map<string, string>() // url -> localPath
  private pathOwners = new Map<string, string>() // relativePath -> owner url

  constructor(outputDir: string) {
    this.outputDir = outputDir
  }

  /**
   * Save downloaded content to disk.
   * Returns the relative path (from output root) where the file was saved.
   *
   * When `ownerUrl` is given, colliding paths from different URLs are
   * uniquified (suffix _1, _2, ...) so nothing is silently overwritten.
   * Post-processing rewrites call save() without an owner to update files
   * in place.
   */
  async save(
    relativePath: string,
    data: Buffer,
    contentType?: string,
    ownerUrl?: string
  ): Promise<string> {
    const finalPath = this.resolveFinalPath(relativePath, contentType, ownerUrl)
    const absolutePath = join(this.outputDir, finalPath)

    // Ensure directory exists
    await mkdir(dirname(absolutePath), { recursive: true })

    // Write file
    await writeFile(absolutePath, data)

    return finalPath
  }

  /**
   * Move a streamed temp file into the output directory without ever
   * loading it into memory. Falls back to copy+delete when temp and output
   * live on different drives (rename fails across devices).
   */
  async saveFromFile(
    tempPath: string,
    relativePath: string,
    contentType?: string,
    ownerUrl?: string
  ): Promise<string> {
    const finalPath = this.resolveFinalPath(relativePath, contentType, ownerUrl)
    const absolutePath = join(this.outputDir, finalPath)

    await mkdir(dirname(absolutePath), { recursive: true })

    try {
      await rename(tempPath, absolutePath)
    } catch {
      await copyFile(tempPath, absolutePath)
      await unlink(tempPath).catch(() => {})
    }

    return finalPath
  }

  private resolveFinalPath(
    relativePath: string,
    contentType: string | undefined,
    ownerUrl: string | undefined
  ): string {
    let finalPath = this.fixExtension(relativePath, contentType)

    if (ownerUrl) {
      const owner = this.pathOwners.get(finalPath)
      if (owner && owner !== ownerUrl) {
        finalPath = this.uniquePath(finalPath)
      }
      this.pathOwners.set(finalPath, ownerUrl)
    }

    return finalPath
  }

  private fixExtension(relativePath: string, contentType?: string): string {
    if (!contentType) return relativePath
    const mime = contentType.split(';')[0].trim().toLowerCase()
    const correctExt = MIME_TO_EXT[mime]
    if (!correctExt) return relativePath

    const currentExt = extname(relativePath).toLowerCase()
    if (!currentExt) {
      return relativePath + correctExt
    }
    // e.g. text/html served as page.php -> page.html so it opens offline
    if (mime === 'text/html' && DYNAMIC_HTML_EXT.test(currentExt)) {
      return relativePath.slice(0, -currentExt.length) + correctExt
    }
    return relativePath
  }

  private uniquePath(path: string): string {
    const ext = extname(path)
    const base = ext ? path.slice(0, -ext.length) : path
    for (let i = 1; ; i++) {
      const candidate = `${base}_${i}${ext}`
      if (!this.pathOwners.has(candidate)) return candidate
    }
  }

  /**
   * Register a URL → local path mapping (for URL rewriting).
   */
  register(url: string, localPath: string): void {
    this.writtenFiles.set(this.canonicalUrl(url), localPath)
  }

  /**
   * Look up the local path for a given URL.
   */
  getLocalPath(url: string): string | null {
    return this.writtenFiles.get(this.canonicalUrl(url)) ?? null
  }

  /** Canonical form so `site.com`, `site.com/`, `site.com/#x` all match. */
  private canonicalUrl(url: string): string {
    try {
      const parsed = new URL(url)
      parsed.hash = ''
      let pathname = parsed.pathname
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1)
      }
      return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`
    } catch {
      return url
    }
  }

  /**
   * Returns all registered URL → path mappings.
   */
  getAllMappings(): Map<string, string> {
    return new Map(this.writtenFiles)
  }

  /**
   * Check if a file exists at the given relative path.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(join(this.outputDir, relativePath))
      return true
    } catch {
      return false
    }
  }

  get root(): string {
    return this.outputDir
  }
}
