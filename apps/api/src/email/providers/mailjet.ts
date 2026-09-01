/**
 * Adapter Mailjet — API Send v3.1 (JSON + Basic auth, clé:secret).
 * https://dev.mailjet.com/email/reference/send-email-v3/
 * fetch natif (Node >= 20), pas de SDK : le contrat EmailProvider reste mince
 * et identique pour les futurs providers.
 */
import type { EmailConfig } from '../config.ts';
import type { EmailProvider } from '../types.ts';

const TIMEOUT_MS = 10_000;

export function createMailjetProvider(config: EmailConfig): EmailProvider {
  const authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`;
  return {
    name: 'mailjet',
    async send(message) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${config.apiUrl}/send`, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Messages: [
              {
                From: {
                  Email: config.fromAddress,
                  ...(config.fromName ? { Name: config.fromName } : {}),
                },
                To: [{ Email: message.to, ...(message.toName ? { Name: message.toName } : {}) }],
                Subject: message.subject,
                TextPart: message.text,
                HTMLPart: message.html,
              },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`mailjet: HTTP ${res.status} ${detail.slice(0, 200)}`);
        }
      } catch (err) {
        const reason =
          (err as Error).name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : (err as Error).message;
        throw new Error(`mailjet: ${reason}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
