// Isolated transactional Resend receipt worker test. No network or real email.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('supabase/functions/pos-receipt-email/index.ts', 'utf8');
const SECRET = 'unit-only-private-staging-key-not-real-00000001';
function sandbox(extra = {}, mockFetch = async () => { throw new Error('Unexpected outbound fetch'); }) {
  const env = { POS_RECEIPT_WORKER_SECRET: SECRET, ...extra };
  let handler;
  const fakeDeno = {
    env: { get: name => env[name] ?? undefined },
    serve: callback => { handler = callback; }
  };
  vm.runInNewContext(source, { Deno: fakeDeno, fetch: mockFetch, Response, URL, Intl, Date, AbortSignal }, { timeout: 1000, filename: 'pos-receipt-email/index.ts' });
  assert.equal(typeof handler, 'function');
  return handler;
}
function request(method = 'POST', auth = SECRET) {
  return new Request('https://pos-staging.example.test/receipt-worker', {
    method,
    headers: { 'x-pos-receipt-worker-secret': auth }
  });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const config = {
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key-for-local-mock-only',
  RESEND_TRANSACTIONAL_API_KEY: 'fake-resend-key-for-local-mock-only',
  RESEND_RECEIPTS_FROM: 'Persen Apparel <receipts@example.test>'
};
function mockProvider(receiptEmail = true) {
  const events = [];
  const fetchMock = async (target, opts = {}) => {
    const address = String(target);
    events.push({ url: address, method: opts.method || 'GET', body: opts.body });
    if (address === 'https://api.resend.com/emails') {
      return json({ id: 'simulated-resend-id' });
    }
    if (address.includes('/rest/v1/site_content?')) return json([]);
    if (address.includes('/rest/v1/pos_receipt_delivery_jobs?')) {
      if (opts.method === 'PATCH') return json([{ id: 'job-1' }]);
      return json([{ id: 'job-1', sale_id: 'sale-1', owner_id: 'owner-1', channel: 'email', status: 'awaiting_sender', attempts: 0 }]);
    }
    if (address.includes('/rest/v1/pos_sales?')) return json([{
      id: 'sale-1', owner_id: 'owner-1', subtotal_cents: 2500,
      discount_cents: 0, tax_cents: 0, total_cents: 2500,
      snapshot: { receipt_email: receiptEmail, email: 'synthetic@example.test',
        items: [{ name: '<unsafe> Sample Hoodie', qty: 1, unit_cents: 2500 }] }
    }]);
    throw new Error('Unexpected mock route ' + address);
  };
  return { events, fetchMock };
}
(async () => {
  {
    const h = sandbox();
    assert.equal((await h(request('GET'))).status, 405);
    assert.equal((await h(request('POST', 'wrong'))).status, 403);
    assert.equal((await h(request())).status, 503);
  }
  {
    const p = mockProvider(true);
    const h = sandbox(config, p.fetchMock);
    const result = await h(request());
    assert.equal(result.status, 200);
    const outcome = await result.json();
    assert.equal(outcome.attempted, 1);
    assert.equal(outcome.sent, 1);
    assert.equal(outcome.failed, 0);
    const sent = p.events.filter(x => x.url === 'https://api.resend.com/emails');
    assert.equal(sent.length, 1);
    const payload = JSON.parse(sent[0].body);
    assert.deepEqual(payload.to, ['synthetic@example.test']);
    assert.match(payload.subject, /Persen Apparel receipt/);
    assert.match(payload.html, /\$25\.00/);
    assert.ok(payload.html.includes('&lt;unsafe&gt;'), 'email HTML must escape cart item names');
    assert.equal(payload.html.includes('<unsafe>'), false);
    assert.ok(p.events.some(x => x.method === 'PATCH' && JSON.parse(x.body || '{}').status === 'sent'));
  }
  {
    const p = mockProvider(false);
    const result = await sandbox(config, p.fetchMock)(request());
    const outcome = await result.json();
    assert.equal(outcome.sent, 0);
    assert.equal(outcome.failed, 1);
    assert.equal(p.events.filter(x => x.url === 'https://api.resend.com/emails').length, 0);
  }
  console.log('POS receipt worker: authorization, no-secrets fail closed, mocked Resend delivery and consent path PASSED');
})().catch(err => { console.error(err); process.exitCode = 1; });
