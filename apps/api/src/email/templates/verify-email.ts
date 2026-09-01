/**
 * E-mail de vérification d'adresse — fr/en, texte + HTML, même carte sobre
 * que le reset (templates/reset-password.ts) : inline CSS uniquement.
 * `change: true` = l'adresse deviendra la nouvelle adresse du compte
 * (changement demandé depuis un compte déjà vérifié) ; `false` = vérification
 * de l'adresse du compte (inscription ou saisie sur compte non vérifié).
 */

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

const TTL_HOURS = 24;

// Palette (tokens du thème, dupliqués en dur : un e-mail n'emporte pas le CSS).
const C = {
  page: '#f4ecdc',
  card: '#fdfaf3',
  border: '#ddcb9e',
  ink: '#6b5640',
  inkSoft: '#7d6850',
  blood: '#a92424',
  gold: '#9a7c48',
};

function htmlWrap(inner: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
  <body style="margin:0;padding:0;background:${C.page};font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background:${C.card};border:1px solid ${C.border};border-radius:8px;padding:28px 24px;">
${inner}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildVerifyEmail(
  displayName: string,
  verifyUrl: string,
  locale: 'fr' | 'en',
  change: boolean,
): BuiltEmail {
  const name = displayName || '';
  if (locale === 'en') {
    const intro = change
      ? `confirm this address belongs to ${name} — it will become the new address of their Table Sync account.`
      : `confirm your address and secure your Table Sync account.`;
    return {
      subject: 'Table Sync — verify your email',
      text: [
        `Hello ${name},`,
        '',
        `One click to ${intro}`,
        verifyUrl,
        '',
        `This link expires in ${TTL_HOURS} hours and can only be used once.`,
        'If you did not expect this email, you can safely ignore it — nothing changes until the link is clicked.',
        '',
        '— The Table Sync team',
      ].join('\n'),
      html: htmlWrap(`            <tr>
              <td style="color:${C.gold};font-size:18px;font-weight:bold;padding-bottom:12px;">Table Sync</td>
            </tr>
            <tr>
              <td style="color:${C.ink};font-size:15px;line-height:1.5;padding-bottom:20px;">
                Hello ${escapeHtml(name)},<br /><br />
                One click to ${escapeHtml(intro)}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <a href="${verifyUrl}" style="display:inline-block;background:${C.blood};color:#fdfaf3;text-decoration:none;font-size:15px;padding:12px 24px;border-radius:6px;">Verify my email</a>
              </td>
            </tr>
            <tr>
              <td style="color:${C.inkSoft};font-size:13px;line-height:1.5;">
                This link expires in ${TTL_HOURS} hours and can only be used once. If the button does not work, copy this address into your browser:<br />
                <span style="word-break:break-all;">${verifyUrl}</span><br /><br />
                If you did not expect this email, you can safely ignore it — nothing changes until the link is clicked.
              </td>
            </tr>`),
    };
  }
  const intro = change
    ? `confirmer que cette adresse appartient à ${name} — elle deviendra la nouvelle adresse de son compte Table Sync.`
    : `confirmer ton adresse et sécuriser ton compte Table Sync.`;
  return {
    subject: 'Table Sync — vérifie ton adresse e-mail',
    text: [
      `Bonjour ${name},`,
      '',
      `Un clic pour ${intro}`,
      verifyUrl,
      '',
      `Ce lien expire dans ${TTL_HOURS} heures et ne peut servir qu'une seule fois.`,
      "Si tu n'attendais pas cet e-mail, ignore-le simplement — rien ne change tant que le lien n'est pas cliqué.",
      '',
      "— L'équipe Table Sync",
    ].join('\n'),
    html: htmlWrap(`            <tr>
              <td style="color:${C.gold};font-size:18px;font-weight:bold;padding-bottom:12px;">Table Sync</td>
            </tr>
            <tr>
              <td style="color:${C.ink};font-size:15px;line-height:1.5;padding-bottom:20px;">
                Bonjour ${escapeHtml(name)},<br /><br />
                Un clic pour ${escapeHtml(intro)}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <a href="${verifyUrl}" style="display:inline-block;background:${C.blood};color:#fdfaf3;text-decoration:none;font-size:15px;padding:12px 24px;border-radius:6px;">Vérifier mon adresse</a>
              </td>
            </tr>
            <tr>
              <td style="color:${C.inkSoft};font-size:13px;line-height:1.5;">
                Ce lien expire dans ${TTL_HOURS} heures et ne peut servir qu'une seule fois. Si le bouton ne fonctionne pas, copie cette adresse dans ton navigateur :<br />
                <span style="word-break:break-all;">${verifyUrl}</span><br /><br />
                Si tu n'attendais pas cet e-mail, ignore-le simplement — rien ne change tant que le lien n'est pas cliqué.
              </td>
            </tr>`),
  };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
