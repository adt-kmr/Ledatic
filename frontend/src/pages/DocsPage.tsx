import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import DocsLayout from "../components/docs/DocsLayout";
import DocsContent from "../components/docs/DocsContent";
import {
  docSections,
  getSectionById,
  type DocSection,
} from "../data/docs-content";
import { useActiveTOCItem } from "../components/docs/TableOfContents";

// Extract TOC items from section content
function extractTOCItems(section: DocSection): { id: string; title: string; level: number }[] {
  const items: { id: string; title: string; level: number }[] = [];

  section.subsections.forEach((sub) => {
    items.push({ id: sub.id, title: sub.title, level: 2 });

    sub.content.forEach((block) => {
      if (block.type === "heading") {
        items.push({
          id: `${sub.id}-${block.text.toLowerCase().replace(/\s+/g, "-")}`,
          title: block.text,
          level: block.level,
        });
      }
    });
  });

  return items;
}

export default function DocsPage() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<string>(
    sectionId || docSections[0]?.id || "getting-started"
  );

  // Get current section
  const currentSection = useMemo(
    () => getSectionById(activeSection) || docSections[0],
    [activeSection]
  );

  // Extract TOC items for current section
  const tocItems = useMemo(
    () => (currentSection ? extractTOCItems(currentSection) : []),
    [currentSection]
  );

  // Track active TOC item
  const activeTocId = useActiveTOCItem(tocItems);

  // Handle section change from URL params
  useEffect(() => {
    if (sectionId && getSectionById(sectionId)) {
      setActiveSection(sectionId);
    }
  }, [sectionId]);

  // Scroll to top when section changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeSection]);

  const handleSectionClick = (sectionId: string) => {
    setActiveSection(sectionId);
    navigate(`/doc/${sectionId}`, { replace: true });
  };

  // Render section content
  const renderSectionContent = () => {
    if (!currentSection) return null;

    return (
      <div>
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[rgba(16,15,15,0.06)] flex items-center justify-center">
              <currentSection.icon className="w-5 h-5 text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="cc-serif text-[clamp(38px,4vw,56px)] leading-[1.02] text-[#100F0F] tracking-[-0.02em]">
                {currentSection.title}
              </h1>
              <p className="text-sm text-[#544F4C] mt-1">
                {currentSection.description}
              </p>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-[var(--color-primary)]/20 via-[rgba(16,15,15,0.1)] to-transparent" />
        </motion.div>

        {/* Subsections */}
        {currentSection.subsections.map((sub) => (
          <motion.section
            key={sub.id}
            id={sub.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5 }}
            className="mb-16 scroll-mt-24"
          >
            <DocsContent blocks={sub.content} />
          </motion.section>
        ))}
      </div>
    );
  };

  return (
    <DocsLayout
      sections={docSections}
      activeSection={activeSection}
      onSectionClick={handleSectionClick}
      tocItems={tocItems}
      activeTocId={activeTocId}
    >
      {renderSectionContent()}
    </DocsLayout>
  );
}