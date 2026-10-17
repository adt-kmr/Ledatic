import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Map,
  Target,
  Network,
  Search,
  BarChart3,
  Settings,
  FileWarning,
  Siren,
  Radar,
  Cpu,
} from "lucide-react";
import type { NavItem } from "../../types/btic";

type Item = { id: NavItem; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; path: string };

export const NAV_GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Monitor",
    items: [
      { id: "home", label: "Overview", icon: LayoutDashboard, path: "/admin" },
      { id: "threats", label: "Threat map", icon: Map, path: "/admin/threats" },
      { id: "soc", label: "SOC dashboard", icon: Radar, path: "/admin/dashboard" },
    ],
  },
  {
    title: "Respond",
    items: [
      { id: "fraud-reports", label: "Fraud reports", icon: FileWarning, path: "/admin/fraud-reports" },
      { id: "emergency", label: "Emergency", icon: Siren, path: "/admin/emergency" },
      { id: "campaigns", label: "Campaigns", icon: Target, path: "/admin/campaigns" },
    ],
  },
  {
    title: "Investigate",
    items: [
      { id: "graph", label: "Mind map", icon: Network, path: "/admin/graph" },
      { id: "investigate", label: "Investigate", icon: Search, path: "/admin/investigate" },
      { id: "analytics", label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
    ],
  },
  {
    title: "System",
    items: [
      { id: "ibm-z", label: "IBM Z trust", icon: Cpu, path: "/admin/ibm-z" },
      { id: "settings", label: "Settings", icon: Settings, path: "/admin/settings" },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const isActive = (pathname: string, path: string) =>
  path === "/admin" ? pathname === "/admin" || pathname === "/admin/" : pathname.startsWith(path);

const HEALTH = ["ML engine", "Redis", "PostgreSQL", "Fabric ledger"];

export function SideNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      {/* Desktop: labeled sidebar (icons only between md and lg) */}
      <aside
        className="sticky top-[57px] hidden h-[calc(100vh-57px)] shrink-0 flex-col justify-between overflow-y-auto border-r md:flex md:w-[64px] lg:w-[232px]"
        style={{ borderColor: "#EAE4E1", background: "#FFFFFF" }}
      >
        <div className="flex flex-col gap-6 px-3 py-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="cc-mono mb-2 hidden px-3 !text-[10px] lg:block" style={{ color: "#969290" }}>
                {group.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(location.pathname, item.path);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.path)}
                      title={item.label}
                      className="group relative flex h-10 items-center gap-3 rounded-[8px] px-3 text-left transition-colors md:justify-center lg:justify-start"
                      style={{
                        background: active ? "#F7F3F1" : "transparent",
                        color: active ? "#100F0F" : "#575452",
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#FBF9F8"; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                    >
                      {active && (
                        <motion.span
                          layoutId="admin-nav-bar"
                          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
                          style={{ background: "#AA412A" }}
                          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        />
                      )}
                      <span style={{ color: active ? "#AA412A" : "#767270" }}><Icon size={17} strokeWidth={1.7} /></span>
                      <span className="hidden text-[14px] lg:inline" style={{ fontWeight: active ? 500 : 400 }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* System health */}
        <div className="m-3 hidden rounded-[12px] p-4 lg:block" style={{ background: "#F7F3F1" }}>
          <div className="cc-mono mb-3 !text-[10px]" style={{ color: "#767270" }}>System health</div>
          <div className="flex flex-col gap-2">
            {HEALTH.map((h) => (
              <div key={h} className="flex items-center justify-between text-[12.5px]" style={{ color: "#575452" }}>
                <span>{h}</span>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="cc-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "#3D8B5A", opacity: 0.5 }} />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#3D8B5A" }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Mobile: fixed bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex justify-around md:hidden"
        style={{
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid #EAE4E1",
          padding: "6px 0 env(safe-area-inset-bottom, 6px)",
        }}
      >
        {ALL_ITEMS.map((item) => {
          const active = isActive(location.pathname, item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-1.5"
              style={{ color: active ? "#AA412A" : "#767270", background: "transparent", border: "none" }}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span className="max-w-full truncate text-[9px]" style={{ fontWeight: active ? 600 : 400 }}>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
