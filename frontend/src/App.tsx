import { motion } from "framer-motion";
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate, Link } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import PlatformsPage from "./pages/PlatformsPage";
import DocsPage from "./pages/DocsPage";
import ZipPayBankPage from "./pages/ZipPayBankPage";
import AdminApp from "./admin/AdminApp";
import PhishingDemoPage from "./pages/PhishingDemoPage";
import PhishingSimPage from "./pages/PhishingSimPage";
import { OAuthReturnHandler } from "./components/OAuthReturnHandler";
import { CitadelMark } from "./components/cc/CitadelMark";
import "./index.css";

// ── Citadel keep-mark (matches /favicon.svg) ──────────────────
function LogoIcon() {
  return <CitadelMark size={18} />;
}

// The customer-facing demo surface. Fraud Intelligence, Blockchain Ledger and
// Financial Gravity are deliberately NOT here — they are fraud-ops views and
// now live inside the FIU admin console at /cbi. The old /demo paths redirect
// there (see the routes below) so existing links keep working.
const TABS = [
  { key: "platforms", label: "Platforms", path: "/demo/platforms" },
  { key: "bank", label: "Bank Demo", path: "/demo/bank" },
  { key: "phishing", label: "Phishing Demo", path: "/demo/phishing" },
];

function DemoApp() {
  const navigate = useNavigate();
  const location = useLocation();

  const currentTab = TABS.find(t => location.pathname === t.path)?.key || "bank";

  return (
    <div style={{ width: "100%", minHeight: "100vh", backgroundColor: "#FFFFFF", position: "relative", overflow: "hidden" }}>
      {/* Ambient background — deep black with subtle colour washes */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", top: "-20%", left: "-10%", width: "60%", height: "60%",
          background: "radial-gradient(circle, rgba(170, 65, 42,0.04) 0%, transparent 60%)",
          filter: "blur(80px)",
        }} />
        <div style={{
          position: "absolute", bottom: "-10%", right: "-10%", width: "50%", height: "50%",
          background: "radial-gradient(circle, rgba(84, 79, 76,0.05) 0%, transparent 60%)",
          filter: "blur(80px)",
        }} />
        <div className="bg-grid-pattern" style={{ position: "absolute", inset: 0, opacity: 0.25 }} />
      </div>

      {/* ── Top Nav ────────────────────────────────────────────────────── */}
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", minHeight: 56, height: "auto",
        background: "rgba(255, 255, 255,0.6)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderBottom: "1px solid rgba(16, 15, 15,0.06)",
        position: "sticky", top: 0, zIndex: 100,
        flexWrap: "wrap", gap: 12,
      }}>

        {/* Left: Brand */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer" }} onClick={() => navigate("/")}>
          <LogoIcon />
          <span style={{
            fontWeight: 400, fontSize: 22, color: "#100F0F", lineHeight: 1,
            letterSpacing: "-0.02em", fontFamily: "'Newsreader', Georgia, serif",
          }}>
            Citadel
          </span>
          <span style={{
            fontSize: 9, fontWeight: 400, color: "rgba(170, 65, 42,0.85)",
            background: "rgba(170, 65, 42,0.06)",
            border: "1px solid rgba(170, 65, 42,0.18)",
            borderRadius: 20, padding: "2px 8px", letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "'DM Mono', ui-monospace, monospace",
          }}>
            Live Demo
          </span>
        </div>

        {/* Center: Pill tabs */}
        <div className="scrollbar-hide" style={{
          display: "flex", gap: 2,
          background: "rgba(16, 15, 15,0.04)",
          border: "1px solid rgba(16, 15, 15,0.08)",
          borderRadius: 10, padding: 3,
          overflowX: "auto", maxWidth: "100%",
        }}>
          {TABS.map(t => {
            const active = currentTab === t.key;
            return (
              <button key={t.key} onClick={() => navigate(t.path)} style={{
                background: active ? "rgba(16, 15, 15,0.12)" : "transparent",
                border: "none",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12,
                color: active ? "#141313" : "rgba(16, 15, 15,0.4)",
                cursor: "pointer",
                fontWeight: active ? 600 : 500,
                transition: "all 0.2s cubic-bezier(0.16, 0, 0.2, 1)",
                whiteSpace: "nowrap",
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                outline: "none",
                letterSpacing: "-0.01em",
                position: "relative",
              }}>
                {active && (
                  <motion.div
                    layoutId="activeNavTab"
                    style={{
                      position: "absolute", inset: 0,
                      background: "rgba(16, 15, 15, 0.08)",
                      border: "1px solid rgba(16, 15, 15, 0.12)",
                      borderRadius: 8,
                      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
                      zIndex: 0,
                    }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />
                )}
                <span style={{ position: "relative", zIndex: 1 }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Status chips + Docs link */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {[
            { dot: "#34C759", text: "API LIVE" },
            { dot: "#AA412A", text: "<80ms SLA" },
            { dot: "#544F4C", text: "RBI FREE-AI" },
          ].map(({ dot, text }) => (
            <div key={text} style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 9.5, color: "rgba(20, 19, 19,0.5)",
              fontFamily: "'DM Mono', monospace",
              fontWeight: 600,
              background: "rgba(16, 15, 15,0.03)",
              borderRadius: 20, padding: "3px 9px",
              letterSpacing: "0.04em",
              border: "1px solid rgba(16, 15, 15,0.06)"
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: dot, flexShrink: 0,
                boxShadow: `0 0 6px ${dot}80`,
              }} />
              {text}
            </div>
          ))}
          <Link to="/doc" style={{
            fontSize: 12, fontWeight: 600, color: "rgba(20, 19, 19,0.5)",
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            textDecoration: "none", letterSpacing: "0.02em",
            padding: "4px 10px", borderRadius: 6,
            border: "1px solid rgba(16, 15, 15,0.06)",
            transition: "color 0.2s, border-color 0.2s",
          }}>
            Docs
          </Link>
        </div>
      </nav>

      {/* ── Page content ────────────────────────────────────────────────── */}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "100%", overflow: "hidden", opacity: 1, transition: "opacity 0.15s ease" }}>
        {currentTab === "platforms" && <PlatformsPage />}
        {currentTab === "bank" && <ZipPayBankPage />}
        {currentTab === "phishing" && <PhishingDemoPage />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <OAuthReturnHandler />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        {/* The Fraud Intelligence Console is a fraud-ops surface — it lives
            ONLY inside the RBAC-gated FIU command center (/admin/dashboard).
            The old public /cbi route redirects there so stale links land on
            the admin login wall instead of an ungated console. */}
        <Route path="/cbi" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/doc" element={<DocsPage />} />
        <Route path="/doc/:sectionId" element={<DocsPage />} />
        <Route path="/phishing/verify" element={<PhishingSimPage />} />
        <Route path="/phishing-demo" element={<PhishingDemoPage />} />
        {/* Fraud-ops views moved out of the customer demo into the FIU console.
            These three must be declared BEFORE the /demo/* wildcard below, or
            the wildcard matches first and renders DemoApp instead. */}
        <Route path="/demo/dashboard" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/demo/blockchain" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/demo/gravity" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/demo/*" element={<DemoApp />} />
        {/* /admin — fraud-ops command centre. Auth gating lives in AdminApp and
            its index route is the overview, so there must be no exact "/admin"
            route redirecting to a child: the panel's catch-all sends unknown
            children back to /admin, which would bounce forever. */}
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
