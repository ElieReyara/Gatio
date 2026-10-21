// Les six icônes du système de design, tracés repris des maquettes validées.
// Trait de 2 px, 24 px, couleur du texte ; toujours accompagnées d'un mot.
const shapes = {
  check: <path d="M5 12l5 5 9-10" />,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <path d="M12 5v9M12 19v.5" />,
  ticket: <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
} as const;

export type IconName = keyof typeof shapes;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {shapes[name]}
    </svg>
  );
}
