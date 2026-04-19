import { memo } from "react";
import type { ReactNode } from "react";

type StatusTone = "neutral" | "info" | "success" | "warning" | "error";

type StatusBadgeProps = {
  tone?: StatusTone;
  children: ReactNode;
};

export const StatusBadge = memo(function StatusBadge({
  tone = "neutral",
  children,
}: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
});
