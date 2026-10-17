import { animate, motion, useInView } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const EASE = [0.16, 1, 0.3, 1] as const;

/* Reveals on entering the viewport — and also when it's already been
   scrolled past (anchor jumps / fast scrolls), so nothing stays hidden. */
export function Reveal({ children, delay = 0, className = "", y = 24 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (el.getBoundingClientRect().top < window.innerHeight - 40) {
        setShown(true);
        window.removeEventListener("scroll", check);
        window.removeEventListener("resize", check);
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, []);
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={shown ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.75, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

export function CountUp({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const ctl = animate(0, to, { duration: 1.8, ease: EASE, onUpdate: setV });
    return () => ctl.stop();
  }, [inView, to]);
  return <span ref={ref}>{prefix}{v.toFixed(decimals)}{suffix}</span>;
}

/* Concurrence-style numbered tab list with a sliding left bar. */
export function NumberedTabs({ items, active, onChange, light, id }: { items: { n: string; t: string }[]; active: number; onChange: (i: number) => void; light?: boolean; id: string }) {
  return (
    <div className="flex flex-col">
      {items.map((it, k) => (
        <button key={it.n} onClick={() => onChange(k)}
          className="cc-mono relative flex items-center gap-6 py-2 pl-[17px] text-left !text-[13px]"
          style={{ color: light ? (k === active ? "#fff" : "rgba(255,255,255,.6)") : (k === active ? "#100F0F" : "rgba(0,0,0,.5)"), transition: "color .25s" }}>
          {k === active && (
            <motion.span layoutId={`tab-bar-${id}`} className="absolute left-0 top-0 h-full w-[4px]"
              style={{ background: light ? "#fff" : "#100F0F" }} transition={{ duration: 0.4, ease: EASE }} />
          )}
          <span>{it.n}</span><span>{it.t}</span>
        </button>
      ))}
    </div>
  );
}
