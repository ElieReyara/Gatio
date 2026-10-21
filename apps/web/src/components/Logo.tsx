import { texts } from '@/texts/fr';

// Logo provisoire du système de design : billet à encoches + « Gatio » en brand.
export function Logo() {
  return (
    <span className="logo">
      <svg
        viewBox="0 0 24 24"
        width="28"
        height="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" />
      </svg>
      {texts.app.name}
    </span>
  );
}
