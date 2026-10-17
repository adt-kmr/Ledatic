/** Citadel mark — outlined keep with an arched gate. Matches /favicon.svg. */
export function CitadelMark({ size = 22, color = "#100F0F" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="5.4 6.7 21.2 20.8" fill="none" aria-hidden style={{ flexShrink: 0, display: "block" }}>
      <path d="M7 27V12h3V7.5h3V12h2V7.5h2V12h2V7.5h3V12h3v15H7Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13.5 27v-5.2a2.5 2.5 0 0 1 5 0V27" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}
