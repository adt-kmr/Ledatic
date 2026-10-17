import { motion } from "framer-motion";

export function GlassButton({
  children,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <motion.button
      whileHover={{ scale: p.disabled ? 1 : 1.01 }}
      whileTap={{ scale: p.disabled ? 1 : 0.98 }}
      {...(p as React.ComponentProps<typeof motion.button>)}
      style={{
        padding: "11px 18px",
        borderRadius: 12,
        border: "none",
        background: "var(--color-primary)",
        color: "var(--color-on-primary)",
        fontWeight: 700,
        fontSize: 14,
        fontFamily: "'Inter', sans-serif",
        cursor: p.disabled ? "default" : "pointer",
        opacity: p.disabled ? 0.5 : 1,
        boxShadow:
          "0 4px 16px color-mix(in oklch, var(--color-primary) 30%, transparent)",
        ...(p.style || {}),
      }}
    >
      {children}
    </motion.button>
  );
}
