import React from "react";

interface TelumBadgeProps {
  size?: "sm" | "md";
}

/**
 * Design-target badge indicating the Telum on-chip AI accelerator. Always
 * renders as "target" because this build runs on commodity hardware.
 */
export default function TelumBadge({ size = "sm" }: TelumBadgeProps) {
  const padding = size === "md" ? "4px 10px" : "2px 8px";
  const fontSize = size === "md" ? 11 : 9;
  return (
    <span
      className="cc-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize,
        padding,
        borderRadius: 999,
        background: "#F7F3F1",
        color: "#767270",
        border: "1px solid #EAE4E1",
        whiteSpace: "nowrap",
      }}
      title="IBM LinuxONE deployment target - Telum on-chip AI accelerator"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#B7791F",
          display: "inline-block",
        }}
      />
      Telum target
    </span>
  );
}
