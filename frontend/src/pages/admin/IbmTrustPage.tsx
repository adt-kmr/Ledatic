import { useEffect, useState } from "react";
import { Cpu, KeyRound, ShieldCheck, Link2, Brain, Database, type LucideIcon } from "lucide-react";
import { adminFetch } from "../../admin/adminAuth";

type Safety = "yes" | "partial" | "no";

interface InventoryItem {
  id: string;
  asset: string;
  endpoint: string;
  algorithm: string;
  purpose: string;
  quantum_safe: Safety;
  key_custody: string;
  hsm_target: string | null;
  note?: string;
}

interface Inventory {
  summary: { total: number; quantum_safe: number; partial: number; at_risk: number };
  items: InventoryItem[];
}

const CAPABILITIES: { Icon: LucideIcon; name: string; component: string; benefit: string }[] = [
  {
    Icon: Cpu,
    name: "Telum on-chip AI accelerator",
    component: "XGBoost, Siamese, CNN-LSTM, Isolation Forest scoring",
    benefit: "Inference inside the payment window via ONNX / Snap ML, with no data leaving the system.",
  },
  {
    Icon: KeyRound,
    name: "Crypto Express HSM",
    component: "HMAC salts, JWT and ML-DSA / ML-KEM keys",
    benefit: "Keys never sit in application memory; verdict signatures are quantum-safe.",
  },
  {
    Icon: ShieldCheck,
    name: "Secure Execution for Linux",
    component: "Decision engine, ML service, AI investigator",
    benefit: "Models and in-flight behavioural data are protected from privileged-admin and host access.",
  },
  {
    Icon: Link2,
    name: "Hyperledger Fabric on s390x",
    component: "Mule flags, IMEI hash registry, SIM-swap check",
    benefit: "Bank-controlled consortium ledger. Hashes only, no PII.",
  },
  {
    Icon: Brain,
    name: "Self-hosted LLaMA 3.3",
    component: "FIU case-report drafting",
    benefit: "Case data never goes to a third-party API.",
  },
  {
    Icon: Database,
    name: "Pervasive / protected-key encryption",
    component: "PostgreSQL, Redis, logs",
    benefit: "Encrypted at rest by default; supports DPDP data localisation.",
  },
];

const SAFETY_STYLE: Record<Safety, { label: string; fg: string; bg: string }> = {
  yes: { label: "Quantum-safe", fg: "#3D8B5A", bg: "rgba(61,139,90,0.1)" },
  partial: { label: "Review", fg: "#B7791F", bg: "rgba(183,121,31,0.12)" },
  no: { label: "At risk", fg: "#B3261E", bg: "rgba(179,38,30,0.1)" },
};

const card: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #EAE4E1",
  borderRadius: 12,
  padding: 20,
};

export default function IbmTrustPage() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminFetch("/api/security/crypto-inventory")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Inventory request failed (${r.status})`);
        return r.json() as Promise<Inventory>;
      })
      .then((d) => { if (live) setInv(d); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load inventory"); });
    return () => { live = false; };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          ...card,
          background: "#FBF9F8",
          fontSize: 12,
          color: "#575452",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "#100F0F" }}>Deployment status:</strong> these are the LinuxONE deployment targets. This
        demo build runs on commodity x86 / ARM containers, so none of the IBM Z features are active here. The
        quantum-safe algorithms in the inventory below are live in the software stack.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3" style={{ gap: 16 }}>
        {CAPABILITIES.map(({ Icon, name, component, benefit }) => (
          <div key={name} style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Icon size={20} strokeWidth={1.6} color="#100F0F" />
              <span
                className="cc-mono"
                style={{ fontSize: 9, padding: "3px 8px", borderRadius: 999, background: "#F7F3F1", color: "#767270" }}
              >
                TARGET
              </span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#100F0F", marginBottom: 4 }}>{name}</div>
            <div style={{ fontSize: 12, color: "#767270", marginBottom: 8 }}>{component}</div>
            <div style={{ fontSize: 12.5, color: "#575452", lineHeight: 1.55 }}>{benefit}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 className="cc-serif" style={{ margin: 0, fontSize: 22, color: "#100F0F" }}>Crypto-agility inventory</h2>
          {inv && (
            <div className="cc-mono" style={{ fontSize: 11, color: "#575452" }}>
              {inv.summary.quantum_safe} safe · {inv.summary.partial} review ·{" "}
              <span style={{ color: "#B3261E" }}>{inv.summary.at_risk} at risk</span> · {inv.summary.total} total
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: "#B3261E" }}>{error}</div>
        )}
        {!inv && !error && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: "#767270" }}>Loading inventory…</div>
        )}

        {inv && (
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#969290" }}>
                  {["Asset", "Algorithm", "Endpoint", "Status", "HSM home (LinuxONE)"].map((h) => (
                    <th key={h} className="cc-mono" style={{ fontSize: 10, fontWeight: 500, padding: "8px 10px", borderBottom: "1px solid #EAE4E1" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it) => {
                  const s = SAFETY_STYLE[it.quantum_safe];
                  return (
                    <tr key={it.id} style={{ verticalAlign: "top" }}>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F3EEEC", color: "#100F0F" }}>
                        {it.asset}
                        <div style={{ fontSize: 11, color: "#969290" }}>{it.purpose}</div>
                      </td>
                      <td className="cc-mono" style={{ padding: "10px", borderBottom: "1px solid #F3EEEC", fontSize: 11.5 }}>
                        {it.algorithm}
                      </td>
                      <td className="cc-mono" style={{ padding: "10px", borderBottom: "1px solid #F3EEEC", fontSize: 11, color: "#767270" }}>
                        {it.endpoint}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F3EEEC" }}>
                        <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>
                          {s.label}
                        </span>
                        {it.note && <div style={{ fontSize: 11, color: "#767270", marginTop: 4, maxWidth: 240 }}>{it.note}</div>}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #F3EEEC", fontSize: 11.5, color: "#575452" }}>
                        {it.hsm_target ?? "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
