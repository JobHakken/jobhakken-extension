import { createServer } from 'http';

/**
 * Mock of the desktop app's loopback bridge, for closed-loop E2E of the CONNECTED
 * extension without launching the real Electron app. Mimics extensionBridge.ts:
 *   GET /health → { name: 'jobhakken' }
 *   POST /rpc   → { result }
 * The connection token selects the scenario so one server covers both:
 *   token "TESTMODE" → status.testMode = true  (app in its sandbox)
 *   anything else    → status.testMode = false (normal, real data)
 */
// Deliberately OUTSIDE the desktop bridge's candidate range (41573-41577, see
// bridgeClient.CANDIDATE_PORTS). If the mock shared a port with the real app, a running
// JobHakken instance would squat it and — because playwright reuses an existing server —
// the extension would talk to the REAL app, which rejects the mock token as "unauthorized"
// and the test would silently fill real data. A dedicated port keeps e2e correct even with
// the desktop app open. The e2e sets f2a_connection.port directly, so discovery isn't involved.
const PORT = 41599;

function handle(method, token) {
  switch (method) {
    case 'status':
      return { testMode: token === 'TESTMODE', hasResume: true };
    case 'profile':
      // deliberately REAL-looking data — the sync test proves test mode overrides this
      return {
        hasResume: true,
        basics: { name: 'Real Person', email: 'real.person@corp.example', phone: '(999) 888-7777', links: [] },
        experience: [{ company: 'Realco', title: 'Engineer', period: '2020 - Present' }],
        education: [{ school: 'Real University', degree: 'B.S.', field: 'CS', period: '2016 - 2020' }],
      };
    case 'resumeFile':
    case 'tailoredResumeFile':
      return { fileName: 'real-person-resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4 real résumé\n%%EOF').toString('base64') };
    case 'keywords':
      return { atsMatchPercent: 77, keywords: [{ keyword: 'C++', status: 'present' }, { keyword: 'RTOS', status: 'missing' }] };
    case 'visa':
      return { h1b: { employer: 'Realco' }, uk: null };
    case 'answer':
      return { text: 'Mock drafted answer.' };
    default:
      return {};
  }
}

createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.end(JSON.stringify({ ok: true, name: 'jobhakken', mock: true, llmConfigured: true, hasResume: true }));
    return;
  }
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    for await (const c of req) body += c;
    let method = '';
    try {
      method = JSON.parse(body || '{}').method;
    } catch {
      /* ignore */
    }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    res.end(JSON.stringify({ result: handle(String(method), token) }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
}).listen(PORT, '127.0.0.1', () => console.log(`mock bridge on 127.0.0.1:${PORT}`));
