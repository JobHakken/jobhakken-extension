/**
 * Coverage intelligence, Layer 2 (#105 / #278 / privacy-coverage-intelligence.md): discover ATS we
 * DON'T support yet — WITHOUT watching anyone. A scoped extension can't (and shouldn't) passively read
 * unknown sites. Instead, only when the user INVOKES the toolbar on an unsupported page (`activeTab`,
 * one tab, that once, no host permission), we run a lightweight "is this a job form?" heuristic and
 * report a **candidate**: a coarse ATS guess plus a SALTED HASH of the site's registrable domain.
 *
 * Privacy: we never send the plaintext host, URL, company, or any page content. The salted hash lets
 * the backend k-anon-count identical hosts (surface only once ≥K distinct installs report it — #278)
 * without ever learning the host. The salt is injected at build time (release only), so dev/CI builds
 * produce no hash and report nothing. Governed by the same opt-out analytics toggle as all telemetry.
 */

// A few common multi-part public suffixes so "careers.bigco.co.uk" → "bigco.co.uk", not "co.uk". Not a
// full public-suffix list — we only need a stable, non-identifying hash bucket, and we always drop the
// subdomain (which could carry an identifying prefix).
const MULTI_SUFFIX = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'me.uk',
  'co.jp',
  'co.in',
  'co.nz',
  'co.za',
  'co.kr',
  'com.au',
  'net.au',
  'org.au',
  'com.br',
  'com.sg',
  'com.hk',
  'com.mx',
  'com.tr',
  'com.cn',
]);

/**
 * Best-effort registrable domain (eTLD+1) without a full PSL. `boards.greenhouse.io` → `greenhouse.io`
 * (captures the ATS), `myco.wd5.myworkdayjobs.com` → `myworkdayjobs.com` (the ATS, not the company),
 * `careers.bigco.co.uk` → `bigco.co.uk`. Subdomains are deliberately dropped.
 */
export function registrableDomain(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  return MULTI_SUFFIX.has(lastTwo) ? lastThree : lastTwo;
}

/**
 * Salted, truncated SHA-256 of the registrable domain, lowercase hex. Truncated to 16 hex chars —
 * enough to k-anon-count buckets, less trivially reversible than a full digest. Returns '' when there's
 * no salt (dev/CI build) or no hostname, so the caller reports nothing.
 */
export async function hostHash(hostname: string, salt: string): Promise<string> {
  if (!salt || !hostname) return '';
  const domain = registrableDomain(hostname);
  if (!domain) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${domain}`));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
