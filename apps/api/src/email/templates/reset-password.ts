/**
 * E-mail de réinitialisation de mot de passe — fr/en, texte + HTML sur le
 * squelette partagé (templates/layout.ts) : carte parchemin, en-tête sceau +
 * mot-symbole, styles inline uniquement.
 */
import {
  type BuiltEmail,
  C,
  escapeHtml,
  headerBlock,
  htmlWrap,
  type TemplateAssets,
} from './layout.ts';

const TTL_MINUTES = 60;

export function buildResetPasswordEmail(
  displayName: string,
  resetUrl: string,
  locale: 'fr' | 'en',
  assets: TemplateAssets = {},
): BuiltEmail {
  const name = displayName || '';
  const header = headerBlock(assets);
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
      html: htmlWrap(`${header}            <tr>
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
    html: htmlWrap(`${header}            <tr>
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
