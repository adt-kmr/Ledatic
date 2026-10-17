import { useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandRoot,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "cmdk";
import { useBticStore } from "../../stores/bticStore";
import {
  LayoutDashboard,
  Map,
  Target,
  Network,
  Search,
  BarChart3,
  Settings,
  Cpu,
  Shield,
  AlertTriangle,
  Users,
  Radio,
  ExternalLink,
  Command as CommandIcon,
} from "lucide-react";

// ── Command groups ─────────────────────────────────────────────────────────
interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: React.ReactNode;
  section: string;
  action: () => void;
  keywords: string[];
}

// ── Layer shortcut definitions ─────────────────────────────────────────────
// Alt+1-5 toggle map layers globally (even when palette is closed)
const LAYER_SHORTCUTS: { key: string; layer: string; label: string }[] = [
  { key: "1", layer: "identity_confidence", label: "Identity Confidence" },
  { key: "2", layer: "sim_swap", label: "SIM Swap" },
  { key: "3", layer: "credential_theft", label: "Credential Theft" },
  { key: "4", layer: "money_mule", label: "Money Mule" },
  { key: "5", layer: "behavior_drift", label: "Behavior Drift" },
];

export function CommandPalette() {
  const navigate = useNavigate();
  const isOpen = useBticStore((s) => s.commandPaletteOpen);
  const setOpen = useBticStore((s) => s.setCommandPaletteOpen);
  const setMapLayer = useBticStore((s) => s.toggleMapLayer);
  const toggleGlobeView = useBticStore((s) => s.toggleGlobeView);
  const feedEvents = useBticStore((s) => s.feedEvents);

  // ── Keyboard shortcut ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K — open palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(!isOpen);
        return;
      }
      // Escape — close palette
      if (e.key === "Escape" && isOpen) {
        setOpen(false);
        return;
      }
      // Alt+1-5 — toggle layer, Alt+G — toggle globe (palette closed, no input focused)
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || isOpen) return;

        if (e.key === "g") {
          e.preventDefault();
          toggleGlobeView();
          return;
        }
        if (e.key === "f") {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("btic:fitBounds"));
          return;
        }
        if (e.key === "r") {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("btic:resetView"));
          return;
        }
        const match = LAYER_SHORTCUTS.find((s) => s.key === e.key);
        if (match) {
          e.preventDefault();
          setMapLayer(match.layer as any);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, setOpen, setMapLayer, toggleGlobeView]);

  // ── Build command list ─────────────────────────────────────────────────
  const commands = useMemo<PaletteCommand[]>(() => {
    if (!isOpen) return [];
    const nav = (label: string, path: string, icon: React.ReactNode, keywords: string[]) =>
      ({
        id: `nav-${path}`,
        label,
        icon,
        section: "Navigation",
        action: () => { navigate(path); setOpen(false); },
        keywords,
      });

    return [
      // Navigation
      nav("Home", "/admin", <LayoutDashboard size={15} />, ["home", "overview", "dashboard"]),
      nav("Threat Intel", "/admin/threats", <Map size={15} />, ["map", "spatial", "intelligence", "threat"]),
      nav("Campaigns", "/admin/campaigns", <Target size={15} />, ["campaign", "fraud", "ring"]),
      nav("Mind Map", "/admin/graph", <Network size={15} />, ["mind map", "graph", "identity", "node", "edge"]),
      nav("Investigation", "/admin/investigate", <Search size={15} />, ["investigate", "search", "lookup"]),
      nav("Analytics", "/admin/analytics", <BarChart3 size={15} />, ["analytics", "chart", "trend"]),
      nav("IBM Z trust", "/admin/ibm-z", <Cpu size={15} />, ["ibm", "linuxone", "quantum", "crypto", "hsm"]),
      nav("Settings", "/admin/settings", <Settings size={15} />, ["settings", "config", "threshold"]),

      // Map layers (with Alt+1-5 shortcuts)
      ...LAYER_SHORTCUTS.map((l) => ({
        id: `layer-${l.layer}`,
        label: `Toggle: ${l.label}`,
        shortcut: `⌥${l.key}`,
        icon: <Radio size={15} />,
        section: "Map Layers",
        action: () => { setMapLayer(l.layer as any); setOpen(false); },
        keywords: [l.label.toLowerCase().split(" ")[0], l.label.toLowerCase().split(" ").slice(1).join(" "), "layer"],
      })),

      // Globe toggle
      {
        id: "toggle-globe",
        label: "Toggle 3D Globe View",
        shortcut: "⌥G",
        icon: <Map size={15} />,
        section: "Map Layers",
        action: () => { toggleGlobeView(); setOpen(false); },
        keywords: ["globe", "3d", "sphere", "earth", "projection"],
      },

      // Zoom to fit
      {
        id: "fit-bounds",
        label: "Zoom to Fit All Threats",
        shortcut: "⌥F",
        icon: <Radio size={15} />,
        section: "Map Layers",
        action: () => { window.dispatchEvent(new CustomEvent("btic:fitBounds")); setOpen(false); },
        keywords: ["zoom", "fit", "bounds", "all", "overview"],
      },

      // Reset view
      {
        id: "reset-view",
        label: "Reset Map View",
        shortcut: "⌥R",
        icon: <Radio size={15} />,
        section: "Map Layers",
        action: () => { window.dispatchEvent(new CustomEvent("btic:resetView")); setOpen(false); },
        keywords: ["reset", "view", "default", "center", "zoom"],
      },

      // Quick actions
      {
        id: "action-investigate",
        label: "Investigate Threat...",
        hint: "Search by hash or session",
        icon: <Shield size={15} />,
        section: "Quick Actions",
        action: () => { navigate("/admin/investigate"); setOpen(false); },
        keywords: ["investigate", "threat", "search"],
      },
      {
        id: "action-graph",
        label: "View Mind Map",
        hint: "Open fraud mind map explorer",
        icon: <Network size={15} />,
        section: "Quick Actions",
        action: () => { navigate("/admin/graph"); setOpen(false); },
        keywords: ["graph", "identity", "fraud"],
      },
      {
        id: "action-campaign",
        label: "View Active Campaigns",
        hint: "Campaign intelligence",
        icon: <Target size={15} />,
        section: "Quick Actions",
        action: () => { navigate("/admin/campaigns"); setOpen(false); },
        keywords: ["campaign", "active", "intelligence"],
      },

      // Recent events (last 5 from feed)
      ...feedEvents.slice(0, 5).map((e) => ({
        id: `event-${e.id}`,
        label: `${e.type.replace(/_/g, " ")} — ${e.location.city}`,
        hint: `${e.severity} · ${e.decision.replace(/_/g, " ")}`,
        icon: <AlertTriangle size={15} style={{ color: e.severity === "CRITICAL" ? "#B3261E" : e.severity === "HIGH" ? "#B7791F" : "#2C7A91" }} />,
        section: "Recent Events",
        action: () => {
          navigate("/admin/investigate", { state: { customerHash: e.customerHash } });
          setOpen(false);
        },
        keywords: [e.type.toLowerCase(), e.location.city.toLowerCase(), e.location.state.toLowerCase(), e.customerHash],
      })),
    ];
  }, [isOpen, navigate, setOpen, setMapLayer, toggleGlobeView, feedEvents]);

  // ── Filter logic ───────────────────────────────────────────────────────
  const filter = useCallback((value: string, search: string) => {
    // Match against label, hint, and keywords
    const item = commands.find((c) => c.id === value);
    if (!item) return 0;
    const q = search.toLowerCase();
    if (item.label.toLowerCase().includes(q)) return 1;
    if (item.hint?.toLowerCase().includes(q)) return 0.8;
    if (item.keywords.some((k) => k.includes(q))) return 0.6;
    return 0;
  }, [commands]);

  // Group commands by section
  const grouped = useMemo(() => {
    const groups: Record<string, PaletteCommand[]> = {};
    for (const cmd of commands) {
      if (!groups[cmd.section]) groups[cmd.section] = [];
      groups[cmd.section].push(cmd);
    }
    return groups;
  }, [commands]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255, 255, 255,0.6)",
          backdropFilter: "blur(8px)",
        }}
      />

      {/* Palette */}
      <CommandRoot
        loop
        filter={filter}
        style={{
          position: "relative",
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: 440,
          background: "rgba(240, 240, 240,0.95)",
          backdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid #D7D2D0",
          borderRadius: 16,
          boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)",
          overflow: "hidden",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid #EAE4E1",
          }}
        >
          <Search size={16} style={{ color: "#969290", flexShrink: 0 }} />
          <CommandInput
            autoFocus
            placeholder="Search pages, actions, events..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#100F0F",
              fontSize: 14,
              fontFamily: "'Inter', sans-serif",
            }}
          />
          <kbd
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid #D7D2D0",
              color: "#969290",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
