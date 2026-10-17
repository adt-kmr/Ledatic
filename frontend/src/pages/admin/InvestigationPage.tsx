import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { MOCK_GRAPH_DATA } from "../../data/mockGraph";
import { fetchGraphData } from "../../lib/bticApi";
import type { GraphData } from "../../types/btic";
import {
  InvestigationSummary,
  EvidencePanel,
  BehaviorPassport,
  Timeline,
} from "../../components/btic/investigation";

export default function InvestigationPage() {
  const location = useLocation();
  const initialState = location.state as {
    sessionId?: string;
    customerHash?: string;
  } | null;

  const [searchQuery, setSearchQuery] = useState(
    initialState?.customerHash || initialState?.sessionId || ""
  );
  // Real per-customer history (past sessions/decisions) pulled from
  // /api/btic/graph/{customer_hash} — this is the "past behaviour of a
  // returning user" the FIU portal is supposed to surface. Null = no real
  // match found yet, so the mock fallback below keeps the workspace populated.
  const [realGraph, setRealGraph] = useState<GraphData | null>(null);

  const q = searchQuery.trim().toLowerCase();

  useEffect(() => {
    if (!q) {
      setRealGraph(null);
      return;
    }
    let cancelled = false;
    fetchGraphData(q).then((data) => {
      if (!cancelled && data && data.nodes.length > 0) {
        setRealGraph(data as GraphData);
      } else if (!cancelled) {
        setRealGraph(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [q]);

  // The central "Suspicious Identity" user is always the best default so the
  // workspace is never empty during a demo — an empty search or any unmatched
  // query falls back to it. A non-empty query first tries the real backend
  // (a customer who has actually logged in on /demo/bank); if that customer
  // hash doesn't exist yet, fall back to a fuzzy match against mock data.
  const centralUser =
    MOCK_GRAPH_DATA.nodes.find((n) => n.type === "user") ||
    MOCK_GRAPH_DATA.nodes[0];

  const activeGraph: GraphData = realGraph ?? MOCK_GRAPH_DATA;

  const node = realGraph
    ? realGraph.nodes.find((n) => n.type === "user") || realGraph.nodes[0]
    : !q
    ? centralUser
    : MOCK_GRAPH_DATA.nodes.find((n) => {
        const hash = String(n.metadata.customerHash || "").toLowerCase();
        return (
          n.id.toLowerCase().includes(q) ||
          hash.includes(q) ||
          n.label.toLowerCase().includes(q) ||
          n.type.toLowerCase().includes(q)
        );
      }) || centralUser;

  const connectedEdges = node
    ? activeGraph.edges.filter(
        (e) => e.source === node.id || e.target === node.id
      )
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <div style={{ display: "flex", gap: 10 }}>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Enter customer hash, session ID, or campaign name..."
          className="premium-input"
          style={{
            flex: 1,
            padding: "11px 14px",
            borderRadius: 12,
            border: "1px solid #D7D2D0",
            background: "rgba(16, 15, 15,0.04)",
            color: "#100F0F",
            fontSize: 14,
            fontFamily: "'DM Mono', monospace",
            outline: "none",
            minWidth: 0,
          }}
        />
      </div>

      {node && (
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
          <div className="glass-card" style={{ padding: "20px 22px" }}>
            <InvestigationSummary node={node} connectedEdges={connectedEdges} />
            <div style={{ marginTop: 16 }}>
              <EvidencePanel edges={connectedEdges} />
            </div>
          </div>

          <div className="glass-card" style={{ padding: "20px 22px" }}>
            <BehaviorPassport node={node} connectedEdges={connectedEdges} />
            <Timeline edges={connectedEdges} />
          </div>
        </div>
      )}
    </div>
  );
}
