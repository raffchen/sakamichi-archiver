/* login gate state (server env VIEWER_PASSWORD — server.mjs §login gate).
   The talk/message side needs a login; the blog archive stays public.
   checkAuth() asks the server once at startup: on vite dev there is no
   /api/auth (404), which leaves required=false — the gate is production-only. */

export const auth = $state({
  required: false,
  authed: false,
  checked: false,
  open: false, // the login screen is visible
  busy: false,
  error: '',
})

export async function checkAuth() {
  try {
    const r = await fetch('/api/auth')
    if (r.ok) {
      const v = await r.json()
      auth.required = !!v.required
      auth.authed = !!v.authed
    }
  } catch {
    /* offline / old server — assume no gate */
  }
  auth.checked = true
}

/** open the login screen (no-op when the gate is off or already passed) */
export function requireLogin() {
  if (auth.required && !auth.authed) auth.open = true
}

/** POST the password. A success reloads the page: the anon-slimmed index is
    replaced by the full one and every <img>/<video> (which can't retry a
    401 themselves) starts fresh with the session cookie in place. */
export async function login(password: string): Promise<boolean> {
  auth.busy = true
  auth.error = ''
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (r.ok) {
      location.reload()
      return true
    }
    auth.error =
      r.status === 429
        ? 'しばらく待ってから再試行してください / too many attempts'
        : 'パスワードが違います / wrong password'
  } catch {
    auth.error = 'ネットワークエラー / network error'
  } finally {
    auth.busy = false
  }
  return false
}
