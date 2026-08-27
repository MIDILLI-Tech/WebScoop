# WebScoop

Open-source, cross-platform website mirroring tool for offline browsing. A modern alternative to HTTrack, WebReaper, and Cyotek WebCopy.

## Features

- **Full Website Mirroring** — Download entire websites with all assets for offline use
- **Single Page Download** — Grab just one page with all its dependencies (UI preset or `--single` CLI flag)
- **CLI Support** — Scriptable downloads from the terminal with the same engine as the desktop app
- **JavaScript Rendering** — Capture SPA/JS-heavy sites using your installed Chrome/Chromium via Puppeteer Core
- **Smart URL Rewriting** — All links converted to relative local paths after the crawl for seamless offline browsing
- **Resume & Pause** — Interrupt and continue downloads without losing progress (survives app restarts)
- **Crash-Safe** — Progress is persisted per file; after a crash or restart the crawl continues where it left off, and failed files can be retried with one click
- **Incremental Updates** — Scheduled re-runs can fetch *only changed files* using ETag / Last-Modified conditional requests (304-aware)
- **Auto-Update** — In-app update notification with download-progress and restart-to-install flow (GitHub Releases via electron-updater)
- **Selective Filters** — Include/exclude by file type, URL pattern (regex), depth, and MIME type
- **Scheduled Downloads** — Recurring crawls with cron expressions; runs fire automatically while the app is open
- **Concurrent Downloads** — Adjustable parallel download count, changeable live during a crawl
- **Download Speed Limit & Request Delay** — Polite crawling with global throttling
- **Live Feedback** — Taskbar/dock progress, desktop notifications on completion, and per-project logs that persist across restarts
- **Authentication Support** — Basic auth, cookie import, or interactive login via a built-in browser window (login cookies are scoped to the target site only)
- **Proxy Support** — Route downloads and headless-browser traffic through an HTTP proxy
- **robots.txt Respect** — Ethical crawling by default, with option to override
- **System Tray** — Optional minimize-to-tray on close (Windows, macOS, Linux)
- **Multilingual UI** — English and Turkish (easily extensible)
- **Dark/Light Theme** — Material Design interface with theme switching

## Tech Stack

- **Electron** — Cross-platform desktop shell
- **Vue 3 + Vuetify** — Modern, clean UI
- **TypeScript** — Type-safe codebase
- **Cheerio + PostCSS** — HTML/CSS parsing and asset discovery
- **Puppeteer Core** — Drives your installed Chrome/Chromium for JS rendering
- **undici** — HTTP client with proxy support
- **SQLite (better-sqlite3)** — Resume state, projects, and settings storage

## Requirements

- **Node.js 24 LTS** or newer (`node -v` to check)
- npm (bundled with Node.js)
- Google Chrome, Chromium, or Microsoft Edge — required only for the optional JavaScript rendering feature. On Windows/macOS it is auto-detected; on exotic setups you can point WebScoop to the executable manually (see below).

> Native module note: `better-sqlite3` is compiled against Electron automatically during `npm install` (via `electron-builder install-app-deps`). No manual steps are needed.

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Quality checks
npm run typecheck   # tsc + vue-tsc
npm run lint        # eslint (flat config)
npm test            # vitest run — unit tests (queue, filters, url-rewriter)
npm run test:watch  # vitest in watch mode

# Build production bundles into out/ (does NOT create an installer)
npm run build

# Preview the production build
# NOTE: preview serves the existing out/ folder — run `npm run build` first
# if you changed code, otherwise you will see a stale version.
npm run preview
```

## Testing

Unit tests live in `src/core/__tests__/` and run with [Vitest](https://vitest.dev):

| File | Covers |
| --- | --- |
| `queue.test.ts` | URL dedup, fragment stripping, trailing-slash / `index.html` canonicalization, query-order canonicalization, priority ordering |
| `filters.test.ts` | Resource-type guessing, domain restriction (`same-host` / `same-domain` / multi-label suffixes like `com.tr`), depth limits, pattern & extension filters, MIME filters |
| `url-rewriter.test.ts` | URL→file-path mapping, query hashing, illegal-character & Windows reserved-name sanitization, path-length caps, HTML link rewriting, `data:` / `mailto:` / anchor preservation |
| `state-manager.test.ts` | Project CRUD, URL lifecycle (pending/completed/failed + retry), ETag/Last-Modified validators, schema migration from older DBs, settings persistence, log storage & pruning |
| `scheduler.test.ts` | Cron validation, invalid-expression errors, rescheduling, trigger firing, stop/cleanup |
| `storage.test.ts` | File writing, MIME-based extension fixing (`.php` → `.html`), collision uniquification per owner URL, URL→path mappings, canonical URL matching |

Run everything before opening a PR:

```bash
npm run lint && npm run typecheck && npm test
```

## Continuous Integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. `npm ci --ignore-scripts` (native module builds are not needed for checks)
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`

## Packaging

```bash
npm run build:win    # Windows installer (NSIS)
npm run build:mac    # macOS dmg
npm run build:linux  # Linux AppImage + deb

npm run build:unpack # Unpackaged app directory (quick smoke test)
```

On Windows without a code-signing certificate use:

```bash
npm run build:win:unsigned
```

Artifacts are written to the `dist/` folder.

## Releasing

Installers are published to GitHub Releases (see the `publish:` block in `electron-builder.yml`). Installed apps then pick them up automatically through electron-updater.

