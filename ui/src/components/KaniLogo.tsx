/** The Kani crab mark (kani means crab in Japanese). */
export function KaniLogo({ size = 32, color = 'var(--brand)', title }: { size?: number; color?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g stroke={color} strokeWidth="3.4" strokeLinecap="round" fill="none">
        <path d="M20 41 11 45.5M21.5 45.5 14 52M26 48.5l-3.5 7M44 41l9 4.5M42.5 45.5 50 52M38 48.5l3.5 7" />
        <path d="M27 30.5 25 22M37 30.5 39 22" />
        <path d="M19.5 35.5 14 29.5M44.5 35.5 50 29.5" />
      </g>
      <path d="M14.2 30.8C6.8 29.6 4.6 19.4 10.4 14.8l3.3 6.4 4.4-4.9c3.3 6.1 1.6 13.1-3.9 14.5Z" fill={color} />
      <path d="M49.8 30.8c7.4-1.2 9.6-11.4 3.8-16l-3.3 6.4-4.4-4.9c-3.3 6.1-1.6 13.1 3.9 14.5Z" fill={color} />
      <ellipse cx="32" cy="39" rx="16.5" ry="11.5" fill={color} />
      <circle cx="25" cy="20.5" r="4.2" fill="#fff" stroke={color} strokeWidth="2" />
      <circle cx="39" cy="20.5" r="4.2" fill="#fff" stroke={color} strokeWidth="2" />
      <circle cx="25.8" cy="21" r="1.8" fill="#12302a" />
      <circle cx="39.8" cy="21" r="1.8" fill="#12302a" />
      <path d="M27.5 41.5c2.6 2.4 6.4 2.4 9 0" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="24.5" cy="37.5" r="1.6" fill="#fff" opacity=".55" />
      <circle cx="39.5" cy="37.5" r="1.6" fill="#fff" opacity=".55" />
    </svg>
  );
}
