'use client';

import {
  orderSchema,
  paymentMethods,
  type Order,
  type PaymentMethod,
  type PaymentStarted,
} from '@gatio/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Banner } from '@/components/Banner';
import { Icon } from '@/components/Icon';
import { BackHeader } from '@/components/public/BackHeader';
import { getJson, postJson } from '@/lib/api-client';
import {
  clearLinkParams,
  downloadTicketPdf,
  orderToken,
  randomKey,
  readLinkParams,
  saveOrderToken,
  trackFunnel,
} from '@/lib/buyer-storage';
import { formatDateTime, formatMoney, formatPhone } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.order;
type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; order: Order; deadline: number };

// La page se met à jour seule pendant l'attente de la confirmation (maquette B4).
const REFRESH_MS = 3000;
const SLOW_REFRESH_MS = 15000;

// Page de la commande : choix du paiement et attente (B4), billets ou échec (B5).
// La page ne confirme rien : elle affiche l'état lu par l'API (R15).
export function OrderView({ orderId }: { orderId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const [choosing, setChoosing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Même clé tant qu'aucune réponse n'est arrivée (réseau coupé) : renvoyer la demande ne
  // déclenche pas une seconde demande de paiement sur le téléphone (§6.1).
  const [attempt, setAttempt] = useState<{ method: PaymentMethod; key: string } | null>(null);
  // Lien de l'email : jeton et billet demandé, lus une fois à l'ouverture de la page.
  const [link] = useState(() => readLinkParams());
  const [initialTicket] = useState(() => Math.max(0, (link.ticket ?? 1) - 1));

  const load = useCallback(async () => {
    const stored = orderToken(orderId);
    let result = stored
      ? await getJson<unknown>(`/orders/${orderId}`, { 'x-order-token': stored })
      : null;
    // Le jeton déjà gardé par ce téléphone reste prioritaire ; celui du lien ne le
    // remplace que s'il ouvre la commande.
    if ((!result || (!result.ok && result.status === 404)) && link.token) {
      const viaLink = await getJson<unknown>(`/orders/${orderId}`, {
        'x-order-token': link.token,
      });
      if (viaLink.ok) saveOrderToken(orderId, link.token);
      result = viaLink;
    }
    if (link.token) clearLinkParams();
    if (!result) {
      setState({ kind: 'missing' });
      return;
    }
    const parsed = result.ok ? orderSchema.safeParse(result.data) : null;
    if (parsed?.success) {
      const order = parsed.data;
      // La minuterie part du temps restant donné par le serveur, pas de l'horloge du
      // téléphone (souvent fausse).
      setState({ kind: 'ready', order, deadline: Date.now() + order.remainingSeconds * 1000 });
    } else {
      setState((current) =>
        current.kind === 'ready'
          ? current
          : { kind: !result.ok && result.status === 404 ? 'missing' : 'error' },
      );
    }
  }, [orderId, link.token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Mise à jour automatique pendant l'attente ; plus lente après une expiration, car un
  // paiement confirmé en retard peut encore donner les billets (R17).
  const refresh =
    state.kind !== 'ready'
      ? null
      : state.order.status === 'pending' && state.order.payment?.status === 'pending'
        ? REFRESH_MS
        : state.order.status === 'expired' && state.order.payment
          ? SLOW_REFRESH_MS
          : null;
  useEffect(() => {
    if (!refresh) return;
    const timer = setInterval(() => void load(), refresh);
    return () => clearInterval(timer);
  }, [refresh, load]);

  async function start(method: PaymentMethod, order: Order) {
    const token = orderToken(orderId);
    if (busy || !token) return;
    setBusy(true);
    setFailure(null);
    const key = attempt?.method === method ? attempt.key : randomKey();
    setAttempt({ method, key });
    const result = await postJson<PaymentStarted>(
      `/orders/${orderId}/payments`,
      { method },
      { 'idempotency-key': key, 'x-order-token': token },
    );
    // Réponse reçue (acceptée ou refusée) : le prochain essai est une nouvelle demande.
    if (result.ok || result.status !== 0) setAttempt(null);
    if (result.ok) {
      trackFunnel('payment_initiated', order.event.slug, orderId);
      if (result.data.next.type === 'redirect') {
        window.location.assign(result.data.next.url);
        return;
      }
      setChoosing(false);
      await load();
    } else {
      const code = result.error?.code;
      if (code === 'NOT_FOUND') {
        setState({ kind: 'missing' });
        setBusy(false);
        return;
      }
      // Réservation expirée, ventes arrêtées, commande déjà payée : la page relue le dit.
      setFailure(
        code === 'RESERVATION_EXPIRED' ||
          code === 'EVENT_NOT_ON_SALE' ||
          code === 'VALIDATION_ERROR'
          ? null
          : code === 'RATE_LIMITED'
            ? t.tooManyPayments
            : t.startFailed,
      );
      await load();
    }
    setBusy(false);
  }

  if (state.kind === 'loading') {
    return (
      <Frame title={t.title}>
        <p className="lead" role="status">
          {t.loading}
        </p>
      </Frame>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <Frame title={t.title}>
        <Banner kind="error">
          {state.kind === 'missing' ? (
            <>
              <strong>{t.notFound}.</strong> {t.notFoundText}
            </>
          ) : (
            texts.checkout.unavailable
          )}
        </Banner>
        <Link className="button-secondary button-link" href="/">
          {t.toEvents}
        </Link>
      </Frame>
    );
  }

  const { order, deadline } = state;
  const seconds = Math.max(0, Math.floor((deadline - now) / 1000));
  const support = `/support?evenement=${order.event.slug}`;

  if (order.status === 'paid') {
    return (
      <Frame title={texts.app.name}>
        <Tickets order={order} orderId={orderId} initialIndex={initialTicket} />
      </Frame>
    );
  }
  if (order.status === 'needs_review') {
    return (
      <Frame title={texts.app.name}>
        <div className="timer" role="status">
          <Icon name="clock" />
          <span>
            <strong>{t.reviewTitle}</strong> {t.reviewText}
          </span>
        </div>
        <div className="recap">
          {t.keepReference}
          <div className="recap-total">{order.reference}</div>
        </div>
        <p className="lead">{t.reviewHint}</p>
        <Link className="button-primary button-link" href={support}>
          {t.contactSupport}
        </Link>
      </Frame>
    );
  }

  const payment = order.payment;
  // Paiement en cours chez l'opérateur : la réservation est gardée le temps de le vérifier
  // (R9), la page continue d'attendre même quand la minuterie arrive à zéro.
  const paymentPending = payment?.status === 'pending';
  const expired =
    order.status === 'expired' || (order.status === 'pending' && seconds === 0 && !paymentPending);
  if (expired || order.status !== 'pending') {
    return (
      <Frame title={t.title}>
        {expired ? (
          <Banner kind="error">
            <strong>{t.expired}</strong> {t.expiredText}
          </Banner>
        ) : (
          <Banner kind="info">{t.closed}</Banner>
        )}
        <Recap order={order} />
        {expired && (
          <Link className="button-primary button-link" href={`/e/${order.event.slug}/billets`}>
            {t.retry}
          </Link>
        )}
        <p className="fine-print">{t.reference(order.reference)}</p>
      </Frame>
    );
  }

  // Un paiement remplacé par l'acheteur n'est pas un échec à lui montrer.
  const failed =
    payment?.status === 'failed' &&
    payment.failureReason !== 'replaced' &&
    payment.failureReason !== 'superseded';

  if (paymentPending && (!choosing || seconds === 0)) {
    return (
      <Frame title={t.title}>
        <div className="stack center">
          <span className="round-icon">
            <Icon name="phone" size={48} />
          </span>
          <h1 className="title title--flush">{t.confirmOnPhone}</h1>
          <p className="lead">
            {payment.next?.type === 'await_phone' && (
              <>
                {t.requestSent} <strong>{formatPhone(payment.next.hint)}</strong>.{' '}
              </>
            )}
            {t.waitingOperator}
          </p>
        </div>
        {seconds > 0 ? (
          <Timer seconds={seconds} />
        ) : (
          <div className="timer" role="status">
            <Icon name="clock" />
            <span>{t.stillChecking}</span>
          </div>
        )}
        <Banner kind="info">{t.doNotPayTwice}</Banner>
        {seconds > 0 && (
          <button type="button" className="button-secondary" onClick={() => setChoosing(true)}>
            {t.changeMethod}
          </button>
        )}
        <p className="fine-print">{t.reference(order.reference)}</p>
      </Frame>
    );
  }

  if (failed && !choosing) {
    return (
      <Frame title={texts.app.name}>
        <Banner kind="error">
          <strong>{t.failed}</strong> {t.failedText}
        </Banner>
        {failure && <Banner kind="error">{failure}</Banner>}
        <Timer seconds={seconds} />
        <Recap order={order} />
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={() => void start(payment.method, order)}
        >
          {busy ? t.starting : t.retryPayment}
        </button>
        <button type="button" className="button-secondary" onClick={() => setChoosing(true)}>
          {t.changeMethod}
        </button>
        <Link className="link" href={support}>
          {t.contactSupport}
        </Link>
      </Frame>
    );
  }

  return (
    <Frame title={t.title}>
      <Timer seconds={seconds} />
      <Recap order={order} />
      {failure && <Banner kind="error">{failure}</Banner>}
      <PaymentChoice
        order={order}
        busy={busy}
        initial={payment?.method ?? 'airtel_money'}
        onPay={(method) => void start(method, order)}
      />
    </Frame>
  );
}

function PaymentChoice({
  order,
  busy,
  initial,
  onPay,
}: {
  order: Order;
  busy: boolean;
  initial: PaymentMethod;
  onPay: (method: PaymentMethod) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(initial);
  return (
    <form
      className="stack"
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        onPay(method);
      }}
    >
      <fieldset className="stack stack--tight fieldset">
        <legend className="subtitle">{t.payWith}</legend>
        {paymentMethods.map((value) => (
          <label key={value} className="option">
            <input
              type="radio"
              name="method"
              value={value}
              checked={method === value}
              onChange={() => setMethod(value)}
              disabled={busy}
            />
            {t.methods[value]}
          </label>
        ))}
      </fieldset>
      <p className="fine-print fine-print--left">{t.operatorFees}</p>
      <Banner kind="info">{texts.public.checkReal}</Banner>
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? t.starting : t.pay(formatMoney(order.total))}
      </button>
    </form>
  );
}

// Billets à l'écran (B5) : un billet à la fois, QR dessiné dans le navigateur.
function Tickets({
  order,
  orderId,
  initialIndex,
}: {
  order: Order;
  orderId: string;
  initialIndex: number;
}) {
  const [index, setIndex] = useState(() =>
    initialIndex < order.tickets.length ? initialIndex : 0,
  );
  const [svg, setSvg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const count = order.tickets.length;
  const ticket = order.tickets[index];

  useEffect(() => {
    if (!ticket) return;
    let current = true;
    void import('qrcode').then(async (QRCode) => {
      const drawn = await QRCode.toString(ticket.qr, { type: 'svg', margin: 4 });
      if (current) setSvg(drawn);
    });
    return () => {
      current = false;
    };
  }, [ticket]);

  if (!ticket) return null;
  return (
    <>
      <div className="banner banner--success banner--large" role="status">
        <span className="banner-icon banner-icon--success">
          <Icon name="check" size={16} strokeWidth={3} />
        </span>
        <span>{t.ready(count)}</span>
      </div>
      <div className="ticket-card">
        <div className="ticket-title">{order.event.title}</div>
        <div>
          {formatDateTime(order.event.startsAt)}
          <br />
          {order.event.venue}, {order.event.city}
        </div>
        <div
          className="ticket-qr"
          role="img"
          aria-label={t.qrAlt}
          // SVG produit par la bibliothèque qrcode à partir du QR signé (base64url).
          dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
        />
        <div className="fine-print">
          {t.ticketLine(ticket.categoryName, index + 1, count, order.reference)}
        </div>
      </div>
      {downloadFailed && <Banner kind="error">{t.downloadFailed}</Banner>}
      {ticket.status === 'void' ? (
        <Banner kind="error">{t.voidTicket}</Banner>
      ) : (
        <button
          type="button"
          className="button-primary button-large"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            setDownloadFailed(false);
            const ok = await downloadTicketPdf(
              orderId,
              ticket.id,
              `billet-${order.reference}-${index + 1}.pdf`,
            );
            setDownloadFailed(!ok);
            setDownloading(false);
          }}
        >
          {downloading ? t.downloading : t.download}
        </button>
      )}
      {count > 1 && (
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setSvg(null);
            setIndex((index + 1) % count);
          }}
        >
          {t.nextTicket(((index + 1) % count) + 1, count)}
        </button>
      )}
      <p className="fine-print">
        {order.ticketEmail === 'sent' ? `${t.emailSent(count)} ` : ''}
        {t.showAtEntry}
      </p>
    </>
  );
}

function Timer({ seconds }: { seconds: number }) {
  return (
    <div className="timer" role="timer">
      <Icon name="clock" />
      <span>
        {t.timer}{' '}
        <strong>
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </strong>
        .
      </span>
    </div>
  );
}

function Recap({ order }: { order: Order }) {
  return (
    <div className="recap">
      <strong>{order.event.title}</strong>
      <br />
      {formatDateTime(order.event.startsAt)}
      {order.items.map((item, index) => (
        <span key={index}>
          <br />
          {texts.checkout.line(item.quantity, item.categoryName)}
        </span>
      ))}
      <div className="recap-total">{formatMoney(order.total)}</div>
    </div>
  );
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <BackHeader title={title} />
      <main className="page page--flush-top stack">{children}</main>
    </>
  );
}
