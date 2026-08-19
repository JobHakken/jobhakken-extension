/**
 * Drive custom (React-style) comboboxes — the fields plain value-assignment can never fill.
 *
 * Modern ATS render "dropdowns" as `<input type="text" role="combobox" aria-haspopup="listbox">` with
 * the choices in a popup that only exists once opened — often portalled to <body>, far from the input.
 * There is no `<option>` to select: the only way to set one is to behave like a person — open it, let
 * it render, find the matching row, click it. Assigning `.value` does nothing; React discards it on the
 * next render, which is exactly why our interactive pass reported 9 successes on a live Greenhouse form
 * while the page gained zero values (#136).
 *
 * Everything here is verified: we return true only when the control actually ends up holding a value.
 */
import { bridgeDomClick, bridgeReactClick } from './fillRepair.js';

/** Options a popup exposes. Portalled popups aren't inside the input's subtree, so search the document
 *  and prefer the listbox the input points at via aria-controls/aria-owns. */
function optionNodes(el: HTMLElement): HTMLElement[] {
  const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
  const scope = (id && document.getElementById(id)) || document;
  const nodes = [...scope.querySelectorAll<HTMLElement>('[role="option"], [role="listbox"] li, ul[role] li')];
  // Only offer things the user could actually click.
  return nodes.filter((n) => {
    const r = n.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w @+./-]/g, '')
    .trim();

/** Best option for `value`: exact → prefix → substring → token overlap. Null when nothing is close. */
function bestOption(nodes: HTMLElement[], value: string): HTMLElement | null {
  const want = norm(value);
  if (!want) return null;
  const scored = nodes.map((n) => {
    const text = norm(n.textContent ?? '');
    let score = 0;
    if (text === want) score = 100;
    else if (text.startsWith(want) || want.startsWith(text)) score = 80;
    else if (text.includes(want) || want.includes(text)) score = 60;
    else {
      const a = new Set(want.split(' ').filter(Boolean));
      const b = new Set(text.split(' ').filter(Boolean));
      const hit = [...a].filter((w) => b.has(w)).length;
      if (hit) score = 20 + (hit / Math.max(a.size, 1)) * 30;
    }
    return { n, score, text };
  });
  scored.sort((x, y) => y.score - x.score);
  const top = scored[0];
  // 55 keeps "United States" ↔ "United States of America" but rejects an unrelated first row — picking
  // the wrong option in someone's job application is worse than leaving it blank.
  return top && top.score >= 55 ? top.n : null;
}

/** Type into a controlled input so the popup's filter reacts (native setter + the events React wants). */
function typeInto(el: HTMLElement, text: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : (HTMLInputElement.prototype as object);
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Click the way the browser does.
 *
 * `HTMLElement.click()` runs the real activation path, and React's synthetic system handles it —
 * whereas a hand-built `dispatchEvent(new MouseEvent('click'))` is ignored by react-select and friends.
 * Verified on a live Greenhouse form: dispatchEvent → nothing; `.click()` → the option commits.
 * The dispatch sequence stays as a fallback for widgets that commit on mousedown instead.
 */
function realClick(el: HTMLElement): void {
  try {
    el.click();
  } catch {
    /* fall through to the synthetic sequence */
  }
}
function syntheticClick(el: HTMLElement): void {
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, detail: 1 }));
  }
}

/**
 * What the widget currently DISPLAYS as its selection. react-select clears the search input on select
 * and renders the chosen label as text in the control, so `input.value` is a false negative — checking
 * it is what made us report failure (and then press Escape, undoing a pick that had worked).
 */
function shownSelection(el: HTMLElement): string {
  const control =
    el.closest('[class*="control"], [class*="Control"], [class*="select"], [class*="Select"]') ??
    el.parentElement?.parentElement?.parentElement ??
    null;
  const text = (control?.textContent ?? '').replace(/select\s*\.{2,}/i, '').trim();
  return text.replace(/\s+/g, ' ').slice(0, 120);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the popup lists something (or we give up) — popups render asynchronously. */
async function waitForOptions(el: HTMLElement, budgetMs: number): Promise<HTMLElement[]> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const nodes = optionNodes(el);
    if (nodes.length) return nodes;
    if (Date.now() > deadline) return [];
    await wait(80);
  }
}

