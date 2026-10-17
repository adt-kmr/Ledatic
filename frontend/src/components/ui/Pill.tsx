export function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        color,
        background: `color-mix(in oklch, ${color} 11%, transparent)`,
        padding: "3px 8px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 500,
        fontFamily: "'DM Mono', ui-monospace, monospace",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
