/** 2D floor plan viewport. Placeholder grid for now; editing arrives in later prompts. */
export function PlanCanvas() {
  return (
    <svg
      data-testid="plan-canvas"
      className="h-full w-full bg-white"
      role="img"
      aria-label="2D floor plan"
    >
      <defs>
        <pattern id="grid-small" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
        </pattern>
        <pattern id="grid-large" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="url(#grid-small)" />
          <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-large)" />
    </svg>
  );
}
