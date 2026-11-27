const origin = 'https://naaqcspvbntzdtwuchrr.supabase.co/functions/v1/holiday-store';
const methods = new Map([['dashboard', 'GET'], ['manage', 'POST'], ['upload', 'POST']]);
const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
const problem = (status, error) => Response.json({ error }, { status, headers: responseHeaders });

export async function onRequest({ request, params }) {
  const method = methods.get(params.action);
  if (!method || request.method !== method) return problem(404, 'Page unavailable.');

  const authorization = request.headers.get('Authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization)) {
    return problem(401, 'Please sign in.');
  }

  const headers = new Headers({ Accept: 'application/json', Authorization: authorization });
  let body;
  if (method === 'POST') {
    if (request.headers.get('Origin') !== new URL(request.url).origin) {
      return problem(403, 'Send this request from Command Center.');
    }
    if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return problem(415, 'Send JSON.');
    }

    const reader = request.body?.getReader();
    if (!reader) return problem(400, 'Missing request.');
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16000) {
          await reader.cancel();
          return problem(413, 'Request too large.');
        }
        chunks.push(value);
      }
      body = await new Blob(chunks).text();
      JSON.parse(body);
    } catch {
      return problem(400, 'Invalid request.');
    }
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(origin + '/' + params.action, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return problem(502, 'Store service unavailable.');
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return problem(503, 'Store service unavailable.');
  }
}
