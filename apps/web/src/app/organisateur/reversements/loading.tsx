import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { texts } from '@/texts/fr';

// Reversements en chargement (maquette O9, état 8 : deux lignes).
export default function PayoutsLoading() {
  return (
    <OrganizerShell title={texts.space.payouts.title} section="payouts">
      <div className="stack" role="status" aria-label={texts.space.payouts.loading}>
        <div className="skeleton skeleton--row" />
        <div className="skeleton skeleton--row" />
      </div>
    </OrganizerShell>
  );
}
