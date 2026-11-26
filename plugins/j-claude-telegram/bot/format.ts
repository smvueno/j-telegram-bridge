/**
 * Claude's Markdown -> Telegram HTML (parse_mode "HTML"): bold, italic, strike, inline code,
 * code blocks, links, headings (bold), bullets and quotes. Anything else stays as text.
 * Everything is escaped first, so only the tags made here reach Telegram.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(line: string): string {
  // pull out inline code first so nothing inside it is touched
  const codes: string[] = [];
  let s = line.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/"/g, "&quot;")}">${t}</a>`);
  s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>");
  s = s.replace(/__(?=\S)(.+?)(?<=\S)__/g, "<b>$1</b>");
  s = s.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\w)/g, "$1<i>$2</i>");
  s = s.replace(/(^|[^\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?!\w)/g, "$1<i>$2</i>");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${esc(codes[Number(i)]!)}</code>`);
}

export function markdownToTelegramHtml(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let quote: string[] = [];
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.join("\n")}</blockquote>`);
    quote = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (fence) {
      // find the closing fence; without one, the line is just text
      const end = lines.findIndex((l, j) => j > i && /^\s*```\s*$/.test(l));
      if (end !== -1) {
        flushQuote();
        const code = esc(lines.slice(i + 1, end).join("\n"));
        const lang = fence[1] ? ` class="language-${esc(fence[1])}"` : "";
        out.push(`<pre><code${lang}>${code}</code></pre>`);
        i = end;
        continue;
      }
    }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      quote.push(inline(q[1]!));
      continue;
    }
    flushQuote();
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      out.push(`<b>${inline(h[1]!)}</b>`);
      continue;
    }
    const li = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (li) {
      out.push(`${li[1]}• ${inline(li[2]!)}`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("──────");
      continue;
    }
    out.push(inline(line));
  }
  flushQuote();
  return out.join("\n");
}
