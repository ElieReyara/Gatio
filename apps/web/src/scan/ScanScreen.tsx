'use client';

import {
  parseTicketQr,
  SCAN_SESSION_ENDED,
  errorResponseSchema,
  scanChangesSchema,
  scanManifestSchema,
  scanSessionSchema,
  type ScanManifest,
  type ScanSession,
} from '@gatio/shared';
import type QrScanner from 'qr-scanner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner } from '@/components/Banner';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { getJson } from '@/lib/api-client';
import { formatDateTime, formatTime } from '@/lib/format';
import { texts } from '@/texts/fr';
import { playSignal, resumeAudio, unlockAudio, type Signal } from './feedback';
import { scanRequest, sendPassages } from './network';
import {
  addPassage,
  listPassages,
  loadManifest,
  removePassages,
  saveManifest,
  type LocalPassage,
} from './storage';
import { hasJoined, markJoined } from './session';
import { applyResults, firstValidPassages, mergeTickets, nextBatch, otherEvents } from './sync';
import { prepareManifest, verifyTicket, type PreparedManifest, type ScanOutcome } from './verify';

const t = texts.scan;
const MANIFEST_URL = '/api/v1/scan/manifest';
const MANIFEST_TIMEOUT_MS = 10_000;
const RESULT_MS = 1200;
// Un QR laissé devant la caméra n'est relu qu'après 8 s : pas de doublon parasite.
const SAME_QR_PAUSE_MS = 8000;
// Session de scan revérifiée en ligne : un contrôleur retiré ou un lien désactivé est vu vite.
const SESSION_CHECK_MS = 60_000;
// R27 : passages envoyés et changements demandés toutes les 5 s en ligne.
const SYNC_MS = 5000;

type ListState = 'loading' | 'ready' | 'missing';
type ScannerState = 'idle' | 'loading' | 'running' | 'camera-error' | 'load-error';
type Shown = { outcome: ScanOutcome; verifyMs: number };

