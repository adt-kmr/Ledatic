// Admin/analyst session for the FIU fraud-ops panel.
//
// Kept SEPARATE from the customer session (different localStorage keys) so an
// analyst can be signed into the panel independently of any customer demo
// login. Admin tokens are short-lived server-side (jwt_admin_expire_minutes);
// we mirror the same expiry-aware rehydration used for customer tokens.
import { apiUrl } from "../lib/auth";

const TOKEN_KEY = "citadel.admin.token";
const ROLE_KEY = "citadel.admin.role";
const NAME_KEY = "citadel.admin.name";
// Drop any session persisted under the pre-rebrand keys.
try {
  ["bdna.admin.token", "bdna.admin.role", "bdna.admin.name"].forEach((k) =>
    localStorage.removeItem(k),
  );
} catch { /* ignore */ }

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

function loadToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return null;
    if (isExpired(t)) { clearAdminSession(); return null; }
    return t;
  } catch {
    return null;
  }
}

let adminToken: string | null = loadToken();
let adminRole: string | null = (() => { try { return localStorage.getItem(ROLE_KEY); } catch { return null; } })();
let adminName: string | null = (() => { try { return localStorage.getItem(NAME_KEY); } catch { return null; } })();

export function getAdminToken(): string | null {
  if (adminToken && isExpired(adminToken)) clearAdminSession();
  return adminToken;
}

export function isAdminLoggedIn(): boolean {
  return getAdminToken() !== null;
}

export function getAdminRole(): string | null {
  return getAdminToken() ? adminRole : null;
}

export function getAdminName(): string | null {
  return getAdminToken() ? adminName : null;
}

export function clearAdminSession(): void {
  adminToken = adminRole = adminName = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(NAME_KEY);
  } catch { /* ignore */ }
}

export interface AdminLoginResult { role: string; name: string; bank_id: string; }

/**
 * Authenticate against /api/admin/login and persist the short-lived token.
 *
 * There is deliberately NO offline/demo fallback: a failed or unreachable
 * backend surfaces as a thrown error so the operator sees the real state of
 * the system instead of a silently fake session.
 */
export async function adminLogin(adminId: string, password: string): Promise<AdminLoginResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_id: adminId, password }),
    });
  } catch {
    throw new Error("Cannot reach the authentication service — is the backend running?");
  }
  if (res.status === 401) throw new Error("Invalid operator ID or password");
  if (res.status === 429) throw new Error("Too many attempts — wait a minute, then try again");
  if (res.status >= 500) throw new Error("The server hit an error — try again in a moment");
  if (!res.ok) throw new Error(`Sign-in failed (${res.status} ${res.statusText || "unexpected response"})`);
  const data = await res.json();
  adminToken = data.access_token;
  adminRole = data.role;
  adminName = data.name;
  try {
    localStorage.setItem(TOKEN_KEY, adminToken!);
    localStorage.setItem(ROLE_KEY, adminRole!);
    localStorage.setItem(NAME_KEY, adminName!);
  } catch { /* storage unavailable — keep in-memory */ }
  return { role: data.role, name: data.name, bank_id: data.bank_id };
}

/** fetch() wrapper that attaches the admin Bearer token. Throws on 401/403. */
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? undefined);
  const token = getAdminToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (res.status === 401) { clearAdminSession(); throw new Error("Session expired — please sign in again"); }
  return res;
}

/**
 * Liveness probe for the API. Free-tier hosts sleep when idle and can take up
 * to a minute to wake, so the login screen pings /health while the operator
 * types instead of letting the first sign-in time out. A same-origin dev
 * server answers /health with the SPA shell, hence the JSON check.
 */
export async function pingBackend(timeoutMs = 8000): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl("/health"), { signal: ctl.signal, cache: "no-store" });
    return res.ok && (res.headers.get("content-type") ?? "").includes("json");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Poll /health until the API answers, `cancelled()` flips, or `maxMs` passes. */
export async function waitForBackend(cancelled: () => boolean, maxMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (!cancelled() && Date.now() < deadline) {
    if (await pingBackend(6000)) return true;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}
