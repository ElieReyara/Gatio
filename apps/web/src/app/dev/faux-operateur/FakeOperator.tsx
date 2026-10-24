'use client';

import { useCallback, useEffect, useState } from 'react';
import { postJson } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.fakeOperator;
const outcomes = ['accept', 'refuse', 'accept_silent', 'accept_twice', 'wrong_amount'] as const;
type FakePayment = {
  providerRef: string;
  amount: number;
  method: string;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: string;
};

export function FakeOperator() {
  const [items, setItems] = useState<FakePayment[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/dev/fake-payments', { cache: 'no-store' });
      const body = (await response.json()) as { items: FakePayment[] };
      setItems(body.items);
    } catch {
      setMessage(t.unavailable);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <main className="page stack">
      <h1 className="title title--flush">{t.title}</h1>
      <p className="lead">{t.intro}</p>
      {message && <p role="status">{message}</p>}
      {items.length === 0 && <p className="lead">{t.empty}</p>}
      {items.map((payment) => (
        <div key={payment.providerRef} className="recap stack stack--tight">
          <strong>
            {formatMoney(payment.amount)} ·{' '}
            {texts.order.methods[payment.method as keyof typeof texts.order.methods] ??
              payment.method}{' '}
            · {t[payment.status]}
          </strong>
          <span className="fine-print fine-print--left">{payment.providerRef}</span>
          {payment.status === 'pending' &&
            outcomes.map((outcome) => (
              <button
                key={outcome}
                type="button"
                className={outcome === 'accept' ? 'button-primary' : 'button-secondary'}
                onClick={async () => {
                  const result = await postJson(`/dev/fake-payments/${payment.providerRef}`, {
                    outcome,
                  });
                  setMessage(result.ok ? t.done : t.unavailable);
                  await load();
                }}
              >
                {t.outcomes[outcome]}
              </button>
            ))}
        </div>
      ))}
    </main>
  );
}
