import type { ThreatSeverity, Decision } from "../../../types/btic";

export const THREAT_DATA = [
  { date: "Mon", critical: 12, high: 28, medium: 45, low: 67 },
  { date: "Tue", critical: 8, high: 32, medium: 38, low: 72 },
  { date: "Wed", critical: 15, high: 25, medium: 52, low: 58 },
  { date: "Thu", critical: 11, high: 30, medium: 41, low: 63 },
  { date: "Fri", critical: 18, high: 35, medium: 48, low: 55 },
  { date: "Sat", critical: 9, high: 22, medium: 35, low: 80 },
  { date: "Sun", critical: 7, high: 18, medium: 30, low: 85 },
];

export const DECISION_DATA = [
  { decision: "APPROVE", count: 1847, color: "#3D8B5A" },
  { decision: "STEP_UP", count: 234, color: "#B7791F" },
  { decision: "HARD_BLOCK", count: 89, color: "#B3261E" },
];

export const GEO_DATA = [
  { state: "Delhi NCR", threats: 47, severity: "CRITICAL" },
  { state: "Maharashtra", threats: 38, severity: "HIGH" },
  { state: "Uttar Pradesh", threats: 32, severity: "HIGH" },
  { state: "Gujarat", threats: 28, severity: "MEDIUM" },
  { state: "Karnataka", threats: 24, severity: "MEDIUM" },
  { state: "Tamil Nadu", threats: 21, severity: "MEDIUM" },
  { state: "Rajasthan", threats: 18, severity: "LOW" },
  { state: "West Bengal", threats: 15, severity: "LOW" },
  { state: "Punjab", threats: 12, severity: "LOW" },
  { state: "Telangana", threats: 11, severity: "LOW" },
];

export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#B3261E",
  HIGH: "#B7791F",
  MEDIUM: "#B8920F",
  LOW: "#3D8B5A",
};

// Indian cities with precise coordinates for map visualization
export const INDIAN_CITIES = [
  { name: "Mumbai", state: "Maharashtra", lat: 19.076, lng: 72.8777, population: 12442373, threatCount: 38, severity: "HIGH" as const },
  { name: "Delhi", state: "Delhi NCR", lat: 28.7041, lng: 77.1025, population: 16787941, threatCount: 47, severity: "CRITICAL" as const },
  { name: "Bangalore", state: "Karnataka", lat: 12.9716, lng: 77.5946, population: 8443675, threatCount: 24, severity: "MEDIUM" as const },
  { name: "Hyderabad", state: "Telangana", lat: 17.385, lng: 78.4867, population: 6810000, threatCount: 11, severity: "LOW" as const },
  { name: "Ahmedabad", state: "Gujarat", lat: 23.0225, lng: 72.5714, population: 5633927, threatCount: 28, severity: "MEDIUM" as const },
  { name: "Chennai", state: "Tamil Nadu", lat: 13.0827, lng: 80.2707, population: 7088000, threatCount: 21, severity: "MEDIUM" as const },
  { name: "Kolkata", state: "West Bengal", lat: 22.5726, lng: 88.3639, population: 4496694, threatCount: 15, severity: "LOW" as const },
  { name: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567, population: 3124458, threatCount: 18, severity: "MEDIUM" as const },
  { name: "Jaipur", state: "Rajasthan", lat: 26.9124, lng: 75.7873, population: 3073350, threatCount: 18, severity: "LOW" as const },
  { name: "Lucknow", state: "Uttar Pradesh", lat: 26.8467, lng: 80.9462, population: 2817105, threatCount: 32, severity: "HIGH" as const },
  { name: "Kanpur", state: "Uttar Pradesh", lat: 26.4499, lng: 80.3319, population: 2768057, threatCount: 14, severity: "LOW" as const },
  { name: "Nagpur", state: "Maharashtra", lat: 21.1458, lng: 79.0882, population: 2497870, threatCount: 12, severity: "LOW" as const },
  { name: "Indore", state: "Madhya Pradesh", lat: 22.7196, lng: 75.8577, population: 1994397, threatCount: 9, severity: "LOW" as const },
  { name: "Bhopal", state: "Madhya Pradesh", lat: 23.2599, lng: 77.4126, population: 1798218, threatCount: 7, severity: "LOW" as const },
  { name: "Patna", state: "Bihar", lat: 25.6093, lng: 85.1376, population: 1684222, threatCount: 16, severity: "LOW" as const },
  { name: "Vadodara", state: "Gujarat", lat: 22.3072, lng: 73.1812, population: 1822221, threatCount: 10, severity: "LOW" as const },
  { name: "Surat", state: "Gujarat", lat: 21.1702, lng: 72.8311, population: 4467797, threatCount: 19, severity: "MEDIUM" as const },
  { name: "Visakhapatnam", state: "Andhra Pradesh", lat: 17.6868, lng: 83.2185, population: 1728128, threatCount: 8, severity: "LOW" as const },
  { name: "Chandigarh", state: "Punjab", lat: 30.7333, lng: 76.7794, population: 1055450, threatCount: 12, severity: "LOW" as const },
  { name: "Coimbatore", state: "Tamil Nadu", lat: 11.0168, lng: 76.9558, population: 1061447, threatCount: 9, severity: "LOW" as const },
  { name: "Kochi", state: "Kerala", lat: 9.9312, lng: 76.2673, population: 602046, threatCount: 6, severity: "LOW" as const },
  { name: "Thiruvananthapuram", state: "Kerala", lat: 8.5241, lng: 76.9366, population: 957730, threatCount: 5, severity: "LOW" as const },
  { name: "Agra", state: "Uttar Pradesh", lat: 27.1767, lng: 78.0081, population: 1585704, threatCount: 11, severity: "LOW" as const },
  { name: "Nashik", state: "Maharashtra", lat: 19.9975, lng: 73.7898, population: 1486053, threatCount: 8, severity: "LOW" as const },
  { name: "Faridabad", state: "Haryana", lat: 28.4089, lng: 77.3178, population: 1394000, threatCount: 15, severity: "MEDIUM" as const },
  { name: "Ghaziabad", state: "Uttar Pradesh", lat: 28.6692, lng: 77.4538, population: 1636000, threatCount: 18, severity: "MEDIUM" as const },
  { name: "Rajkot", state: "Gujarat", lat: 22.3039, lng: 70.8022, population: 1286000, threatCount: 7, severity: "LOW" as const },
  { name: "Varanasi", state: "Uttar Pradesh", lat: 25.3176, lng: 82.9739, population: 1198491, threatCount: 13, severity: "LOW" as const },
  { name: "Srinagar", state: "Jammu & Kashmir", lat: 34.0837, lng: 74.7973, population: 1180570, threatCount: 9, severity: "LOW" as const },
  { name: "Aurangabad", state: "Maharashtra", lat: 19.8762, lng: 75.3433, population: 1175116, threatCount: 6, severity: "LOW" as const },
];

