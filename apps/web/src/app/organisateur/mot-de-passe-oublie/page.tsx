import type { Metadata } from 'next';
import { texts } from '@/texts/fr';
import { ForgotForm } from './ForgotForm';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.organizer.forgot.title}` };

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
