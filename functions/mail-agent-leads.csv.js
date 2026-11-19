// Pages Function: gate the outreach CSV behind HTTP Basic auth.
// Password lives only in the Cloudflare Pages secret MHZALY_CSV_PASS
// and in the owner's private ~/.automaton/mhzaly.env — never in the UI.
const REALM = 'mhzaly leads';

function deny() {
  return new Response('Access denied', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store, max-age=0, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const pass = env.MHZALY_CSV_PASS;
  if (!pass) {
    return new Response('CSV access is not configured', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  const header = request.headers.get('authorization') || '';
  let ok = false;
  if (header.startsWith('Basic ')) {
    try {
      const raw = atob(header.slice(6));
      const at = raw.indexOf(':');
      if (at >= 0 && raw.slice(at + 1) === pass) ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) return deny();

  const res = await next();
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
