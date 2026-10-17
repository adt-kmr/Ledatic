import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink } from "lucide-react";
import DocsSidebar from "./DocsSidebar";
import DocsSearch from "./DocsSearch";
import TableOfContents from "./TableOfContents";
import type { DocSection } from "../../data/docs-content";
import { CitadelMark } from "../cc/CitadelMark";

interface DocsLayoutProps {
  children: React.ReactNode;
  sections: DocSection[];
  activeSection: string;
  onSectionClick: (sectionId: string) => void;
  tocItems: { id: string; title: string; level: number }[];
  activeTocId: string;
}

export default function DocsLayout({
  children,
  sections,
  activeSection,
  onSectionClick,
  tocItems,
  activeTocId,
}: DocsLayoutProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Global Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchNavigate = (sectionId: string) => {
    onSectionClick(sectionId);
    setIsSearchOpen(false);
  };

  return (
    <div className="relative min-h-screen bg-white">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderColor: "#EAE4E1" }}>
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-baseline gap-2 no-underline">
                <CitadelMark size={17} />
                <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 24, lineHeight: 1, color: "#100F0F", letterSpacing: "-0.02em" }}>Citadel</span>
                <span className="cc-mono ml-1 rounded-[6px] px-2 py-0.5 !text-[10px]" style={{ background: "#F7F3F1", color: "#575452" }}>Docs</span>
              </Link>
              <div className="hidden items-center gap-1 text-[14px] md:flex">
                <Link to="/" className="flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 no-underline transition-colors hover:bg-[#F7F3F1]" style={{ color: "#575452" }}>
                  <ArrowLeft className="h-4 w-4" /> Home
                </Link>
                <Link to="/admin" className="rounded-[6px] px-3 py-1.5 no-underline transition-colors hover:bg-[#F7F3F1]" style={{ color: "#575452" }}>
                  FIU console
                </Link>
              </div>
            </div>
            <Link to="/demo/bank" className="cc-btn cc-btn-orange">
              Launch demo <ExternalLink />
            </Link>
          </div>
        </div>
      </nav>

      {/* Main content area */}
      <div className="relative z-10 flex max-w-[1600px] mx-auto">
        {/* Sidebar */}
        <DocsSidebar
          sections={sections}
          activeSection={activeSection}
          onSectionClick={onSectionClick}
          onSearchClick={() => setIsSearchOpen(true)}
        />

        {/* Content */}
        <main className="min-w-0 flex-1 px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="max-w-[720px] mx-auto"
          >
            {children}
          </motion.div>
        </main>

        {/* Table of Contents */}
        <TableOfContents items={tocItems} activeId={activeTocId} />
      </div>

      {/* Search overlay */}
      <DocsSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={handleSearchNavigate}
      />
    </div>
  );
}