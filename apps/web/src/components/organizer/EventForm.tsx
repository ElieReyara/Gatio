'use client';

import {
  cities,
  eventCreateSchema,
  eventTypes,
  IMAGE_MAX_BYTES,
  type OrganizerEvent,
  UNSUPPORTED_CHARACTERS,
} from '@gatio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field, SelectField, TextAreaField } from '@/components/form/Field';
import { Icon } from '@/components/Icon';
import { sendJson, uploadImage, type ApiResult } from '@/lib/api-client';
import { fromChadInput, parseAmount, toChadInput } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.space.eventForm;
type FieldName =
  'title' | 'description' | 'image' | 'city' | 'eventType' | 'startsAt' | 'venue' | 'capacity';
type Errors = Partial<Record<FieldName, string>>;

const missing: Record<Exclude<FieldName, 'image'>, string> = {
  title: t.titleMissing,
  description: t.descriptionMissing,
  city: t.cityMissing,
  eventType: t.typeMissing,
  startsAt: t.startsAtMissing,
  venue: t.venueMissing,
  capacity: t.capacityMissing,
};

// Formulaire court d'événement (maquette O3), pour créer comme pour modifier (onglet Infos).
export function EventForm({ event }: { event?: OrganizerEvent }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(event?.imageUrl ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'uploading' | 'saved' | 'created'>('idle');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chooseImage(chosen: File | undefined) {
    if (!chosen) return;
    if (chosen.size > IMAGE_MAX_BYTES) {
      setErrors((current) => ({ ...current, image: t.imageTooBig }));
      return;
    }
    setErrors((current) => {
      const next = { ...current };
      delete next.image;
      return next;
    });
    setFile(chosen);
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = Object.fromEntries(new FormData(formEvent.currentTarget)) as Record<
      string,
      string
    >;
    const startsAt = fromChadInput(form.startsAt ?? '');
    const payload = {
      ...form,
      startsAt: startsAt ?? '',
      capacity: parseAmount(form.capacity ?? '') ?? 0,
    };
    delete (payload as Record<string, unknown>).image;
    const parsed = eventCreateSchema.safeParse(payload);
    const next: Errors = errors.image ? { image: errors.image } : {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Exclude<FieldName, 'image'>;
        next[field] ??=
          issue.message === UNSUPPORTED_CHARACTERS ? t.unsupportedCharacters : missing[field];
      }
    } else if (
      new Date(parsed.data.startsAt).getTime() <= Date.now() &&
      parsed.data.startsAt !== event?.startsAt
    ) {
      next.startsAt = t.startsAtPast;
    }
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0 || !parsed.success) return;

    setState('saving');
    const result: ApiResult<OrganizerEvent> = event
      ? await sendJson('PATCH', `/organizer/events/${event.id}`, parsed.data)
      : await sendJson('POST', '/organizer/events', parsed.data);
    if (!result.ok) {
      setState('idle');
      const reason = result.error?.details.reason;
      if (reason === 'not_in_future') setErrors({ startsAt: t.startsAtPast });
      else if (reason === 'below_categories') {
        setErrors({ capacity: t.capacityBelow(Number(result.error?.details.allocated ?? 0)) });
      } else if (reason === 'postpone_required') {
        setErrors({ startsAt: t.postponeRequired });
      } else if (reason === 'sale_period_conflict') {
        const names = (result.error?.details.categories as string[] | undefined) ?? [];
        setErrors({ startsAt: t.periodConflict(names.join(', ')) });
      } else setFailure(texts.form.networkError);
      return;
    }
    const id = result.data.id;
    if (file) {
      setState('uploading');
      const upload = await uploadImage<OrganizerEvent>(`/organizer/events/${id}/image`, file);
      if (!upload.ok) {
        // 413 : trop lourde ; sinon : format refusé ou illisible.
        const imageError = upload.status === 413 ? t.imageTooBig : t.imageInvalid;
        if (!event) {
          // L'événement existe déjà : on montre le succès, en signalant l'image refusée.
          setImageFailed(true);
          setCreatedId(id);
          setState('created');
          return;
        }
        setState('idle');
        setErrors({ image: imageError });
        return;
      }
      setFile(null);
    }
    if (event) {
      setState('saved');
      router.refresh();
    } else {
      setCreatedId(id);
      setState('created');
    }
  }

  if (state === 'created' && createdId) {
    return (
      <>
        <Banner kind="success">{t.created}</Banner>
        {imageFailed && <Banner kind="error">{t.imageNotSaved}</Banner>}
        <p className="lead">{t.nextStep}</p>
        <Link
          className="button-primary button-link"
          href={`/organisateur/evenements/${createdId}/billets/nouvelle`}
        >
          {t.toCategories}
        </Link>
        <Link className="link" href="/organisateur">
          {t.backToEvents}
        </Link>
      </>
    );
  }

  const errorCount = Object.keys(errors).length;
  const busy = state === 'saving' || state === 'uploading';
  return (
    <form className="stack" onSubmit={(formEvent) => void submit(formEvent)} noValidate>
      {errorCount > 1 && <Banner kind="error">{texts.space.fixCount(errorCount)}</Banner>}
      {failure && <Banner kind="error">{failure}</Banner>}
      {state === 'saved' && <Banner kind="success">{texts.space.saved}</Banner>}
      <Field
        label={t.title}
        name="title"
        defaultValue={event?.title}
        placeholder={t.titlePlaceholder}
        error={errors.title}
      />
      <TextAreaField
        label={t.description}
        name="description"
        defaultValue={event?.description}
        placeholder={t.descriptionPlaceholder}
        help={t.descriptionHelp}
        error={errors.description}
      />
      <div className={`field${errors.image ? ' field--error' : ''}`}>
        <span className="field-label">{t.image}</span>
        <label className={`upload${errors.image ? ' upload--error' : ''}`}>
          {preview ? (
            // Aperçu local ou image déjà ré-encodée par l'API.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" />
          ) : (
            <Icon name="ticket" size={32} />
          )}
          <strong>
            {state === 'uploading' ? t.imageUploading : preview ? t.imageChange : t.imageChoose}
          </strong>
          {!preview && <span className="muted">{t.imageLimit}</span>}
          {file && <span className="muted">{t.imageAdded}</span>}
          <input
            className="visually-hidden"
            type="file"
            name="image"
            accept="image/*"
            onChange={(changeEvent) => chooseImage(changeEvent.target.files?.[0])}
          />
        </label>
        {errors.image && (
          <p className="field-error">
            <Icon name="alert" size={20} />
            {errors.image}
          </p>
        )}
      </div>
      <SelectField
        label={t.city}
        name="city"
        defaultValue={event?.city ?? ''}
        placeholder={t.cityPlaceholder}
        options={cities.map((city) => ({ value: city, label: city }))}
        error={errors.city}
      />
      <SelectField
        label={t.type}
        name="eventType"
        defaultValue={event?.eventType ?? ''}
        placeholder={t.typePlaceholder}
        options={eventTypes.map((type) => ({ value: type, label: texts.space.eventTypes[type] }))}
        error={errors.eventType}
      />
      <Field
        label={t.startsAt}
        name="startsAt"
        type="datetime-local"
        defaultValue={toChadInput(event?.startsAt ?? null)}
        error={errors.startsAt}
      />
      <Field
        label={t.venue}
        name="venue"
        defaultValue={event?.venue}
        placeholder={t.venuePlaceholder}
        error={errors.venue}
      />
      <Field
        label={t.capacity}
        name="capacity"
        inputMode="numeric"
        defaultValue={event?.capacity}
        placeholder={t.capacityPlaceholder}
        help={t.capacityHelp}
        error={errors.capacity}
      />
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? texts.space.saving : t.submit}
      </button>
    </form>
  );
}
