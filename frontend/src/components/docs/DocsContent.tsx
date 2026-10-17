import { motion } from "framer-motion";
import {
  Info,
  AlertTriangle,
  Lightbulb,
  Layers,
  Server,
  Brain,
  Cpu,
  Database,
} from "lucide-react";
import CodeBlock from "./CodeBlock";
import type { DocBlock } from "../../data/docs-content";

interface DocsContentProps {
  blocks: DocBlock[];
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  layers: Layers,
  server: Server,
  brain: Brain,
  cpu: Cpu,
  database: Database,
};

function CalloutIcon({
  variant,
}: {
  variant: "info" | "warning" | "tip";
}) {
  switch (variant) {
    case "info":
      return <Info className="w-5 h-5 text-[#083241]" />;
    case "warning":
      return <AlertTriangle className="w-5 h-5 text-[#AA412A]" />;
    case "tip":
      return <Lightbulb className="w-5 h-5 text-[#3D6B3A]" />;
  }
}

function CalloutStyles(variant: "info" | "warning" | "tip") {
  switch (variant) {
    case "info":
      return {
        bg: "bg-[rgba(8,50,65,0.05)]",
        border: "border-[rgba(8,50,65,0.18)]",
      };
    case "warning":
      return {
        bg: "bg-[rgba(170,65,42,0.06)]",
        border: "border-[rgba(170,65,42,0.22)]",
      };
    case "tip":
      return {
        bg: "bg-[rgba(61,107,58,0.06)]",
        border: "border-[rgba(61,107,58,0.2)]",
      };
  }
}

export default function DocsContent({ blocks }: DocsContentProps) {
  return (
    <div className="space-y-6">
      {blocks.map((block, index) => {
        const animProps = {
          initial: { opacity: 0, y: 15 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-50px" },
          transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
        };

        switch (block.type) {
          case "paragraph":
            return (
              <motion.p
                key={index}
                {...animProps}
                className="text-[16px] leading-[1.7] text-[#575452]"
              >
                {block.text}
              </motion.p>
            );

          case "heading":
            if (block.level === 2) {
              return (
                <motion.h2
                  key={index}
                  {...animProps}
                  className="cc-serif text-[34px] leading-[1.1] text-[#100F0F] tracking-[-0.015em] mt-14 mb-4 pt-8 border-t border-[#EAE4E1] first:mt-0 first:pt-0 first:border-0"
                >
                  {block.text}
                </motion.h2>
              );
            }
            return (
              <motion.h3
                key={index}
                {...animProps}
                className="cc-serif text-[24px] leading-[1.15] text-[#100F0F] tracking-[-0.01em] mt-10 mb-3"
              >
                {block.text}
              </motion.h3>
            );

          case "code":
            return (
              <motion.div key={index} {...animProps}>
                <CodeBlock
                  code={block.code}
                  language={block.language}
                  filename={block.filename}
                />
              </motion.div>
            );

          case "list":
            return (
              <motion.ul
                key={index}
                {...animProps}
                className="space-y-2 pl-1"
              >
                {block.items.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 text-[16px] text-[#575452]"
                  >
                    <span className="mt-[10px] h-[2px] w-3 flex-shrink-0 bg-[#AA412A]" />
                    <span className="leading-[1.6]">{item}</span>
                  </li>
                ))}
              </motion.ul>
            );

          case "callout": {
            const styles = CalloutStyles(block.variant);
            return (
              <motion.div
                key={index}
                {...animProps}
                className={`flex gap-4 p-5 rounded-[12px] border ${styles.bg} ${styles.border}`}
              >
                <CalloutIcon variant={block.variant} />
                <p className="text-[15px] leading-[1.6] text-[#2A2726] flex-1">
                  {block.text}
                </p>
              </motion.div>
            );
          }

          case "card": {
            const Icon = iconMap[block.icon] || Layers;
            return (
              <motion.div
                key={index}
                {...animProps}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="glass-card p-5 group relative overflow-hidden"
              >
                                <div className="relative z-10 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-[10px] bg-[#F7F3F1] flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-[var(--color-primary)]" />
                  </div>
                  <div>
                    <h4 className="cc-serif text-[20px] text-[#100F0F] mb-1">
                      {block.title}
                    </h4>
                    <p className="text-[14px] text-[#575452] leading-[1.6]">
                      {block.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}