'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Banner } from '@/components/Banner';
import { BackHeader } from '@/components/public/BackHeader';
import { postJson } from '@/lib/api-client';
import { clearLinkParams, readLinkParams } from '@/lib/buyer-storage';
import { texts } from '@/texts/fr';

const t = texts.emailConfirm;
type State = 'checking' | 'confirmed' | 'invalid' | 'error';

// Maquette B9 : email confirmé, ou lien expiré / déjà utilisé.
export function EmailConfirm() {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    const { token } = readLinkParams();
    if (!token) {
      clearLinkParams();
      setState('invalid');
      return;
    }
    // Le lien reste dans l'adresse tant que la réponse n'est pas définitive : après une
    // panne passagère, recharger la page suffit.
    void postJson('/email-verifications/confirm', { token }).then((result) => {
      if (result.ok || result.status === 400) clearLinkParams();
      if (result.ok) setState('confirmed');
      else setState(result.status === 400 ? 'invalid' : 'error');
    });
  }, []);

  return (
    <>
      <BackHeader title={texts.app.name} />
      <main className="page page--flush-top stack">
        {state === 'checking' && (
          <p className="lead" role="status">
            {t.checking}
          </p>
        )}
        {state === 'confirmed' && (
          <>
            <Banner kind="success">
              <strong>{t.confirmed}</strong>
            </Banner>
            <p className="lead">{t.confirmedText}</p>
            <Link className="button-primary button-link" href="/mes-billets">
              {t.toMyTickets}
            </Link>
          </>
        )}
        {state === 'invalid' && (
          <>
            <Banner kind="error">
              <strong>{t.invalid}</strong> {t.invalidText}
            </Banner>
            <p className="lead">{t.stillValid}</p>
            <Link className="button-secondary button-link" href="/mes-billets">
              {t.toMyTickets}
            </Link>
          </>
        )}
        {state === 'error' && <Banner kind="error">{t.unavailable}</Banner>}
      </main>
    </>
  );
}
