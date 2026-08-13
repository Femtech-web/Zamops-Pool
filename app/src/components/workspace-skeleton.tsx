type WorkspaceSkeletonProps = {
  label: string;
  variant?: "pool" | "tokens";
};

export function WorkspaceSkeleton({ label, variant = "pool" }: WorkspaceSkeletonProps) {
  return (
    <section className={`workspace-skeleton workspace-skeleton--${variant}`} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skeleton-heading">
        <i className="skeleton-line skeleton-line--short" />
        <i className="skeleton-line skeleton-line--title" />
        <i className="skeleton-line skeleton-line--copy" />
      </div>
      <i className="skeleton-strip" />
      <div className="skeleton-grid">
        <i />
        <i />
      </div>
      {variant === "tokens" ? <><i className="skeleton-row" /><i className="skeleton-row" /></> : <i className="skeleton-panel" />}
    </section>
  );
}
