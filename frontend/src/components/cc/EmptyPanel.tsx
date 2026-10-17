import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { ComponentType } from "react";

/** Empty state for console panels: tells the operator how data will arrive. */
export function EmptyPanel({
  icon: Icon,
  title,
  body,
  cta,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  body: string;
  cta?: { label: string; to: string };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card"
      style={{ padding: "56px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}
    >
      <div style={{ position: "relative", width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <motion.span
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeOut" }}
          style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(170,65,42,0.12)" }}
        />
        <span style={{ position: "relative", width: 52, height: 52, borderRadius: "50%", background: "#F7F3F1", display: "flex", alignItems: "center", justifyContent: "center", color: "#AA412A" }}>
          <Icon size={22} strokeWidth={1.6} />
        </span>
      </div>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 26, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.1 }}>{title}</div>
      <p style={{ margin: 0, maxWidth: 440, fontSize: 14.5, lineHeight: 1.55, color: "#575452" }}>{body}</p>
      {cta && (
        <Link to={cta.to} className="cc-btn cc-btn-orange" style={{ marginTop: 6 }}>
          {cta.label} <ArrowRight />
        </Link>
      )}
    </motion.div>
  );
}
