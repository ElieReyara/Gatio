// Port Email (conception §3.11) : le programme ne dépend d'aucun service d'envoi.
// Boîte de test locale (Mailpit) en développement ; service réel en tranche 16.
export type EmailAttachment = { filename: string; contentType: string; content: Buffer };
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
};

export type EmailPort = { send(message: EmailMessage): Promise<void> };

// Mailpit accepte l'envoi par son API HTTP : aucune bibliothèque SMTP nécessaire.
export function mailpitEmail(baseUrl: string, from: { email: string; name: string }): EmailPort {
  return {
    async send(message) {
      const response = await fetch(`${baseUrl}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: from.email, Name: from.name },
          To: [{ Email: message.to }],
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
          Attachments: (message.attachments ?? []).map((attachment) => ({
            Filename: attachment.filename,
            ContentType: attachment.contentType,
            Content: attachment.content.toString('base64'),
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`mailpit send failed: ${response.status}`);
    },
  };
}
