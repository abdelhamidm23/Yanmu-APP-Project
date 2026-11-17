import type { InputHTMLAttributes } from "react";

export function TextField({
  label,
  id,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        className={`min-h-12 rounded-button border border-outline bg-surface px-3.5 text-[16px] text-ink placeholder:text-muted ${className}`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
