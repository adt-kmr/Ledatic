import type { GraphNodeType } from "../../../types/btic";

export const NODE_COLORS: Record<GraphNodeType, string> = {
  user: "var(--color-primary)",
  device: "#2C7A91",
  behavior: "var(--color-accent-emerald)",
  recipient: "#8E5BA8",
  merchant: "#B7791F",
  telecom: "#5B5BA8",
  campaign: "var(--color-accent-rose)",
  bank: "#B8920F",
};
