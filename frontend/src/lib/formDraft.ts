// Persisted form drafts.
//
// The sign-up panel is unmounted the moment the customer flips to the "Sign in"
// tab (AnimatePresence swaps the two panels), so everything typed so far used
// to be gone on the way back. Each field mirrors itself into a single
// localStorage entry per form and re-reads it on mount; the draft is dropped
// once the account actually exists.
//
// Demo scope: drafts hold passwords and PINs in plaintext, consistent with how
// the rest of this demo already keeps `pass_*` / `normal_pin_*` in
// localStorage. A real deployment would keep secrets out of the draft.

import { useState, useEffect } from "react";

export const SIGNUP_DRAFT = "zippay.signup_draft";
export const LOGIN_DRAFT = "zippay.login_draft";

/** The whole draft object for a form, or `{}` if absent/unreadable. */
export function readDraft(store: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(store) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // storage unavailable (privacy mode) or corrupt JSON → start clean
  }
}

/** Merge one field into the stored draft, leaving the other fields alone. */
export function writeDraftField(store: string, field: string, value: unknown): void {
  try {
    localStorage.setItem(store, JSON.stringify({ ...readDraft(store), [field]: value }));
  } catch { /* storage full/unavailable — the form still works in memory */ }
}

export function clearDraft(store: string): void {
  try { localStorage.removeItem(store); } catch { /* ignore */ }
}

/** useState whose value survives unmount by living in the `store` draft. */
export function useDraftState<T>(store: string, field: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const saved = readDraft(store)[field];
    return saved === undefined ? initial : (saved as T);
  });
  useEffect(() => { writeDraftField(store, field, value); }, [store, field, value]);
  return [value, setValue] as const;
}
