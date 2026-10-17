import { memo, type ReactNode } from "react";

/**
 * Generic memo wrapper for performance-critical components.
 * Usage: Memoize expensive renders that receive stable props.
 */
export const Memoized = memo(function Memoized({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
});

/**
 * Memoized list item wrapper.
 * Prevents re-rendering unchanged items in a list.
 */
export function memoizedListItem<T extends { id: string }>(
  Component: React.FC<{ item: T; [key: string]: any }>,
) {
  return memo(Component, (prev, next) => prev.item.id === next.item.id);
}
