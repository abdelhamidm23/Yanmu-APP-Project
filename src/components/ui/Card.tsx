import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-card border border-border bg-surface p-4 ${className}`} {...props} />;
}
