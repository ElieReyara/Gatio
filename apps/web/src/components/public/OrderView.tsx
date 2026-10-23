'use client';

import { orderSchema, type Order } from '@gatio/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Banner } from '@/components/Banner';
import { Icon } from '@/components/Icon';
import { BackHeader } from '@/components/public/BackHeader';
import { getJson } from '@/lib/api-client';
import { orderToken } from '@/lib/buyer-storage';
import { formatDateTime, formatMoney } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.order;
type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; order: Order; deadline: number };

// Haut de la maquette B4 : minuterie de réservation et récapitulatif. Le choix du moyen de
// paiement arrive avec la tranche 6.
export function OrderView({ orderId }: { orderId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const token = orderToken(orderId);
    if (!token) {
      setState({ kind: 'missing' });
      return;
    }
    void getJson<unknown>(`/orders/${orderId}`, { 'x-order-token': token }).then((result) => {
      const parsed = result.ok ? orderSchema.safeParse(result.data) : null;
      if (parsed?.success) {
        const order = parsed.data;
        // La minuterie part du temps restant donné par le serveur, pas de l'horloge du
        // téléphone (souvent fausse).
        setState({ kind: 'ready', order, deadline: Date.now() + order.remainingSeconds * 1000 });
      } else {
        setState({ kind: !result.ok && result.status === 404 ? 'missing' : 'error' });
      }
    });
  }, [orderId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (state.kind === 'loading') {
    return (
      <Frame>
        <p className="lead" role="status">
          {t.loading}
        </p>
      </Frame>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <Frame>
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
  const expired = order.status === 'expired' || (order.status === 'pending' && seconds === 0);
  const closed = !expired && order.status !== 'pending';
  return (
    <Frame>
      {expired ? (
        <Banner kind="error">
          <strong>{t.expired}</strong> {t.expiredText}
        </Banner>
      ) : closed ? (
        <Banner kind="info">{t.closed}</Banner>
      ) : (
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
      )}
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
      {expired ? (
        <Link className="button-primary button-link" href={`/e/${order.event.slug}/billets`}>
          {t.retry}
        </Link>
      ) : (
        !closed && <Banner kind="info">{t.paymentSoon}</Banner>
      )}
      <p className="fine-print">{t.reference(order.reference)}</p>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <BackHeader title={t.title} />
      <main className="page page--flush-top stack">{children}</main>
    </>
  );
}
