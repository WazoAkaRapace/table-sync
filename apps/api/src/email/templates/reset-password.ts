/**
 * E-mail de réinitialisation de mot de passe — fr/en, texte + HTML. Le HTML
 * reste volontairement minimal (table centrée, styles inline : les webmails
 * retirent classes et <style>) dans l'univers parchemin/encre/sang de l'app.
 */

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

const TTL_MINUTES = 60;

// Palette (tokens du thème, dupliqués en dur : un e-mail n'emporte pas le CSS).
const C = {
  page: '#f4ecdc', // fond email (parchemin sombre)
  card: '#fdfaf3', // parchment-50
  border: '#ddcb9e', // parchment-300
  ink: '#6b5640', // ink-500
  inkSoft: '#7d6850', // ink-400
  blood: '#a92424', // blood-400 (CTA)
  gold: '#9a7c48', // gold-600 (titre)
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

export function buildResetPasswordEmail(
  displayName: string,
  resetUrl: string,
  locale: 'fr' | 'en',
): BuiltEmail {
  const name = displayName || '';
  if (locale === 'en') {
    return {
      subject: 'Table Sync — reset your password',
      text: [
        `Hello ${name},`,
        '',
        'You asked to reset your Table Sync password. Click the link below to choose a new one:',
        resetUrl,
        '',
        `This link expires in ${TTL_MINUTES} minutes and can only be used once.`,
        'If you did not request this, you can safely ignore this email — your password stays unchanged.',
        '',
        '— The Table Sync team',
      ].join('\n'),
      html: htmlWrap(`            <tr>
              <td style="color:${C.gold};font-size:18px;font-weight:bold;padding-bottom:12px;">Table Sync</td>
            </tr>
            <tr>
              <td style="color:${C.ink};font-size:15px;line-height:1.5;padding-bottom:20px;">
                Hello ${escapeHtml(name)},<br /><br />
                You asked to reset your Table Sync password. Click the button below to choose a new one.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <a href="${resetUrl}" style="display:inline-block;background:${C.blood};color:#fdfaf3;text-decoration:none;font-size:15px;padding:12px 24px;border-radius:6px;">Choose a new password</a>
              </td>
            </tr>
            <tr>
              <td style="color:${C.inkSoft};font-size:13px;line-height:1.5;">
                This link expires in ${TTL_MINUTES} minutes and can only be used once. If the button does not work, copy this address into your browser:<br />
                <span style="word-break:break-all;">${resetUrl}</span><br /><br />
                If you did not request this, you can safely ignore this email — your password stays unchanged.
              </td>
            </tr>`),
    };
  }
  return {
    subject: 'Table Sync — réinitialisation de votre mot de passe',
    text: [
      `Bonjour ${name},`,
      '',
      'Vous avez demandé la réinitialisation de votre mot de passe Table Sync. Cliquez sur le lien ci-dessous pour en choisir un nouveau :',
      resetUrl,
      '',
      `Ce lien expire dans ${TTL_MINUTES} minutes et ne peut servir qu'une seule fois.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail — votre mot de passe reste inchangé.",
      '',
      "— L'équipe Table Sync",
    ].join('\n'),
    html: htmlWrap(`            <tr>
              <td style="color:${C.gold};font-size:18px;font-weight:bold;padding-bottom:12px;">Table Sync</td>
            </tr>
            <tr>
              <td style="color:${C.ink};font-size:15px;line-height:1.5;padding-bottom:20px;">
                Bonjour ${escapeHtml(name)},<br /><br />
                Vous avez demandé la réinitialisation de votre mot de passe Table Sync. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <a href="${resetUrl}" style="display:inline-block;background:${C.blood};color:#fdfaf3;text-decoration:none;font-size:15px;padding:12px 24px;border-radius:6px;">Choisir un nouveau mot de passe</a>
              </td>
            </tr>
            <tr>
              <td style="color:${C.inkSoft};font-size:13px;line-height:1.5;">
                Ce lien expire dans ${TTL_MINUTES} minutes et ne peut servir qu'une seule fois. Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br />
                <span style="word-break:break-all;">${resetUrl}</span><br /><br />
                Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail — votre mot de passe reste inchangé.
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
