/**
 * Lightweight Markdown-to-HTML renderer.
 * Supports: headings, bold, italic, inline code, code blocks,
 * links, images, lists, blockquotes, horizontal rules, and tables.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderMarkdown(md: string): string {
  if (!md || !md.trim()) return '';

  const lines = md.split('\n');
  const html: string[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
        codeLines = [];
        i++;
        continue;
      } else {
        const langAttr = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
        html.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
        i++;
        continue;
      }
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      html.push('<hr />');
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(headingMatch[2]))}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      html.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+[-| :]*$/.test(lines[i + 1].trim())) {
      const headerCells = line.split('|').map(c => c.trim()).filter(Boolean);
      const alignLine = lines[i + 1];
      const aligns = alignLine.split('|').map(c => c.trim()).filter(Boolean).map(c => {
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });
      let tableHtml = '<table><thead><tr>';
      headerCells.forEach((cell, idx) => {
        const align = aligns[idx] || 'left';
        tableHtml += `<th style="text-align:${align}">${renderInline(escapeHtml(cell))}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
        tableHtml += '<tr>';
        cells.forEach((cell, idx) => {
          const align = aligns[idx] || 'left';
          tableHtml += `<td style="text-align:${align}">${renderInline(escapeHtml(cell))}</td>`;
        });
        tableHtml += '</tr>';
        i++;
      }
      tableHtml += '</tbody></table>';
      html.push(tableHtml);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s/, ''));
        i++;
      }
      html.push('<ul>' + items.map(item => `<li>${renderInline(escapeHtml(item))}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s/, ''));
        i++;
      }
      html.push('<ol>' + items.map(item => `<li>${renderInline(escapeHtml(item))}</li>`).join('') + '</ol>');
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim()) && !lines[i].trimStart().startsWith('```') && !lines[i].trimStart().startsWith('> ')) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      html.push(`<p>${renderInline(escapeHtml(paraLines.join('\n')))}</p>`);
    }
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  return html.join('\n');
}