/** Does this control need the click-and-pick treatment (vs a plain value assignment)? */
export function isCombobox(el: Element): boolean {
  const role = el.getAttribute('role');
  return (
    role === 'combobox' ||
    el.getAttribute('aria-haspopup') === 'listbox' ||
    (el.getAttribute('aria-expanded') !== null && el.tagName === 'INPUT')
  );
}

/**
 * Open the combobox, pick the option matching `value`, and confirm it took.
 * Leaves the popup closed either way, so a failure never strands the page's UI open.
 */
export async function fillCombobox(el: HTMLElement, value: string, budgetMs = 1500): Promise<boolean> {
  const input = el as HTMLInputElement;
  const had = String(input.value ?? '').trim();
  const shownBefore = shownSelection(el);
  try {
    el.focus();
    syntheticClick(el); // react-select opens its menu on MOUSEDOWN — `.click()` alone won't open it
    let nodes = await waitForOptions(el, Math.min(600, budgetMs));
    // Let the menu finish mounting. Clicking the instant the first option appears hits a node React is
    // still replacing, and the selection silently doesn't commit (verified on a live Greenhouse form).
    await wait(320);
    nodes = optionNodes(el).length ? optionNodes(el) : nodes;
    // Long lists (countries) are usually filtered by typing — narrow, then re-read the popup.
    if (nodes.length > 12 && el.tagName === 'INPUT') {
      typeInto(el, value.slice(0, 24));
      await wait(220);
      nodes = optionNodes(el).length ? optionNodes(el) : nodes;
    }
    if (!nodes.length) nodes = await waitForOptions(el, budgetMs);
    const dbg = (() => {
      try {
        return localStorage.getItem('JH_DEBUG') === '1';
      } catch {
        return false;
      }
    })();
    const pick = bestOption(nodes, value);
    if (dbg)
      console.log(
        '[jh-combo]',
        value.slice(0, 14),
        '| opts:',
        nodes.length,
        '| pick:',
        (pick?.textContent || 'NONE').trim().slice(0, 20),
        '| tag:',
        pick?.tagName,
        '| shownBefore:',
        JSON.stringify(shownBefore.slice(0, 20)),
      );
    if (!pick) {
      if (had !== String(input.value ?? '').trim()) typeInto(el, had); // undo any filter text we typed
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    pick.scrollIntoView?.({ block: 'nearest' });
    // Did the selection take? Either the control now displays something new, or the input holds a value.
    const committed = () => {
      const v = String(input.value ?? '').trim();
      if (v && v !== had) return true;
      const now = shownSelection(el);
      return !!now && now !== shownBefore;
    };
    await bridgeDomClick(pick); // page-world `.click()` — the one that actually commits
    await wait(260);
    if (!committed()) {
      realClick(pick); // isolated-world .click() (works on simpler widgets)
      await wait(200);
    }
    if (!committed()) {
      syntheticClick(pick); // widgets that commit on mousedown
      await wait(200);
    }
    if (!committed()) {
      await bridgeReactClick(pick); // last resort: call the option's own React handler (page world)
      await wait(220);
    }
    const ok = committed();
    if (dbg)
      console.log(
        '[jh-combo]   after click → shown:',
        JSON.stringify(shownSelection(el).slice(0, 26)),
        '| value:',
        JSON.stringify(String(input.value || '').slice(0, 20)),
        ok ? 'OK' : 'FAIL',
      );
    // Only tidy up when we genuinely failed — pressing Escape after a SUCCESSFUL pick used to undo it.
    if (!ok) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return ok;
  } catch {
    return false;
  }
}
