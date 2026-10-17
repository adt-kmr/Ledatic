export function LogoIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 4 C9 4 9 20 12 20 C15 20 15 4 20 4"
        stroke="var(--color-primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5 9 C8 9 9 15 12 15 C15 15 16 9 19 9"
        stroke="var(--color-accent-emerald)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />
      <path
        d="M7 13.5 C9 13.5 10 10.5 12 10.5 C14 10.5 15 13.5 17 13.5"
        stroke="#141313"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeOpacity="0.4"
      />
    </svg>
  );
}
