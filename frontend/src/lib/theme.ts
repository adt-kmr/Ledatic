// Citadel — design tokens (dark security console)
// Near-black canvas, steel-gray neutrals, one electric-lime accent, semantic
// status colors only (green = approve, amber = step-up, rose = hard block).
// Type: Newsreader (display serif) + Inter (UI) + Fragment Mono (data).

export const C = {
  bgBase: 'var(--color-canvas)',
  bgSurface: 'var(--color-surface-soft)',
  bgCard: 'var(--color-surface-card)',
  border: 'var(--color-hairline)',
  borderHover: 'var(--color-hairline-strong)',
  blue: 'var(--color-accent-blue)',
  violet: '#544F4C',
  teal: 'var(--color-primary-active)',
  green: 'var(--color-accent-emerald)',
  amber: 'oklch(0.75 0.15 70)',
  red: 'var(--color-accent-rose)',
  textPrimary: 'var(--color-ink)',
  textMuted: 'var(--color-muted)',
  mono: "'DM Mono', 'DM Mono', ui-monospace, monospace",
} as const

export const decisionColor: Record<string, string> = {
  APPROVE: C.green,
  STEP_UP: C.amber,
  HARD_BLOCK: C.red,
}

// Light "paper" card — soft shadow, hairline border, no harsh glow.
export const glassCard = {
  background: 'rgba(235, 230, 227, 0.6)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  borderRadius: 24,
  border: '1px solid rgba(16, 15, 15, 0.1)',
  boxShadow: '0 32px 64px -16px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255,255,255,0.15)',
  padding: '24px 28px',
  transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
}

// Subtle emerald-tinted card for positive/passport sections.
export const tealGlassCard = {
  background: 'rgba(100, 210, 255, 0.05)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  borderRadius: 24,
  border: '1px solid rgba(100, 210, 255, 0.2)',
  boxShadow: '0 32px 64px -16px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(100, 210, 255, 0.15)',
  padding: '24px 28px',
  transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
}