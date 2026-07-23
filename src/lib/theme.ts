/**
 * Manual light/dark theme for the popup + options page. Default is "system" (follow the
 * browser's prefers-color-scheme); the user can override to Light or Dark, persisted in
 * chrome.storage.local so both surfaces agree. Applied via a `data-theme` attribute on
 * <html> that the CSS overrides (explicit attribute wins over the media query).
 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'jh_theme';

export const THEME_ICON: Record<ThemePref, string> = { system: '🖥', light: '☀', dark: '🌙' };
const THEME_LABEL: Record<ThemePref, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

/** Reflect a preference onto <html> (system → no attribute, so the media query drives it). */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export async function loadThemePref(): Promise<ThemePref> {
  try {
    const { [KEY]: v } = await chrome.storage.local.get(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

export async function saveThemePref(pref: ThemePref): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: pref });
  } catch {
    /* storage unavailable — still apply for this session */
  }
  applyTheme(pref);
}

/** system → light → dark → system. */
export function nextThemePref(pref: ThemePref): ThemePref {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

/** Apply the stored theme immediately (call as early as possible to avoid a flash). */
export async function initTheme(): Promise<ThemePref> {
  const pref = await loadThemePref();
  applyTheme(pref);
  return pref;
}

/** Wire a button to cycle themes, keeping its icon + tooltip in sync. */
export async function initThemeToggle(btn: HTMLElement): Promise<void> {
  let pref = await loadThemePref();
  applyTheme(pref);
  const paint = () => {
    btn.textContent = THEME_ICON[pref];
    btn.title = `${THEME_LABEL[pref]} — click to change`;
    btn.setAttribute('aria-label', btn.title);
  };
  paint();
  btn.addEventListener('click', async () => {
    pref = nextThemePref(pref);
    await saveThemePref(pref);
    paint();
  });
}
