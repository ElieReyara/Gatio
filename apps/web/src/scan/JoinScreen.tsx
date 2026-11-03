'use client';

import { scanInviteInfoSchema, type ScanEvent } from '@gatio/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { Logo } from '@/components/Logo';
import { postJson } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { texts } from '@/texts/fr';
import { flushPendingPassages } from './network';
import { markJoined } from './session';

const t = texts.join;
type State =
  | { kind: 'checking' }
  | { kind: 'ready'; event: ScanEvent }
  | { kind: 'invalid' }
  | { kind: 'error'; tooMany: boolean };

// Rejoindre le contrôle des entrées (maquette C1) : lien d'invitation, prénom, puis la page
// de scan. Le jeton est après le « # » : il n'apparaît pas dans les journaux du serveur.
export function JoinScreen() {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [firstName, setFirstName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef('');

  useEffect(() => {
    try {
      token.current = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      // Lien abîmé (texte ajouté par une messagerie) : lien invalide.
      token.current = '';
    }
    if (!token.current) {
      setState({ kind: 'invalid' });
      return;
    }
    void postJson('/scan/invite', { inviteToken: token.current }).then((result) => {
      const parsed = result.ok ? scanInviteInfoSchema.safeParse(result.data) : null;
      if (parsed?.success) setState({ kind: 'ready', event: parsed.data.event });
      else if (!result.ok && result.status === 400) setState({ kind: 'invalid' });
      else setState({ kind: 'error', tooMany: !result.ok && result.status === 429 });
    });
  }, []);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) return;
    if (!firstName.trim()) {
      setNameError(t.firstNameMissing);
      return;
    }
    setBusy(true);
    setFailure(null);
    // Passages d'un contrôle précédent sur ce téléphone : envoyés avant de changer de session.
    await flushPendingPassages();
    const result = await postJson('/scan/join', { inviteToken: token.current, firstName });
    if (result.ok) {
      markJoined();
      // Remplacement : le lien et son jeton ne restent pas dans l'historique.
      window.location.replace('/scan');
      return;
    }
    setBusy(false);
    if (result.error?.code === 'INVITE_INVALID') setState({ kind: 'invalid' });
    else if (result.error?.code === 'VALIDATION_ERROR') setNameError(t.firstNameMissing);
    else setFailure(result.status === 429 ? t.tooMany : t.unavailable);
  }

  return (
    <main className="page page--form page--card stack">
      <Logo />
      {/* Lien invalide : la maquette C1 (état 2) n'a que le message. */}
      {state.kind !== 'invalid' && <h1 className="title title--flush">{texts.scan.title}</h1>}
      {state.kind === 'checking' && (
        <p className="lead" role="status">
          {t.checking}
        </p>
      )}
      {state.kind === 'error' && (
        <Banner kind="error">{state.tooMany ? t.tooMany : t.unavailable}</Banner>
      )}
      {state.kind === 'invalid' && (
        <>
          <Banner kind="error">
            <strong>{t.invalidStrong}</strong> {t.invalidText}
          </Banner>
          <button type="button" className="button-primary" disabled>
            {texts.scan.start}
          </button>
        </>
      )}
      {state.kind === 'ready' && (
        <form className="stack" onSubmit={submit} noValidate>
          <p className="lead">
            <strong>{state.event.title}</strong>
            <br />
            {formatDateTime(state.event.startsAt)}
          </p>
          {failure && <Banner kind="error">{failure}</Banner>}
          <Field
            label={t.firstName}
            name="firstName"
            autoComplete="given-name"
            placeholder={t.firstNamePlaceholder}
            maxLength={40}
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
              setNameError(null);
            }}
            error={nameError}
            disabled={busy}
          />
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? t.joining : texts.scan.start}
          </button>
          <Banner kind="info">{texts.scan.installTip}</Banner>
        </form>
      )}
    </main>
  );
}
