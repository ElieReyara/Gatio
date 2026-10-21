import { Icon } from '@/components/Icon';
import { texts } from '@/texts/fr';

// Logo provisoire du système de design : billet à encoches + « Gatio » en brand.
export function Logo() {
  return (
    <span className="logo">
      <Icon name="ticket" size={28} />
      {texts.app.name}
    </span>
  );
}
