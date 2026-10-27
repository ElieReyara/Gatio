'use client';

import {
  categoryCreateSchema,
  UNSUPPORTED_CHARACTERS,
  type Category,
  type FeePreview,
} from '@gatio/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { postJson, sendJson } from '@/lib/api-client';
import { formatMoney, formatNumber, fromChadInput, parseAmount, toChadInput } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.space.categoryForm;
type Errors = Partial<Record<'name' | 'priceAmount' | 'quantityTotal' | 'saleEndsAt', string>>;

// Catégorie de billets (maquette O4) : aperçu des frais en direct calculé par l'API (R7),
// période de vente facultative (R12).
export function CategoryForm({
  eventId,
  capacity,
  category,
}: {
  eventId: string;
  capacity: number;
  category?: Category;
}) {
  const router = useRouter();
  const [price, setPrice] = useState(category ? formatNumber(category.priceAmount) : '');
  const [preview, setPreview] = useState<FeePreview | null>(category?.fee ?? null);
  const [customPeriod, setCustomPeriod] = useState(
    Boolean(category?.saleStartsAt || category?.saleEndsAt),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previewIsCurrent = preview !== null && preview.price === parseAmount(price);

  // L'aperçu suit le prix dès qu'il change (cahier §4).
  useEffect(() => {
    const amount = parseAmount(price);
    if (!amount) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      const result = await postJson<FeePreview>('/organizer/fee-preview', {
        price: amount,
        eventId,
      });
      // Réseau lent : une réponse arrivée après une nouvelle saisie ne remplace pas l'aperçu.
      if (result.ok && result.data.price === amount) setPreview(result.data);
    }, 300);
    return () => clearTimeout(timer);
  }, [price, eventId]);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = Object.fromEntries(new FormData(formEvent.currentTarget)) as Record<
      string,
      string
    >;
    const payload = {
      name: form.name ?? '',
      priceAmount: parseAmount(price) ?? 0,
      quantityTotal: parseAmount(form.quantityTotal ?? '') ?? 0,
      saleStartsAt: customPeriod ? fromChadInput(form.saleStartsAt ?? '') : null,
      saleEndsAt: customPeriod ? fromChadInput(form.saleEndsAt ?? '') : null,
    };
    const parsed = categoryCreateSchema.safeParse(payload);
    const next: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'name') {
          next.name =
            issue.message === UNSUPPORTED_CHARACTERS
              ? texts.space.eventForm.unsupportedCharacters
              : t.nameMissing;
        }
        if (field === 'priceAmount') next.priceAmount = t.priceMissing;
        if (field === 'quantityTotal') next.quantityTotal = t.quantityMissing;
      }
    }
    if (previewIsCurrent && preview?.priceTooLow) next.priceAmount = t.priceTooLow;
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0 || !parsed.success) return;

    setBusy(true);
    const result = category
      ? await sendJson<Category>('PATCH', `/organizer/categories/${category.id}`, parsed.data)
      : await sendJson<Category>('POST', `/organizer/events/${eventId}/categories`, parsed.data);
    setBusy(false);
    if (result.ok) {
      router.push(`/organisateur/evenements/${eventId}/billets`);
      router.refresh();
      return;
    }
    const details = result.error?.details ?? {};
    if (result.error?.code === 'PRICE_TOO_LOW') setErrors({ priceAmount: t.priceTooLow });
    else if (details.reason === 'capacity_exceeded') {
      setErrors({ quantityTotal: t.capacityExceeded(Number(details.remaining ?? 0)) });
    } else if (details.reason === 'below_sold') setErrors({ quantityTotal: t.belowSold });
    else if (details.reason === 'sale_period_invalid') setErrors({ saleEndsAt: t.periodInvalid });
    else if (details.reason === 'sale_end_required') setErrors({ saleEndsAt: t.saleEndRequired });
    else setFailure(texts.form.networkError);
  }

  const errorCount = Object.keys(errors).length;
  return (
    <form className="stack" onSubmit={(formEvent) => void submit(formEvent)} noValidate>
      <h1 className="title title--flush">{category ? t.editTitle : t.newTitle}</h1>
      {errorCount > 1 && <Banner kind="error">{texts.space.fixCount(errorCount)}</Banner>}
      {failure && <Banner kind="error">{failure}</Banner>}
      <Field label={t.name} name="name" defaultValue={category?.name} error={errors.name} />
      <Field
        label={t.price}
        name="priceAmount"
        inputMode="numeric"
        value={price}
        onChange={(changeEvent) => setPrice(changeEvent.target.value)}
        error={errors.priceAmount}
      />
      {preview && (
        <div
          className={`preview${preview.priceTooLow ? ' preview--error' : ''}`}
          role={preview.priceTooLow ? 'alert' : 'status'}
        >
          <strong>{t.previewTitle(formatMoney(preview.price))}</strong>
          {preview.priceTooLow ? (
            <span>{t.previewTooLow(formatMoney(preview.feeAmount))}</span>
          ) : (
            <>
              <span>
                {t.previewDetail(
                  formatNumber(preview.percentAmount),
                  formatNumber(preview.fixedAmount),
                  formatMoney(preview.feeAmount),
                )}
              </span>
              <span className="preview-strong">
                {t.previewReceive(formatMoney(preview.payoutAmount))}
              </span>
            </>
          )}
        </div>
      )}
      <Field
        label={t.quantity}
        name="quantityTotal"
        inputMode="numeric"
        defaultValue={category?.quantityTotal}
        help={t.capacityHelp(formatNumber(capacity))}
        error={errors.quantityTotal}
      />
      <div className="card">
        <strong>{t.period}</strong>
        {customPeriod ? (
          <>
            <Field
              label={t.saleStart}
              name="saleStartsAt"
              type="datetime-local"
              defaultValue={toChadInput(category?.saleStartsAt ?? null)}
            />
            <Field
              label={t.saleEnd}
              name="saleEndsAt"
              type="datetime-local"
              defaultValue={toChadInput(category?.saleEndsAt ?? null)}
              help={t.saleEndHelp}
              error={errors.saleEndsAt}
            />
            <button
              type="button"
              className="link link-button link--left"
              onClick={() => setCustomPeriod(false)}
            >
              {t.periodReset}
            </button>
          </>
        ) : (
          <>
            <span>{t.periodDefault}</span>
            <button
              type="button"
              className="link link-button link--left"
              onClick={() => setCustomPeriod(true)}
            >
              {t.periodChoose}
            </button>
          </>
        )}
      </div>
      <button
        type="submit"
        className="button-primary"
        disabled={busy || (previewIsCurrent && preview?.priceTooLow === true)}
      >
        {busy ? texts.space.saving : t.submit}
      </button>
    </form>
  );
}
