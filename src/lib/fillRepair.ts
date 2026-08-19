/**
 * Verify-and-repair pass for autofill writes (#136 follow-up).
 *
 * The fill engine assigns `el.value` from the isolated world. On framework-controlled inputs (React &
 * co.) that assignment is silently discarded on the next render — measured live: 14 fields "filled",
 * only 5 held a value. So after every fill we CHECK what actually landed and re-write the failures
 * through the MAIN-world bridge (pageBridge.ts), which can reach React's own value tracker.
 *
 * This also makes our reported fill count honest: we count what the DOM confirms, not what we tried.
 */
import { fillCombobox, isCombobox } from './comboboxFill.js';

// Flip on from the console for a live-page debugging session: localStorage.JH_DEBUG = '1'
const DEBUG = (() => {
  try {
    return localStorage.getItem('JH_DEBUG') === '1';
  } catch {
    return false;
  }
})();

const REQ = 'jh-bridge-set';
const RES = 'jh-bridge-done';

/** Write a value the ordinary way (native setter + the events frameworks listen for) and report
 *  whether it actually stuck. */
function localSet(el: Element, value: string): boolean {
  try {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    return false;
  }
  return valueOf(el) === value.trim();
}

/** Current value of a fillable control, normalized for comparison. */
function valueOf(el: Element): string {
  return String((el as HTMLInputElement).value ?? '').trim();
}

/** Ask the page-world bridge to write `value` into `el`. Resolves false if the bridge never answers. */
function bridgeCall(
  el: Element,
  value: string,
  action: 'set' | 'click' | 'domclick' | 'combo',
  timeoutMs = 400,
): Promise<boolean> {
  return new Promise((resolve) => {
    const token = `jh${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener(RES, onDone as EventListener);
      clearTimeout(timer);
      el.removeAttribute('data-jh-fill');
      resolve(ok);
    };
    const onDone = (ev: Event) => {
      const d = (ev as CustomEvent<{ token: string; ok: boolean }>).detail;
      if (d?.token === token) done(!!d.ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    document.addEventListener(RES, onDone as EventListener);
    el.setAttribute('data-jh-fill', token);
    document.dispatchEvent(new CustomEvent(REQ, { detail: { token, value, action } }));
  });
}

export type Attempt = {
  el: Element;
  value: string;
  /** How the engine decided this value — 'user' means the user's OWN rule, i.e. explicit intent. */
  source?: string;
};

/**
 * For each field the engine believed it filled, confirm the value is really there; if not, repair it:
 *
 *  - **custom combobox** (`role=combobox` / `aria-haspopup=listbox`) → open it and pick the matching
 *    option like a person would. These can't be filled by assignment at all, and they're the bulk of
 *    what we were silently failing (Country, Gender, sponsorship, veteran status…).
 *  - **anything else** → re-write through the MAIN-world bridge, which can reach React's value tracker.
 *
 * Returns how many fields hold a real value afterwards — the honest count.
 */
export async function repairFills(
  attempts: Attempt[],
  budgetMs = 6000,
): Promise<{ confirmed: number; repaired: number; comboboxes: number }> {
  let confirmed = 0;
  let repaired = 0;
  let comboboxes = 0;
  const deadline = Date.now() + budgetMs; // comboboxes are slow; never let repair run away with the UI
  for (const { el, value } of attempts) {
    if (!value || !el.isConnected) continue;
    if (valueOf(el) === value.trim()) {
      confirmed++;
      continue; // it stuck — nothing to do (idempotent: never re-write a good field)
    }
    if (Date.now() > deadline) continue;
    let ok = false;
    const combo = el instanceof HTMLElement && isCombobox(el);
    if (combo) {
      // Handled entirely in the page world: the component's own setValue() via React's fiber, with a
      // click-the-menu fallback (pageBridge.driveCombobox). 4s covers the fallback's open+settle.
      ok = await bridgeCall(el, value, 'combo', 4000);
      if (ok) comboboxes++;
      continue;
    } else {
      // Local write first: it works for ordinary inputs, costs nothing, and doesn't depend on the
      // page-world bridge being injectable (it isn't on every page). Only if the value fails to stick
      // — framework-controlled inputs — do we pay for the cross-world round trip.
      ok = localSet(el, value);
      if (!ok) ok = await bridgeCall(el, value, 'set');
    }
    if (DEBUG)
      console.log('[jh-repair]', combo ? 'COMBO' : 'set  ', String(value).slice(0, 18), '→', ok ? 'OK' : 'fail');
    if (ok || valueOf(el) === value.trim()) {
      confirmed++;
      repaired++;
    }
  }
  return { confirmed, repaired, comboboxes };
}

/**
 * Click an element through React's own handlers (page world). Needed for component libraries that
 * ignore untrusted `dispatchEvent` clicks — e.g. react-select dropdown options.
 */
export function bridgeReactClick(el: Element): Promise<boolean> {
  return bridgeCall(el, '', 'click');
}

/** Click an element with a plain `.click()` executed in the PAGE's world (see pageBridge). */
export function bridgeDomClick(el: Element): Promise<boolean> {
  return bridgeCall(el, '', 'domclick');
}
