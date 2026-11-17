import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

const control =
  "min-h-11 w-full rounded-button border border-outline bg-surface px-3 text-[15px] text-ink disabled:bg-bg disabled:text-muted";

export function Field({ label, id, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-subtle">
        {label}
      </label>
      <input id={id} className={control} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint ? (
        <p id={`${id}-hint`} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  id,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-subtle">
        {label}
      </label>
      <select id={id} className={control} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-[14px]">
      <input type="checkbox" className="size-5 shrink-0 accent-brand" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function PageHeader({ title, help, children }: { title: string; help?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold">{title}</h1>
        {children}
      </div>
      {help ? <p className="text-muted">{help}</p> : null}
    </header>
  );
}
