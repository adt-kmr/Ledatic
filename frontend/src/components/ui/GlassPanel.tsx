import React from "react";

interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "dense";
  noPadding?: boolean;
}

const VARIANT_CLASSES: Record<string, string> = {
  default: "glass-panel",
  elevated: "glass-panel glass-panel-elevated",
  dense: "glass-panel glass-panel-dense",
};

export function GlassPanel({
  variant = "default",
  noPadding = false,
  className = "",
  style,
  children,
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={`${VARIANT_CLASSES[variant]} ${className}`}
      style={{
        ...(noPadding ? { padding: 0 } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