<CommandList
            style={{
              maxHeight: 360,
              overflowY: "auto",
              padding: "6px 0",
            }}
          >
            <CommandEmpty
              style={{
                padding: "24px 18px",
                textAlign: "center",
                color: "#969290",
                fontSize: 13,
              }}
            >
              No results found
            </CommandEmpty>

            {Object.entries(grouped).map(([section, items]) => (
              <CommandGroup key={section} heading={section}>
                {items.map((cmd) => (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.id}
                    onSelect={() => cmd.action()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 18px",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "#575452",
                    transition: "background 0.1s",
                  }}
                  className="cmd-item"
                >
                  <span style={{ color: "#969290", flexShrink: 0 }}>
                    {cmd.icon}
                  </span>
                  <span style={{ flex: 1 }}>{cmd.label}</span>
                  {cmd.shortcut && (
                    <kbd
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        borderRadius: 4,
                        border: "1px solid #D7D2D0",
                        color: "#767270",
                        fontFamily: "'DM Mono', monospace",
                        flexShrink: 0,
                      }}
                    >
                      {cmd.shortcut}
                    </kbd>
                  )}
                  {cmd.hint && !cmd.shortcut && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#969290",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {cmd.hint}
                    </span>
                  )}
                  <ExternalLink
                    size={12}
                    style={{ color: "#969290", flexShrink: 0 }}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>

        {/* Footer hint */}
        <div
          style={{
            padding: "8px 18px",
            borderTop: "1px solid #EAE4E1",
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 10,
            color: "#969290",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <CommandIcon size={10} /> navigate
          </span>
          <span>↑↓ select</span>
          <span>↵ open</span>
          <span>⌥1-5 layers</span>
          <span>⌥G globe</span>
          <span>⌥F fit</span>
          <span>⌥R reset</span>
          <span>esc close</span>
        </div>
      </CommandRoot>

      <style>{`
        .cmd-item[data-selected="true"] {
          background: rgba(16, 15, 15,0.06) !important;
          color: #100F0F !important;
        }
        .cmd-item[data-selected="true"] span {
          color: #100F0F !important;
        }
        [cmdk-group-heading] {
          font-size: 9px;
          font-family: 'DM Mono', monospace;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(20, 19, 19,0.3);
          padding: 8px 18px 4px;
        }
        [cmdk-input]::placeholder {
          color: rgba(20, 19, 19,0.3);
        }
        [cmdk-list]::-webkit-scrollbar {
          width: 4px;
        }
        [cmdk-list]::-webkit-scrollbar-track {
          background: transparent;
        }
        [cmdk-list]::-webkit-scrollbar-thumb {
          background: rgba(16, 15, 15,0.08);
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
