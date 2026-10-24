import { notFound } from 'next/navigation';
import { apiUrl } from '@/lib/api';
import { texts } from '@/texts/fr';
import { FakeOperator } from './FakeOperator';

// Outil d'essai (tranche 6) : accepter, refuser ou perdre un paiement du faux prestataire.
export const dynamic = 'force-dynamic';

export default async function FakeOperatorPage() {
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}/api/v1/dev/fake-payments`, { cache: 'no-store' });
  } catch {
    return <p className="page">{texts.fakeOperator.unavailable}</p>;
  }
  // Les routes d'essai n'existent pas en production.
  if (response.status === 404) notFound();
  return <FakeOperator />;
}