```bash
# 1. Bump the version (updates package.json + package-lock.json and tags git)
npm version patch   # or minor / major

# 2. Build and publish artifacts to GitHub Releases
#    Windows (PowerShell):
$env:GH_TOKEN = "github_pat_..."
npm run build:win -- --publish always

#    macOS / Linux (bash):
GH_TOKEN=github_pat_... npm run build:mac -- --publish always
GH_TOKEN=github_pat_... npm run build:linux -- --publish always
```

Notes on auto-update:

- The token needs the `repo` scope. `electron-builder` uploads the installers plus the `latest.yml` / `latest-mac.yml` metadata that electron-updater reads.
- **Windows (NSIS)** — auto-update works for unsigned builds too (Windows shows a SmartScreen warning on first install).
- **macOS** — auto-update requires a signed **and** notarized build; unsigned dmg installs will not self-update.
- **Linux** — AppImage supports auto-update; deb packages do not (update via your package manager).
- Development builds (`npm run dev`) skip the update check.
- Users can always check manually via **Settings → Check for Updates**, and choose **Download → Restart & Install** from the in-app notification.

## Project Structure

```
src/
  main/       Electron main process — window, tray, IPC handlers
  preload/    Context-isolated bridge exposed to the renderer as window.api
  renderer/   Vue 3 + Vuetify UI — views, components, Pinia stores, i18n (EN/TR)
  core/       Crawling engine — crawler, downloader (undici + cookie jar),
              filters, parsers (HTML/CSS/JS/SVG), storage, URL rewriter,
              robots.txt, state manager (SQLite), JS renderer (Puppeteer Core)
scripts/      CLI entry — same engine, plain Node.js (no Electron needed)
```

## CLI Usage

The crawling engine can also be used directly from the terminal — no app window, no Electron needed. It runs on a plain Node.js 24+ installation.

```bash
# Full site mirror (default depth 3)
npm run cli -- https://example.com

# Single page + its assets only
npm run cli -- https://docs.example.com --single

# JavaScript-rendered crawl for SPA sites
npm run cli -- https://app.example.com --js

# Common options
npm run cli -- https://example.com -o D:\mirrors\example -d 5 -c 8 --delay 200
```

All options:

| Option | Description |
| --- | --- |
| `-o, --out <dir>` | Output directory (default `./webscoop-output/<host>`) |
| `-d, --depth <n>` | Max link depth (default 3, `0` = unlimited) |
| `-p, --max-pages <n>` | Max pages (`0` = unlimited) |
| `-c, --concurrency <n>` | Parallel downloads (default 4) |
| `--delay <ms>` | Delay between requests (default 150) |
| `--speed-limit <kbps>` | Global speed limit (`0` = unlimited) |
| `-u, --user-agent <str>` | Custom User-Agent |
| `--timeout <s>`, `--retries <n>` | Request timeout / retry count |
| `--domain <mode>` | `same-host` \| `same-domain` \| `any` |
| `--include-ext`, `--exclude-ext <list>` | Extension filters (`.png,.jpg`) |
| `--js`, `--chromium-path <p>` | Enable JS rendering with Chrome/Chromium |
| `--ignore-robots` | Ignore robots.txt (default: respect it) |
| `--single` | Single page mode: start page + assets only |

Interrupted crawls **resume automatically**: re-running the same command with the same output directory continues from `<out>/.webscoop-state.json`.

## Setting the Chromium Path (JS Rendering)

1. Open **Settings → Chromium / JS Rendering**
2. Either click **Auto-detect**, or type/paste the full executable path, or click the **file-browse button** and pick `chrome.exe` / `chromium` / `msedge.exe`
3. Click **Save**

The saved path is used first when a crawl starts; if it is missing or invalid, WebScoop falls back to automatic detection of common install locations (Chrome, Chromium, Edge).

Typical paths:

| Platform | Example |
| --- | --- |
| Windows | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Linux | `/usr/bin/google-chrome`, `/usr/bin/chromium` |

## Where Is My Data?

- **Projects, schedule state, settings, crawl logs** — SQLite database in the Electron user-data folder:
  - Windows: `%APPDATA%\WebScoop\webscoop.db`
  - macOS: `~/Library/Application Support/WebScoop/webscoop.db`
  - Linux: `~/.config/WebScoop/webscoop.db`
- **Downloaded websites** — by default under your OS *Downloads* folder, one subfolder per project (configurable per project and in Settings)

## Troubleshooting

- **"No Chromium installation found" during a crawl** — Set the browser path manually in Settings (section above), make sure JS Rendering is enabled in the project's config, and save before starting.
- **Tray icon not showing on Linux** — Your desktop environment must support the StatusNotifierItem/AppIndicator protocol (GNOME needs an extension such as AppIndicator support). Without it, closing the window will simply quit the app.
- **Some pages look broken offline** — Sites loading assets from third-party domains may need *Domain Restriction* set to "Any domain" in the project filters so those assets get mirrored too.
- **Build fails with a Node version warning** — This project targets Node.js 24 LTS; older versions are unsupported.
- **"Update check failed" in Settings** — The app queries GitHub Releases; corporate proxies or rate limits can block it. Auto-update itself is unaffected once an installer is published.
- **Auto-update doesn't trigger** — It only works for installed (packaged) builds published to GitHub Releases; dev builds skip it, and macOS builds must be signed and notarized.

## License

MIT
