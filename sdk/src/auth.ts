// In-memory JWT holder for the standalone SDK package — mirrors
// frontend/src/lib/auth.ts so the SDK can attach Authorization headers
// to its /api/signals/ingest POSTs when a token has been set.

let authToken: string | null = null;

export function getToken(): string | null {
  return authToken;
}

export function setToken(token: string | null): void {
  authToken = token;
}

export function clearToken(): void {
  authToken = null;
}