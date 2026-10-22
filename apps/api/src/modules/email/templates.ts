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
