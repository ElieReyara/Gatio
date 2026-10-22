import type { Metadata } from 'next';
import { texts } from '@/texts/fr';
import { AuthPage } from '../AuthPage';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = {
  title: `${texts.app.name} · ${texts.organizer.register.title}`,
};

export default function RegisterPage() {
  return (
    <AuthPage title={texts.organizer.register.title}>
      <RegisterForm />
    </AuthPage>
  );
}
