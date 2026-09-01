/**
 * Squelette partagé des e-mails transactionnels — carte parchemin centrée,
 * styles inline uniquement (les webmails retirent classes et <style>).
 * L'en-tête porte le sceau de la maison : PNG servi par le web (jamais SVG —
 * Gmail/Outlook ne le rendent pas), même origine que le lien d'action. Sans
 * base d'origine connue, ou images bloquées par le client, le mot-symbole
 * « Table Sync » doré porte seul la marque — la mise en page n'en dépend pas.
 */

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Options communes aux templates. */
export interface TemplateAssets {
  /** URL absolue du sceau (…/icon-192.png) — vide = en-tête typographique seul. */
  logoUrl?: string;
}

// Palette (tokens du thème, dupliqués en dur : un e-mail n'emporte pas le CSS).
export const C = {
  page: '#f4ecdc', // fond email (parchemin sombre)
  card: '#fdfaf3', // parchment-50
  border: '#ddcb9e', // parchment-300
  ink: '#6b5640', // ink-500
  inkSoft: '#7d6850', // ink-400
  blood: '#a92424', // blood-400 (CTA)
  gold: '#9a7c48', // gold-600 (titre)
};

export function htmlWrap(inner: string): string {
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

/**
 * En-tête de marque : sceau PNG centré (64 px, 192 px de source = net en
 * rétine) + mot-symbole. width/height posés en attributs pour que le client
 * réserve la place même avant (ou sans) chargement ; alt porteur de marque.
 */
export function headerBlock(assets: TemplateAssets = {}): string {
  const seal = assets.logoUrl
    ? `            <tr>
              <td align="center" style="padding-bottom:10px;">
                <img src="${assets.logoUrl}" width="64" height="64" alt="Table Sync" style="display:block;width:64px;height:64px;border-radius:50%;border:2px solid ${C.border};" />
              </td>
            </tr>
`
    : '';
  return `${seal}            <tr>
              <td align="center" style="color:${C.gold};font-size:18px;font-weight:bold;letter-spacing:0.12em;padding-bottom:14px;">TABLE&nbsp;SYNC</td>
            </tr>`;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
