/** A flight: the arc of a jump, with the center of mass at its top. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo__mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M4 25 Q16 -3 28 25" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="11" r="3.4" fill="var(--gold-fill)" />
    </svg>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo__word t-brand">TrampoVision</span>
    </span>
  );
}
