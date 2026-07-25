/**
 * @jest-environment node
 *
 * GA Measurement Protocol sink — asserts the POST shape and that content never reaches GA.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { makeGaSink } from './gaSink';
import type { TelemetryPayload } from './telemetry';

const payload: TelemetryPayload = {
  event: 'autofill_run',
  params: { ok: true, fields_filled: '6-15' },
  client_id: 'cid-123',
  ext_version: '9.9.9',
  ts: 1,
};

describe('makeGaSink', () => {
  it('POSTs to the MP endpoint with measurement_id + api_secret and the right body', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response);
    const sink = makeGaSink('G-TEST', 'secret-xyz', fetchMock as unknown as typeof fetch);
    await sink(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://www.google-analytics.com/mp/collect');
    expect(url).toContain('measurement_id=G-TEST');
    expect(url).toContain('api_secret=secret-xyz');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    expect(body.client_id).toBe('cid-123');
    expect(body.events[0].name).toBe('autofill_run');
    expect(body.events[0].params).toMatchObject({ ok: true, fields_filled: '6-15', ext_version: '9.9.9' });
  });

  it('only forwards the already-sanitized params (no content field can appear)', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response);
    const sink = makeGaSink('G-TEST', 's', fetchMock as unknown as typeof fetch);
    await sink(payload);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    // payload.params never contained resume/email/url, so neither can the GA body.
    expect(JSON.stringify(body)).not.toMatch(/resume|email|@|http/i);
  });
});
