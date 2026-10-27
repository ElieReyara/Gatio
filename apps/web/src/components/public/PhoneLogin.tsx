'use client';

import { normalizeChadPhone, OTP_LOCKED, OTP_RESEND_SECONDS } from '@gatio/shared';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { Icon } from '@/components/Icon';
import { CodeInput } from '@/components/public/CodeInput';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { postJson } from '@/lib/api-client';
import { formatPhone } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.buyerLogin;
type Step = 'phone' | 'code' | 'locked';

// Connexion par code SMS (maquette B6) : numéro, code, code erroné, trop d'essais. Sert à
// « Mes billets » et, avant la première réservation, au parcours B3 (journal de bord n° 71).
export function PhoneLogin({
  phone: presetPhone,
  withHeader = false,
  verifiedNext,
  onVerified,
  onChangePhone,
}: {
  // Numéro déjà saisi (parcours B3) : le code est demandé dès l'affichage.
  phone?: string;
  withHeader?: boolean;
  // Ce qui suit le code validé (« Réservation en cours… »), affiché jusqu'à l'écran suivant.
  verifiedNext?: string;
  onVerified: () => void;
  onChangePhone?: () => void;
}) {
  const [step, setStep] = useState<Step>(presetPhone ? 'code' : 'phone');
  const [phone, setPhone] = useState(presetPhone ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // Envoi du code (busy) et vérification (checking) sont distincts : seule la vérification
  // remplace les commandes de l'écran par son état (revue du lot 8b).
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(false);
  const [wrong, setWrong] = useState<{ attemptsLeft: number | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  // Le texte « Nous l'avons envoyé au… » n'apparaît qu'une fois l'envoi accepté.
  const [sent, setSent] = useState(false);
  const errorId = useId();
  const [now, setNow] = useState(() => Date.now());
  const requested = useRef(false);

  useEffect(() => {
    if (step !== 'code') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  async function requestCode(target: string) {
    setBusy(true);
    setFailure(null);
    const result = await postJson('/auth/buyer/otp/request', { phone: target });
    setBusy(false);
    if (result.ok) {
      setSent(true);
      setResendAt(Date.now() + OTP_RESEND_SECONDS * 1000);
      setNow(Date.now());
      setCode('');
      setWrong(null);
      return true;
    }
    if (result.status === 429 && result.error?.details.reason === OTP_LOCKED) setStep('locked');
    else if (result.status === 429) setFailure(t.tooManyCodes);
    else if (result.error?.code === 'VALIDATION_ERROR') {
      if (step === 'code') setFailure(t.phoneInvalid);
      else setPhoneError(t.phoneInvalid);
    } else setFailure(t.unavailable);
    return false;
  }

  useEffect(() => {
    if (!presetPhone || requested.current) return;
    requested.current = true;
    void requestCode(presetPhone);
  }, [presetPhone]);

  async function submitPhone(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) return;
    if (!normalizeChadPhone(phone)) {
      setPhoneError(t.phoneInvalid);
      return;
    }
    if (await requestCode(phone)) setStep('code');
  }

  async function verify(value: string) {
    if (checking || verified || value.length !== 6) return;
    setChecking(true);
    setFailure(null);
    const result = await postJson('/auth/buyer/otp/verify', { phone, code: value });
    setChecking(false);
    if (result.ok) {
      setVerified(true);
      onVerified();
      return;
    }
    const details = result.error?.details ?? {};
    if (result.status === 429 && details.reason === OTP_LOCKED) setStep('locked');
    else if (result.error?.code === 'TOKEN_INVALID') {
      const left = details.attemptsLeft;
      setWrong({ attemptsLeft: typeof left === 'number' ? left : null });
    } else if (result.status === 429) setFailure(t.tooManyCodes);
    else setFailure(t.unavailable);
  }

  function changeCode(value: string) {
    if (verified) return;
    setCode(value);
    if (wrong) setWrong(null);
    // Code complet (tapé, collé ou proposé par le téléphone) : vérifié tout de suite, sans
    // bouton à appuyer (retour du responsable au PC-8).
    if (value.length === 6) void verify(value);
  }

  function changePhone() {
    if (onChangePhone) {
      onChangePhone();
      return;
    }
    setStep('phone');
    setCode('');
    setWrong(null);
    setFailure(null);
    setSent(false);
  }

  const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  // « Mes billets » : en-tête et pied communs (27/10/2026) ; « Changer de numéro » sert de
  // retour. Parcours d'achat : le cadre est celui de la réservation.
  const frame = (content: ReactNode) =>
    withHeader ? (
      <>
        <PublicHeader current="tickets" />
        <main className="page page--card">{content}</main>
        <PublicFooter onMyTickets />
      </>
    ) : (
      content
    );

  if (step === 'locked') {
    return frame(
      <div className="stack">
        <div className="banner banner--info" role="alert">
          <Icon name="clock" strokeWidth={2.4} />
          <span>
            <strong>{t.lockedStrong}</strong> {t.lockedText}
          </span>
        </div>
        {/* Parcours d'achat : le lien de l'email ne concerne pas une réservation à faire. */}
        {!onChangePhone && <p className="lead">{t.lockedHelp}</p>}
        <Link className="button-secondary button-link" href="/support">
          {t.contactSupport}
        </Link>
        {onChangePhone && (
          <button type="button" className="link link-button" onClick={changePhone}>
            {t.changePhone}
          </button>
        )}
      </div>,
    );
  }

  if (step === 'phone') {
    return frame(
      <form className="stack" onSubmit={submitPhone} noValidate>
        <h1 className="title title--flush">{t.title}</h1>
        <p className="lead">{t.intro}</p>
        {failure && <Banner kind="error">{failure}</Banner>}
        <Field
          label={t.phone}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t.phonePlaceholder}
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            setPhoneError(null);
          }}
          error={phoneError}
          disabled={busy}
        />
        <button type="submit" className="button-primary" disabled={busy || phoneError !== null}>
          {busy ? t.sending : t.send}
        </button>
        <p className="fine-print fine-print--left">{t.noPassword}</p>
      </form>,
    );
  }

  // Pendant et après la vérification, plus de bouton « Valider » : seulement l'état du code.
  const done = checking || verified;
  return frame(
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        // Touche « OK » du clavier après un refus : le même code faux ne consomme pas un essai.
        if (wrong) return;
        // Le bouton « Valider » disparaît : le focus revient au champ du code.
        event.currentTarget.querySelector('input')?.focus();
        void verify(code);
      }}
      noValidate
    >
      <h1 className="title title--flush">{t.codeTitle}</h1>
      {wrong ? (
        <div id={errorId}>
          <Banner kind="error">
            <strong>{t.wrongStrong}</strong>
            {wrong.attemptsLeft !== null && <> {t.attemptsLeft(wrong.attemptsLeft)}</>}
          </Banner>
        </div>
      ) : !sent ? (
        !failure && (
          <p className="lead" role="status">
            {t.sending}
          </p>
        )
      ) : (
        <p className="lead">
          {presetPhone && <>{t.checkoutIntro} </>}
          {t.sentTo}{' '}
          <strong className="nowrap">{formatPhone(normalizeChadPhone(phone) ?? phone)}</strong>.{' '}
          {t.validity}
        </p>
      )}
      {failure && <Banner kind="error">{failure}</Banner>}
      <CodeInput
        value={code}
        onChange={changeCode}
        error={wrong !== null}
        describedBy={wrong ? errorId : undefined}
        busy={done}
        autoFocus
      />
      {/* Une seule zone annoncée : l'état du code (bandeau sans rôle propre). */}
      <div aria-live="polite">
        {checking && (
          <p className="code-status">
            <Icon name="clock" size={20} />
            {t.verifying}
          </p>
        )}
        {verified && (
          <div className="banner banner--success">
            <span className="banner-icon banner-icon--success">
              <Icon name="check" size={16} strokeWidth={3} />
            </span>
            <span>
              <strong>{t.verified}</strong>
              {verifiedNext && <> {verifiedNext}</>}
            </span>
          </div>
        )}
      </div>
      {!done && (
        <>
          {/* Le bouton ne sert qu'à réessayer un code complet après une panne. */}
          {failure && code.length === 6 ? (
            <button type="submit" className="button-primary">
              {t.verify}
            </button>
          ) : (
            <p className="fine-print">{t.autoCheck}</p>
          )}
          {seconds > 0 ? (
            <p className="fine-print" role="status">
              {t.resendIn(`0:${String(seconds).padStart(2, '0')}`)}
            </p>
          ) : (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                if (!busy) void requestCode(phone);
              }}
            >
              {busy ? t.sending : t.resend}
            </button>
          )}
        </>
      )}
      {/* Toujours possible tant que le code n'est pas validé (réseau qui ne répond plus). */}
      {!verified && (
        <button type="button" className="link link-button" onClick={changePhone}>
          {t.changePhone}
        </button>
      )}
    </form>,
  );
}
