import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, Search } from "lucide-react";
import { CitadelMark } from "../cc/CitadelMark";
import { getAdminRole, getAdminName } from "../../admin/adminAuth";
import { useBticStore } from "../../stores/bticStore";
import { NAV_GROUPS } from "./SideNav";

const ROLE_DISPLAY: Record<string, string> = {
  fiu_admin: "FIU admin",
  bank_analyst: "Bank analyst",
  admin: "FIU admin",
  analyst: "Bank analyst",
};

function currentPage(pathname: string) {
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      const hit = it.path === "/admin" ? pathname === "/admin" || pathname === "/admin/" : pathname.startsWith(it.path);
      if (hit) return { group: g.title, label: it.label };
    }
  }
  return { group: "Monitor", label: "Overview" };
}

export function TopNav({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const setCommandPaletteOpen = useBticStore((s) => s.setCommandPaletteOpen);
  const role = getAdminRole() || "";
  const name = getAdminName() || "Operator";
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const page = currentPage(location.pathname);

  return (
    <nav
      className="sticky top-0 z-[100] flex h-[57px] items-center justify-between gap-4 border-b px-4 md:px-6"
      style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderColor: "#EAE4E1" }}
    >
      {/* Brand + breadcrumb */}
      <div className="flex min-w-0 items-center gap-5">
        <button onClick={() => navigate("/admin")} className="flex items-baseline gap-2 bg-transparent" style={{ border: "none", cursor: "pointer" }}>
          <CitadelMark size={16} />
          <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 22, lineHeight: 1, color: "#100F0F", letterSpacing: "-0.02em" }}>Citadel</span>
        </button>
        <span className="hidden h-5 w-px sm:block" style={{ background: "#EAE4E1" }} />
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <span className="cc-mono !text-[10.5px]" style={{ color: "#969290" }}>FIU console</span>
          <span style={{ color: "#D7D2D0" }}>/</span>
          <span className="cc-mono !text-[10.5px]" style={{ color: "#969290" }}>{page.group}</span>
          <span style={{ color: "#D7D2D0" }}>/</span>
          <span className="truncate text-[14px]" style={{ color: "#100F0F", fontWeight: 500 }}>{page.label}</span>
        </div>
      </div>

      {/* Search */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="hidden h-9 w-[320px] items-center gap-2 rounded-[8px] px-3 text-left transition-colors md:flex"
        style={{ border: "1px solid #EAE4E1", background: "#FBF9F8", cursor: "pointer" }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#D7D2D0")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#EAE4E1")}
      >
        <Search size={14} color="#969290" />
        <span className="flex-1 text-[13px]" style={{ color: "#969290" }}>Search cases, sessions, accounts…</span>
        <kbd className="cc-mono rounded-[4px] px-1.5 py-0.5 !text-[10px]" style={{ background: "#fff", border: "1px solid #EAE4E1", color: "#767270" }}>⌘K</kbd>
      </button>

      {/* Operator */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="cc-mono hidden rounded-[6px] px-2.5 py-1 !text-[10px] sm:inline" style={{ background: "rgba(170,65,42,0.08)", color: "#AA412A" }}>
          {ROLE_DISPLAY[role] || role}
        </span>
        <div className="hidden items-center gap-2 lg:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-medium text-white" style={{ background: "#083241" }}>{initials}</span>
          <span className="text-[13px]" style={{ color: "#575452" }}>{name}</span>
        </div>
        <button
          onClick={onLogout}
          className="flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[13px] transition-colors"
          style={{ border: "1px solid #EAE4E1", background: "#fff", color: "#575452", cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#D7D2D0"; e.currentTarget.style.color = "#100F0F"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#EAE4E1"; e.currentTarget.style.color = "#575452"; }}
        >
          <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </nav>
  );
}