export function ScanScreen() {
  const [listState, setListState] = useState<ListState>('loading');
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [scannerState, setScannerState] = useState<ScannerState>('idle');
  const [shown, setShown] = useState<Shown | null>(null);
  const [lastVerifyMs, setLastVerifyMs] = useState<number | null>(null);
  // Session du contrôleur (tranche 9).
  const [session, setSession] = useState<ScanSession | null>(null);
  const [revoked, setRevoked] = useState(false);
  // Page ouverte sans invitation ni liste sur ce téléphone.
  const [noSession, setNoSession] = useState(false);

  const manifest = useRef<PreparedManifest | null>(null);
  // Liste telle qu'enregistrée (curseur des changements compris), pour la mettre à jour.
  const raw = useRef<ScanManifest | null>(null);
  const syncing = useRef(false);
  const ended = useRef(false);
  // Session terminée : les passages en attente partent encore pendant le délai de grâce (F11),
  // jusqu'à ce que le serveur les refuse.
  const uploadClosed = useRef(false);
  // Passages que le stockage n'a pas pu garder : envoyés depuis la mémoire, sans être perdus.
  const unsaved = useRef<LocalPassage[]>([]);
  const firstPassages = useRef(new Map<string, string>());
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const showing = useRef(false);
  const lastQr = useRef<{ text: string; until: number } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    document.addEventListener('visibilitychange', resumeAudio);

    const applyManifest = (value: ScanManifest | null) => {
      if (value) {
        raw.current = value;
        manifest.current = prepareManifest(value);
      }
      setListState(manifest.current ? 'ready' : 'missing');
    };
    void (async () => {
      // La liste déjà enregistrée sert tout de suite ; la nouvelle arrive en arrière-plan.
      const [stored, passages] = await Promise.all([
        loadManifest().catch(() => null),
        listPassages().catch(() => [] as LocalPassage[]),
      ]);
      firstPassages.current = firstValidPassages(passages);
      setPending(passages.length);
      if (stored) applyManifest(stored);
      const fresh = await downloadManifest();
      if (fresh === 'ended') {
        ended.current = true;
        setRevoked(true);
        return;
      }
      if (fresh === 'none') {
        if (!stored) setNoSession(true);
        applyManifest(null);
        return;
      }
      if (!fresh) {
        applyManifest(null);
        return;
      }
      // Passages d'un autre événement : ils ne peuvent plus partir (la page « rejoindre » et
      // « scanner moi-même » les envoient avant d'ouvrir une autre session).
      const stale = otherEvents(passages, fresh.eventId);
      if (stale.length > 0) {
        await removePassages(stale).catch(() => undefined);
        const kept = passages.filter((passage) => !stale.includes(passage.id));
        firstPassages.current = firstValidPassages(kept);
        setPending(kept.length);
      }
      await saveManifest(fresh).catch(() => undefined);
      applyManifest(fresh);
    })();
    // Le lecteur de QR est chargé à la demande : on le charge dès maintenant, en ligne,
    // pour que le service worker le garde avant tout passage en mode avion.
    void preloadScanner().then(registerServiceWorker);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      document.removeEventListener('visibilitychange', resumeAudio);
      clearTimeout(dismissTimer.current);
      scanner.current?.destroy();
    };
  }, []);

  useEffect(() => {
    const check = async () => {
      if (!navigator.onLine) return;
      const result = await getJson<unknown>('/scan/session');
      const parsed = result.ok ? scanSessionSchema.safeParse(result.data) : null;
      if (parsed?.success) {
        markJoined();
        setSession(parsed.data);
        setRevoked(false);
      } else if (
        !result.ok &&
        result.status === 401 &&
        (result.error?.details.reason === SCAN_SESSION_ENDED || hasJoined())
      ) {
        ended.current = true;
        setRevoked(true);
        scanner.current?.stop();
      }
    };
    void check();
    const timer = setInterval(() => void check(), SESSION_CHECK_MS);
    window.addEventListener('online', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', check);
    };
  }, []);

  // Envoi des passages en attente puis changements depuis le curseur (R26, R27).
  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine || syncing.current || uploadClosed.current || !raw.current) return;
      syncing.current = true;
      try {
        const current = raw.current;
        const prepared = manifest.current;
        if (!prepared) return;
        const stored = await listPassages().catch(() => [] as LocalPassage[]);
        const { batch, invalid } = nextBatch([...stored, ...unsaved.current], current.eventId);
        if (invalid.length > 0) await removePassages(invalid).catch(() => undefined);
        let listChanged = false;
        if (batch.length > 0) {
          const results = await sendPassages(batch);
          if (results === 'closed') uploadClosed.current = true;
          else if (results) {
            // La liste locale garde les billets passés avant que leurs passages quittent la file.
            listChanged = applyResults(prepared, batch, results);
            const saved =
              !listChanged ||
              (await saveManifest({ ...current, tickets: [...prepared.tickets.values()] }).then(
                () => true,
                () => false,
              ));
            if (saved) {
              const sent = new Set(results.map((result) => result.id));
              unsaved.current = unsaved.current.filter((passage) => !sent.has(passage.id));
              await removePassages([...sent]);
              setPending(
                (await listPassages().catch(() => [] as LocalPassage[])).length +
                  unsaved.current.length,
              );
            }
          }
        }
        // Session terminée : plus de changements à suivre, seulement la file à vider.
        if (ended.current) return;
        const changed = await scanRequest(
          `/scan/changes?since=${encodeURIComponent(current.cursor)}`,
        );
        // Une nouvelle liste est arrivée pendant l'appel : celle-ci est périmée.
        if (raw.current !== current) return;
        const changes = changed.ok ? scanChangesSchema.safeParse(changed.data) : null;
        if (changes?.success) {
          listChanged = mergeTickets(prepared, changes.data.tickets) || listChanged;
          raw.current = { ...current, cursor: changes.data.cursor };
          // Rien de changé : la liste n'est pas réécrite (elle peut compter 20 000 billets).
          if (listChanged) {
            raw.current = { ...raw.current, tickets: [...prepared.tickets.values()] };
            await saveManifest(raw.current).catch(() => undefined);
          }
        }
      } catch {
        // Stockage ou réseau en échec : les passages restent en file, nouvel essai plus tard.
      } finally {
        syncing.current = false;
      }
    };
    const timer = setInterval(() => void sync(), SYNC_MS);
    window.addEventListener('online', sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', sync);
    };
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(dismissTimer.current);
    resumeAudio();
    showing.current = false;
    setShown(null);
  }, []);

  const onDecode = useCallback(
    (text: string) => {
      const prepared = manifest.current;
      if (!prepared || showing.current) return;
      if (lastQr.current?.text === text && Date.now() < lastQr.current.until) return;
      showing.current = true;
      try {
        const startedAt = performance.now();
        const outcome = verifyTicket(text, prepared, firstPassages.current);
        const verifyMs = Math.round(performance.now() - startedAt);
        // Un QR refusé n'envoie ni identifiant de billet ni QR (signature non vérifiée).
        const refused = outcome.kind === 'invalid';
        const ticketId = refused ? null : (parseTicketQr(text)?.ticketId ?? null);
        const scannedAt = new Date().toISOString();
        if (outcome.kind === 'valid' && ticketId) firstPassages.current.set(ticketId, scannedAt);
        const passage: LocalPassage = {
          id: newId(),
          eventId: prepared.eventId,
          ticketId,
          scannedAt,
          localResult: outcome.kind,
          verifyMs,
          qr: refused ? null : text.trim(),
        };
        // Stockage en échec : le passage part depuis la mémoire tant que la page est ouverte.
        void addPassage(passage)
          .catch(() => {
            unsaved.current.push(passage);
          })
          .then(() => setPending((count) => count + 1));

        lastQr.current = { text, until: Date.now() + RESULT_MS + SAME_QR_PAUSE_MS };
        setLastVerifyMs(verifyMs);
        setShown({ outcome, verifyMs });
        playSignal(display(outcome).signal);
        dismissTimer.current = setTimeout(dismiss, RESULT_MS);
      } catch {
        // Ne jamais laisser l'écran bloqué sur un QR qui a provoqué une erreur.
        showing.current = false;
      }
    },
    [dismiss],
  );

  const start = useCallback(() => {
    unlockAudio();
    setScannerState('loading');
  }, []);

  // La vidéo n'existe qu'après le rendu de l'écran de scan : la caméra démarre ensuite.
  useEffect(() => {
    if (scannerState !== 'loading' || scanner.current) return;
    void (async () => {
      let Scanner: typeof QrScanner;
      try {
        Scanner = (await import('qr-scanner')).default;
      } catch {
        setScannerState('load-error');
        return;
      }
      if (!video.current) return;
      try {
        scanner.current = new Scanner(video.current, (result) => onDecode(result.data), {
          returnDetailedScanResult: true,
          preferredCamera: 'environment',
          maxScansPerSecond: 10,
        });
        await scanner.current.start();
        setScannerState('running');
      } catch {
        setScannerState('camera-error');
      }
    })();
  }, [scannerState, onDecode]);

  const indicator = (
    <div className="scan-indicator">
      {listState === 'ready' && (
        <span className="scan-pill">
          <span className="scan-dot" />
          {t.listReady}
        </span>
      )}
      <span className="scan-pill">{online ? t.online : t.offline}</span>
      {pending > 0 && <span className="scan-pill">{t.pending(pending)}</span>}
      {lastVerifyMs !== null && <span className="scan-pill">{t.verifiedIn(lastVerifyMs)}</span>}
    </div>
  );

  // Lien désactivé, contrôleur retiré ou événement terminé (maquette C1, état 2).
  if (revoked) {
    return (
      <main className="page">
        <Logo />
        <h1 className="title">{t.title}</h1>
        <Banner kind="error">
          <strong>{texts.join.invalidStrong}</strong> {texts.join.invalidText}
        </Banner>
      </main>
    );
  }

  if (noSession) {
    return (
      <main className="page">
        <Logo />
        <h1 className="title">{t.title}</h1>
        <Banner kind="info">{t.noSession}</Banner>
      </main>
    );
  }

  if (scannerState === 'idle') {
    return (
      <main className="page">
        <Logo />
        <h1 className="title">{t.title}</h1>
        {session && (
          <p className="lead">
            <strong>{session.event.title}</strong>
            <br />
            {formatDateTime(session.event.startsAt)}
          </p>
        )}
        {listState === 'loading' && <p>{t.listLoading}</p>}
        {listState === 'missing' && (
          <p className="banner banner--error" role="alert">
            <Icon name="cross" />
            <span>{t.listMissing}</span>
          </p>
        )}
        <button
          type="button"
          className="button-primary"
          disabled={listState !== 'ready'}
          onClick={start}
        >
          {t.start}
        </button>
        <p className="banner banner--info">
          <Icon name="info" />
          <span>{t.installTip}</span>
        </p>
      </main>
    );
  }

  const result = shown ? display(shown.outcome) : null;
  const aim =
    scannerState === 'camera-error'
      ? t.cameraError
      : scannerState === 'load-error'
        ? t.scannerLoadError
        : t.aim;
  return (
    <main className="scan-camera">
      {/* Vidéo et viseur restent montés : la caméra ne redémarre pas entre deux billets. */}
      <video ref={video} className="scan-video" muted playsInline />
      {indicator}
      <div className="scan-frame">
        <svg
          viewBox="0 0 260 260"
          width="260"
          height="260"
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M20 70V30a10 10 0 0 1 10-10h40M190 20h40a10 10 0 0 1 10 10v40M240 190v40a10 10 0 0 1-10 10h-40M70 240H30a10 10 0 0 1-10-10v-40" />
        </svg>
      </div>
      <p className="scan-aim">{aim}</p>
      {result && (
        <button
          type="button"
          className={`scan-result scan-result--${result.signal}`}
          onClick={dismiss}
        >
          {indicator}
          <span className="scan-result-body">
            <Icon name={result.icon} size={120} strokeWidth={3} />
            <span
              className={`scan-result-word${result.word.length > 12 ? ' scan-result-word--long' : ''}`}
              role="status"
            >
              {result.word}
            </span>
            {result.detail && <span className="scan-result-detail">{result.detail}</span>}
            <span className="scan-result-next">{t.next}</span>
          </span>
        </button>
      )}
    </main>
  );
}

