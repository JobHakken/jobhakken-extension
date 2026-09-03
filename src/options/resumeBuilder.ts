/**
 * Native résumé builder — build/edit a résumé right in the extension, no website visit required.
 *
 * A faithful port of jobhakken-site's `src/pages/resume-builder.tsx` (see
 * JobHakken/JobHakken#482), translated from React into the plain-DOM style this repo already uses
 * everywhere else (`rail.ts`, `content.ts`): no framework, one `render()` that rebuilds the form from
 * state on a structural change, direct state writes (no re-render) on a keystroke so a focused input
 * or the rich-text field never loses its cursor.
 *
 * Reads/writes the vendored `Resume` shape (`src/lib/vendor/resume`) — the same shape the site, the
 * desktop app and the localhost bridge already share (ADR-0005) — so a résumé built here is the same
 * kind of object as one imported from either. Storage is `resumeDraftStore.ts` (chrome.storage.local),
 * on-device only, same guarantee as every other piece of profile data this extension keeps.
 */
import {
  DEFAULT_TEMPLATE_ID,
  RESUME_TEMPLATES,
  renderResumeHtml,
} from '../lib/vendor/resume/registry.js';
import { STARTER_RESUME } from '../lib/vendor/resume/defaults.js';
import { coerceResumeData } from '../lib/vendor/resume/fromReactiveResumeV5.js';
import type { Resume } from '../lib/vendor/resume/model.js';
import { getResumeDraft, setResumeDraft } from '../lib/resumeDraftStore.js';

type SectionKey = 'experience' | 'education' | 'skills';
type Item = Record<string, unknown>;

const SECTION_TITLES: Record<SectionKey, string> = { experience: 'Experience', education: 'Education', skills: 'Skills' };
const SECTION_FIELDS: Record<SectionKey, { key: string; label: string; rich?: boolean }[]> = {
  experience: [
    { key: 'company', label: 'Company' },
    { key: 'position', label: 'Title' },
    { key: 'period', label: 'Dates (e.g. 2022 – Present)' },
    { key: 'location', label: 'Location' },
    { key: 'description', label: 'What you did', rich: true },
  ],
  education: [
    { key: 'school', label: 'School' },
    { key: 'degree', label: 'Degree' },
    { key: 'area', label: 'Field of study' },
    { key: 'period', label: 'Dates' },
    { key: 'grade', label: 'Grade / GPA' },
    { key: 'description', label: 'Notes', rich: true },
  ],
  skills: [
    { key: 'name', label: 'Skill' },
    { key: 'proficiency', label: 'Proficiency (e.g. Advanced)' },
    { key: 'keywords', label: 'Keywords (comma-separated)' },
  ],
};

const uid = (): string => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function blankItem(resume: Resume, sk: SectionKey): Item {
  const proto = (resume.sections as unknown as Record<string, { items?: unknown[] }>)[sk]?.items?.[0];
  const base: Item = proto ? (structuredClone(proto) as Item) : {};
  for (const k of Object.keys(base)) {
    const v = base[k];
    if (typeof v === 'string') base[k] = '';
    else if (Array.isArray(v)) base[k] = [];
    else if (v && typeof v === 'object' && 'url' in (v as object)) base[k] = { url: '', label: '' };
  }
  base.id = uid();
  base.hidden = false;
  return base;
}

function fieldValue(it: Item, key: string): string {
  const v = it[key];
  if (key === 'keywords' && Array.isArray(v)) return v.join(', ');
  return typeof v === 'string' ? v : '';
}

