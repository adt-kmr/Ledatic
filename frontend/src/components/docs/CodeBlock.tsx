import { motion } from "framer-motion";
import { Code, Copy, Check } from "lucide-react";
import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language: string;
  filename?: string;
}

// Simple syntax highlighting
function highlightSyntax(code: string, language: string): string {
  // Keywords by language
  const keywords: Record<string, string[]> = {
    typescript: [
      "import",
      "export",
      "from",
      "const",
      "let",
      "var",
      "function",
      "return",
      "if",
      "else",
      "for",
      "while",
      "class",
      "interface",
      "type",
      "async",
      "await",
      "new",
      "this",
      "true",
      "false",
      "null",
      "undefined",
    ],
    javascript: [
      "import",
      "export",
      "from",
      "const",
      "let",
      "var",
      "function",
      "return",
      "if",
      "else",
      "for",
      "while",
      "class",
      "async",
      "await",
      "new",
      "this",
      "true",
      "false",
      "null",
      "undefined",
    ],
    python: [
      "import",
      "from",
      "def",
      "class",
      "return",
      "if",
      "else",
      "elif",
      "for",
      "while",
      "True",
      "False",
      "None",
      "and",
      "or",
      "not",
      "in",
      "is",
    ],
    bash: ["if", "then", "else", "fi", "for", "do", "done", "echo", "export"],
    html: ["DOCTYPE", "html", "head", "body", "script", "div", "span"],
    http: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  };

  const langKeywords = keywords[language] || keywords.typescript;

  // Escape HTML first
  let highlighted = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Single pass: each token is wrapped once, so later rules can never match
  // inside markup an earlier rule inserted (e.g. the "#" in a style attr).
  const kw = new Set(langKeywords);
  const token =
    /(\/\/.*$|(?:^|\s)#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+\.?\d*)\b|\b([a-zA-Z_]\w*)(?=\s*\()|\b([a-zA-Z_]\w*)\b/gm;
  const wrap = (cls: string, s: string) => `<span class="${cls}">${s}</span>`;
  highlighted = highlighted.replace(token, (m, comment, str, num, fn, word) => {
    if (comment) return wrap("docs-code-comment", m);
    if (str) return wrap("docs-code-string", m);
    if (num) return wrap("docs-code-number", m);
    if (fn) return kw.has(fn) ? wrap("docs-code-keyword", m) : wrap("docs-code-function", m);
    if (word && kw.has(word)) return wrap("docs-code-keyword", m);
    return m;
  });

  return highlighted;
}

export default function CodeBlock({
  code,
  language,
  filename,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split("\n");
  const highlightedCode = highlightSyntax(code, language);

  return (
    <motion.div
      className="glass-panel overflow-hidden w-full my-6 relative"
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />

      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(16,15,15,0.1)] bg-[#FAFAFA]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#C9C5C2]" />
          <div className="w-3 h-3 rounded-full bg-[#C9C5C2]" />
          <div className="w-3 h-3 rounded-full bg-[#C9C5C2]" />
        </div>
        <div className="flex items-center gap-2">
          {filename && (
            <>
              <Code className="w-3 h-3 text-[#544F4C]" />
              <span className="font-mono text-xs text-[#544F4C]">
                {filename}
              </span>
            </>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono text-[#544F4C] hover:text-[#141313] hover:bg-[rgba(16,15,15,0.05)] transition-all"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#22c55e]" />
              <span className="text-[#22c55e]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Editor */}
      <div className="p-6 overflow-x-auto bg-[#F7F3F1] relative">
        {/* Line numbers */}
        <div className="absolute top-0 left-0 w-8 h-full bg-[#FAFAFA] border-r border-[rgba(16,15,15,0.05)] flex flex-col items-center py-6 text-[#A9A5A2] font-mono text-xs gap-[6px]">
          {lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>

        {/* Code content */}
        <pre className="font-mono text-[13px] leading-[1.6] text-[#343333] pl-6">
          <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
        </pre>
      </div>
    </motion.div>
  );
}