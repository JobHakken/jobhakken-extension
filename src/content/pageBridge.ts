/**
 * Page-world value bridge (#136 follow-up: writes that actually stick).
 *
 * PROBLEM: React/Vue/Angular render *controlled* inputs — the framework owns the value and re-renders
 * from its own state. When the content script (isolated world) assigns `el.value = x`, the framework
 * never learns about it and the next render restores the old value. Measured on a live Greenhouse form:
 * the engine matched and "filled" 14 of 17 fields, but only **5 ever held a value** — every select,
 * radio and EEO dropdown silently reverted. The engine reported success; the page disagreed.
 *
 * WHY A SEPARATE WORLD: the fix needs React's own bookkeeping — `_valueTracker` (how React decides a
 * value changed) and the fiber's real `onChange` handler. Those are expando properties created by the
 * page's JS, and expandos are **per-world**: a content script literally cannot see them. So this file
 * runs in the MAIN world (`"world": "MAIN"` content script) and the isolated content script asks it to
 * write, over a CustomEvent — the same split JobFill and Simplify use.
 *
 * SECURITY: this runs in the page's own world, so treat everything here as untrusted-adjacent. It only
 * ever writes values the extension sends, only into elements the extension tagged with
 * `data-jh-fill`, and it exposes no globals the page could call. The tag is removed immediately.
 */
const REQ = 'jh-bridge-set';
const RES = 'jh-bridge-done';

type Req = { token: string; value: string; action?: 'set' | 'click' | 'domclick' | 'combo' };

/** React attaches its props to the DOM node under a `__reactProps$<hash>` key (per-world expando). */
function reactProps(el: Element): Record<string, unknown> | null {
  for (const k of Object.keys(el)) {
    if (k.startsWith('__reactProps$')) return (el as unknown as Record<string, Record<string, unknown>>)[k];
  }
  return null;
}

/**
 * Invoke a React element's own click handlers directly.
 *
 * `dispatchEvent` produces an **untrusted** event, and component libraries (react-select and friends)
 * ignore those — which is why a synthetic click on a dropdown option silently does nothing. Calling the
 * component's `onMouseDown`/`onClick` from the page world is how the selection actually commits. Only
 * reachable from here, because React's expando is invisible to the isolated world.
 */
function reactClick(el: Element): boolean {
  const props = reactProps(el);
  if (!props) return false;
  const evt = {
    type: 'click',
    button: 0,
    target: el,
    currentTarget: el,
    bubbles: true,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
    persist() {},
    nativeEvent: { type: 'click', button: 0 },
  };
  let called = false;
  for (const handler of ['onMouseDown', 'onClick', 'onMouseUp']) {
    const fn = props[handler];
    if (typeof fn === 'function') {
      try {
        (fn as (e: unknown) => void)(evt);
        called = true;
      } catch {
        /* a handler that throws on our synthetic event — try the next one */
      }
    }
  }
  return called;
}

/** Native value setter for the element's own class — bypasses the framework's overridden property. */
function nativeSetter(el: Element): ((v: string) => void) | null {
  const proto =
    el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : null;
  if (!proto) return null;
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  return set ? (v: string) => set.call(el, v) : null;
}

/**
 * Write `value` the way the page itself would: native setter, then invalidate React's value tracker so
 * it sees a real change, then fire the events frameworks listen for. Returns whether the value stuck.
 */
