// Permission-diff guard: fails if the extension's permission surface changed vs the committed
// baseline. Permission creep is the top cause of Chrome Web Store rejection and extension
// security incidents, so any change must be a deliberate, reviewed act (CODEOWNERS gates
// manifest.json). Update the baseline intentionally with: npm run check:permissions -- --update
import { readFileSync, writeFileSync } from 'fs';

const MANIFEST = 'src/manifest.json';
const BASELINE = '.github/permissions-baseline.json';

// The full exposure surface — not just permissions. web_accessible_resources, optional_*,
// externally_connectable, and content-script all_frames are all real fingerprinting / attack
// surfaces (finding #23), so a change to any of them must be a reviewed, re-baselined act.
const surface = (m) => ({
  permissions: [...(m.permissions ?? [])].sort(),
  optional_permissions: [...(m.optional_permissions ?? [])].sort(),
  host_permissions: [...(m.host_permissions ?? [])].sort(),
  optional_host_permissions: [...(m.optional_host_permissions ?? [])].sort(),
  content_scripts_matches: [...new Set((m.content_scripts ?? []).flatMap((c) => c.matches ?? []))].sort(),
  content_scripts_all_frames: (m.content_scripts ?? []).some((c) => c.all_frames === true),
  web_accessible_resources: JSON.stringify(m.web_accessible_resources ?? []),
  externally_connectable: JSON.stringify(m.externally_connectable ?? null),
});

const current = surface(JSON.parse(readFileSync(MANIFEST, 'utf8')));

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`✓ permissions baseline updated → ${BASELINE}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`✗ no baseline at ${BASELINE}. Create it: npm run check:permissions -- --update`);
  process.exit(1);
}

if (JSON.stringify(current) !== JSON.stringify(baseline)) {
  console.error('✗ Extension permission surface CHANGED vs the baseline.\n');
  console.error('baseline:', JSON.stringify(baseline, null, 2));
  console.error('current: ', JSON.stringify(current, null, 2));
  console.error('\nPermission creep is a security + store-review risk. If this change is intentional and');
  console.error('reviewed, update the baseline: npm run check:permissions -- --update  (manifest.json is');
  console.error('CODEOWNERS-gated, so a maintainer must approve).');
  process.exit(1);
}
console.log('✓ permission surface matches the baseline');
