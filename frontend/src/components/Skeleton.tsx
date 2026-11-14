// The one loading skeleton of the "soft luxury" surfaces (observer dashboard and the Super Admin
// panel). It lives here, not in one page's parts file, so the two can never drift; the shimmer and
// its reduced-motion rule are in observer.css beside the tokens it uses.
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="obs-skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="obs-skeleton-line" />
      ))}
    </div>
  );
}
