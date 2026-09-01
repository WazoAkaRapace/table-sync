/**
 * E-mail de vérification d'adresse — fr/en, texte + HTML sur le squelette
 * partagé (templates/layout.ts). `change: true` = l'adresse deviendra la
 * nouvelle adresse du compte (changement demandé depuis un compte déjà
 * vérifié) ; `change: false` = vérification de l'adresse du compte
 * (inscription ou saisie sur compte non vérifié).
 */
import {
  type BuiltEmail,
  C,
  escapeHtml,
  headerBlock,
  htmlWrap,
  type TemplateAssets,
} from './layout.ts';

const TTL_HOURS = 24;

export function buildVerifyEmail(
  displayName: string,
  verifyUrl: string,
  locale: 'fr' | 'en',
  change: boolean,
  assets: TemplateAssets = {},
): BuiltEmail {
  const name = displayName || '';
  const header = headerBlock(assets);
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
      html: htmlWrap(`${header}            <tr>
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
    html: htmlWrap(`${header}            <tr>
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
