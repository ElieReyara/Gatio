import type { Metadata } from 'next';
import { EmailConfirm } from '@/components/public/EmailConfirm';
import { texts } from '@/texts/fr';

export const metadata: Metadata = { title: texts.app.name, robots: { index: false } };

// Validation de l'email de l'acheteur (maquette B9) : le jeton est après le « # ».
export default function EmailConfirmPage() {
  return <EmailConfirm />;
}
