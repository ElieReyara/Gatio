import type { Metadata } from 'next';
import { texts } from '@/texts/fr';
import { AuthPage } from '../AuthPage';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.organizer.login.title}` };

export default function LoginPage() {
  return (
    <AuthPage title={texts.organizer.login.title}>
      <LoginForm />
    </AuthPage>
  );
}
