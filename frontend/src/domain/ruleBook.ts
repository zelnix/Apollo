// Apollo's rule book (backend/content/rulebook.md) turned into blocks the app can render, word for word.
// Handles exactly what the book uses: headings (with an optional {#id}), paragraphs, bullet and numbered
// lists (one level of nesting), tables, horizontal rules, **bold**, *italic* / _italic_ and `code`.
// Pure: no React, no native imports.

export interface Span { text: string; bold?: boolean; italic?: boolean; code?: boolean }
export interface ListItem { depth: number; marker: string; spans: Span[] }
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string | null }
  | { kind: "paragraph"; spans: Span[]; indent: boolean }
  | { kind: "list"; items: ListItem[] }
  | { kind: "table"; headers: string[]; rows: Span[][][] }
  | { kind: "rule" };

const HEADING = /^(#{1,3})\s+(.*?)(?:\s*\{#([\w-]+)\})?\s*$/;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const INLINE = /\*\*([^*]+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_/g;

/** Inline emphasis. An underscore inside a word (snake_case) is text, not italics. */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m[4] !== undefined && (/\w/.test(text[m.index - 1] ?? "") || /\w/.test(text[m.index + m[0].length] ?? ""))) continue;
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], code: true });
    else spans.push({ text: m[3] ?? m[4], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.filter((s) => s.text.length > 0);
}

export function plainText(spans: Span[]): string {
  return spans.map((s) => s.text).join("");
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parseRuleBook(markdown: string): Block[] {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let indent = false;
  let list: ListItem[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ")), indent });
    if (list.length) blocks.push({ kind: "list", items: list });
    paragraph = []; list = []; indent = false;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2], id: heading[3] ?? null });
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(line)) { flush(); blocks.push({ kind: "rule" }); continue; }
    if (line.trim().startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i += 1) {
        if (!/^\s*\|[\s|:-]+\|\s*$/.test(lines[i])) rows.push(cells(lines[i]));
      }
      i -= 1;
      const [headers = [], ...body] = rows;
      blocks.push({ kind: "table", headers: headers.map((h) => plainText(parseInline(h))), rows: body.map((row) => row.map(parseInline)) });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (paragraph.length) flush();
      const marker = /\d/.test(item[2]) ? item[2] : "•";
      list.push({ depth: Math.min(2, Math.round(item[1].length / 3)), marker, spans: parseInline(item[3]) });
      continue;
    }
    if (list.length && /^\s+\S/.test(line)) {
      // A wrapped continuation of the list item above.
      const lastItem = list[list.length - 1];
      lastItem.spans = parseInline(`${plainSource(lastItem.spans)} ${line.trim()}`);
      continue;
    }
    if (list.length) flush();
    if (!paragraph.length) indent = /^\s{2,}\S/.test(line);
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Re-create the markdown source of spans, so a continued list item is parsed as one piece. */
function plainSource(spans: Span[]): string {
  return spans.map((s) => (s.bold ? `**${s.text}**` : s.code ? `\`${s.text}\`` : s.italic ? `*${s.text}*` : s.text)).join("");
}

/** The date the book was last reviewed against the code, for display ("1 June 2026"). */
export function reviewedLabel(isoDate: string | null | undefined): string | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

export interface RuleBookSection { id: string; title: string; blocks: Block[] }

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The book as the app shows it: the intro, then one section per level-2 heading, each opened by a tap.
 *  The "---" lines between sections are dropped, because each section is its own card. */
export function sectionsOf(blocks: Block[]): { intro: Block[]; sections: RuleBookSection[] } {
  const intro: Block[] = [];
  const sections: RuleBookSection[] = [];
  for (const block of blocks) {
    if (block.kind === "heading" && block.level === 2) sections.push({ id: block.id ?? slug(block.text), title: block.text, blocks: [] });
    else (sections.length ? sections[sections.length - 1].blocks : intro).push(block);
  }
  const trim = (list: Block[]) => {
    while (list.length && list[list.length - 1].kind === "rule") list.pop();
    while (list.length && list[0].kind === "rule") list.shift();
  };
  trim(intro);
  sections.forEach((section) => trim(section.blocks));
  return { intro, sections };
}
