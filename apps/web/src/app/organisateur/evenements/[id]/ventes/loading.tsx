import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { texts } from '@/texts/fr';

// Ventes en chargement (maquette O6, état 2) : la page n'a pas encore l'événement, seulement
// des formes à la place des chiffres.
export default function EventSalesLoading() {
  return (
    <OrganizerShell title={texts.space.tabs.sales}>
      <div className="stack" role="status" aria-label={texts.space.sales.loading}>
        <div className="skeleton skeleton--card" />
        <div className="skeleton skeleton--card" />
        <div className="skeleton skeleton--small" />
      </div>
    </OrganizerShell>
  );
}
