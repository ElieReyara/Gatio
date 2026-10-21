import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { fetchHealth } from '@/lib/api';
import { texts } from '@/texts/fr';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const health = await fetchHealth();
  const ok = health?.status === 'ok';

  return (
    <main className="page">
      <Logo />
      <h1 className="title">{texts.health.title}</h1>
      <p
        className={`banner ${ok ? 'banner--success' : 'banner--error'}`}
        role={ok ? 'status' : 'alert'}
      >
        <Icon name={ok ? 'check' : 'cross'} />
        <span>{ok ? texts.health.ok : texts.health.unavailable}</span>
      </p>
    </main>
  );
}
