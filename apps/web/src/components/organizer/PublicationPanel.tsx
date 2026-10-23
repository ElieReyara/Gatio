'use client';

import type { OrganizerEventDetail } from '@gatio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { Sheet } from '@/components/Sheet';
import { sendJson, type ApiResult } from '@/lib/api-client';
import { formatDateTime, fromChadInput, toChadInput } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.space.publication;
type Action = 'publish' | 'unpublish' | 'postpone' | 'cancel';
type Notice = 'published' | 'republished' | 'unpublished' | null;

export function PublicationPanel({
  event,
  hasPayoutAccount,
  saleUrl,
}: {
  event: OrganizerEventDetail;
  hasPayoutAccount: boolean;
  saleUrl: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<'postpone' | 'cancel' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const sold = event.categories.reduce((total, category) => total + category.quantitySold, 0);
  const hasCategory = event.categories.some((category) => category.archivedAt === null);

  async function act(action: Action, after?: Notice) {
    setBusy(true);
    setFailure(null);
    const result = await sendJson(`POST`, `/organizer/events/${event.id}/${action}`);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      setFailure(errorText(result));
      // Statut changé ailleurs (autre onglet) : on affiche l'état réel.
      if (isOutdated(result)) router.refresh();
      return;
    }
    setNotice(after ?? null);
    router.refresh();
  }

  // Report : on enregistre d'abord la nouvelle date, puis on republie (R34).
  async function republish(formData: FormData) {
    const startsAt = fromChadInput(String(formData.get('startsAt') ?? ''));
    if (!startsAt || new Date(startsAt).getTime() <= Date.now()) {
      setDateError(texts.space.eventForm.startsAtPast);
      return;
    }
    // Republier « avec une nouvelle date » (R34) : la date doit changer.
    if (new Date(startsAt).getTime() === new Date(event.startsAt).getTime()) {
      setDateError(t.sameDate);
      return;
    }
    setDateError(null);
    setBusy(true);
    const patch = await sendJson('PATCH', `/organizer/events/${event.id}`, { startsAt });
    if (!patch.ok) {
      setBusy(false);
      setDateError(errorText(patch));
      return;
    }
    await act('publish', 'republished');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(saleUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const shareUrl = `https://wa.me/?text=${encodeURIComponent(t.shareText(event.title, saleUrl))}`;
  const status = event.status;

  return (
    <>
      {notice === 'published' && (
        <Banner kind="success">
          <strong>{t.published}</strong>
        </Banner>
      )}
      {notice === 'republished' && (
        <Banner kind="success">
          <strong>{t.republishedStrong}</strong> {t.republished(formatDateTime(event.startsAt))}{' '}
          {t.linkUnchanged}
        </Banner>
      )}
      {notice === 'unpublished' && <Banner kind="info">{t.unpublished}</Banner>}
      {status === 'postponed' && (
        <div
          className="status-banner status-banner--postponed status-banner--rounded"
          role="status"
        >
          <span>
            <strong>{t.postponedStrong}</strong> {t.postponedText}
          </span>
        </div>
      )}
      {status === 'cancelled' && (
        <div
          className="status-banner status-banner--cancelled status-banner--rounded"
          role="status"
        >
          <span>
            <strong>{t.cancelledStrong}</strong> {t.cancelledText}
          </span>
        </div>
      )}
      {failure && <Banner kind="error">{failure}</Banner>}

      <h1 className="title title--flush">{event.title}</h1>
      <span className="pill">{texts.space.events.status[status]}</span>

      {status === 'draft' && (
        <>
          <p className="lead muted">{t.draftHint}</p>
          {!hasCategory && (
            <Banner kind="info">
              {t.noCategory}{' '}
              <Link href={`/organisateur/evenements/${event.id}/billets/nouvelle`}>
                {texts.space.categories.add}
              </Link>
            </Banner>
          )}
          {!hasPayoutAccount && (
            <Banner kind="info">
              {t.payoutMissing} <Link href="/organisateur/profil/versement">{t.toProfile}</Link>
            </Banner>
          )}
          <button
            type="button"
            className="button-primary"
            disabled={busy || !hasPayoutAccount || !hasCategory}
            onClick={() => void act('publish', 'published')}
          >
            {t.publish}
          </button>
        </>
      )}

      {status === 'published' && (
        <div className="card">
          <strong>{t.saleLink}</strong>
          <span className="link-box">{saleUrl}</span>
          <button type="button" className="button-primary" onClick={() => void copy()}>
            {copied ? t.copied : t.copy}
          </button>
          <a className="button-secondary button-link" href={shareUrl} rel="noopener noreferrer">
            {t.share}
          </a>
        </div>
      )}

      {status === 'postponed' && (
        <form className="card" action={(formData) => void republish(formData)}>
          <strong>{t.newDate}</strong>
          <Field
            label={texts.space.eventForm.startsAt}
            name="startsAt"
            type="datetime-local"
            defaultValue={toChadInput(event.startsAt)}
            help={t.newDateHelp}
            error={dateError}
          />
          <button type="submit" className="button-primary" disabled={busy}>
            {t.republish}
          </button>
        </form>
      )}

      <div className="card">
        <strong>{t.sales}</strong>
        <span>{t.soldOf(sold, event.capacity)}</span>
      </div>

      {status === 'published' && (
        <>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => void act('unpublish', 'unpublished')}
          >
            {t.unpublish}
          </button>
          <div className="row">
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => setConfirm('postpone')}
            >
              {t.postpone}
            </button>
            <button
              type="button"
              className="button-secondary button-danger-outline"
              disabled={busy}
              onClick={() => setConfirm('cancel')}
            >
              {t.cancel}
            </button>
          </div>
        </>
      )}
      {status === 'postponed' && (
        <button
          type="button"
          className="button-secondary button-danger-outline"
          disabled={busy}
          onClick={() => setConfirm('cancel')}
        >
          {t.cancelEvent}
        </button>
      )}

      {status !== 'cancelled' && (
        <>
          <Link className="link link--left" href={`/organisateur/evenements/${event.id}/infos`}>
            {t.editInfo}
          </Link>
          <Link
            className="link link--left link--tight"
            href={`/organisateur/evenements/${event.id}/billets`}
          >
            {t.editTickets}
          </Link>
        </>
      )}

      {confirm === 'cancel' && (
        <Sheet title={t.cancelTitle} onClose={() => setConfirm(null)}>
          <p>{t.cancelText}</p>
          <button
            type="button"
            className="button-primary button-danger"
            disabled={busy}
            onClick={() => void act('cancel')}
          >
            {t.cancelConfirm}
          </button>
          <button type="button" className="button-secondary" onClick={() => setConfirm(null)}>
            {t.back}
          </button>
        </Sheet>
      )}
      {confirm === 'postpone' && (
        <Sheet title={t.postponeTitle} onClose={() => setConfirm(null)}>
          <p>{t.postponeText}</p>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => void act('postpone')}
          >
            {t.postponeConfirm}
          </button>
          <button type="button" className="button-secondary" onClick={() => setConfirm(null)}>
            {t.back}
          </button>
        </Sheet>
      )}
    </>
  );
}

function isOutdated(result: Extract<ApiResult<unknown>, { ok: false }>): boolean {
  const reason = result.error?.details.reason;
  return reason === 'invalid_status' || reason === 'event_cancelled';
}

function errorText(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  const details = result.error?.details ?? {};
  if (isOutdated(result)) return t.outdated;
  if (details.reason === 'payout_account_missing') return t.payoutMissing;
  if (details.reason === 'no_active_category') return t.noCategory;
  if (details.reason === 'not_in_future') return texts.space.eventForm.startsAtPast;
  if (details.reason === 'sale_period_conflict') {
    const names = (details.categories as string[] | undefined) ?? [];
    return texts.space.eventForm.periodConflict(names.join(', '));
  }
  return texts.form.networkError;
}
