import { motion, AnimatePresence } from "framer-motion";
import { Search, ArrowRight, Command } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { searchDocs, type DocSection } from "../../data/docs-content";

interface DocsSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (sectionId: string) => void;
}

export default function DocsSearch({
  isOpen,
  onClose,
  onNavigate,
}: DocsSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocSection[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter results based on query
  useEffect(() => {
    if (query.trim()) {
      const filtered = searchDocs(query);
      setResults(filtered);
      setSelectedIndex(0);
    } else {
      setResults([]);
    }
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            onNavigate(results[selectedIndex].id);
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, results, selectedIndex, onNavigate, onClose]);

  // Global Cmd+K listener
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // This will be handled by parent
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Search panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-[560px] mx-4 bg-[rgba(255,255,255,0.98)] backdrop-blur-2xl rounded-2xl border border-[rgba(16,15,15,0.1)] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-4 border-b border-[rgba(16,15,15,0.1)]">
              <Search className="w-5 h-5 text-[#544F4C] flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documentation..."
                className="flex-1 bg-transparent text-[#141313] placeholder-[#A9A5A2] font-inter text-base outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="hidden sm:flex items-center gap-0.5 px-2 py-1 rounded text-xs font-mono text-[#544F4C] bg-[rgba(16,15,15,0.06)] border border-[rgba(16,15,15,0.1)]">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[400px] overflow-y-auto">
              {query.trim() && results.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <div className="text-[#544F4C] text-sm">
                    No results found for "{query}"
                  </div>
                  <div className="text-[#A9A5A2] text-xs mt-1">
                    Try different keywords
                  </div>
                </div>
              )}

              {results.length > 0 && (
                <div className="py-2">
                  {results.map((section, index) => {
                    const Icon = section.icon;
                    const isSelected = index === selectedIndex;

                    return (
                      <button
                        key={section.id}
                        onClick={() => {
                          onNavigate(section.id);
                          onClose();
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`
                          w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                          ${
                            isSelected
                              ? "bg-[rgba(16,15,15,0.08)]"
                              : "hover:bg-[rgba(16,15,15,0.04)]"
                          }
                        `}
                      >
                        <div
                          className={`
                            w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                            ${
                              isSelected
                                ? "bg-[var(--color-primary)]/20"
                                : "bg-[rgba(16,15,15,0.06)]"
                            }
                          `}
                        >
                          <Icon
                            className={`w-4 h-4 ${
                              isSelected
                                ? "text-[var(--color-primary)]"
                                : "text-[#544F4C]"
                            }`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className={`font-medium text-sm truncate ${
                              isSelected ? "text-[#141313]" : "text-[#544F4C]"
                            }`}
                          >
                            {section.title}
                          </div>
                          <div className="text-xs text-[#A9A5A2] truncate mt-0.5">
                            {section.description}
                          </div>
                        </div>
                        <ArrowRight
                          className={`w-4 h-4 flex-shrink-0 transition-opacity ${
                            isSelected ? "opacity-100" : "opacity-0"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}

              {!query.trim() && (
                <div className="px-4 py-6 text-center">
                  <div className="text-[#A9A5A2] text-sm">
                    Start typing to search documentation
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-3 text-xs text-[#A9A5A2]">
                    <kbd className="px-1.5 py-0.5 rounded bg-[rgba(16,15,15,0.06)] border border-[rgba(16,15,15,0.1)]">
                      ↑↓
                    </kbd>
                    <span>to navigate</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-[rgba(16,15,15,0.06)] border border-[rgba(16,15,15,0.1)]">
                      ↵
                    </kbd>
                    <span>to select</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-[rgba(16,15,15,0.1)] flex items-center justify-between text-xs text-[#A9A5A2]">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Command className="w-3 h-3" /> K
                </span>
                <span>to toggle</span>
              </div>
              <div className="flex items-center gap-4">
                <span>↑↓ navigate</span>
                <span>↵ select</span>
                <span>esc close</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}