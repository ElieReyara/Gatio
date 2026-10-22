import type { Metadata } from 'next';
import { texts } from '@/texts/fr';
import { ResetForm } from './ResetForm';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.organizer.reset.title}` };

export default function ResetPasswordPage() {
  return <ResetForm />;
}
