import React from "react";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  accentColor?: string;
  noPadding?: boolean;
}

export function GlassCard({
  hoverable = true,
  accentColor,
  noPadding = false,
  className = "",
  style,
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={`glass-card ${hoverable ? "magnetic-hover" : ""} ${className}`}
      style={{
        ...(accentColor ? { borderLeft: `3px solid ${accentColor}` } : {}),
        ...(noPadding ? { padding: 0 } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
