import type { GraphNode, GraphEdge, GraphData, GraphNodeType, GraphEdgeType } from "../types/btic";

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function generateHash(): string {
  const chars = "0123456789abcdef";
  let hash = "";
  for (let i = 0; i < 8; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

const NODE_COLORS: Record<GraphNodeType, string> = {
  user: "var(--color-primary)",
  device: "#64D2FF",
  behavior: "var(--color-accent-emerald)",
  recipient: "#BF5AF2",
  merchant: "#FF9F0A",
  telecom: "#5E5CE6",
  campaign: "var(--color-accent-rose)",
  bank: "#FFD60A",
};

/**
 * Generate a realistic fraud ring graph for demo purposes.
 */
export function generateMockGraph(): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // ── Central fraudster ──────────────────────────────────────────────────
  const centralUser: GraphNode = {
    id: `user-${generateId()}`,
    type: "user",
    label: "Suspicious Identity",
    confidence: 0.92,
    importance: 10,
    metadata: {
      customerHash: generateHash(),
      riskLevel: "CRITICAL",
      sessions: 14,
      firstSeen: "2026-06-15T10:00:00Z",
      lastSeen: "2026-07-06T08:30:00Z",
    },
  };
  nodes.push(centralUser);

  // ── Connected devices ──────────────────────────────────────────────────
  const devices: GraphNode[] = [];
  for (let i = 0; i < 5; i++) {
    const device: GraphNode = {
      id: `device-${generateId()}`,
      type: "device",
      label: `Device ${i + 1}`,
      confidence: 0.7 + Math.random() * 0.3,
      importance: 5 + Math.floor(Math.random() * 4),
      metadata: {
        imei: `IMEI-${Math.floor(Math.random() * 900000000000000) + 100000000000000}`,
        trusted: i === 0,
        os: ["Android 14", "iOS 17", "Android 13", "iOS 16", "Android 14"][i],
      },
    };
    devices.push(device);
    nodes.push(device);
    edges.push({
      id: `edge-${generateId()}`,
      source: centralUser.id,
      target: device.id,
      type: "shared_device",
      confidence: 0.85 + Math.random() * 0.15,
      evidenceCount: 3 + Math.floor(Math.random() * 12),
      firstSeen: "2026-06-20T00:00:00Z",
      lastSeen: "2026-07-06T08:00:00Z",
      explanation: `Observed in ${3 + Math.floor(Math.random() * 12)} blocked sessions`,
    });
  }

  // ── Recipients (money mules) ──────────────────────────────────────────
  const recipients: GraphNode[] = [];
  for (let i = 0; i < 20; i++) {
    const recipient: GraphNode = {
      id: `recipient-${generateId()}`,
      type: "recipient",
      label: `Account ${generateHash()}`,
      confidence: 0.6 + Math.random() * 0.4,
      importance: 3 + Math.floor(Math.random() * 6),
      metadata: {
        accountHash: generateHash(),
        totalReceived: Math.floor(Math.random() * 500000),
        transactionCount: Math.floor(Math.random() * 30) + 1,
        riskLevel: Math.random() > 0.7 ? "HIGH" : "MEDIUM",
      },
    };
    recipients.push(recipient);
    nodes.push(recipient);

    // Connect some recipients to the central user
    if (Math.random() > 0.3) {
      edges.push({
        id: `edge-${generateId()}`,
        source: centralUser.id,
        target: recipient.id,
        type: "shared_recipient",
        confidence: 0.6 + Math.random() * 0.4,
        evidenceCount: Math.floor(Math.random() * 8) + 1,
        firstSeen: "2026-06-25T00:00:00Z",
        lastSeen: "2026-07-05T00:00:00Z",
        explanation: `Shared recipient in ${Math.floor(Math.random() * 8) + 1} sessions`,
      });
    }
  }

  // ── Merchants ──────────────────────────────────────────────────────────
  const merchants: GraphNode[] = [];
  for (let i = 0; i < 3; i++) {
    const merchant: GraphNode = {
      id: `merchant-${generateId()}`,
      type: "merchant",
      label: `Merchant ${generateHash()}`,
      confidence: 0.5 + Math.random() * 0.5,
      importance: 4 + Math.floor(Math.random() * 3),
      metadata: {
        merchantId: generateHash(),
        category: ["Electronics", "Travel", "Gift Cards"][i],
        riskScore: Math.floor(Math.random() * 40) + 60,
      },
    };
    merchants.push(merchant);
    nodes.push(merchant);

    edges.push({
      id: `edge-${generateId()}`,
      source: centralUser.id,
      target: merchant.id,
      type: "shared_merchant",
      confidence: 0.5 + Math.random() * 0.5,
      evidenceCount: Math.floor(Math.random() * 5) + 1,
      firstSeen: "2026-06-28T00:00:00Z",
      lastSeen: "2026-07-04T00:00:00Z",
      explanation: `Transaction to this merchant in ${Math.floor(Math.random() * 5) + 1} sessions`,
    });
  }

  // ── Telecom (SIM info) ─────────────────────────────────────────────────
  const telecom: GraphNode = {
    id: `telecom-${generateId()}`,
    type: "telecom",
    label: "Delhi Circle",
    confidence: 0.88,
    importance: 6,
    metadata: {
      circle: "Delhi",
      simChangeCount: 3,
      lastSimChange: "2026-07-01T14:30:00Z",
    },
  };
  nodes.push(telecom);
  edges.push({
    id: `edge-${generateId()}`,
    source: centralUser.id,
    target: telecom.id,
    type: "shared_sim",
    confidence: 0.88,
    evidenceCount: 3,
    firstSeen: "2026-07-01T14:30:00Z",
    lastSeen: "2026-07-01T14:30:00Z",
    explanation: "3 SIM changes in 30 days",
  });

  // ── Campaign ───────────────────────────────────────────────────────────
  const campaign: GraphNode = {
    id: `campaign-${generateId()}`,
    type: "campaign",
    label: "Delhi SIM Swap Ring",
    confidence: 0.92,
    importance: 9,
    metadata: {
      campaignId: "cmp-001",
      status: "ACTIVE",
      victimCount: 34,
      estimatedLoss: 4200000,
    },
  };
  nodes.push(campaign);
  edges.push({
    id: `edge-${generateId()}`,
    source: centralUser.id,
    target: campaign.id,
    type: "campaign_member",
    confidence: 0.92,
    evidenceCount: 14,
    firstSeen: "2026-06-15T00:00:00Z",
    lastSeen: "2026-07-06T00:00:00Z",
    explanation: "Behavioral pattern matches campaign signature",
  });

  // ── Behavior node ──────────────────────────────────────────────────────
  const behavior: GraphNode = {
    id: `behavior-${generateId()}`,
    type: "behavior",
    label: "Behavioral Fingerprint",
    confidence: 0.85,
    importance: 7,
    metadata: {
      typingStability: 0.23,
      touchRhythm: 0.31,
      interactionConsistency: 0.19,
      driftFromBaseline: 0.78,
    },
  };
  nodes.push(behavior);
  edges.push({
    id: `edge-${generateId()}`,
    source: centralUser.id,
    target: behavior.id,
    type: "behavior_similarity",
    confidence: 0.85,
    evidenceCount: 14,
    firstSeen: "2026-06-15T00:00:00Z",
    lastSeen: "2026-07-06T00:00:00Z",
    explanation: "Behavioral drift of 78% from established baseline",
  });

  // ── Cross-connections between recipients (mule network) ────────────────
  for (let i = 0; i < Math.min(recipients.length - 1, 10); i++) {
    const a = recipients[i];
    const b = recipients[i + 1];
    if (Math.random() > 0.5) {
      edges.push({
        id: `edge-${generateId()}`,
        source: a.id,
        target: b.id,
        type: "shared_recipient",
        confidence: 0.4 + Math.random() * 0.4,
        evidenceCount: Math.floor(Math.random() * 4) + 1,
        firstSeen: "2026-06-28T00:00:00Z",
        lastSeen: "2026-07-05T00:00:00Z",
        explanation: `Both recipients appear in ${Math.floor(Math.random() * 4) + 1} sessions`,
      });
    }
  }

  // ── Normal users (background noise) ────────────────────────────────────
  for (let i = 0; i < 50; i++) {
    const user: GraphNode = {
      id: `user-${generateId()}`,
      type: "user",
      label: `User ${generateHash()}`,
      confidence: 0.8 + Math.random() * 0.2,
      importance: 1 + Math.floor(Math.random() * 3),
      metadata: {
        customerHash: generateHash(),
        riskLevel: "LOW",
      },
    };
    nodes.push(user);

    // Connect to 1-2 random recipients
    if (Math.random() > 0.6) {
      const recipient = recipients[Math.floor(Math.random() * recipients.length)];
      edges.push({
        id: `edge-${generateId()}`,
        source: user.id,
        target: recipient.id,
        type: "money_transfer",
        confidence: 0.3 + Math.random() * 0.4,
        evidenceCount: 1,
        firstSeen: "2026-07-01T00:00:00Z",
        lastSeen: "2026-07-05T00:00:00Z",
        explanation: "Single transaction to shared recipient",
      });
    }
  }

  return { nodes, edges };
}

export const MOCK_GRAPH_DATA = generateMockGraph();
