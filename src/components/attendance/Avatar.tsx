/** A person's photo, or their initials when there is none. Photos are private files served under row-level security. */
export function Avatar({ photoId, name, size = 44 }: { photoId: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return photoId ? (
    // eslint-disable-next-line @next/next/no-img-element -- private files served under row-level security
    <img src={`/api/attachment/${photoId}`} alt="" width={size} height={size} className="shrink-0 rounded-full border border-border object-cover" style={{ inlineSize: size, blockSize: size }} />
  ) : (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-tint font-semibold text-brand" style={{ inlineSize: size, blockSize: size }}>
      {initials}
    </span>
  );
}
