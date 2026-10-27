'use client';

import {
  MAX_PENDING_ORDERS_PER_PHONE,
  MAX_TICKETS_PER_ORDER,
  orderCreateSchema,
  PHONE_VERIFICATION_REQUIRED,
  phonesMatch,
  type OrderCreate,
  type OrderCreated,
  type PublicEvent,
} from '@gatio/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { PhoneLogin } from '@/components/public/PhoneLogin';
import { PublicCategoryCard } from '@/components/public/PublicCategoryCard';
import { postJson } from '@/lib/api-client';
import { randomKey, saveOrderToken } from '@/lib/buyer-storage';
import { formatMoney } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.checkout;
type FieldName = 'name' | 'phone' | 'phoneConfirm' | 'email';
type Errors = Partial<Record<FieldName, string>>;

// Choix des billets et coordonnées (maquette B3), messages d'erreur (B8). Vérification du
// numéro active (journal de bord n° 71) : code SMS (B6) avant la première réservation depuis
// ce téléphone ; la double saisie du numéro n'est plus utile.
export function Checkout({
  event,
  phoneVerification,
}: {
  event: PublicEvent;
  phoneVerification: boolean;
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [contact, setContact] = useState({ name: '', phone: '', phoneConfirm: '', email: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [short, setShort] = useState<{ categoryId: string; remaining: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Même clé tant que la demande ne change pas : un double appui ou une réponse perdue
  // ne crée jamais deux commandes (§6.1).
  const [attempt, setAttempt] = useState<{ key: string; body: string } | null>(null);
  // Réservation en attente du code SMS : reprise telle quelle (même clé) après le code.
  const [verifying, setVerifying] = useState<{ data: OrderCreate; key: string } | null>(null);

  const total = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const lines = event.categories
    .filter((category) => (quantities[category.id] ?? 0) > 0)
    .map((category) => ({ category, quantity: quantities[category.id]! }));
  const amount = lines.reduce((sum, line) => sum + line.category.priceAmount * line.quantity, 0);

  function change(categoryId: string, delta: number) {
    setQuantities((current) => ({
      ...current,
      [categoryId]: Math.max(0, (current[categoryId] ?? 0) + delta),
    }));
    if (short?.categoryId === categoryId) setShort(null);
    setFailure(null);
  }

  function update(field: FieldName, value: string) {
    setContact((current) => ({ ...current, [field]: value }));
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy || total === 0) return;
    const payload = {
      eventSlug: event.slug,
      items: lines.map((line) => ({ categoryId: line.category.id, quantity: line.quantity })),
      contact: { name: contact.name, phone: contact.phone, email: contact.email },
    };
    const parsed = orderCreateSchema.safeParse(payload);
    const next: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[1];
        if (field === 'name') next.name = t.nameMissing;
        if (field === 'phone') next.phone = t.phoneInvalid;
        if (field === 'email') next.email = t.emailInvalid;
      }
    }
    if (!phoneVerification && !next.phone && !phonesMatch(contact.phone, contact.phoneConfirm)) {
      next.phoneConfirm = t.phoneMismatch;
    }
    setErrors(next);
    setFailure(null);
    setShort(null);
    if (!parsed.success || Object.keys(next).length > 0) return;

    const body = JSON.stringify(parsed.data);
    const key = attempt?.body === body ? attempt.key : randomKey();
    setAttempt({ key, body });
    await place(parsed.data, key);
  }

  async function place(data: OrderCreate, key: string, afterCode = false) {
    setBusy(true);
    setFailure(null);
    const result = await postJson<OrderCreated>('/orders', data, { 'idempotency-key': key });
    if (result.ok) {
      saveOrderToken(result.data.orderId, result.data.orderToken);
      router.push(`/commande/${result.data.orderId}`);
      return;
    }
    setBusy(false);
    // L'écran du code reste affiché jusqu'à la réponse ; une erreur ramène au formulaire.
    setVerifying(null);
    const details = (result.error?.details ?? {}) as Record<string, unknown>;
    if (result.status === 401 && details.reason === PHONE_VERIFICATION_REQUIRED) {
      // Code redemandé juste après l'avoir validé (session non gardée par le navigateur) :
      // pas de nouveau SMS en boucle, retour au formulaire avec un message.
      if (afterCode) setFailure(t.unavailable);
      else setVerifying({ data, key });
      return;
    }
    switch (result.error?.code) {
      case 'STOCK_INSUFFICIENT':
        setFailure(t.stock);
        setShort({ categoryId: String(details.categoryId), remaining: Number(details.remaining) });
        break;
      case 'CATEGORY_NOT_ON_SALE':
        setFailure(details.reason === 'not_open' ? t.notOpen : t.ended);
        break;
      case 'RESERVATION_EXPIRED':
        setAttempt(null);
        setFailure(t.reservationExpired);
        break;
      case 'EVENT_NOT_ON_SALE':
      case 'NOT_FOUND':
        setFailure(t.eventStopped);
        break;
      case 'RATE_LIMITED':
        setFailure(
          details.reason === 'too_many_pending'
            ? t.tooManyPending(MAX_PENDING_ORDERS_PER_PHONE)
            : t.tooManyOrders,
        );
        break;
      default:
        setFailure(t.unavailable);
    }
  }

  const errorCount = Object.keys(errors).length;
  if (verifying) {
    return (
      <PhoneLogin
        phone={verifying.data.contact.phone}
        verifiedNext={`${t.busy} ${t.busyNote}`}
        onVerified={() => void place(verifying.data, verifying.key, true)}
        onChangePhone={() => setVerifying(null)}
      />
    );
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h1 className="title title--flush">{t.title}</h1>
      {errorCount > 0 && (
        <Banner kind="error">
          <strong>{t.fieldsToFix(errorCount)}</strong> {t.fieldsToFixEnd}
        </Banner>
      )}
      {failure && <Banner kind="error">{failure}</Banner>}
      <div className="stack stack--tight">
        {event.categories.map((category) => {
          if (category.availability !== 'available') {
            return <PublicCategoryCard key={category.id} category={category} stopped={false} />;
          }
          const quantity = quantities[category.id] ?? 0;
          const shortHere = short?.categoryId === category.id ? short : null;
          return (
            <div
              key={category.id}
              className={`category${shortHere ? ' category--error' : ''}${busy ? ' category--off' : ''}`}
            >
              <div>
                <div className="category-name">{category.name}</div>
                <div className="category-price">{formatMoney(category.priceAmount)}</div>
                {shortHere && (
                  <div className="category-note category-note--error">
                    {t.remaining(shortHere.remaining)}
                  </div>
                )}
              </div>
              <div className="qty">
                {!busy && (
                  <button
                    type="button"
                    aria-label={`${t.remove} (${category.name})`}
                    disabled={quantity === 0}
                    onClick={() => change(category.id, -1)}
                  >
                    −
                  </button>
                )}
                <span aria-live="polite">
                  {quantity}
                  <span className="visually-hidden"> {category.name}</span>
                </span>
                {!busy && (
                  <button
                    type="button"
                    aria-label={`${t.add} (${category.name})`}
                    disabled={
                      total >= MAX_TICKETS_PER_ORDER ||
                      (shortHere !== null && quantity >= shortHere.remaining)
                    }
                    onClick={() => change(category.id, 1)}
                  >
                    +
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="fine-print fine-print--left">{t.maxPerOrder(MAX_TICKETS_PER_ORDER)}</p>

      <h2 className="subtitle">{t.contact}</h2>
      <Field
        label={t.name}
        name="name"
        autoComplete="name"
        placeholder={t.namePlaceholder}
        value={contact.name}
        onChange={(e) => update('name', e.target.value)}
        error={errors.name}
        disabled={busy}
      />
      <Field
        label={t.phone}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="66 12 34 56"
        help={phoneVerification ? t.phoneVerifiedHelp : t.phoneHelp}
        value={contact.phone}
        onChange={(e) => update('phone', e.target.value)}
        error={errors.phone}
        disabled={busy}
      />
      {!phoneVerification && (
        <Field
          label={t.phoneConfirm}
          name="phoneConfirm"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          help={t.phoneConfirmHelp}
          value={contact.phoneConfirm}
          onChange={(e) => update('phoneConfirm', e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            setErrors((current) => ({ ...current, phoneConfirm: t.noPaste }));
          }}
          onDrop={(e) => e.preventDefault()}
          error={errors.phoneConfirm}
          disabled={busy}
        />
      )}
      <Field
        label={t.email}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="nom@exemple.com"
        help={t.emailHelp}
        value={contact.email}
        onChange={(e) => update('email', e.target.value)}
        error={errors.email}
        disabled={busy}
      />

      {lines.map((line) => (
        <div key={line.category.id} className="recap-line">
          <span>{t.line(line.quantity, line.category.name)}</span>
          <strong>{formatMoney(line.category.priceAmount * line.quantity)}</strong>
        </div>
      ))}
      <button type="submit" className="button-primary" disabled={busy || total === 0}>
        {busy ? t.busy : total === 0 ? t.payEmpty : t.pay(formatMoney(amount))}
      </button>
      <p className="fine-print" role={busy ? 'status' : undefined}>
        {busy ? t.busyNote : t.holdNote}
      </p>
    </form>
  );
}
