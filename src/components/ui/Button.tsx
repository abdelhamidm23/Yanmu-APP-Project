import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "success" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover active:bg-brand-hover",
  success: "bg-good text-white hover:opacity-90",
  secondary: "bg-surface text-ink border border-outline hover:bg-bg",
  danger: "bg-critical text-white hover:opacity-90",
};

export function buttonClasses(variant: Variant = "primary", full = false) {
  return [
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-button px-5 text-[15px] font-semibold",
    "disabled:cursor-not-allowed disabled:opacity-50",
    full ? "w-full" : "",
    variants[variant],
  ].join(" ");
}

export function Button({
  variant = "primary",
  full = false,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  return <button type={type} className={`${buttonClasses(variant, full)} ${className}`} {...props} />;
}
