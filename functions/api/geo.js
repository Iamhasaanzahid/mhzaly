// Pages Function: return detected country from Cloudflare edge
// Free, no third‑party API, respects privacy (only uses Cloudflare's own IP data)
export async function onRequestGet({ request, env }) {
  // Cloudflare exposes the visitor's country code via request.headers
  const cfIPCountry = request.headers.get('CF-IPCountry') || '';
  // Reject non‑country responses (e.g. XS, T1, internal)
  const countryCode = (cfIPCountry && /^[A-Z]{2}$/.test(cfIPCountry) && cfIPCountry !== 'XX') ? cfIPCountry : '';

  const body = {
    country: countryCode,
    // include extra Cloudflare edge info if useful
    city: request.cf?.city || '',
    region: request.cf?.region || '',
    timezone: request.cf?.timezone || '',
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=300', // cache 5 min at edge
    },
  });
}
