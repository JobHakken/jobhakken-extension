/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/templates/shared.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { resumeFontFaceCss } from '../fonts';
import type { Resume, ResumeRenderOptions } from '../model';
import type { ExperienceItem, RoleItem } from '../schema';

/** Page dimensions at 96dpi + the CSS @page size keyword. */
const PAGE_DIMS = {
  Letter: { w: 816, h: 1056, css: 'Letter' }, // 8.5 x 11in
  A4: { w: 794, h: 1123, css: 'A4' }, // 210 x 297mm
} as const;

/**
 * Shared résumé body builder. All templates emit the SAME semantic HTML (classes:
 * name/contact/section-title/entry/date/small/ul/entrygap/pub/rich) and differ only
 * by their CSS — so a template is just a stylesheet over this structure, and the
 * renderer's preview == the printToPDF export (both call the same render).
 *
 * The model is Reactive Resume v5 `ResumeData`: descriptions are rich-text HTML
 * strings, which we **sanitize + inject** (that's where `<ul><li>` bullets come
 * from). Section order follows the résumé's own `metadata.layout` (main then
 * sidebar), so the user's arrangement is respected.
 */

/** Wrap a template's CSS + the shared body into a full HTML document. */
export function renderDocument(css: string, resume: Resume, opts?: ResumeRenderOptions): string {
  const dims = PAGE_DIMS[opts?.pageSize ?? 'Letter'] ?? PAGE_DIMS.Letter;
  // Injected AFTER the template CSS so it overrides the template's default page size.
  const pageCss = `.page { width: ${dims.w}px; min-height: ${dims.h}px; }\n@page { size: ${dims.css}; }`;
  return `<style>\n${resumeFontFaceCss()}\n${css}\n${pageCss}\n</style>\n<div class="page">\n${renderResumeBody(resume)}\n</div>`;
}

/** Default English section headings when a section leaves its `title` blank. */
const SECTION_LABEL: Record<string, string> = {
  summary: 'Summary',
  profiles: 'Profiles',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  languages: 'Languages',
  interests: 'Interests',
  awards: 'Awards',
  certifications: 'Certifications',
  publications: 'Publications',
  volunteer: 'Volunteering',
  references: 'References',
};

const GAP = '<div class="entrygap"></div>';

/** The inner `.page` HTML (header + sections), shared by every template. */
export function renderResumeBody(resume: Resume): string {
  const parts: string[] = [renderHeader(resume)];
  for (const id of sectionOrder(resume)) {
    const html = renderSectionById(resume, id);
    if (html) parts.push(html);
  }
  return parts.join('\n');
}

/** Section render order: the résumé's own layout (main then sidebar), de-duped. */
function sectionOrder(resume: Resume): string[] {
  const pages = resume.metadata?.layout?.pages ?? [];
  const ids: string[] = [];
  for (const page of pages) {
    for (const id of [...(page.main ?? []), ...(page.sidebar ?? [])]) {
      if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
    }
  }
  if (ids.length) return ids;
  // fallback if the layout is empty
  return ['summary', 'experience', 'education', 'skills', 'projects', 'publications', 'certifications', 'awards', 'languages', 'volunteer', 'interests', 'references'];
}

