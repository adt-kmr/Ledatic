import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface TOCItem {
  id: string;
  title: string;
  level: number;
}

interface TableOfContentsProps {
  items: TOCItem[];
  activeId: string;
}

export default function TableOfContents({
  items,
  activeId,
}: TableOfContentsProps) {
  const [visible, setVisible] = useState(true);

  // Hide TOC on smaller screens
  useEffect(() => {
    const handleResize = () => {
      setVisible(window.innerWidth >= 1280);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!visible || items.length === 0) {
    return null;
  }

  return (
    <motion.aside
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="hidden xl:block sticky top-24 w-[200px] flex-shrink-0"
    >
      <div className="pl-6 border-l border-[rgba(16,15,15,0.1)]">
        <div className="text-xs font-semibold text-[#544F4C] uppercase tracking-wider mb-4">
          On this page
        </div>
        <nav className="space-y-1">
          {items.map((item) => {
            const isActive = activeId === item.id;

            return (
              <motion.a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const element = document.getElementById(item.id);
                  if (element) {
                    element.scrollIntoView({ behavior: "smooth" });
                  }
                }}
                className={`
                  block py-1.5 text-sm transition-colors relative
                  ${
                    isActive
                      ? "text-[var(--color-primary)]"
                      : "text-[rgba(16,15,15,0.35)] hover:text-[rgba(16,15,15,0.7)]"
                  }
                `}
                style={{
                  paddingLeft: item.level === 3 ? "16px" : "0",
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="tocIndicator"
                    className="absolute left-[-25px] top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[var(--color-primary)]"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                {item.title}
              </motion.a>
            );
          })}
        </nav>
      </div>
    </motion.aside>
  );
}

// Hook to track active TOC item based on scroll position
export function useActiveTOCItem(items: TOCItem[]): string {
  const [activeId, setActiveId] = useState<string>(items[0]?.id || "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      {
        rootMargin: "-80px 0px -80% 0px",
        threshold: 0,
      }
    );

    items.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [items]);

  return activeId;
}