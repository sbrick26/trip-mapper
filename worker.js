/**
 * Cloudflare Worker — Travel Map Proxy
 * 
 * Handles two things:
 *   POST /         → Proxies Anthropic API calls (adds CORS headers)
 *   GET  /?fetch=  → Fetches Google Sheets CSV server-side (no CORS issue)
 *
 * Deploy at: workers.cloudflare.com
 *   1. Create Account (free) → Workers & Pages → Create Worker
 *   2. Paste this file → Save & Deploy
 *   3. Copy the worker URL → paste into index.html as WORKER_URL
 */

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
      'Access-Control-Max-Age': '86400',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── GET /?fetch=<url>  →  fetch Google Sheet CSV server-side ──
    if (request.method === 'GET') {
      const target = url.searchParams.get('fetch');
      if (!target) {
        return new Response('ok', { headers: corsHeaders });
      }
      try {
        const res = await fetch(decodeURIComponent(target), {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const body = await res.text();
        return new Response(body, {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── POST /  →  proxy Anthropic API ────────────────────────────
    if (request.method === 'POST') {
      const apiKey = request.headers.get('X-Api-Key') || '';
      const body   = await request.text();

      try {
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body,
        });
        const responseBody = await upstream.text();
        return new Response(responseBody, {
          status: upstream.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: e.message } }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
};
