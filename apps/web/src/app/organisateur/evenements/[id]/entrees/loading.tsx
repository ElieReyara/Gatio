import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { texts } from '@/texts/fr';

// Rapport d'entrée en chargement (maquette O8, état 6).
export default function EntryReportLoading() {
  return (
    <OrganizerShell title={texts.space.entryReport.title}>
      <div className="stack" role="status" aria-label={texts.space.entryReport.title}>
        <div className="skeleton skeleton--small" />
        <div className="skeleton skeleton--small" />
        <div className="skeleton skeleton--card" />
      </div>
    </OrganizerShell>
  );
}
