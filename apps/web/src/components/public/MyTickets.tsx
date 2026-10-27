'use client';

import { myTicketsSchema, type MyTicketsEvent } from '@gatio/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Banner } from '@/components/Banner';
import { Icon } from '@/components/Icon';
import { BackHeader } from '@/components/public/BackHeader';
import { PhoneLogin } from '@/components/public/PhoneLogin';
import { getJson, postJson } from '@/lib/api-client';
import { downloadMyTicketPdf } from '@/lib/buyer-storage';
import { formatDateTime } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.myTickets;
type State =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'ready'; items: MyTicketsEvent[] }
  | { kind: 'error' };

// « Mes billets » (maquette B7) : sans session acheteur, connexion par code (B6).
export function MyTickets() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    const result = await getJson<unknown>('/me/tickets');
    if (!result.ok && result.status === 401) {
      setState({ kind: 'login' });
      return;
    }
    const parsed = result.ok ? myTicketsSchema.safeParse(result.data) : null;
    setState(parsed?.success ? { kind: 'ready', items: parsed.data.items } : { kind: 'error' });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await postJson('/auth/logout');
    setState({ kind: 'login' });
  }

  if (state.kind === 'login') {
    return (
      <PhoneLogin
        withHeader
        onVerified={() => {
          setState({ kind: 'loading' });
          void load();
        }}
      />
    );
  }

  return (
    <>
      <BackHeader title={t.title} />
      <main className="page page--flush-top stack">
        {state.kind === 'loading' && (
          <div className="stack" role="status" aria-label={t.loading}>
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--card" />
            <div className="skeleton skeleton--small" />
          </div>
        )}
        {state.kind === 'error' && <Banner kind="error">{t.unavailable}</Banner>}
        {state.kind === 'ready' && state.items.length === 0 && (
          <div className="empty">
            <span className="empty-icon">
              <Icon name="ticket" size={36} strokeWidth={1.8} />
            </span>
            <p className="my-ticket-title">{t.emptyTitle}</p>
            <p className="lead">{t.emptyText}</p>
            <button type="button" className="button-secondary" onClick={() => void logout()}>
              {t.otherPhone}
            </button>
          </div>
        )}
        {state.kind === 'ready' && state.items.length > 0 && (
          <>
            <Group label={t.upcoming} items={state.items.filter((item) => !item.past)} />
            <Group label={t.past} items={state.items.filter((item) => item.past)} />
            <button type="button" className="link link-button" onClick={() => void logout()}>
              {t.logout}
            </button>
          </>
        )}
      </main>
    </>
  );
}

function Group({ label, items }: { label: string; items: MyTicketsEvent[] }) {
  if (items.length === 0) return null;
  return (
    <section className="stack" aria-label={label}>
      <h2 className="group-label title--flush">{label}</h2>
      {items.map((item) =>
        item.past ? (
          <article key={item.event.slug} className="my-ticket my-ticket--past">
            <strong>{item.event.title}</strong>
            <span>{formatDateTime(item.event.startsAt)}</span>
          </article>
        ) : (
          <EventTickets key={item.event.slug} item={item} />
        ),
      )}
    </section>
  );
}

function EventTickets({ item }: { item: MyTicketsEvent }) {
  const { event } = item;
  if (event.status === 'cancelled') {
    return (
      <article className="my-ticket">
        <h3 className="my-ticket-title title--flush">{event.title}</h3>
        <span className="badge badge--danger">
          <Icon name="cross" size={14} strokeWidth={3.4} />
          {t.cancelled}
        </span>
        <p className="title--flush">{t.cancelledText}</p>
        <Link className="button-secondary button-link" href={`/support?evenement=${event.slug}`}>
          {t.contactSupport}
        </Link>
      </article>
    );
  }
  return (
    <article className="my-ticket">
      <h3 className="my-ticket-title title--flush">{event.title}</h3>
      {event.status === 'postponed' ? (
        <>
          <span className="badge badge--warning">
            <Icon name="clock" size={14} strokeWidth={3} />
            {t.postponed}
          </span>
          <p className="title--flush">{t.postponedText}</p>
        </>
      ) : (
        <p className="title--flush">
          {formatDateTime(event.startsAt)}
          <br />
          {event.venue}, {event.city}
        </p>
      )}
      {item.orders.map((order) => (
        <div key={order.orderId} className="stack stack--tight">
          <div className="my-ticket-rule" />
          <div className="my-ticket-line">
            <span>
              {order.lines.map((line) => t.line(line.quantity, line.categoryName)).join(', ')}
            </span>
            <Link
              className="link"
              href={`/commande/${order.orderId}`}
              aria-label={t.viewOrder(order.reference)}
            >
              {t.view}
            </Link>
          </div>
          {order.tickets.map((ticket) =>
            ticket.status === 'void' ? (
              <div key={ticket.id} className="stack stack--tight">
                <span className="badge badge--danger">
                  <Icon name="cross" size={14} strokeWidth={3.4} />
                  {t.voidTicket}
                </span>
                <p className="title--flush">{t.voidText}</p>
              </div>
            ) : (
              <Download
                key={ticket.id}
                ticketId={ticket.id}
                index={ticket.index}
                filename={`billet-${order.reference}-${ticket.index}.pdf`}
              />
            ),
          )}
        </div>
      ))}
    </article>
  );
}

function Download({
  ticketId,
  index,
  filename,
}: {
  ticketId: string;
  index: number;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          setFailed(!(await downloadMyTicketPdf(ticketId, filename)));
          setBusy(false);
        }}
      >
        {busy ? t.downloading : t.download(index)}
      </button>
      {failed && (
        <p className="field-error" role="alert">
          {t.downloadFailed}
        </p>
      )}
    </>
  );
}
