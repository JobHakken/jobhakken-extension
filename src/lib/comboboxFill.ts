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
import { bridgeReactClick } from './fillRepair.js';

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

/** Full mouse sequence — many popup libraries commit on mousedown, not click. */
function realClick(el: HTMLElement): void {
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
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
  try {
    el.focus();
    realClick(el);
    let nodes = await waitForOptions(el, Math.min(600, budgetMs));
    // Long lists (countries) are usually filtered by typing — narrow, then re-read the popup.
    if (nodes.length > 12 && el.tagName === 'INPUT') {
      typeInto(el, value.slice(0, 24));
      await wait(220);
      nodes = optionNodes(el).length ? optionNodes(el) : nodes;
    }
    if (!nodes.length) nodes = await waitForOptions(el, budgetMs);
    const pick = bestOption(nodes, value);
    if (!pick) {
      if (had !== String(input.value ?? '').trim()) typeInto(el, had); // undo any filter text we typed
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    pick.scrollIntoView?.({ block: 'nearest' });
    const settled = () => {
      const v = String(input.value ?? '').trim();
      // Some widgets clear their search input and render the choice as text instead, so also accept
      // "the popup closed and the control now reports a selection".
      const chosen = el.getAttribute('aria-expanded') === 'false' && (el.getAttribute('aria-activedescendant') || v);
      return v !== '' && v !== had ? v : chosen ? String(chosen) : '';
    };
    realClick(pick);
    await wait(160);
    // Synthetic clicks are UNTRUSTED — react-select & friends ignore them. Ask the page world to call
    // the option's own React handler instead (the technique the mature extensions use).
    if (!settled()) {
      await bridgeReactClick(pick);
      await wait(220);
    }
    const now = String(input.value ?? '').trim();
    const ok = settled() !== '' || (now !== '' && now !== had);
    if (!ok) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return ok;
  } catch {
    return false;
  }
}
