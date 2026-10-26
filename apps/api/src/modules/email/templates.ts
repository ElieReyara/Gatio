import type { EmailMessage } from './port.js';

// Textes des emails, repris de la maquette E3 (vouvoiement, système de design Savane).
const brand = '#a8431a';
const muted = '#5c5248';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function passwordResetEmail(to: string, link: string): EmailMessage {
  const subject = 'Réinitialisez votre mot de passe Gatio';
  const intro =
    'Vous avez demandé à choisir un nouveau mot de passe pour votre compte organisateur Gatio.';
  const button = 'Choisir un nouveau mot de passe';
  const note =
    'Ce lien est valable 30 minutes et ne sert qu’une fois. Si vous n’avez pas fait cette demande, ignorez cet email : votre mot de passe ne change pas.';
  const text = `Bonjour,\n\n${intro}\n\n${button} : ${link}\n\n${note}\n`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#faf6ef;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f1a14">
<div style="max-width:480px;margin:0 auto;padding:24px 20px;background:#ffffff;font-size:16px;line-height:24px">
<p style="margin:0 0 16px;font-size:20px;line-height:26px;font-weight:800;color:${brand}">Gatio</p>
<p style="margin:0 0 16px">Bonjour,</p>
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="display:block;padding:12px 16px;border-radius:12px;background:${brand};color:#ffffff;font-weight:700;text-align:center;text-decoration:none">${escapeHtml(button)}</a></p>
<p style="margin:0;font-size:14px;line-height:20px;color:${muted}">${escapeHtml(note)}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

// Maquette E1 : email du billet, envoyé après la confirmation du paiement (R32).
export function ticketEmail(input: {
  to: string;
  name: string;
  eventTitle: string;
  when: string;
  place: string;
  reference: string;
  count: number;
  // Lien vers la commande, ouverte sur le billet demandé (1 à count).
  orderLink: (index: number) => string;
  verifyLink: string | null;
  attachments: NonNullable<EmailMessage['attachments']>;
}): EmailMessage {
  // Champs saisis par l'organisateur ou l'acheteur : une seule ligne (objet de l'email).
  const title = oneLine(input.eventTitle);
  const place = oneLine(input.place);
  const plural = input.count > 1;
  const subject = `${plural ? 'Vos billets' : 'Votre billet'} pour ${title}`;
  const firstName = oneLine(input.name).split(' ')[0] ?? '';
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const lead = `Votre paiement est confirmé. Voici ${plural ? `vos ${input.count} billets` : 'votre billet'} pour `;
  const tail = `, ${input.when} (${place}).`;
  const attached = plural
    ? 'Vos billets sont aussi joints à cet email, en PDF.'
    : 'Votre billet est aussi joint à cet email, en PDF.';
  const note = `Présentez le QR code à l’entrée. Référence de commande : ${input.reference}.`;
  const buttons = Array.from({ length: input.count }, (_, i) => ({
    label: plural ? `Télécharger le billet ${i + 1} sur ${input.count}` : 'Télécharger mon billet',
    link: input.orderLink(i + 1),
  }));
  const verifyText = 'Pour recevoir vos prochains billets ici, confirmez votre adresse email.';
  const text = [
    greeting,
    '',
    `${lead}${title}${tail}`,
    '',
    ...buttons.map(({ label, link }) => `${label} : ${link}`),
    '',
    attached,
    note,
    ...(input.verifyLink ? ['', `${verifyText} ${input.verifyLink}`] : []),
    '',
  ].join('\n');
  const button = ({ label, link }: { label: string; link: string }, primary: boolean) =>
    `<p style="margin:0 0 8px"><a href="${escapeHtml(link)}" style="display:block;padding:12px 16px;border-radius:12px;border:2px solid ${primary ? brand : '#8c7f70'};background:${primary ? brand : '#ffffff'};color:${primary ? '#ffffff' : '#1f1a14'};font-weight:700;text-align:center;text-decoration:none">${escapeHtml(label)}</a></p>`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#faf6ef;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f1a14">
<div style="max-width:480px;margin:0 auto;padding:24px 20px;background:#ffffff;font-size:16px;line-height:24px">
<p style="margin:0 0 16px;font-size:20px;line-height:26px;font-weight:800;color:${brand}">Gatio</p>
<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px">${escapeHtml(lead)}<b>${escapeHtml(title)}</b>${escapeHtml(tail)}</p>
${buttons.map((entry, i) => button(entry, i === 0)).join('\n')}
<p style="margin:8px 0 0;font-size:14px;line-height:20px;color:${muted}">${escapeHtml(attached)} ${escapeHtml(note)}</p>
${
  input.verifyLink
    ? `<hr style="margin:16px 0;border:0;border-top:1px solid #e4dacb"><p style="margin:0;font-size:14px;line-height:20px">Pour recevoir vos prochains billets ici, <a href="${escapeHtml(input.verifyLink)}" style="color:${brand};font-weight:700">confirmez votre adresse email</a>.</p>`
    : ''
}
</div></body></html>`;
  return { to: input.to, subject, text, html, attachments: input.attachments };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
