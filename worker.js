/**
 * Cloudflare Worker — Travel Map Proxy + KV Cache
 *
 * Routes:
 *   GET  /?fetch=<url>          → Fetches Google Sheets CSV server-side
 *   GET  /?cache_get=<hash>     → Returns cached trip JSON if hash matches
 *   POST /cache                 → Stores processed trip JSON keyed by CSV hash
 *   POST /                      → Proxies Anthropic API calls
 */

export default {
  async fetch(request, env) {
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
      // ── GET /?cache_get=<hash>  →  check KV cache ──
      const cacheKey = url.searchParams.get('cache_get');
      if (cacheKey) {
        const cached = env.TRIP_CACHE ? await env.TRIP_CACHE.get(cacheKey) : null;
        if (cached) {
          return new Response(JSON.stringify({ hit: true, data: JSON.parse(cached) }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ hit: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ── GET /?geocode=<query>  →  proxy Nominatim place search ──
      const geocodeQ = url.searchParams.get('geocode');
      if (geocodeQ) {
        const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(geocodeQ)}&format=json&limit=5&addressdetails=1`;
        try {
          const r = await fetch(nomUrl, { headers: { 'User-Agent': 'TripMapper/1.0 (travel-map-app)' } });
          const body = await r.text();
          return new Response(body, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch(e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

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

    if (request.method === 'POST') {
      // ── POST /cache/delete  →  remove entry from KV ──
      if (url.pathname === '/cache/delete') {
        const { hash } = await request.json();
        if (env.TRIP_CACHE) await env.TRIP_CACHE.delete(hash);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ── POST /cache  →  store trip JSON in KV ──
      if (url.pathname === '/cache') {
        if (!env.TRIP_CACHE) {
          return new Response(JSON.stringify({ ok: false, error: 'KV not bound' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { hash, data } = await request.json();
        // Store for 30 days
        await env.TRIP_CACHE.put(hash, JSON.stringify(data), { expirationTtl: 86400 * 30 });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ── POST /  →  proxy Anthropic API (streaming) ──
      const apiKey = request.headers.get('X-Api-Key') || '';
      const body = await request.json();

      // Inject streaming to avoid Cloudflare subrequest timeout
      body.stream = true;

      try {
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });

        // Error responses are JSON (not SSE) — buffer and forward as-is
        if (!upstream.ok) {
          const errorBody = await upstream.text();
          return new Response(errorBody, {
            status: upstream.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Stream SSE response through to client
        return new Response(upstream.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: e.message } }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
};
