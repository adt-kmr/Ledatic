import { motion } from "framer-motion";
import { Search, Menu, X } from "lucide-react";
import { useState } from "react";
import type { DocSection } from "../../data/docs-content";

interface DocsSidebarProps {
  sections: DocSection[];
  activeSection: string;
  onSectionClick: (sectionId: string) => void;
  onSearchClick: () => void;
}

export default function DocsSidebar({
  sections,
  activeSection,
  onSectionClick,
  onSearchClick,
}: DocsSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSectionClick = (sectionId: string) => {
    onSectionClick(sectionId);
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="lg:hidden fixed top-20 left-4 z-50 p-2 rounded-lg bg-white border border-[#EAE4E1] text-[#100F0F] hover:bg-[#F7F3F1] transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        className={`
          fixed lg:sticky top-0 lg:top-16 left-0 h-screen lg:h-[calc(100vh-64px)]
          w-[288px] lg:w-[272px] z-50 lg:z-auto
          bg-white lg:bg-[#FBF9F8]
          border-r border-[#EAE4E1]
          flex flex-col
          transform lg:transform-none transition-transform duration-300
          ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
        initial={false}
      >
        {/* Mobile close button */}
        <div className="lg:hidden flex items-center justify-between p-4 border-b border-[rgba(16,15,15,0.1)]">
          <span className="font-outfit font-semibold text-[#141313]">
            Navigation
          </span>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-md hover:bg-[rgba(16,15,15,0.1)] transition-colors"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5 text-[#544F4C]" />
          </button>
        </div>

        {/* Search button */}
        <div className="p-4">
          <button
            onClick={onSearchClick}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] bg-white border border-[#EAE4E1] text-[#767270] hover:text-[#100F0F] hover:border-[#D7D2D0] transition-all text-sm text-left"
          >
            <Search className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">Search docs...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono bg-[#F7F3F1] border border-[#EAE4E1] text-[#767270]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Navigation sections */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <div className="space-y-1">
            {sections.map((section, index) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;

              return (
                <motion.button
                  key={section.id}
                  onClick={() => handleSectionClick(section.id)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.3 }}
                  className={`
                    relative w-full flex items-start gap-3 px-3 py-2.5 rounded-[8px] text-left transition-colors
                    ${
                      isActive
                        ? "bg-white text-[#100F0F] shadow-[0_1px_2px_rgba(16,15,15,0.06)]"
                        : "text-[#575452] hover:text-[#100F0F] hover:bg-white/70"
                    }
                  `}
                  aria-current={isActive ? "page" : undefined}
                >
                  {isActive && <motion.span layoutId="docs-nav-bar" className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r bg-[#AA412A]" />}
                  <Icon
                    className={`mt-0.5 w-4 h-4 flex-shrink-0 ${
                      isActive ? "text-[#AA412A]" : "text-[#969290]"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {section.title}
                    </div>
                    <div className="text-xs text-[#969290] truncate mt-0.5">
                      {section.description}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-[#EAE4E1]">
          <div className="cc-mono !text-[10px] text-[#969290]">
            Citadel docs · v1.0
          </div>
        </div>
      </motion.aside>
    </>
  );
}