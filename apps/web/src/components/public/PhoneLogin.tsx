'use client';

import { normalizeChadPhone, OTP_LOCKED, OTP_RESEND_SECONDS } from '@gatio/shared';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { Icon } from '@/components/Icon';
import { CodeInput } from '@/components/public/CodeInput';
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
  onVerified,
  onChangePhone,
}: {
  // Numéro déjà saisi (parcours B3) : le code est demandé dès l'affichage.
  phone?: string;
  withHeader?: boolean;
  onVerified: () => void;
  onChangePhone?: () => void;
}) {
  const [step, setStep] = useState<Step>(presetPhone ? 'code' : 'phone');
  const [phone, setPhone] = useState(presetPhone ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
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
    if (busy || value.length !== 6) return;
    setBusy(true);
    setFailure(null);
    const result = await postJson('/auth/buyer/otp/verify', { phone, code: value });
    if (result.ok) {
      onVerified();
      return;
    }
    setBusy(false);
    const details = result.error?.details ?? {};
    if (result.status === 429 && details.reason === OTP_LOCKED) setStep('locked');
    else if (result.error?.code === 'TOKEN_INVALID') {
      const left = details.attemptsLeft;
      setWrong({ attemptsLeft: typeof left === 'number' ? left : null });
    } else if (result.status === 429) setFailure(t.tooManyCodes);
    else setFailure(t.unavailable);
  }

  function changeCode(value: string) {
    setCode(value);
    if (wrong) setWrong(null);
    // Code complet (collé ou proposé par le téléphone) : vérifié tout de suite.
    if (value.length === 6 && !busy) void verify(value);
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
  const frame = (title: string, content: ReactNode, back?: () => void) =>
    withHeader ? (
      <>
        <header className="shell-top public-back">
          {back && (
            <button
              type="button"
              className="shell-back"
              aria-label={texts.space.back}
              onClick={back}
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
          )}
          <span>{title}</span>
        </header>
        <main className="page page--flush-top">{content}</main>
      </>
    ) : (
      content
    );

  if (step === 'locked') {
    return frame(
      texts.app.name,
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
      texts.app.name,
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

  return frame(
    t.codeTop,
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
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
        busy={busy}
        autoFocus
      />
      <button type="submit" className="button-primary" disabled={busy || code.length !== 6}>
        {busy && code.length === 6 ? t.verifying : t.verify}
      </button>
      {seconds > 0 ? (
        <p className="fine-print" role="status">
          {t.resendIn(`0:${String(seconds).padStart(2, '0')}`)}
        </p>
      ) : (
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => void requestCode(phone)}
        >
          {t.resend}
        </button>
      )}
      <button type="button" className="link link-button" onClick={changePhone}>
        {t.changePhone}
      </button>
    </form>,
    changePhone,
  );
}