function display(outcome: ScanOutcome): {
  signal: Signal;
  icon: IconName;
  word: string;
  detail: string | null;
} {
  switch (outcome.kind) {
    case 'valid':
      return {
        signal: 'success',
        icon: 'check',
        word: t.valid,
        detail: outcome.categoryName || null,
      };
    case 'already_used':
      return {
        signal: 'warning',
        icon: 'alert',
        word: t.alreadyUsed,
        detail: outcome.firstPassageAt
          ? t.firstPassageAt(formatTime(outcome.firstPassageAt))
          : null,
      };
    case 'void':
      return { signal: 'danger', icon: 'cross', word: t.void, detail: t.voidDetail };
    case 'invalid':
      return { signal: 'danger', icon: 'cross', word: t.invalid, detail: t.invalidDetail };
  }
}

// Liste de la session : 'ended' si la session a été coupée, 'none' sans session, null si le
// réseau ne répond pas (la liste enregistrée reste en service).
async function downloadManifest(): Promise<ScanManifest | 'ended' | 'none' | null> {
  if (!navigator.onLine) return null;
  try {
    const response = await fetch(MANIFEST_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (response.status === 401) {
      const body = errorResponseSchema.safeParse(await response.json().catch(() => null));
      const ended = body.success && body.data.error.details.reason === SCAN_SESSION_ENDED;
      return ended || hasJoined() ? 'ended' : 'none';
    }
    return scanManifestSchema.parse(await response.json());
  } catch {
    return null;
  }
}

// crypto.randomUUID manque sur les iPhone antérieurs à iOS 15.4.
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Charge le lecteur et, sur les navigateurs sans lecture native (iPhone), son worker.
async function preloadScanner() {
  try {
    const { default: Scanner } = await import('qr-scanner');
    const engine = await Scanner.createQrEngine();
    if (engine instanceof Worker) engine.terminate();
  } catch {
    // Hors ligne au premier chargement : le message d'erreur viendra au toucher « Commencer ».
  }
}

// Le service worker garde la page et ses fichiers pour scanner sans réseau ; on lui
// donne tout ce que la page a déjà chargé, car il n'existait pas au premier chargement.
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => url.startsWith(location.origin) && !url.includes('/api/'));
    registration.active?.postMessage({ type: 'cache-urls', urls: [location.pathname, ...urls] });
  } catch {
    // Sans service worker, la page fonctionne en ligne seulement.
  }
}