/** Escape text placed into an HTML attribute (`value="…"`, `data-placeholder="…"`). */
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function mountResumeBuilder(root: HTMLElement): void {
  let resume: Resume = STARTER_RESUME;
  let templateId: string = DEFAULT_TEMPLATE_ID;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const items = (sk: SectionKey): Item[] =>
    ((resume.sections as unknown as Record<string, { items?: unknown[] }>)[sk]?.items ?? []) as Item[];

  const writeItems = (sk: SectionKey, next: Item[]): void => {
    const sections = resume.sections as unknown as Record<string, { items?: unknown[] }>;
    resume = { ...resume, sections: { ...sections, [sk]: { ...sections[sk], items: next } } } as unknown as Resume;
  };

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    // Debounced, not on every keystroke — this is chrome.storage.local, not an in-memory variable,
    // and a résumé's text fields see a lot of keystrokes.
    saveTimer = setTimeout(() => {
      void setResumeDraft({ resume, templateId });
    }, 400);
  }

  function updatePreview(): void {
    const frame = root.querySelector<HTMLIFrameElement>('.rb-frame');
    if (!frame) return;
    try {
      frame.srcdoc = renderResumeHtml(resume, templateId);
    } catch {
      frame.srcdoc = '<p style="font-family:sans-serif;padding:24px">Preview unavailable.</p>';
    }
  }

  /** For a plain-text field: update state + preview + save, but do NOT rebuild the DOM — the input
   *  the person is typing into must not lose focus or cursor position mid-keystroke. */
  function onFieldInput(mutate: () => void): void {
    mutate();
    updatePreview();
    scheduleSave();
  }

  function download(): void {
    const html = renderResumeHtml(resume, templateId);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    // Same approach the site's builder uses: no PDF library, no Chromium launch (an extension has
    // neither) — the browser's own print dialog, which offers "Save as PDF" on every platform.
    setTimeout(() => w.print(), 400);
  }

  function exportJson(): void {
    const blob = new Blob([JSON.stringify(resume, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobhakken-resume.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resume = coerceResumeData(JSON.parse(String(reader.result)));
        render();
        updatePreview();
        scheduleSave();
      } catch {
        alert('Could not read that file — is it a résumé JSON?');
      }
    };
    reader.readAsText(file);
  }

  function reset(): void {
    if (!confirm('Clear this résumé and start over?')) return;
    resume = STARTER_RESUME;
    templateId = DEFAULT_TEMPLATE_ID;
    render();
    updatePreview();
    scheduleSave();
  }

  /** A single-line text field. Renders once; updates through `oninput` without a re-render. */
  function textField(label: string, value: string, onChange: (v: string) => void): string {
    const id = `rb-f-${uid()}`;
    queueMicrotask(() => {
      const el = root.querySelector<HTMLInputElement>(`#${id}`);
      el?.addEventListener('input', () => onFieldInput(() => onChange(el.value)));
    });
    return `<label class="rb-field"><span>${label}</span><input id="${id}" class="rb-input" type="text" value="${escAttr(value)}"></label>`;
  }

  /** Tiny rich-text field (bold / italic / bullets), contentEditable + execCommand — deliberately
   *  dependency-free, matching the site's own component exactly (jobhakken-site's richText.tsx). The
   *  desktop app's Tiptap editor writes the same HTML model, so drafts stay compatible either way. */
  function richField(label: string, value: string, placeholder: string, onChange: (html: string) => void): string {
    const id = `rb-rt-${uid()}`;
    queueMicrotask(() => {
      const wrap = root.querySelector<HTMLElement>(`#${id}`);
      const edit = wrap?.querySelector<HTMLElement>('.rt-edit');
      if (!wrap || !edit) return;
      edit.addEventListener('input', () => onFieldInput(() => onChange(edit.innerHTML)));
      wrap.querySelectorAll<HTMLButtonElement>('.rt-bar button').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
        btn.addEventListener('click', () => {
          document.execCommand(btn.dataset.cmd!, false);
          edit.focus();
          onFieldInput(() => onChange(edit.innerHTML));
        });
      });
    });
    return `
      <label class="rb-field"><span>${label}</span>
        <div class="rt-wrap" id="${id}">
          <div class="rt-bar">
            <button type="button" data-cmd="bold" aria-label="Bold"><b>B</b></button>
            <button type="button" data-cmd="italic" aria-label="Italic"><i>I</i></button>
            <button type="button" data-cmd="insertUnorderedList" aria-label="Bulleted list">• List</button>
          </div>
          <div class="rt-edit" contenteditable role="textbox" aria-multiline="true"
               data-placeholder="${escAttr(placeholder)}">${value}</div>
        </div>
      </label>`;
  }

  function render(): void {
    const b = resume.basics as unknown as {
      name?: string;
      headline?: string;
      email?: string;
      phone?: string;
      location?: string;
      website?: { url?: string; label?: string };
    };
    const setBasics = (patch: Partial<typeof b>): void => {
      resume = { ...resume, basics: { ...resume.basics, ...patch } } as unknown as Resume;
    };

    const toolbar = `
      <div class="rb-toolbar">
        <button type="button" class="btn" id="rb-import">Import JSON</button>
        <button type="button" class="btn" id="rb-export">Export JSON</button>
      </div>
      <input type="file" id="rb-file" accept="application/json,.json" hidden>`;

    const templatePicker = `
      <label class="rb-field"><span>Template</span>
        <div class="rb-templates">
          ${RESUME_TEMPLATES.map(
            (t) =>
              `<button type="button" class="btn${t.id === templateId ? ' primary' : ''}" data-tpl="${t.id}" style="padding:6px 12px;font-size:13px">${t.name}</button>`,
          ).join('')}
        </div>
      </label>`;

    const basicsHtml = `
      <h3 class="rb-h">Basics</h3>
      ${textField('Full name', b.name ?? '', (v) => setBasics({ name: v }))}
      ${textField('Headline', b.headline ?? '', (v) => setBasics({ headline: v }))}
      ${textField('Email', b.email ?? '', (v) => setBasics({ email: v }))}
      ${textField('Phone', b.phone ?? '', (v) => setBasics({ phone: v }))}
      ${textField('Location', b.location ?? '', (v) => setBasics({ location: v }))}
      ${textField('Website', b.website?.url ?? '', (v) => setBasics({ website: { url: v, label: v.replace(/^https?:\/\//, '') } }))}
      ${richField('Professional summary', (resume.summary as { content?: string } | undefined)?.content ?? '', 'A short professional summary…', (html) => {
        resume = { ...resume, summary: { ...(resume.summary as object), content: html } } as unknown as Resume;
      })}`;

    const sectionsHtml = (Object.keys(SECTION_FIELDS) as SectionKey[])
      .map((sk) => {
        const list = items(sk);
        const itemsHtml = list
          .map((it, i) => {
            const fieldsHtml = SECTION_FIELDS[sk]
              .map((f) =>
                f.rich
                  ? richField(f.label, fieldValue(it, f.key), 'Describe your impact…', (html) => {
                      const value: unknown = html;
                      writeItems(
                        sk,
                        items(sk).map((x) => (x.id === it.id ? { ...x, [f.key]: value } : x)),
                      );
                    })
                  : textField(f.label, fieldValue(it, f.key), (v) => {
                      const value: unknown = f.key === 'keywords' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v;
                      writeItems(
                        sk,
                        items(sk).map((x) => (x.id === it.id ? { ...x, [f.key]: value } : x)),
                      );
                    }),
              )
              .join('');
            return `
              <div class="rb-item" data-sk="${sk}" data-id="${escAttr(String(it.id))}">
                <div class="rb-item-head">
                  <span>${SECTION_TITLES[sk]} #${i + 1}</span>
                  <span class="rb-item-actions">
                    <button type="button" class="rb-move" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                    <button type="button" class="rb-move" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                    <button type="button" class="rb-remove" data-act="remove" aria-label="Remove">✕</button>
                  </span>
                </div>
                ${fieldsHtml}
              </div>`;
          })
          .join('');
        return `
          <div class="rb-section" data-section="${sk}">
            <h3 class="rb-h">${SECTION_TITLES[sk]}</h3>
            ${itemsHtml}
            <button type="button" class="btn rb-add" data-add="${sk}">+ Add ${SECTION_TITLES[sk].toLowerCase()}</button>
          </div>`;
      })
      .join('');

    root.innerHTML = `
      <div class="rb-grid">
        <div class="rb-editor">
          <div class="rb-privacy">🔒 Private — saved only on this device. Nothing is uploaded.</div>
          ${toolbar}
          ${templatePicker}
          ${basicsHtml}
          ${sectionsHtml}
          <div class="rb-actions" style="display:flex;gap:10px;margin-top:8px">
            <button type="button" class="btn primary" id="rb-download">Download PDF</button>
            <button type="button" class="btn" id="rb-reset">Reset</button>
          </div>
        </div>
        <div class="rb-preview"><iframe title="Résumé preview" class="rb-frame"></iframe></div>
      </div>`;

    // Delegated handlers for everything that changes the SHAPE of the form (needs a full re-render).
    root.querySelector('#rb-download')?.addEventListener('click', download);
    root.querySelector('#rb-export')?.addEventListener('click', exportJson);
    root.querySelector('#rb-reset')?.addEventListener('click', reset);
    root.querySelector('#rb-import')?.addEventListener('click', () => root.querySelector<HTMLInputElement>('#rb-file')?.click());
    root.querySelector('#rb-file')?.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) importJson(file);
      input.value = '';
    });
    root.querySelectorAll<HTMLButtonElement>('[data-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        templateId = btn.dataset.tpl!;
        render();
        updatePreview();
        scheduleSave();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sk = btn.dataset.add as SectionKey;
        writeItems(sk, [...items(sk), blankItem(resume, sk)]);
        render();
        updatePreview();
        scheduleSave();
      });
    });
    root.querySelectorAll<HTMLElement>('.rb-item').forEach((el) => {
      const sk = el.dataset.sk as SectionKey;
      const id = el.dataset.id!;
      el.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
        writeItems(sk, items(sk).filter((it) => String(it.id) !== id));
        render();
        updatePreview();
        scheduleSave();
      });
      const move = (dir: -1 | 1) => {
        const arr = items(sk);
        const index = arr.findIndex((it) => String(it.id) === id);
        const to = index + dir;
        if (index < 0 || to < 0 || to >= arr.length) return;
        const next = [...arr];
        [next[index], next[to]] = [next[to], next[index]];
        writeItems(sk, next);
        render();
        updatePreview();
        scheduleSave();
      };
      el.querySelector('[data-act="up"]')?.addEventListener('click', () => move(-1));
      el.querySelector('[data-act="down"]')?.addEventListener('click', () => move(1));
    });

    updatePreview();
  }

  void getResumeDraft().then((draft) => {
    if (draft) {
      resume = draft.resume;
      templateId = draft.templateId;
    }
    render();
  });
}
