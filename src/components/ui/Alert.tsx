export function Alert({ children, tone = "critical" }: { children: React.ReactNode; tone?: "critical" | "good" }) {
  const cls = tone === "critical" ? "bg-critical-bg text-critical" : "bg-verified-bg text-verified-fg";
  return (
    <p role={tone === "critical" ? "alert" : "status"} className={`rounded-button px-3.5 py-3 text-[14px] ${cls}`}>
      {children}
    </p>
  );
}