// Severity to RGBA color mapping for deck.gl
export const SEVERITY_RGBA: Record<string, [number, number, number, number]> = {
  CRITICAL: [255, 69, 58, 230],
  HIGH: [255, 159, 10, 210],
  MEDIUM: [255, 214, 10, 190],
  LOW: [48, 209, 88, 170],
  INFO: [100, 210, 255, 150],
};

// Threat types for random simulation
export const THREAT_TYPES = [
  "SIM_SWAP",
  "CREDENTIAL_THEFT",
  "BEHAVIORAL_ANOMALY",
  "MONEY_MULE",
  "MERCHANT_ABUSE",
  "IDENTITY_MISMATCH",
  "COERCION",
] as const;

// Channel types
export const CHANNELS = ["UPI", "NEFT", "RTGS", "IMPS", "NET_BANKING", "MOBILE_BANKING"] as const;

// Generate mock threat event for a city
export function generateThreatForCity(city: typeof INDIAN_CITIES[0]) {
  const type = THREAT_TYPES[Math.floor(Math.random() * THREAT_TYPES.length)];
  const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
  const severityWeights = city.severity === "CRITICAL" ? [0.3, 0.3, 0.25, 0.15] :
    city.severity === "HIGH" ? [0.15, 0.35, 0.3, 0.2] :
    city.severity === "MEDIUM" ? [0.05, 0.15, 0.45, 0.35] :
    [0.02, 0.08, 0.3, 0.6];

  const rand = Math.random();
  let cumulative = 0;
  let severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "LOW";
  for (let i = 0; i < severities.length; i++) {
    cumulative += severityWeights[i];
    if (rand < cumulative) {
      severity = severities[i];
      break;
    }
  }

  return {
    id: `threat-${city.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    severity: severity as ThreatSeverity,
    confidence: 0.7 + Math.random() * 0.3,
    location: {
      state: city.state,
      stateCode: city.state.slice(0, 2).toUpperCase(),
      city: city.name,
      lat: city.lat + (Math.random() - 0.5) * 0.1,
      lng: city.lng + (Math.random() - 0.5) * 0.1,
    },
    customerHash: `cust_${Math.random().toString(36).slice(2, 10)}`,
    sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`,
    riskScore: Math.floor(Math.random() * 1000),
    decision: (Math.random() > 0.85 ? "HARD_BLOCK" : Math.random() > 0.6 ? "STEP_UP" : "APPROVE") as Decision,
    details: `${type.replace(/_/g, " ")} detected in ${city.name}`,
    channel: CHANNELS[Math.floor(Math.random() * CHANNELS.length)],
    pathway: "DIGITAL_CHANNEL",
  };
}
