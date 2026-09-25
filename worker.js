/**
 * worker.js — backend di scraping per la PWA "Plugin Deals".
 *
 * PERCHE' SERVE UN WORKER
 * ----------------------
 * 1) CORS: il browser non puo leggere direttamente audiopluginguy.com.
 * 2) Anti-bot: il sito (protezione Sucuri) risponde 403 a chi non manda
 *    header da browser, e restituisce una pagina di challenge
 *    (.well-known/sgcaptcha) con HTTP 202. Serve quindi simulare un browser.
 * 3) Il parsing lato server evita di scaricare ~500 KB di HTML a ogni
 *    apertura della PWA: si invia solo il JSON dei deal.
 *
 * Sostituisce il vecchio proxy generico sullo stesso dominio
 * (vstdeals.ccmixmastering.workers.dev).
 *
 * Deploy:  npx wrangler deploy      Test:  npx wrangler dev
 */

import { parseDeals, parsePosts } from './parser.js';

const DEALS_URL = 'https://www.audiopluginguy.com/deals/';
const POSTS_API_URL =
  'https://www.audiopluginguy.com/wp-json/wp/v2/posts?per_page=30&_fields=id,date,link,slug,title,content';

/**
 * Fonti tentate in ordine. Il sito ha una protezione anti-bot che blocca i
 * client non-browser (Node/undici ottiene 403 anche con header da browser:
 * il blocco e' basato su fingerprint TLS/HTTP2). Se la pagina principale non
 * risponde si ripiega sul REST API di WordPress, che espone gli articoli con
 * link diretti ai plugin: dati meno precisi, ma la PWA continua a funzionare.
 */
const SOURCES = [
  { name: 'tabella /deals/', url: DEALS_URL, kind: 'html' },
  { name: 'REST API wp-json', url: POSTS_API_URL, kind: 'json' },
];

// Solo gli host autorizzati: il worker e' pubblico, e un proxy aperto
// verrebbe usato come trampolino per qualunque richiesta.
const ALLOWED_HOSTS = new Set(['www.audiopluginguy.com', 'audiopluginguy.com']);

const CACHE_TTL_SECONDS = 1800; // 30 minuti
const CACHE_KEY_URL = 'https://cache.local/deals.json';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'no-cache',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

/** Riconosce la pagina di challenge anti-bot, per restituire un errore chiaro. */
function detectBlockPage(html, status) {
  const head = String(html || '').slice(0, 2000);
  if (/sgcaptcha|cf-browser-verification/i.test(head)) return 'captcha';
  if (/Just a moment\.\.\./i.test(head)) return 'challenge';
  if (status === 403) return 'forbidden';
  return null;
}

async function fetchDealsHtml(url) {
  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
  });
  const body = await response.text();
  const blocked = detectBlockPage(body, response.status);

  if (!response.ok || blocked) {
    const error = new Error(
      blocked === 'captcha' || blocked === 'challenge'
        ? 'challenge anti-bot (Sucuri)'
        : `HTTP ${response.status}`
    );
    error.blocked = blocked || `http-${response.status}`;
    throw error;
  }
  return body;
}

/**
 * Prova le fonti una dopo l'altra e restituisce la prima che dà risultati.
 * @returns {Promise<{deals: Array<object>, stats: object, source: string, sourceUrl: string}>}
 */
async function loadFromSources() {
  const failures = [];

  for (const source of SOURCES) {
    try {
      const body = await fetchDealsHtml(source.url);
      const parsed = source.kind === 'json' ? parsePosts(JSON.parse(body)) : parseDeals(body);

      if (!parsed.deals.length) {
        throw new Error('nessun deal riconosciuto nella risposta');
      }
      return { ...parsed, source: source.name, sourceUrl: source.url };
    } catch (error) {
      failures.push(`${source.name}: ${error.message}`);
    }
  }

  const error = new Error(`Nessuna fonte disponibile — ${failures.join(' | ')}`);
  error.failures = failures;
  error.blocked = 'all-sources';
  throw error;
}

/** Restituisce i deal, usando la Cache API per non colpire il sito a ogni visita. */
async function getPayload(force) {
  const cache = caches.default;
  const cached = await cache.match(CACHE_KEY_URL);

  if (!force && cached) {
    const fetchedAt = Number(cached.headers.get('x-fetched-at') || 0);
    const age = (Date.now() - fetchedAt) / 1000;
    if (age >= 0 && age < CACHE_TTL_SECONDS) {
      return { ...(await cached.json()), fromCache: true, ageSeconds: Math.round(age) };
    }
  }

  const { deals, stats, source, sourceUrl } = await loadFromSources();

  const payload = {
    ok: true,
    source,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    stats,
    deals,
  };

  await cache.put(
    CACHE_KEY_URL,
    new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', 'x-fetched-at': payload.fetchedAt },
    })
  );

  return { ...payload, fromCache: false, ageSeconds: 0 };
}

async function handleDeals(url) {
  const force = url.searchParams.get('refresh') === '1';
  const freeOnly = url.searchParams.get('free') === '1';
  const limit = Number(url.searchParams.get('limit')) || 0;

  try {
    const payload = await getPayload(force);
    let deals = payload.deals;
    if (freeOnly) deals = deals.filter((d) => d.free);
    if (limit > 0) deals = deals.slice(0, limit);

    return json({ ...payload, ok: true, deals, returned: deals.length });
  } catch (error) {
    // Se il sito e' irraggiungibile si serve la copia in cache, se esiste:
    // meglio una lista vecchia che una lista vuota.
    const cached = await caches.default.match(CACHE_KEY_URL);
    if (cached) {
      return json(
        { ...(await cached.json()), ok: true, stale: true, warning: `Aggiornamento fallito: ${error.message}` },
        200,
        { 'X-Stale': '1' }
      );
    }
    return json(
      {
        ok: false,
        error: error.message,
        blocked: error.blocked || null,
        hint:
          error.blocked === 'all-sources'
            ? 'Il sito blocca sia la pagina dei deal sia il REST API. Se il worker restituisce 403 anche a te, controlla le impostazioni anti-bot del sito.'
            : 'Verifica che https://www.audiopluginguy.com/deals/ sia raggiungibile.',
      },
      502
    );
  }
}

/** Proxy "grezzo" mantenuto per compatibilita': restituisce l'HTML della pagina. */
async function handleProxy(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ ok: false, error: 'URL non valido' }, 400);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return json({ ok: false, error: `Host non consentito: ${parsed.hostname}` }, 403);
  }

  try {
    const response = await fetch(parsed.href, { headers: BROWSER_HEADERS, redirect: 'follow' });
    const html = await response.text();
    const blocked = detectBlockPage(html, response.status);
    if (blocked) return json({ ok: false, error: "Bloccato dall'anti-bot", blocked }, 403);
    return new Response(html, {
      status: response.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
    });
  } catch (error) {
    return json({ ok: false, error: error.message }, 502);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ ok: false, error: 'Metodo non consentito' }, 405);
    }

    if (url.pathname === '/health') {
      const cached = await caches.default.match(CACHE_KEY_URL);
      const payload = cached ? await cached.json() : null;
      return json({
        ok: true,
        cache: Boolean(payload),
        fetchedAt: payload?.fetchedAt || null,
        deals: payload?.deals?.length || 0,
        ttlSeconds: CACHE_TTL_SECONDS,
      });
    }

    const target = url.searchParams.get('url');
    if (target) return handleProxy(target);

    return handleDeals(url);
  },
};
