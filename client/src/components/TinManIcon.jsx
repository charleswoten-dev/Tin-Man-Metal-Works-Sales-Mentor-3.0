import { useId } from 'react';

// Reusable Tin Man robot-face icon. Used for the sidebar logo, bot message
// avatars, onboarding, etc. `bg` toggles the dark backdrop square.
export default function TinManIcon({ size = 40, bg = true, className = '' }) {
  const glow = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Tin Man"
    >
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {bg && <rect width="512" height="512" rx="96" fill="#111111" />}

      <g stroke="#00E676" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <line x1="256" y1="120" x2="256" y2="80" />
        <circle cx="140" cy="248" r="18" />
        <circle cx="372" cy="248" r="18" />
        <rect x="146" y="120" width="220" height="250" rx="30" />
        <circle cx="256" cy="252" r="11" />
        <rect x="196" y="296" width="120" height="44" rx="7" />
        <line x1="222" y1="296" x2="222" y2="340" strokeWidth="6" />
        <line x1="248" y1="296" x2="248" y2="340" strokeWidth="6" />
        <line x1="274" y1="296" x2="274" y2="340" strokeWidth="6" />
        <line x1="300" y1="296" x2="300" y2="340" strokeWidth="6" />
      </g>

      <g fill="#00E676" filter={`url(#${glow})`}>
        <circle cx="256" cy="66" r="13" />
        <rect x="176" y="184" width="56" height="40" rx="9" />
        <rect x="280" y="184" width="56" height="40" rx="9" />
      </g>
    </svg>
  );
}
