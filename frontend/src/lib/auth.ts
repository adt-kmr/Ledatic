// JWT session holder for the Citadel frontend.
// Tokens come from POST /api/auth/login only — there is no hidden fallback
// account. If the backend rejects a login, the UI shows the real error.

// API base resolution:
//  - "" (default) → same-origin. Dev: Vite proxies /api → backend. Docker:
//    nginx proxies /api → backend. This is the correct default everywhere the
//    frontend and backend share an origin or a proxy.
//  - VITE_API_URL → explicit backend origin for split deployments (e.g. the
//    frontend on Vercel calling an API on Render).
const PROD_BACKEND_FALLBACK = "https://derby-hack.onrender.com";

function resolveApiBase(): string {
  const raw = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim().replace(/\/$/, "");
  if (raw && /^https?:\/\//i.test(raw)) return raw;

  if (raw && typeof window !== "undefined") {
    // A common misconfig: VITE_API_URL set to the Google client id or another
    // non-URL string. Relative fetch() then resolves under /demo/... and every
    // POST hits the Vercel static host → 405 Method Not Allowed.
    console.error(
      "[citadel] VITE_API_URL must be an absolute https:// backend URL. " +
      "Rebuild with VITE_API_URL=https://<backend-host> (no trailing slash).",
    );
  }

  if (typeof window !== "undefined" && window.location.hostname.endsWith(".vercel.app")) {
    return PROD_BACKEND_FALLBACK;
  }

  return "";
}

export const API_BASE: string = resolveApiBase();

if (!API_BASE && typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname) &&
    !import.meta.env.DEV) {
  console.warn(
    "[citadel] VITE_API_URL is not set — API calls go to the current origin. " +
    "If the backend is hosted elsewhere, set VITE_API_URL at build time.",
  );
}

/** Resolve an API path against the configured base. Absolute URLs pass through. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return API_BASE + path;
}

/**
 * Absolute ws:// or wss:// URL for a WebSocket path.
 *
 * `new WebSocket()` requires an ABSOLUTE url — unlike fetch(), a relative path
 * throws. When API_BASE is empty the socket must target the current origin
 * (whose proxy forwards it), following the page's protocol so https gets wss.
 */
export function wsUrl(path: string): string {
  const base = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  return base.replace(/^http/i, "ws") + path;
}

let cachedPublicIp: string | null = null;
export async function getPublicIp(): Promise<string> {
  if (cachedPublicIp) return cachedPublicIp;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 800);
    const res = await fetch("https://api64.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      cachedPublicIp = data.ip;
      return data.ip;
    }
  } catch {
    // Non-fatal — return empty string on timeout/adblocker/error without hanging
  }
  return "";
}

// ── Persistent session ────────────────────────────────────────────────────
// The JWT, the logged-in Customer ID, and the last session id are mirrored to
// localStorage so a browser refresh restores the same session instead of
// silently logging the user out (the token used to live only in memory).
const TOKEN_KEY = "citadel.token";
const USER_KEY = "citadel.user";
const SESSION_KEY = "citadel.session";
// One-time migration from the pre-rebrand keys so existing demo sessions survive.
const LEGACY_KEYS = ["bdna.token", "bdna.user", "bdna.session"];
try { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

/** Decode a JWT's `exp` (seconds since epoch), or null if unreadable. */
function tokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isExpired(token: string): boolean {
  const exp = tokenExp(token);
  return exp !== null && exp * 1000 <= Date.now();
}

/** Rehydrate a non-expired token from storage on module load. */
function loadStoredToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return null;
    if (isExpired(t)) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return t;
  } catch {
    return null; // storage unavailable (SSR / privacy mode) → in-memory only
  }
}

let authToken: string | null = loadStoredToken();

export function getToken(): string | null {
  // Drop a token that expired while the tab was idle.
  if (authToken && isExpired(authToken)) clearToken();
  return authToken;
}

export function setToken(token: string | null): void {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable — keep in-memory copy */ }
}

export function clearToken(): void {
  authToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

export function isLoggedIn(): boolean {
  return getToken() !== null;
}

/** Persist the logged-in Customer ID and (optionally) the latest session id. */
export function setSession(userId: string | null, sessionId?: string | null): void {
  try {
    if (userId) localStorage.setItem(USER_KEY, userId);
    else localStorage.removeItem(USER_KEY);
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
  } catch { /* ignore */ }
}

/** The Customer ID from the restored session, if any. */
export function getSessionUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

/** The last persisted session id, if any. */
export function getSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/** Thrown by loginCustomer so callers can show the backend's real reason. */
export class LoginError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface LoginResult {
  access_token: string;
  [key: string]: unknown;
}

/**
 * The single real login path. POSTs credentials to the backend, stores the
 * JWT on success, and throws a LoginError carrying the backend's reason on
 * failure (wrong password, VPN block, account block, network down).
 */
export async function loginCustomer(
  customerId: string,
  password: string,
  extra: Record<string, unknown> = {},
): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, password, ...extra }),
    });
  } catch {
    throw new LoginError(0, "Cannot reach the authentication service. Check that the backend is running.", "network");
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = data?.detail as Record<string, unknown> | string | undefined;
    const message =
      typeof detail === "string" ? detail :
      (detail?.message as string) ?? (data?.message as string) ?? "Invalid credentials";
    const code = typeof detail === "object" && detail ? ((detail.error as string) ?? null) : null;
    throw new LoginError(res.status, message, code);
  }
  const token = data.access_token as string | undefined;
  if (!token) throw new LoginError(res.status, "Login response missing access token", "protocol");
  setToken(token);
  setSession(customerId);
  return data as unknown as LoginResult;
}

/**
 * Returns the current token if one is held, else null. Demo panels that used
 * to auto-login through this helper now require a real signed-in session —
 * there are no baked-in credentials in the client anymore.
 */
export async function ensureDemoToken(): Promise<string | null> {
  return getToken();
}

/** Headers carrying the current JWT, if any. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * fetch() wrapper that attaches `Authorization: Bearer` when a JWT is held.
 * Preserves caller-supplied headers and resolves the path against API_BASE.
 *
 * On a 401 the stale token is cleared and the 401 is returned to the caller —
 * the UI decides to re-prompt for login. (The old behavior silently logged in
 * as a demo account and retried, which masked every real auth failure.)
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const h = new Headers(init.headers ?? undefined);
  const token = getToken();
  if (token) h.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(input), { ...init, headers: h });
  if (res.status === 401) clearToken();
  return res;
}