function setValue(el: Element, value: string): boolean {
  const set = nativeSetter(el);
  if (!set) return false;
  // React tracks the last value it wrote; if it still matches, React treats our change as a no-op and
  // discards it. Resetting the tracker makes the next input event look like a genuine user edit.
  const tracked = (el as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  try {
    tracked?.setValue('\u0000never');
  } catch {
    /* not a React input — fine */
  }
  set(value);
  for (const type of ['input', 'change']) {
    el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  }
  // Some libraries only commit on blur.
  el.dispatchEvent(new Event('blur', { bubbles: false }));
  return (el as HTMLInputElement).value === value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Set a React-component dropdown (react-select and friends) by calling the component's OWN API,
 * instead of trying to click a menu row.
 *
 * Clicking is what everything else here fights: the menu has to be opened, rendered, filtered and
 * hit before React re-renders it, and a synthesized click is ignored anyway. But the component
 * instance is reachable from the DOM node through React's fiber, it already holds the full option
 * list in `props.options`, and it exposes `setValue`. Calling that is what the widget does internally
 * when a user picks a row — so the selection simply commits.
 *
 * (Technique learned from studying how mature autofill extensions solve this; implemented here from
 * the approach, not their code.)
 */
function reactSelectSet(el: Element, value: string): boolean {
  type Fiber = { stateNode?: unknown; return?: Fiber };
  type SelectInst = { setValue: (opt: unknown, action: string) => void; props: { options?: unknown } };
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!key) return false;
  // Walk UP the tree: the DOM input belongs to a child of the Select component.
  let node = (el as unknown as Record<string, Fiber>)[key];
  let inst: SelectInst | null = null;
  for (let i = 0; node && i < 30; i++) {
    const sn = node.stateNode as { select?: unknown } | undefined;
    if (sn && typeof sn === 'object') {
      const cand = (typeof sn.select === 'object' && sn.select !== null ? sn.select : sn) as Partial<SelectInst>;
      if (typeof cand.setValue === 'function' && cand.props && typeof cand.props === 'object') {
        inst = cand as SelectInst;
        break;
      }
    }
    node = node.return as Fiber;
  }
  if (!inst) return false;

  // Options may be grouped ({ label, options: [...] }) — flatten one level.
  const raw = inst.props.options;
  const options: unknown[] = Array.isArray(raw)
    ? raw.flatMap((o) =>
        o && typeof o === 'object' && Array.isArray((o as { options?: unknown[] }).options)
          ? (o as { options: unknown[] }).options
          : [o],
      )
    : [];
  if (!options.length) return false;

  // An option matches on either its visible label or its submitted value.
  const textsOf = (o: unknown): string[] =>
    o && typeof o === 'object'
      ? [(o as { label?: unknown }).label, (o as { value?: unknown }).value]
          .filter((v) => ['string', 'number', 'boolean'].includes(typeof v))
          .map((v) => String(v))
      : [String(o)];
  const want = String(value);
  const lower = want.toLowerCase();
  // EEO dropdowns phrase "no answer" a dozen different ways. A user who chose "Prefer not to say"
  // means the same thing as this form's "Decline To Self Identify" — without this, the field is left
  // blank and the applicant looks like they skipped a required question.
  const DECLINE = /(prefer not|decline|do not wish|don't wish|choose not|not disclose|no answer|rather not)/i;
  const wantsDecline = DECLINE.test(want);
  /**
   * Only accept a tier when exactly ONE option matches. Ambiguity here is dangerous: a profile that
   * says "Yes" to visa sponsorship prefix-matches "Yes, Netherlands Highly Skilled Migrant Visa",
   * "Yes, EU Blue Card", "Yes, F-1 OPT (USA)"… and picking the first would put a specific visa the
   * applicant never claimed onto their application. When several options fit, the honest answer is to
   * leave it for the user. A single fit (e.g. "United States" → "United States of America") is safe.
   */
  const uniqueIdx = (pred: (t: string) => boolean): number => {
    const hits = options.map((o, i) => (textsOf(o).some(pred) ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : -1;
  };
  let idx = uniqueIdx((t) => t === want);
  if (idx === -1) idx = uniqueIdx((t) => t.toLowerCase() === lower);
  // Bidirectional on purpose: a user who stored the precise answer ("Yes, F-1 Visa OPT (USA)") should
  // still match a plain "Yes" on the next form that only offers Yes/No. Their data decides; we only
  // refuse when THEIR value can't single out an option.
  if (idx === -1 && want)
    idx = uniqueIdx((t) => t.toLowerCase().startsWith(lower) || lower.startsWith(t.toLowerCase()));
  if (idx === -1 && want) idx = uniqueIdx((t) => t.toLowerCase().includes(lower));
  // Same intent, different words — only ever maps a decline TO a decline, never to a real answer.
  // Declines are interchangeable: "Decline To Self Identify", "I don't wish to answer" and "Prefer not
  // to say" all mean the same thing, so several matches is NOT ambiguity — take the first. (Contrast
  // the visa list, where each "Yes, …" is a different claim and picking one would be a fabrication.)
  if (idx === -1 && wantsDecline) idx = options.findIndex((o) => textsOf(o).some((t) => DECLINE.test(t)));
  if (idx === -1) return false; // no confident match — leave it blank rather than guess

  inst.setValue(options[idx], 'select-option');
  return true;
}

/** What the widget currently displays as its choice (react-select renders it as text, not input.value). */
function shown(el: Element): string {
  // A className-based closest() lookup is fragile here: Greenhouse's BEM naming puts "select" in
  // EVERY ancestor's class along the way up (select__input -> select__input-container ->
  // select__value-container -> select__control), so widening the search past `el` itself still
  // self-matched on an empty wrapper div one level too early — verified live: the selection rendered
  // correctly ("Reykjavik, Capital Region, Iceland") two levels further up than the nearest
  // class*="select" match. Walk up looking for actual rendered TEXT instead of guessing a class name —
  // robust to whatever a given vendor happens to name its wrapper divs.
  let node: Element | null = el.parentElement;
  for (let i = 0; node && i < 8; i++) {
    const txt = (node.textContent ?? '').replace(/select\s*\.{2,}/i, '').trim();
    if (txt) return txt;
    node = node.parentElement;
  }
  return '';
}

/**
 * Drive a custom combobox end-to-end IN THE PAGE'S WORLD: open it, wait for the menu, pick the option
 * matching `value`, click it, and report whether the choice stuck.
 *
 * The whole sequence has to happen here. Verified on a live Greenhouse form: run from the page world it
 * commits every time; driven from the extension's isolated world — even when only the final click was
 * delegated here — react-select never registers the selection. So we hand over the entire interaction
 * rather than ping-ponging between worlds.
 */
async function driveCombobox(el: HTMLElement, value: string): Promise<boolean> {
  // Preferred path: ask the component to set itself. No menu, no click, no timing.
  try {
    if (reactSelectSet(el, value)) {
      await sleep(120);
      return true;
    }
  } catch {
    /* not a React select, or its internals moved — fall back to driving the UI */
  }
  const before = shown(el);
  const want = value.toLowerCase().replace(/\s+/g, ' ').trim();
  el.focus();
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
  }
  await sleep(500);
  let opts = [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(
    (o) => o.getBoundingClientRect().height > 0,
  );
  // Long lists filter as you type (countries) — narrow, then re-read. A field that opens with NOTHING
  // visible (School, Location (City), Ashby's location field — verified live against real corpus data:
  // zero options until typed) is a different case, not just an empty long list: there's no list to
  // narrow, so type the FULL value rather than a slice, and give it longer — these are typically a
  // remote/debounced search (same as Workday's multiselect prompt in widgets.ts), not a client-side
  // filter over an already-loaded array. Without this the field silently stays blank: `reactSelectSet`
  // above already failed for the same reason (an async combobox's `props.options` is empty until a
  // query has actually run), so this fallback was the only remaining path and it never triggered.
  if ((opts.length > 12 || opts.length === 0) && el instanceof HTMLInputElement) {
    const searchOnly = opts.length === 0;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(el, searchOnly ? value : value.slice(0, 24));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(searchOnly ? 700 : 350);
    const readVisible = () =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(
        (o) => o.getBoundingClientRect().height > 0,
      );
    let filtered = readVisible();
    // Poll a bit longer only for the genuinely-empty case — a remote search can still be in flight
    // after the first wait. Bounded so this can never run away with the fill budget (repairFills gives
    // a combobox 4s total; open-wait + this stays comfortably under that).
    for (let i = 0; searchOnly && !filtered.length && i < 5; i++) {
      await sleep(350);
      filtered = readVisible();
    }
    if (filtered.length) opts = filtered;
  }
  const score = (text: string): number => {
    const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (t === want) return 100;
    if (t.startsWith(want) || want.startsWith(t)) return 80;
    if (t.includes(want) || want.includes(t)) return 60;
    return 0;
  };
  // Same rule as the fiber path: take the best tier, but only if ONE option sits in it. "Yes" against
  // a list of "Yes, <specific visa>" options is genuinely ambiguous, and picking one would assert
  // something the applicant never said.
  let bestScore = 0;
  for (const o of opts) bestScore = Math.max(bestScore, score(o.textContent ?? ''));
  const tied = opts.filter((o) => score(o.textContent ?? '') === bestScore);
  const DECLINE_OPT = /(prefer not|decline|do not wish|don't wish|choose not|no answer|rather not)/i;
  const allDecline = tied.length > 1 && tied.every((o) => DECLINE_OPT.test(o.textContent ?? ''));
  const best = tied.length === 1 || allDecline ? tied[0] : null;
  if (!best || bestScore < 60) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }
  // Neither a bare `.click()` NOR invoking the option's own React handlers (reactClick) commits a
  // selection on every combobox variant. Verified live (Samsung Semiconductor Greenhouse posting,
  // Discipline field): both left `.select__single-value` never rendered — the component never actually
  // entered a "selected" state — while the search <input>'s OWN value happened to still hold the typed
  // query text, which made the OLD success check below (falling back to `!!el.value`) falsely report
  // success. Pressing Escape afterwards (a completely ordinary interaction — closing the panel, the
  // next field's own fill sequence, anything) then wiped that leftover search text, and the field
  // silently reverted to empty with no error anywhere. What DOES reliably commit, verified live on the
  // same field: keyboard navigation — ArrowDown to the target row, Enter to confirm — the same
  // technique a real person uses, and the one every list widget wires up for accessibility regardless
  // of how its click handling is implemented internally. Try the cheaper paths first; keyboard is the
  // fallback that's actually reliable when they aren't.
  //
  // These are tried in order and each one is VERIFIED before escalating, because no single technique
  // works everywhere and picking just one trades one widget family for another. An earlier version
  // escalated straight from reactClick to keyboard, skipping the plain click — that fixed Greenhouse
  // but broke every ordinary listbox whose options commit on a real `click` and ignore key events
  // (caught by e2e/sandbox.html's lazy dropdown, whose option handlers are plain click listeners).
  //
  // A single fixed wait-then-check also reported real successes as failures: on a live Greenhouse
  // Location (City) field the pick committed, but one 300ms sleep read the DOM before React had
  // re-rendered the selected text, so the field was left blank AND recorded as unfillable. So each
  // attempt polls for a beat rather than trusting one snapshot.
  const settled = async (tries: number): Promise<string> => {
    for (let i = 0; i < tries; i++) {
      await sleep(150);
      const seen = shown(el);
      if (seen && seen !== before) return seen;
    }
    return '';
  };

  let after = '';
  // 1. The option's own React handlers — for components that ignore untrusted synthetic clicks.
  if (reactClick(best)) after = await settled(3);
  // 2. A plain DOM click — what an ordinary (non-React) listbox actually listens for.
  if (!after) {
    best.click();
    after = await settled(3);
  }
  // 3. Keyboard: ArrowDown to the row, Enter to confirm — the way a person using a keyboard does it,
  //    wired up by any accessible widget regardless of how its click handling works internally. This
  //    is the one that commits on Samsung Semiconductor's Greenhouse Discipline field, where neither
  //    a bare click nor the React handlers ever put the component into a selected state.
  if (!after) {
    const idx = opts.indexOf(best);
    if (idx >= 0 && idx < 20) {
      for (let i = 0; i <= idx; i++) {
        el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }),
        );
        await sleep(20);
      }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      after = await settled(5);
    }
  }
  // `el.value` is deliberately NOT part of this check: for a combobox search input, a non-empty value
  // means "text is currently typed in the search box," not "a selection was committed" — a genuine
  // commit clears the search text and renders the choice in a separate display element instead. Using
  // `el.value` as a success signal is backwards here: it's true in exactly the failure case above.
  const ok = !!after && after !== before;
  if (!ok) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return ok;
}

document.addEventListener(REQ, (ev) => {
  const detail = (ev as CustomEvent<Req>).detail;
  if (!detail || typeof detail.token !== 'string') return;
  const el = document.querySelector(`[data-jh-fill="${CSS.escape(detail.token)}"]`);
  let ok = false;
  if (el) {
    try {
      if (detail.action === 'combo') {
        void driveCombobox(el as HTMLElement, String(detail.value ?? '')).then((r) => {
          el.removeAttribute('data-jh-fill');
          document.dispatchEvent(new CustomEvent(RES, { detail: { token: detail.token, ok: r } }));
        });
        return; // answered asynchronously above
      } else if (detail.action === 'domclick') {
        // A plain `.click()` — but run from the PAGE's world. Verified on a live Greenhouse form:
        // the same call from the extension's isolated world does not commit a react-select option,
        // while from here it does. This is the primary way we commit a dropdown choice.
        (el as HTMLElement).click();
        ok = true;
      } else if (detail.action === 'click') {
        ok = reactClick(el);
      } else {
        ok = setValue(el, String(detail.value ?? ''));
      }
    } catch {
      ok = false;
    }
    el.removeAttribute('data-jh-fill');
  }
  document.dispatchEvent(new CustomEvent(RES, { detail: { token: detail.token, ok } }));
});
