/**
 * Render simple Markdown to HTML (no external deps).
 * Shared by the character sheet's Notes tab and the DM notebook — one engine,
 * one look. Supports: # headers, **bold**, *italic*, - lists, `code`,
 * > quotes, --- dividers.
 */

function inline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-parchment-200 px-1 rounded text-blood-700 text-[11px]">$1</code>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    // Blank line
    if (!line.trim()) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push('');
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push('<hr class="border-parchment-200 my-2" />');
      continue;
    }
    // Headers
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      const level = h[1].length;
      const cls =
        level === 1
          ? 'font-display text-base font-bold text-ink-800 mt-2'
          : level === 2
            ? 'font-semibold text-ink-700 mt-1.5'
            : 'font-medium text-ink-600 mt-1';
      html.push(`<div class="${cls}">${inline(h[2])}</div>`);
      continue;
    }
    // Blockquote
    if (line.startsWith('> ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(
        `<blockquote class="border-l-2 border-blood-400 pl-2 text-ink-500 italic my-1">${inline(line.slice(2))}</blockquote>`,
      );
      continue;
    }
    // List items
    if (line.match(/^[-*]\s+/)) {
      if (!inList) {
        html.push('<ul class="list-disc list-inside space-y-0.5 my-1">');
        inList = true;
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    // Regular paragraph
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    html.push(`<p>${inline(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}
