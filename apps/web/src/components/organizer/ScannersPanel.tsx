'use client';

import {
  SCANNER_INVITE_HOURS,
  scannerInviteCreatedSchema,
  type EventStatus,
  type Scanner,
  type ScannerInvite,
} from '@gatio/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner } from '@/components/Banner';
import { Sheet } from '@/components/Sheet';
import { postJson, sendJson } from '@/lib/api-client';
import Link from 'next/link';
import { formatOpening, formatTime, toChadInput } from '@/lib/format';
import { flushPendingPassages } from '@/scan/network';
import { markJoined } from '@/scan/session';
import { texts } from '@/texts/fr';

const t = texts.space.scanners;
type Stored = { inviteId: string; token: string };

// Onglet « Contrôleurs » (maquette O7) : lien d'invitation, liste des contrôleurs, retrait.
// Le jeton du lien n'est connu qu'à sa création (seule son empreinte est gardée par l'API) :
// ce navigateur le garde pour l'afficher de nouveau.
export function ScannersPanel({
  event,
  invites,
  scanners,
  siteUrl,
}: {
  event: { id: string; title: string; status: EventStatus; startsAt: string };
  invites: ScannerInvite[];
  scanners: Scanner[];
  siteUrl: string;
}) {
  const router = useRouter();
  const storageKey = `gatio-invite-${event.id}`;
  // undefined : stockage pas encore lu (rien n'est affiché à la place du lien).
  const [stored, setStored] = useState<Stored | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const active = invites.filter((invite) => invite.active);
  const activeIds = active.map((invite) => invite.id).join(',');

  // Relu à chaque liste reçue du serveur (lien désactivé ou expiré entre-temps).
  useEffect(() => {
    const ids = activeIds.split(',');
    let value: Stored | null = null;
    try {
      value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Stored | null;
      if (value && !ids.includes(value.inviteId)) localStorage.removeItem(storageKey);
    } catch {
      // Stockage bloqué : le lien créé dans cette page reste affiché tant qu'il est actif.
    }
    setStored((current) => {
      if (value && ids.includes(value.inviteId)) return value;
      if (current && ids.includes(current.inviteId)) return current;
      return null;
    });
  }, [activeIds, storageKey]);

  const url = stored ? `${siteUrl}/c#${stored.token}` : null;
  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    let current = true;
    void import('qrcode').then(async (QRCode) => {
      const drawn = await QRCode.toString(url, { type: 'svg', margin: 4 });
      if (current) setQr(drawn);
    });
    return () => {
      current = false;
    };
  }, [url]);

  // Un événement suspendu se contrôle encore (R33) ; annulé ou terminé, non.
  const closed =
    event.status === 'cancelled' ||
    new Date(event.startsAt).getTime() + SCANNER_INVITE_HOURS * 3600 * 1000 <= Date.now();

  async function run(action: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const ok = await action();
    setBusy(false);
    if (!ok) setFailure(t.unavailable);
    router.refresh();
  }

  const create = () =>
    run(async () => {
      const result = await postJson(`/organizer/events/${event.id}/scanner-invites`);
      const parsed = result.ok ? scannerInviteCreatedSchema.safeParse(result.data) : null;
      if (!parsed?.success) return false;
      const value = { inviteId: parsed.data.invite.id, token: parsed.data.token };
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // Stockage indisponible : le lien reste affiché tant que la page est ouverte.
      }
      setStored(value);
      setCopied(false);
      return true;
    });

  const deactivate = (inviteId: string) =>
    run(async () => {
      setConfirm(null);
      const result = await sendJson('DELETE', `/organizer/scanner-invites/${inviteId}`);
      return result.ok;
    });

  const remove = (sessionId: string) =>
    run(async () => (await sendJson('DELETE', `/organizer/scanner-sessions/${sessionId}`)).ok);

  async function selfScan() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    // Passages d'un contrôle précédent sur ce téléphone : envoyés avant de changer de session.
    await flushPendingPassages();
    const result = await postJson(`/organizer/events/${event.id}/scanner-session`);
    if (result.ok) {
      markJoined();
      window.location.assign('/scan');
      return;
    }
    setBusy(false);
    setFailure(t.unavailable);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (closed) {
    return <Banner kind="info">{t.closed}</Banner>;
  }

  return (
    <>
      {failure && <Banner kind="error">{failure}</Banner>}
      <section className="card" aria-labelledby="inviter">
        <h2 className="card-title" id="inviter">
          {t.inviteTitle}
        </h2>
        <p className="fine-print fine-print--left">{t.inviteHelp}</p>
        {url ? (
          <>
            <span className="link-box">{url}</span>
            <button type="button" className="button-primary" onClick={() => void copy()}>
              {copied ? t.copied : t.copy}
            </button>
            <a
              className="button-secondary button-link"
              href={`https://wa.me/?text=${encodeURIComponent(t.shareText(event.title, url))}`}
              rel="noopener noreferrer"
            >
              {t.share}
            </a>
            {qr && (
              <div
                className="ticket-qr invite-qr"
                role="img"
                aria-label={t.qrAlt}
                // SVG produit par la bibliothèque qrcode à partir du lien d'invitation.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
          </>
        ) : stored === undefined ? null : (
          <>
            {active.length > 0 && <p className="lead">{t.otherDevice}</p>}
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? t.creating : t.create}
            </button>
          </>
        )}
      </section>

      <section className="stack" aria-labelledby="controleurs">
        <h2 className="subtitle" id="controleurs">
          {t.listTitle(scanners.length)}
        </h2>
        {scanners.length === 0 && <p className="lead muted">{t.empty}</p>}
        {scanners.map((scanner) => (
          <div key={scanner.id} className="card scanner-row">
            <span className="scanner-name">
              <strong>
                {scanner.organizer ? `${scanner.firstName} (${t.you})` : scanner.firstName}
              </strong>
              <span className="pill pill--success">{t.active}</span>
            </span>
            <span className="muted">{joinedText(scanner.joinedAt)}</span>
            <button
              type="button"
              className="link link--left link-button"
              disabled={busy}
              aria-label={t.removeLabel(scanner.firstName)}
              onClick={() => void remove(scanner.id)}
            >
              {t.remove}
            </button>
          </div>
        ))}
        {scanners.length > 0 && <p className="fine-print fine-print--left">{t.removeHint}</p>}
      </section>

      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={() => void selfScan()}
      >
        {t.selfScan}
      </button>
      <p className="fine-print fine-print--left">{t.selfScanHelp}</p>
      <Link className="link link--left" href={`/organisateur/evenements/${event.id}/entrees`}>
        {texts.space.entryReport.link}
      </Link>

      {active.length > 0 && (
        <section className="stack stack--tight" aria-labelledby="liens">
          <h2 className="group-label title--flush" id="liens">
            {t.linksTitle}
          </h2>
          {active.map((invite) => (
            <div key={invite.id} className="scanner-link">
              <span className="fine-print fine-print--left">
                {t.linkLine(formatOpening(invite.createdAt), formatOpening(invite.expiresAt))}
              </span>
              <button
                type="button"
                className="link link-button"
                disabled={busy}
                aria-label={t.deactivateLabel(formatOpening(invite.createdAt))}
                onClick={() => setConfirm(invite.id)}
              >
                {t.deactivate}
              </button>
            </div>
          ))}
        </section>
      )}

      {confirm && (
        <Sheet title={t.deactivateTitle} onClose={() => setConfirm(null)}>
          <p>{t.deactivateText}</p>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => void deactivate(confirm)}
          >
            {t.deactivateConfirm}
          </button>
          <button type="button" className="button-secondary" onClick={() => setConfirm(null)}>
            {t.back}
          </button>
        </Sheet>
      )}
    </>
  );
}

// « A rejoint à 17 h 52 » (maquette O7) ; un autre jour : « A rejoint le lundi 2 novembre à 17 h 52 ».
function joinedText(iso: string): string {
  const day = (value: string) => toChadInput(value).slice(0, 10);
  if (day(iso) === day(new Date().toISOString())) return t.joinedToday(formatTime(iso));
  return t.joinedOn(formatOpening(iso));
}