function renderHeader(resume: Resume): string {
  const b = resume.basics;
  const links: Array<{ text: string; url?: string }> = [];
  if (b.name) {
    /* name rendered separately below */
  }
  if (b.email) links.push({ text: b.email, url: `mailto:${b.email}` });
  if (b.phone) links.push({ text: b.phone, url: `tel:${b.phone.replace(/[^+\d]/g, '')}` });
  if (b.location) links.push({ text: b.location });
  if (b.website?.url) links.push({ text: b.website.label || cleanUrl(b.website.url), url: b.website.url });
  for (const cf of b.customFields ?? []) {
    if (cf.text) links.push({ text: cf.text, url: cf.link || undefined });
  }
  for (const p of resume.sections?.profiles?.items ?? []) {
    if (p.hidden) continue;
    const text = p.username || p.network;
    if (text) links.push({ text, url: p.website?.url || undefined });
  }

  const contacts = links
    .map((c) => (c.url ? `<a href="${attr(c.url)}">${esc(c.text)}</a>` : esc(c.text)))
    .join('<span class="sep">|</span>');

  return [
    `<p class="name">${esc(b.name)}</p>`,
    contacts ? `<p class="contact">${contacts}</p>` : '',
    `<hr class="rule" />`,
  ]
    .filter(Boolean)
    .join('\n');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderSectionById(resume: Resume, id: string): string {
  if (id === 'profiles') return ''; // rendered in the header

  if (id === 'summary') {
    const s = resume.summary;
    if (!s || s.hidden) return '';
    const body = rich(s.content);
    return body ? section(title(s.title, 'summary'), body) : '';
  }

  const sec = (resume.sections as any)?.[id];
  if (!sec || sec.hidden) return '';
  const items: any[] = (sec.items ?? []).filter((it: any) => !it?.hidden);
  if (!items.length) return '';
  const t = title(sec.title, id);

  switch (id) {
    case 'experience':
      return section(t, items.map(renderExperience).join(GAP));
    case 'education':
      return section(t, items.map(renderEducation).join(GAP));
    case 'projects':
      return section(t, items.map(renderProject).join(GAP));
    case 'skills':
      return section(t, items.map(renderSkill).join(''));
    case 'publications':
      return section(t, items.map(renderPublication).join(''));
    case 'certifications':
      return section(t, items.map((c) => entry(`<b>${esc(c.title)}</b>${c.issuer ? `, ${esc(c.issuer)}` : ''}`, c.date) + rich(c.description)).join(GAP));
    case 'awards':
      return section(t, items.map((a) => entry(`<b>${esc(a.title)}</b>${a.awarder ? `, ${esc(a.awarder)}` : ''}`, a.date) + rich(a.description)).join(GAP));
    case 'volunteer':
      return section(t, items.map((v) => entry(`<b>${esc(v.organization)}</b>${v.location ? ` · ${esc(v.location)}` : ''}`, v.period) + rich(v.description)).join(GAP));
    case 'references':
      return section(t, items.map((r) => `<p class="small"><b>${esc(r.name)}</b>${r.position ? `, ${esc(r.position)}` : ''}</p>${rich(r.description)}`).join(GAP));
    case 'languages':
      return section(t, inlineList(items.map((l) => (l.fluency ? `${esc(l.language)} (${esc(l.fluency)})` : esc(l.language)))));
    case 'interests':
      return section(t, inlineList(items.flatMap((i) => [i.name, ...(i.keywords ?? [])]).map(esc)));
    default:
      return '';
  }
}

function renderExperience(x: ExperienceItem): string {
  const head = `<b>${esc(x.position || x.company)}</b>${x.position && x.company ? `, ${esc(x.company)}` : ''}${x.location ? ` · ${esc(x.location)}` : ''}`;
  let html = entry(head, x.period) + rich(x.description);
  for (const role of x.roles ?? ([] as RoleItem[])) {
    html += entry(`<span class="it">${esc(role.position)}</span>`, role.period, true) + rich(role.description);
  }
  return html;
}

function renderEducation(e: any): string {
  const deg = [e.degree, e.area].filter(Boolean).map(esc).join(', ');
  const head = `<b>${esc(e.school)}</b>${deg ? `, ${deg}` : ''}${e.grade ? ` (GPA: ${esc(e.grade)})` : ''}`;
  return entry(head, e.period) + rich(e.description);
}

function renderProject(p: any): string {
  return entry(`<b>${esc(p.name)}</b>`, p.period, true) + rich(p.description);
}

function renderSkill(s: any): string {
  const keywords: string[] = s.keywords ?? [];
  if (keywords.length) return `<p class="small"><b>${esc(s.name)}:</b> ${esc(keywords.join(', '))}</p>`;
  return `<p class="small"><b>${esc(s.name)}</b>${s.proficiency ? ` — ${esc(s.proficiency)}` : ''}</p>`;
}

function renderPublication(pub: any): string {
  const meta = [pub.publisher, pub.date].filter(Boolean).map(esc).join(' — ');
  return `<p class="pub"><b>&ldquo;${esc(pub.title)}&rdquo;</b>${meta ? ` ${meta}` : ''}</p>${rich(pub.description)}`;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function section(heading: string, body: string): string {
  return `<p class="section-title">${esc(heading)}</p>\n${body}`;
}

function entry(left: string, date?: string, italicDate = false): string {
  const right = date ? `<span class="date${italicDate ? ' it' : ''}">${esc(date)}</span>` : '';
  return `<div class="entry"><span>${left}</span>${right}</div>`;
}

function inlineList(parts: string[]): string {
  const body = parts.filter((p) => p && p.trim()).join(', ');
  return body ? `<p class="small">${body}</p>` : '';
}

/** A section's display heading: its own title, else the default English label. */
function title(sectionTitle: string | undefined, id: string): string {
  const t = sectionTitle?.trim();
  return t || SECTION_LABEL[id] || id;
}

// ---- rich text (bullets) ----

/** Tags allowed in injected description HTML — everything else is stripped to text. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'mark', 'a', 'span', 'sub', 'sup', 'blockquote', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

/**
 * Sanitize a rich-text HTML description and wrap it for the templates. Keeps an
 * allowlist of inline/list tags (drops all attributes except a safe `href`),
 * removes `<script>`/`<style>` blocks, comments, event handlers, and dangerous
 * URLs. Returns `''` when there's no visible text (so empty descriptions render
 * nothing).
 */
export function rich(html: string | undefined | null): string {
  const clean = sanitizeRichHtml(html);
  return hasText(clean) ? `<div class="rich">${clean}</div>` : '';
}

/** The bare sanitized HTML (no wrapper) — exported for tests/other renderers. */
export function sanitizeRichHtml(html: string | undefined | null): string {
  let s = String(html ?? '');
  if (!s.trim()) return '';
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_m, slash: string, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (slash) return `</${tag}>`;
    if (tag === 'a') {
      const href = safeHref(attrs);
      return href ? `<a href="${href}">` : '<a>';
    }
    return `<${tag}>`;
  });
  return s;
}

function safeHref(attrs: string): string {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!m) return '';
  const raw = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  // allow http(s), mailto, tel, anchors, and relative paths; block javascript:/data:/vbscript:
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(raw)) return attr(raw);
  if (!/:/.test(raw)) return attr(raw); // no scheme → relative
  return '';
}

/** Whether sanitized HTML has any visible text (ignoring tags/whitespace/nbsp). */
function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;
}

function cleanUrl(url: string): string {
  return String(url).replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/** Escape text content. */
export function esc(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape an attribute value (e.g. href). */
export function attr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}
