/**
 * Citadel — FIU Mule Account Network Tab
 * Upgraded with: full-canvas SVG, stronger physics, larger nodes,
 * clearer labels, wider initial spread, better contrast.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  PUNJAB_GRAPH,
  PUNJAB_CLUSTERS,
  MONEY_FLOW_CHAIN,
} from "../../data/punjabCriminalNetwork";
import type { GraphNode, GraphEdge } from "../../types/btic";

// ── Color maps ────────────────────────────────────────────────────────────────
const NODE_TYPE_COLOR: Record<string, string> = {
  user:      "#B3261E",  // accused — red
  recipient: "#3D8B5A",  // victim  — green
  bank:      "#2C7A91",  // mule account — cyan
  telecom:   "#E040FB",  // phone — magenta
  device:    "#AB47BC",  // vehicle — purple
  campaign:  "#B5527A",  // campaign — rose
  behavior:  "#26A69A",  // behavior — teal
  merchant:  "#B7791F",
};

const NODE_TYPE_LABEL: Record<string, string> = {
  user:      "Accused",
  recipient: "Victim",
  bank:      "Mule Account",
  telecom:   "Phone",
  device:    "Vehicle",
  campaign:  "Campaign",
  behavior:  "Behavior",
};

const EDGE_TYPE_COLOR: Record<string, string> = {
  money_transfer:      "#2C7A91",
  shared_recipient:    "#3D8B5A",
  shared_sim:          "#E040FB",
  shared_device:       "#AB47BC",
  campaign_member:     "#B5527A",
  behavior_similarity: "#26A69A",
};

// ── Physics ───────────────────────────────────────────────────────────────────
const REPULSION    = 12000;
const ATTRACTION   = 0.018;
const CENTER_PULL  = 0.005;
const DAMPING      = 0.75;

function fmtINR(n: number): string {
  return n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${(n / 1000).toFixed(0)}K`;
}

interface NodePos { x: number; y: number; vx: number; vy: number }

// ── Main Component ────────────────────────────────────────────────────────────
export function MuleNetworkTab() {
  const containerRef  = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 600 });

  // Observe container size
  useEffect(() => {
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: Math.max(width, 400), h: Math.max(height, 400) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Initialise positions with wide spread
  const initPos = useCallback((w: number, h: number): Record<string, NodePos> => {
    const pos: Record<string, NodePos> = {};
    const n = PUNJAB_GRAPH.nodes.length;
    PUNJAB_GRAPH.nodes.forEach((node, i) => {
      const angle  = (i / n) * Math.PI * 2;
      const radius = 180 + (node.importance || 1) * 18 + Math.random() * 60;
      pos[node.id] = {
        x:  w / 2 + Math.cos(angle) * radius,
        y:  h / 2 + Math.sin(angle) * radius,
        vx: 0, vy: 0,
      };
    });
    return pos;
  }, []);

  const [positions, setPositions] = useState<Record<string, NodePos>>(() =>
    initPos(900, 600)
  );

  // Reset positions when dims arrive
  useEffect(() => {
    setPositions(initPos(dims.w, dims.h));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posRef      = useRef(positions);
  const dragging    = useRef<string | null>(null);
  const running     = useRef(true);
  const rafRef      = useRef<number>(0);
  const svgRef      = useRef<SVGSVGElement>(null);

  // Physics simulation
  useEffect(() => {
    running.current = true;
    const nodes = PUNJAB_GRAPH.nodes;
    const edges = PUNJAB_GRAPH.edges;

    const tick = () => {
      if (!running.current) return;
      const pos   = posRef.current;
      const cx    = dims.w / 2;
      const cy    = dims.h / 2;

      // Repulsion between all pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const pa = pos[a.id], pb = pos[b.id];
          if (!pa || !pb) continue;
          const dx = pa.x - pb.x;
          const dy = pa.y - pb.y;
          const dist2 = dx * dx + dy * dy + 1;
          const dist  = Math.sqrt(dist2);
          const force = REPULSION / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          pa.vx += fx; pa.vy += fy;
          pb.vx -= fx; pb.vy -= fy;
        }
      }

      // Attraction along edges
      for (const e of edges) {
        const pa = pos[e.source], pb = pos[e.target];
        if (!pa || !pb) continue;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        pa.vx += dx * ATTRACTION; pa.vy += dy * ATTRACTION;
        pb.vx -= dx * ATTRACTION; pb.vy -= dy * ATTRACTION;
      }

      // Center pull
      for (const node of nodes) {
        const p = pos[node.id];
        if (!p) continue;
        p.vx += (cx - p.x) * CENTER_PULL;
        p.vy += (cy - p.y) * CENTER_PULL;
      }

      // Integrate + damp + boundary
      const margin = 40;
      for (const node of nodes) {
        const p = pos[node.id];
        if (!p || dragging.current === node.id) continue;
        p.vx *= DAMPING; p.vy *= DAMPING;
        p.x  += p.vx;   p.y  += p.vy;
        p.x = Math.max(margin, Math.min(dims.w - margin, p.x));
        p.y = Math.max(margin, Math.min(dims.h - margin, p.y));
      }

      posRef.current = { ...pos };
      setPositions({ ...pos });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { running.current = false; cancelAnimationFrame(rafRef.current); };
  }, [dims]);

  // Mouse drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const id = dragging.current;
      if (!id) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      posRef.current = {
        ...posRef.current,
        [id]: { ...posRef.current[id], x: e.clientX - rect.left, y: e.clientY - rect.top, vx: 0, vy: 0 },
      };
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const [selectedNode,  setSelectedNode]  = useState<GraphNode | null>(null);
  const [hoveredNode,   setHoveredNode]   = useState<string | null>(null);
  const [activeCluster, setActiveCluster] = useState("ALL");
  const [searchQuery,   setSearchQuery]   = useState("");
  const [showChain,     setShowChain]     = useState(false);
  const [zoom,          setZoom]          = useState(1);

  // Cluster / search filter
  const visibleNodes = useMemo(() => {
    let ns = PUNJAB_GRAPH.nodes;
    if (activeCluster !== "ALL") {
      const c = PUNJAB_CLUSTERS.find((cl) => cl.id === activeCluster);
      if (c) ns = ns.filter((n) => c.nodeIds.includes(n.id));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      ns = ns.filter((n) =>
        n.label.toLowerCase().includes(q) ||
        String((n.metadata as any)?.accountNumber || "").toLowerCase().includes(q)
      );
    }
    return ns;
  }, [activeCluster, searchQuery]);

  const visibleIds   = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(() =>
    PUNJAB_GRAPH.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
  [visibleIds]);

  const locateNode = () => {
    const q = searchQuery.toLowerCase();
    const found = PUNJAB_GRAPH.nodes.find((n) => n.label.toLowerCase().includes(q));
    if (found) setSelectedNode(found);
  };

  // Node radius based on importance
  const nodeR = (node: GraphNode) => Math.max(16, 10 + (node.importance || 1) * 2.5);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", minHeight: 600, background: "#FAFAFA" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "10px 16px", flexShrink: 0,
        background: "rgba(255, 255, 255,0.6)", backdropFilter: "blur(8px)",
        borderBottom: "1px solid rgba(44, 122, 145,0.15)",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 15, fontWeight: 800, color: "#2C7A91", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          🕸️ Mule Account Network
        </div>
        <div style={{ fontSize: 11.5, fontFamily: "'DM Mono',monospace", color: "rgba(44, 122, 145,0.5)" }}>
          Criminal Relationship Graph · Punjab SIM Ring 2026
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {[
            { label: "ZOOM +",   action: () => setZoom(z => Math.min(z + 0.25, 3)) },
            { label: "ZOOM −",   action: () => setZoom(z => Math.max(z - 0.25, 0.3)) },
            { label: "RESET",    action: () => { setZoom(1); setPositions(initPos(dims.w, dims.h)); } },
          ].map((btn) => (
            <button key={btn.label} onClick={btn.action} style={{
              padding: "5px 11px", borderRadius: 6, border: "1px solid rgba(44, 122, 145,0.25)",
              background: "rgba(44, 122, 145,0.07)", color: "rgba(44, 122, 145,0.8)",
              fontSize: 11.5, fontFamily: "'DM Mono',monospace", fontWeight: 700,
              cursor: "pointer", transition: "all 0.15s",
            }}>
              {btn.label}
            </button>
          ))}
          <button onClick={() => setShowChain(s => !s)} style={{
            padding: "5px 12px", borderRadius: 6, cursor: "pointer",
            fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 11.5,
            border: `1px solid ${showChain ? "rgba(44, 122, 145,0.6)" : "rgba(16, 15, 15,0.12)"}`,
            background: showChain ? "rgba(44, 122, 145,0.12)" : "transparent",
            color: showChain ? "#2C7A91" : "#767270", transition: "all 0.2s",
          }}>
            💸 Money Flow Chain
          </button>
        </div>
      </div>

      {/* ── 3-column body ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* LEFT panel */}
        <div style={{
          width: 200, flexShrink: 0,
          background: "rgba(243, 243, 243,0.95)", backdropFilter: "blur(10px)",
          borderRight: "1px solid rgba(44, 122, 145,0.1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Dialer */}
          <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid #EAE4E1" }}>
            <div style={{ fontSize: 11, color: "#2C7A91", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
              Network Dialer
            </div>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && locateNode()}
              placeholder="Vikram Singh, AC-88122…"
              style={{
                width: "100%", padding: "7px 10px", borderRadius: 6, boxSizing: "border-box",
                background: "rgba(16, 15, 15,0.04)", border: "1px solid rgba(44, 122, 145,0.2)",
                color: "#100F0F", fontSize: 11.5, fontFamily: "'DM Mono',monospace", outline: "none",
              }}
            />
            <button onClick={locateNode} style={{
              width: "100%", marginTop: 6, padding: "7px",
              background: "rgba(44, 122, 145,0.15)", border: "1px solid rgba(44, 122, 145,0.4)",
              borderRadius: 6, color: "#2C7A91", fontSize: 11.5, fontFamily: "'DM Mono',monospace",
              fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em",
            }}>
              LOCATE NODE
            </button>
          </div>

          {/* Node type legend */}
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #EAE4E1" }}>
            <div style={{ fontSize: 10, color: "#969290", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Node Types
            </div>
            {Object.entries(NODE_TYPE_LABEL).map(([type, label]) => (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: NODE_TYPE_COLOR[type], flexShrink: 0, boxShadow: `0 0 6px ${NODE_TYPE_COLOR[type]}60` }} />
                <span style={{ fontSize: 11.5, color: "#575452", fontFamily: "'DM Mono',monospace" }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Gang clusters */}
          <div style={{ padding: "8px 12px" }}>
            <div style={{ fontSize: 10, color: "#969290", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Gang Clusters
            </div>
            {["ALL", ...PUNJAB_CLUSTERS.map(c => c.id)].map((cid) => {
              const cluster = PUNJAB_CLUSTERS.find(c => c.id === cid);
              const color   = cluster?.color || "#2C7A91";
              const active  = activeCluster === cid;
              return (
                <button key={cid} onClick={() => setActiveCluster(cid)} style={{
                  width: "100%", padding: "6px 10px", marginBottom: 4,
                  borderRadius: 5, textAlign: "left",
                  border: `1px solid ${active ? color : "rgba(16, 15, 15,0.08)"}`,
                  background: active ? `${color}18` : "transparent",
                  color: active ? color : "#767270",
                  fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: 700,
                  cursor: "pointer", letterSpacing: "0.04em", transition: "all 0.15s",
                }}>
                  {cid === "ALL" ? "ALL CLUSTERS" : cluster?.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* CENTER — graph canvas */}
        <div
          ref={containerRef}
          style={{
            flex: 1, position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden",
            background: "radial-gradient(ellipse at 40% 40%, #EBEBEB 0%, #FAFAFA 100%)",
          }}
        >
          {/* Grid */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            backgroundImage: `linear-gradient(rgba(44, 122, 145,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(44, 122, 145,0.04) 1px, transparent 1px)`,
            backgroundSize: "50px 50px",
          }} />

          {/* Title */}
          <div style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
            fontSize: 12.5, fontFamily: "'DM Mono',monospace", fontWeight: 700,
            color: "#2C7A91", letterSpacing: "0.1em", textTransform: "uppercase",
            background: "rgba(44, 122, 145,0.08)", border: "1px solid rgba(44, 122, 145,0.2)",
            padding: "4px 14px", borderRadius: 6, pointerEvents: "none", whiteSpace: "nowrap",
            zIndex: 10,
          }}>
            Organized Criminal Relationship Graph
          </div>

          <div style={{ position: "absolute", top: 48, left: 14, fontSize: 11, color: "#969290", fontFamily: "'DM Mono',monospace", pointerEvents: "none" }}>
            Click node to inspect · Drag to rearrange · Hover for details
          </div>

          {/* SVG graph */}
          <svg
            ref={svgRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: dragging.current ? "grabbing" : "default" }}
            viewBox={`0 0 ${dims.w} ${dims.h}`}
          >
            <g transform={`scale(${zoom}) translate(${(dims.w / 2) * (1 - 1 / zoom)},${(dims.h / 2) * (1 - 1 / zoom)})`}>

              {/* Edges */}
              {visibleEdges.map((edge) => {
                const sp = posRef.current[edge.source];
                const tp = posRef.current[edge.target];
                if (!sp || !tp) return null;
                const color = EDGE_TYPE_COLOR[edge.type] || "#BFBBB8";
                const isSel = selectedNode?.id === edge.source || selectedNode?.id === edge.target;
                const isHov = hoveredNode === edge.source || hoveredNode === edge.target;
                const highlight = isSel || isHov;
                const isMoney   = edge.type === "money_transfer";

                // Midpoint for label
                const mx = (sp.x + tp.x) / 2;
                const my = (sp.y + tp.y) / 2;

                return (
                  <g key={edge.id}>
                    <line
                      x1={sp.x} y1={sp.y} x2={tp.x} y2={tp.y}
                      stroke={color}
                      strokeWidth={highlight ? 2.5 : 1.5}
                      strokeOpacity={highlight ? 0.9 : 0.35}
                      strokeDasharray={isMoney ? "8 4" : undefined}
                    >
                      {isMoney && <animate attributeName="stroke-dashoffset" values="0;-24" dur="1.5s" repeatCount="indefinite" />}
                    </line>
                    {highlight && (
                      <text x={mx} y={my - 6} fill={color} fontSize={9} textAnchor="middle"
                        fontFamily="'DM Mono',monospace" fillOpacity={0.85}>
                        {edge.type.replace(/_/g, " ")}
                        {(edge as any).amount ? ` · ${fmtINR((edge as any).amount)}` : ""}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {visibleNodes.map((node) => {
                const p     = posRef.current[node.id];
                if (!p) return null;
                const color = NODE_TYPE_COLOR[node.type] || "#7B7774";
                const r     = nodeR(node);
                const isSel = selectedNode?.id === node.id;
                const isHov = hoveredNode === node.id;

                return (
                  <g key={node.id}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() => setSelectedNode(isSel ? null : node)}
                    onMouseDown={(e) => { e.stopPropagation(); dragging.current = node.id; }}
                  >
                    {/* Outer glow ring */}
                    {(isSel || isHov) && (
                      <circle cx={p.x} cy={p.y} r={r + 10} fill={color} fillOpacity={0.14} />
                    )}
                    {/* Pulse for accused/critical */}
                    {node.type === "user" && (
                      <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.45}>
                        <animate attributeName="r" values={`${r+4};${r+16};${r+4}`} dur="2.2s" repeatCount="indefinite" />
                        <animate attributeName="stroke-opacity" values="0.45;0;0.45" dur="2.2s" repeatCount="indefinite" />
                      </circle>
                    )}
                    {/* Main filled circle */}
                    <circle
                      cx={p.x} cy={p.y} r={r}
                      fill={color}
                      fillOpacity={isSel ? 1 : isHov ? 0.9 : 0.8}
                      stroke={isSel ? "#FFFFFF" : color}
                      strokeWidth={isSel ? 3 : 1.5}
                      filter={isHov || isSel ? "url(#glow)" : undefined}
                    />
                    {/* Node icon / letter */}
                    <text
                      x={p.x} y={p.y + 1}
                      textAnchor="middle" dominantBaseline="middle"
                      fill="#FFFFFF" fontSize={r * 0.65}
                      fontFamily="'Inter',sans-serif" fontWeight={800}
                      pointerEvents="none"
                    >
                      {node.type === "user" ? "⚠" :
                       node.type === "recipient" ? "👤" :
                       node.type === "bank" ? "🏦" :
                       node.type === "telecom" ? "📱" :
                       node.type === "device" ? "🚗" :
                       node.type === "campaign" ? "🎯" : "🧬"}
                    </text>
                    {/* Label below node */}
                    <text
                      x={p.x} y={p.y + r + 14}
                      textAnchor="middle"
                      fill={isSel ? "#FFFFFF" : isHov ? "#100F0F" : "rgba(20, 19, 19,0.72)"}
                      fontSize={isSel || isHov ? 10 : 9}
                      fontFamily="'DM Mono',monospace"
                      fontWeight={isSel ? 700 : 500}
                      pointerEvents="none"
                      style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}
                    >
                      {node.label.length > 22 ? node.label.slice(0, 22) + "…" : node.label}
                    </text>
                    {/* Type tag on hover */}
                    {isHov && (
                      <g>
                        <rect
                          x={p.x - 28} y={p.y + r + 20}
                          width={56} height={13} rx={4}
                          fill={color} fillOpacity={0.25}
                        />
                        <text
                          x={p.x} y={p.y + r + 29}
                          textAnchor="middle"
                          fill={color} fontSize={7.5}
                          fontFamily="'DM Mono',monospace" fontWeight={700}
                          pointerEvents="none"
                        >
                          {(NODE_TYPE_LABEL[node.type] || node.type).toUpperCase()}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* SVG filter for glow */}
              <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
            </g>
          </svg>

          {/* Money flow chain overlay */}
          {showChain && (
            <div style={{
              position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
              display: "flex", alignItems: "stretch", gap: 0,
              background: "rgba(243, 243, 243,0.97)", backdropFilter: "blur(14px)",
              border: "1px solid rgba(44, 122, 145,0.25)", borderRadius: 12,
              padding: "12px 18px", zIndex: 50,
            }}>
              <div style={{
                fontSize: 11, color: "#2C7A91", fontFamily: "'DM Mono',monospace",
                fontWeight: 700, marginRight: 14, display: "flex", alignItems: "center",
                letterSpacing: "0.08em", textTransform: "uppercase",
              }}>
                Money<br />Flow<br />Chain
              </div>
              {MONEY_FLOW_CHAIN.map((step, idx) => (
                <div key={step.label} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{
                    textAlign: "center", padding: "8px 12px",
                    background: `${step.color}18`, border: `1px solid ${step.color}45`,
                    borderRadius: 8, minWidth: 90,
                  }}>
                    <div style={{ fontSize: 18, lineHeight: 1 }}>{step.icon}</div>
                    <div style={{ fontSize: 12.5, color: step.color, fontFamily: "'DM Mono',monospace", fontWeight: 800, marginTop: 4 }}>
                      {fmtINR(step.amount)}
                    </div>
                    <div style={{ fontSize: 10, color: "#767270", fontFamily: "'DM Mono',monospace", marginTop: 2, whiteSpace: "nowrap" }}>
                      {step.label}
                    </div>
                  </div>
                  {idx < MONEY_FLOW_CHAIN.length - 1 && (
                    <div style={{ color: "#2C7A91", fontSize: 20, margin: "0 6px", opacity: 0.7, lineHeight: 1 }}>→</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — Entity Dossier */}
        <div style={{
          width: 280, flexShrink: 0,
          background: "rgba(243, 243, 243,0.95)", backdropFilter: "blur(10px)",
          borderLeft: "1px solid rgba(44, 122, 145,0.1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid #EAE4E1",
            fontSize: 11, fontFamily: "'DM Mono',monospace",
            color: "#2C7A91", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            Entity Dossier Inspector
          </div>

          {!selectedNode ? (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: 24, textAlign: "center", gap: 12,
            }}>
              <div style={{ fontSize: 36, opacity: 0.3 }}>🕵️</div>
              <div style={{ fontSize: 12.5, color: "#969290", fontFamily: "'DM Mono',monospace", lineHeight: 1.7 }}>
                Click any node in the graph to pull<br />
                security status, risk coefficient,<br />
                and connected links.
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {/* Card header */}
              <div style={{
                padding: "12px 14px", borderRadius: 8, marginBottom: 14,
                background: `${NODE_TYPE_COLOR[selectedNode.type]}12`,
                border: `1px solid ${NODE_TYPE_COLOR[selectedNode.type]}35`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: NODE_TYPE_COLOR[selectedNode.type], boxShadow: `0 0 8px ${NODE_TYPE_COLOR[selectedNode.type]}` }} />
                  <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 400, color: "#100F0F" }}>
                    {selectedNode.label}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#767270", fontFamily: "'DM Mono',monospace" }}>
                  {(NODE_TYPE_LABEL[selectedNode.type] || selectedNode.type).toUpperCase()} · Conf. {(selectedNode.confidence * 100).toFixed(0)}%
                </div>
              </div>

              {/* Risk bar */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: "#767270", fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Risk Coefficient</span>
                  <span style={{ fontSize: 11, color: "#100F0F", fontFamily: "'DM Mono',monospace" }}>{(selectedNode.confidence * 100).toFixed(0)}%</span>
                </div>
                <div style={{ height: 7, background: "rgba(16, 15, 15,0.06)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${(selectedNode.confidence * 100).toFixed(0)}%`,
                    background: selectedNode.confidence > 0.85 ? "#B3261E" : selectedNode.confidence > 0.7 ? "#B7791F" : "#3D8B5A",
                    borderRadius: 4, transition: "width 0.6s ease",
                  }} />
                </div>
              </div>

              {/* Metadata */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
                {Object.entries(selectedNode.metadata || {}).map(([key, val]) => {
                  if (key === "gang") return null;
                  const display = Array.isArray(val) ? val.join(", ") : String(val ?? "—");
                  const label   = key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                  return (
                    <div key={key} style={{
                      display: "flex", justifyContent: "space-between", gap: 8,
                      padding: "5px 0", borderBottom: "1px solid #EAE4E1",
                    }}>
                      <span style={{ fontSize: 11, color: "#767270", fontFamily: "'DM Mono',monospace", flexShrink: 0, textTransform: "uppercase" }}>
                        {label}
                      </span>
                      <span style={{ fontSize: 11, color: "#100F0F", fontFamily: "'DM Mono',monospace", textAlign: "right", wordBreak: "break-all" }}>
                        {display.length > 42 ? display.slice(0, 42) + "…" : display}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Connected edges */}
              {(() => {
                const connected = PUNJAB_GRAPH.edges.filter(
                  e => e.source === selectedNode.id || e.target === selectedNode.id
                );
                return connected.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 11, color: "#969290", fontFamily: "'DM Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>
                      Linked Entities ({connected.length})
                    </div>
                    {connected.slice(0, 8).map((edge) => {
                      const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
                      const other   = PUNJAB_GRAPH.nodes.find(n => n.id === otherId);
                      const color   = EDGE_TYPE_COLOR[edge.type] || "#7B7774";
                      return (
                        <div key={edge.id} style={{
                          padding: "7px 10px", borderRadius: 6, marginBottom: 5,
                          background: "#FFFFFF", border: "1px solid #EAE4E1",
                          cursor: "pointer",
                        }}
                          onClick={() => other && setSelectedNode(other)}
                        >
                          <div style={{ fontSize: 11, color, fontFamily: "'DM Mono',monospace", fontWeight: 700, marginBottom: 2 }}>
                            {edge.type.replace(/_/g, " ")}
                            {(edge as any).amount ? ` · ${fmtINR((edge as any).amount)}` : ""}
                          </div>
                          <div style={{ fontSize: 11, color: "#767270", fontFamily: "'DM Mono',monospace" }}>
                            {other?.label?.slice(0, 28) || "Unknown"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom legend ───────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 18,
        padding: "6px 16px",
        background: "rgba(243, 243, 243,0.9)", borderTop: "1px solid rgba(44, 122, 145,0.1)",
        flexWrap: "wrap",
      }}>
        {Object.entries(NODE_TYPE_LABEL).map(([type, label]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: NODE_TYPE_COLOR[type], boxShadow: `0 0 5px ${NODE_TYPE_COLOR[type]}50` }} />
            <span style={{ fontSize: 11, color: "#767270", fontFamily: "'DM Mono',monospace" }}>{label}</span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 11, color: "#969290", fontFamily: "'DM Mono',monospace" }}>
          {visibleNodes.length} nodes · {visibleEdges.length} links · Punjab SIM Ring 2026
        </div>
      </div>
    </div>
  );
}
