import { BrowserWindow } from 'electron'

/**
 * Opens a mini browser window for the user to log in.
 * Captures all cookies after login and returns them.
 */
export async function captureAuthCookies(loginUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Log in to website — WebScoop',
      webPreferences: {
        partition: 'persist:auth-session',
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    authWindow.setMenuBarVisibility(false)

    // When user closes window without completing, resolve with no cookies
    authWindow.on('closed', async () => {
      resolve('')
    })

    // Load the login URL
    authWindow.loadURL(loginUrl).catch(reject)

    // Add a toolbar with "I'm done logging in" button via preload
    authWindow.webContents.on('did-finish-load', () => {
      authWindow.webContents.executeJavaScript(`
        (function() {
          if (document.getElementById('__webscoop_auth_bar')) return;
          const bar = document.createElement('div');
          bar.id = '__webscoop_auth_bar';
          bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:999999;' +
            'background:#1565C0;padding:12px;text-align:center;font-family:system-ui;';
          const btn = document.createElement('button');
          btn.textContent = 'Done — I have logged in ✓';
          btn.style.cssText = 'background:#fff;color:#1565C0;border:none;padding:10px 32px;' +
            'border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;';
          btn.onclick = function() {
            document.title = '__WEBSCOOP_AUTH_DONE__';
          };
          bar.appendChild(btn);
          document.body.appendChild(bar);
        })();
      `).catch(() => {})
    })

    // Watch for the "done" signal
    authWindow.webContents.on('page-title-updated', async (_event, title) => {
      if (title === '__WEBSCOOP_AUTH_DONE__') {
        try {
          const session = authWindow.webContents.session
          const allCookies = await session.cookies.get({})
          // Keep only cookies that belong to the login site (or its parent/
          // child domains). Never forward SSO provider sessions (Google,
          // Facebook, ...) to the crawled site.
          let targetHost = ''
          try {
            targetHost = new URL(loginUrl).hostname.toLowerCase()
          } catch { /* keep all cookies if URL is unparseable */ }
          const relevant = targetHost
            ? allCookies.filter((c) => {
                const d = (c.domain || '').replace(/^\./, '').toLowerCase()
                if (!d) return false
                return (
                  d === targetHost ||
                  targetHost.endsWith('.' + d) ||
                  d.endsWith('.' + targetHost)
                )
              })
            : allCookies
          const cookieStr = relevant
            .map((c) => `${c.name}=${c.value}`)
            .join('; ')
          authWindow.destroy()
          resolve(cookieStr)
        } catch (err) {
          authWindow.destroy()
          reject(err)
        }
      }
    })
  })
}
