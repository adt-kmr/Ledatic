import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import { CommandPalette } from "../../components/ui/CommandPalette";
import { TopNav } from "../../components/btic/TopNav";
import { SideNav } from "../../components/btic/SideNav";
import { ThreatTicker } from "../../components/btic/ThreatTicker";
import { PerfOverlay } from "../../components/btic/PerfOverlay";

// Lazy-loaded pages
const OverviewPage = lazy(() => import("../../pages/admin/OverviewPage"));
const ThreatIntelPage = lazy(() => import("../../pages/admin/ThreatIntelPage"));
// The SOC dashboard (fraud/emergency/QR/gravity/consortium tabs) lives at
// /admin/dashboard inside this RBAC-gated portal; legacy public paths
// (/demo/dashboard and the old /cbi) redirect here.
const SocDashboardPage = lazy(() => import("../../pages/DashboardPage"));
const FraudReportsPage = lazy(() => import("../../pages/admin/FraudReportsPage"));
const EmergencyIncidentsPage = lazy(() => import("../../pages/admin/EmergencyIncidentsPage"));
const CampaignPage = lazy(() => import("../../pages/admin/CampaignPage"));
const FraudGraphPage = lazy(() => import("../../pages/admin/FraudGraphPage"));
const InvestigationPage = lazy(() => import("../../pages/admin/InvestigationPage"));
const AnalyticsPage = lazy(() => import("../../pages/admin/AnalyticsPage"));
const SettingsPage = lazy(() => import("../../pages/admin/SettingsPage"));

function PageSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 400,
        gap: 12,
      }}
    >
      {/* Animated skeleton bars */}
      <div style={{ display: "flex", gap: 8 }}>
        {[60, 80, 50, 70].map((w, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ width: w, height: 8, borderRadius: 4 }}
          />
        ))}
      </div>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "#969290",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Loading...
      </div>
    </div>
  );
}

/**
 * Preload critical chunks on idle.
 * The map chunk (1.7MB) should be preloaded after the initial render
 * so it's ready when the user navigates to the map view.
 */
function useChunkPreloading() {
  useEffect(() => {
    // Preload the map chunk after 2 seconds (when the user is likely done with overview)
    const timer = setTimeout(() => {
      // Use requestIdleCallback if available, otherwise setTimeout
      const preload = () => {
        import("../../pages/admin/ThreatIntelPage").catch(() => {});
        import("../../components/btic/map/ThreatMap").catch(() => {});
      };

      if ("requestIdleCallback" in window) {
        (window as any).requestIdleCallback(preload, { timeout: 5000 });
      } else {
        setTimeout(preload, 100);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);
}

const PAGE_META: Record<string, { kicker: string; title: string; desc: string }> = {
  "": { kicker: "Monitor", title: "Fraud-ops overview", desc: "Live identity confidence, active threats and the campaigns your analysts are working right now." },
  threats: { kicker: "Monitor", title: "Threat map", desc: "Where attacks are originating across India, with live incident replay and mule-network links." },
  dashboard: { kicker: "Monitor", title: "SOC dashboard", desc: "Every scored session, QR scan, emergency and consortium signal in one operations view." },
  "fraud-reports": { kicker: "Respond", title: "Fraud reports", desc: "AI-written investigation reports for every HARD_BLOCK, with face evidence and decision trail." },
  emergency: { kicker: "Respond", title: "Emergency incidents", desc: "Duress-PIN activations and coercion alerts that need a human response now." },
  campaigns: { kicker: "Respond", title: "Fraud campaigns", desc: "Coordinated attacks clustered by technique, region and shared infrastructure." },
  graph: { kicker: "Investigate", title: "Fraud mind map", desc: "Accounts, devices and payees linked into the networks behind each campaign." },
  investigate: { kicker: "Investigate", title: "Investigation workspace", desc: "Pull a session apart: signals, SHAP attribution, device history and ledger proof." },
  analytics: { kicker: "Investigate", title: "Analytics", desc: "Detection performance, decision mix and trends across the protected population." },
  settings: { kicker: "System", title: "Settings", desc: "Risk thresholds, alerting and operator preferences for this console." },
};

function PageHeader() {
  const { pathname } = useLocation();
  const key = pathname.replace(/^\/admin\/?/, "").split("/")[0];
  const meta = PAGE_META[key] ?? PAGE_META[""];
  return (
    <motion.header
      key={key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b pb-6"
      style={{ borderColor: "#EAE4E1" }}
    >
      <div>
        <div className="cc-mono" style={{ color: "#AA412A" }}>{meta.kicker}</div>
        <h1 className="m-0 mt-2 text-[clamp(30px,3vw,42px)] font-normal leading-[1.05] tracking-[-0.02em]" style={{ fontFamily: "'Newsreader', Georgia, serif", color: "#100F0F" }}>
          {meta.title}
        </h1>
        <p className="m-0 mt-2 max-w-[640px] text-[14.5px] leading-[1.5]" style={{ color: "#575452" }}>{meta.desc}</p>
      </div>
      <div className="cc-mono flex items-center gap-2" style={{ color: "#767270" }}>
        <span className="relative flex h-2 w-2">
          <span className="cc-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "#3D8B5A", opacity: 0.5 }} />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#3D8B5A" }} />
        </span>
        Live
      </div>
    </motion.header>
  );
}

export default function CommandCenterLayout({
  onLogout,
}: {
  onLogout: () => void;
}) {
  useChunkPreloading();

  return (
    <div style={{ minHeight: "100vh", background: "#FBF9F8", color: "#100F0F" }}>
      {/* Performance overlay (Ctrl+Shift+P to toggle) */}
      <PerfOverlay />

      {/* Command Palette (Cmd+K / Ctrl+K) */}
      <CommandPalette />

      <TopNav onLogout={onLogout} />
      <ThreatTicker />

      <div style={{ display: "flex", minHeight: "calc(100vh - 57px)" }}>
        <SideNav />
        <main className="min-w-0 flex-1 px-4 pb-24 pt-7 md:px-8 md:pb-12">
          <div className="mx-auto max-w-[1440px]">
            <PageHeader />
            <ErrorBoundary name="Page" fallback={<PageSkeleton />}>
              <Suspense fallback={<PageSkeleton />}>
                <Routes>
                  <Route index element={<OverviewPage />} />
                  <Route path="threats" element={<ThreatIntelPage />} />
                  <Route path="dashboard" element={<SocDashboardPage />} />
                  <Route path="fraud-reports" element={<FraudReportsPage />} />
                  <Route path="emergency" element={<EmergencyIncidentsPage />} />
                  <Route path="campaigns" element={<CampaignPage />} />
                  <Route path="graph" element={<FraudGraphPage />} />
                  <Route path="investigate" element={<InvestigationPage />} />
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/admin" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
