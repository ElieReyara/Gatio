import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailpitEmail } from './port.js';
import { ticketEmail } from './templates.js';

const base = {
  to: 'acheteur@exemple.com',
  name: 'Mahamat Idriss',
  eventTitle: 'Soirée Sahel Live',
  when: 'le samedi 14 novembre à 19 h',
  place: "Salle des fêtes, N'Djamena",
  reference: 'GT-7K3M9Q',
  count: 2,
  orderLink: (index: number) => `http://localhost:3000/commande/abc#t=jeton&b=${index}`,
  verifyLink: null,
  attachments: [],
};

describe('email du billet (E1)', () => {
  it('échappe le titre et le nom, sans motif de remplacement ni retour à la ligne', () => {
    const message = ticketEmail({
      ...base,
      name: '<img src=x onerror=alert(1)> Ali',
      eventTitle: "Concert <script>alert(1)</script> $' $&\nBcc: autre@exemple.com",
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&#60;script&#62;');
    expect(message.subject).not.toMatch(/\n/);
    expect(message.subject).toBe(
      "Vos billets pour Concert <script>alert(1)</script> $' $& Bcc: autre@exemple.com",
    );
    expect(message.html).toContain('<b>Concert &#60;script&#62;');
  });

  it('un bouton par billet, chacun ouvrant son billet', () => {
    const message = ticketEmail(base);
    expect(message.text).toContain(
      'Télécharger le billet 1 sur 2 : http://localhost:3000/commande/abc#t=jeton&b=1',
    );
    expect(message.text).toContain(
      'Télécharger le billet 2 sur 2 : http://localhost:3000/commande/abc#t=jeton&b=2',
    );
  });
});

describe('adaptateur Mailpit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envoie les pièces jointes en base64 avec leur nom et leur type', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await mailpitEmail('http://mailpit', { email: 'noreply@gatio.local', name: 'Gatio' }).send({
      ...ticketEmail(base),
      attachments: [
        {
          filename: 'billet-1.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('%PDF-1'),
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://mailpit/api/v1/send');
    const body = JSON.parse(String(init.body)) as { Attachments: unknown[] };
    expect(body.Attachments).toEqual([
      {
        Filename: 'billet-1.pdf',
        ContentType: 'application/pdf',
        Content: Buffer.from('%PDF-1').toString('base64'),
      },
    ]);
  });
});
