'use client';

import { parseTicketQr, scanManifestSchema } from '@gatio/shared';
import type QrScanner from 'qr-scanner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { texts } from '@/texts/fr';
import { playSignal, unlockAudio, type Signal } from './feedback';
import { addPassage, listPassages, loadManifest, saveManifest } from './storage';
import { prepareManifest, verifyTicket, type PreparedManifest, type ScanOutcome } from './verify';

const t = texts.scan;
// Liste fictive du prototype (tranche 1) ; remplacée par /api/v1/scan/manifest en tranche 10.
const MANIFEST_URL = '/api/v1/dev/scan-prototype/manifest';
const RESULT_MS = 1200;
const SAME_QR_PAUSE_MS = 3000;

type ListState = 'loading' | 'ready' | 'missing';
type Shown = { outcome: ScanOutcome; verifyMs: number };

export function ScanScreen() {
  const [listState, setListState] = useState<ListState>('loading');
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [lastVerifyMs, setLastVerifyMs] = useState<number | null>(null);

  const manifest = useRef<PreparedManifest | null>(null);
  const firstPassages = useRef(new Map<string, string>());
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const showing = useRef(false);
  const lastQr = useRef<{ text: string; until: number } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    registerServiceWorker();
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    void loadLocalState().then(({ prepared, passages }) => {
      manifest.current = prepared;
      firstPassages.current = passages.first;
      setPending(passages.count);
      setListState(prepared ? 'ready' : 'missing');
    });
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      scanner.current?.destroy();
    };
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(dismissTimer.current);
    showing.current = false;
    setShown(null);
  }, []);

  const onDecode = useCallback(
    (text: string) => {
      const prepared = manifest.current;
      if (!prepared || showing.current) return;
      if (lastQr.current?.text === text && Date.now() < lastQr.current.until) return;
      showing.current = true;

      const startedAt = performance.now();
      const outcome = verifyTicket(text, prepared, firstPassages.current);
      const verifyMs = Math.round(performance.now() - startedAt);
      const ticketId = parseTicketQr(text)?.ticketId ?? null;
      const scannedAt = new Date().toISOString();
      if (outcome.kind === 'valid' && ticketId) firstPassages.current.set(ticketId, scannedAt);
      void addPassage({
        id: crypto.randomUUID(),
        ticketId,
        scannedAt,
        localResult: outcome.kind,
        verifyMs,
      });

      lastQr.current = { text, until: Date.now() + RESULT_MS + SAME_QR_PAUSE_MS };
      setPending((count) => count + 1);
      setLastVerifyMs(verifyMs);
      setShown({ outcome, verifyMs });
      playSignal(display(outcome).signal);
      dismissTimer.current = setTimeout(dismiss, RESULT_MS);
    },
    [dismiss],
  );

  const start = useCallback(() => {
    unlockAudio();
    setScanning(true);
  }, []);

  // La vidéo n'existe qu'après le rendu de l'écran de scan : la caméra démarre ensuite.
  useEffect(() => {
    if (!scanning || scanner.current) return;
    void (async () => {
      try {
        const { default: Scanner } = await import('qr-scanner');
        if (!video.current) return;
        scanner.current = new Scanner(video.current, (result) => onDecode(result.data), {
          returnDetailedScanResult: true,
          preferredCamera: 'environment',
          maxScansPerSecond: 10,
        });
        await scanner.current.start();
      } catch {
        setCameraError(true);
      }
    })();
  }, [scanning, onDecode]);

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

  if (!scanning) {
    return (
      <main className="page">
        <Logo />
        <h1 className="title">{t.title}</h1>
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
          <Icon name="alert" />
          <span>{t.installTip}</span>
        </p>
      </main>
    );
  }

  const result = shown ? display(shown.outcome) : null;
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
      <p className="scan-aim">{cameraError ? t.cameraError : t.aim}</p>
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

// « 19 h 42 » (système de design : heures en toutes lettres).
function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`;
}

async function loadLocalState() {
  let stored = await loadManifest().catch(() => null);
  if (navigator.onLine) {
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
      const fresh = scanManifestSchema.parse(await response.json());
      await saveManifest(fresh);
      stored = fresh;
    } catch {
      // Réseau lent ou coupé : on garde la liste déjà enregistrée.
    }
  }
  const passages = await listPassages().catch(() => []);
  const first = new Map<string, string>();
  for (const passage of passages.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))) {
    if (passage.localResult === 'valid' && passage.ticketId && !first.has(passage.ticketId)) {
      first.set(passage.ticketId, passage.scannedAt);
    }
  }
  return {
    prepared: stored ? prepareManifest(stored) : null,
    passages: { first, count: passages.length },
  };
}

// Le service worker garde la page et ses fichiers pour scanner sans réseau ; on lui
// donne tout ce que la page a déjà chargé, car il n'existait pas au premier chargement.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js').then(async () => {
    const registration = await navigator.serviceWorker.ready;
    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => url.startsWith(location.origin) && !url.includes('/api/'));
    registration.active?.postMessage({ type: 'cache-urls', urls: [location.pathname, ...urls] });
  });
}
