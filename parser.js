/**
 * parser.js — Estrazione dei deal dalla pagina "Audio Plugin Deals".
 *
 * Funzione PURA e senza dipendenze: gira identica dentro il Cloudflare Worker
 * e dentro il browser (usata come fallback quando si carica l'HTML grezzo).
 *
 * Struttura della pagina (verificata su https://www.audiopluginguy.com/deals/):
 *
 *   <div id="ultimate-plugin-deals-list">
 *     <tr data-index="14" data-tags="FREE, Effects, ">
 *       <td class="column-1">
 *         <strong><a class="dev_alert">NoiseAsh</a></strong> |
 *         <a href="https://...">Get Heater v2 by NoiseAsh free.</a>
 *         <span class='deal-badge badge-freebie'>FREEBIE</span>
 *       </td>
 *       <td class="column-2">100%</td>         <- sconto massimo
 *       <td class="column-3">2026-10-09</td>  <- scadenza
 *       <td class="column-4">2026-09-25</td>  <- data inserimento
 *       <td class="column-5 ult-hidden">https://...</td>
 *     </tr>
 *
 * Attenzione: il markup contiene un </p> "orfano" dentro alcune <tr>, quindi
 * l'HTML non è perfettamente well-formed. Per questo il parsing usa regex
 * tolleranti invece dell'albero DOM (che "correggerebbe" silenziosamente
 * la struttura e renderebbe i selettori fragili).
 */

const ROW_RE = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
const TD_RE = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const BADGE_RE = /<span\b[^>]*class=(['"])([^'"]*deal-badge[^'"]*)\1[^>]*>([\s\S]*?)<\/span>/gi;
const TAG_RE = /<[^>]+>/g;
const WS_RE = /\s+/g;
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013',
  mdash: '\u2014', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018',
  ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb',
  deg: '\u00b0', eacute: '\u00e9', egrave: '\u00e8', agrave: '\u00e0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', euro: '\u20ac',
  pound: '\u00a3', middot: '\u00b7', bull: '\u2022', times: '\u00d7',
};

/** Decodifica le entita HTML piu comuni (nominate e numeriche). */
export function decodeEntities(str) {
  if (!str) return '';
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** Rimuove i tag, decodifica le entita e normalizza gli spazi. */
export function cleanText(html) {
  if (!html) return '';
  return decodeEntities(String(html).replace(TAG_RE, ' ').replace(WS_RE, ' ')).trim();
}

/** Estrae gli attributi da un frammento di tag: { href: '...', class: '...' } */
export function parseAttrs(attrString) {
  const attrs = {};
  if (!attrString) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function classList(value) {
  return String(value || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Estrae la percentuale da "100%", "71%", "up to 71% off"… altrimenti null. */
export function parseDiscount(text) {
  const m = String(text || '').match(/(\d{1,3})\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** Normalizza "2026-10-09" in "2026-10-09", altrimenti null. */
export function parseDate(text) {
  const m = String(text || '').match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function absolutize(href) {
  const url = String(href || '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return 'https://www.audiopluginguy.com' + url;
  return '';
}

function unionInto(target, values, keyOf = (v) => v) {
  const seen = new Set(target.map(keyOf));
  for (const value of values) {
    const k = keyOf(value);
    if (!seen.has(k)) { seen.add(k); target.push(value); }
  }
}

/**
 * Unisce due righe che puntano allo stesso deal: la stessa offerta puo essere
 * pubblicata piu volte (sconto, poi freebie). Si tiene sempre l'informazione
 * piu utile: il flag "free" e' cumulativo, lo sconto il max, le date le piu
 * vicine, tag e badge l'unione.
 */
function mergeDeal(target, extra) {
  target.free = target.free || extra.free;
  if (extra.developer && !target.developer) target.developer = extra.developer;
  if (extra.discount != null) {
    target.discount = target.discount == null ? extra.discount : Math.max(target.discount, extra.discount);
  }
  if (extra.ends && (!target.ends || extra.ends < target.ends)) target.ends = extra.ends;
  if (extra.dateAdded && (!target.dateAdded || extra.dateAdded < target.dateAdded)) {
    target.dateAdded = extra.dateAdded;
  }
  unionInto(target.tags, extra.tags);
  unionInto(target.badges, extra.badges, (b) => b.label);
  if (target.free && target.discount == null) target.discount = 100;
  return target;
}

/**
 * Estrae tutti i deal dalla pagina.
 * @param {string} html HTML completo della pagina deals.
 * @param {{freeOnly?: boolean}} [options]
 * @returns {{deals: Array<object>, stats: object}}
 */
export function parseDeals(html, options = {}) {
  const { freeOnly = false } = options;
  const deals = [];
  const seenUrls = new Map();
  let totalRows = 0;
  let skipped = 0;
  let duplicates = 0;

  if (typeof html !== 'string' || !html) {
    return { deals: [], stats: { rows: 0, free: 0, kept: 0, skipped } };
  }

  ROW_RE.lastIndex = 0;
  let rowMatch;
  while ((rowMatch = ROW_RE.exec(html)) !== null) {
    const rowAttrMap = parseAttrs(rowMatch[1]);
    // La riga d'intestazione non ha data-index: va saltata.
    if (rowAttrMap['data-index'] === undefined) continue;

    const rawTags = String(rowAttrMap['data-tags'] || '');
    const tags = rawTags.split(',').map((t) => t.trim()).filter(Boolean);
    totalRows++;

    // --- celle della riga, indicizzate per classe ("column-1", "column-2"…) ---
    const cells = {};
    TD_RE.lastIndex = 0;
    let cellMatch;
    while ((cellMatch = TD_RE.exec(rowMatch[2])) !== null) {
      const attrMap = parseAttrs(cellMatch[1]);
      for (const cls of classList(attrMap.class)) {
        if (cls.startsWith('column-')) cells[cls] = cellMatch[2];
      }
    }

    const column1 = cells['column-1'] || '';

    // --- ancore della colonna 1: sviluppatore + link del deal ---
    let developer = '';
    let title = '';
    let titleUrl = '';
    ANCHOR_RE.lastIndex = 0;
    let anchorMatch;
    while ((anchorMatch = ANCHOR_RE.exec(column1)) !== null) {
      const a = parseAttrs(anchorMatch[1]);
      const text = cleanText(anchorMatch[2]);
      const href = absolutize(a.href);
      if (classList(a.class).includes('dev_alert')) {
        if (!developer) developer = text;
      } else if (text && !title) {
        title = text;
        titleUrl = href;
      }
    }

    // La URL canonica sta in column-5; la colonna 1 e il piano B.
    const url = absolutize(cleanText(cells['column-5'] || '')) || titleUrl;
    if (!url || !title) { skipped++; continue; }

    // --- badge (FREEBIE / HOT / NEW / BIG DISCOUNT / ENDS SOON) ---
    const badges = [];
    BADGE_RE.lastIndex = 0;
    let badgeMatch;
    while ((badgeMatch = BADGE_RE.exec(column1)) !== null) {
      const label = cleanText(badgeMatch[3]);
      if (!label) continue;
      const badgeClass = classList(badgeMatch[2]).find((c) => c.startsWith('badge-'));
      badges.push({ label, kind: badgeClass ? badgeClass.replace('badge-', '') : 'default' });
    }

    const discount = parseDiscount(cells['column-2']);
    const free =
      discount === 100 ||
      badges.some((b) => b.kind === 'freebie') ||
      tags.some((t) => t.toUpperCase() === 'FREE');

    // --- deduplicazione per URL, unendo le varianti duplicate ---
    // La stessa offerta puo comparire piu volte (prima come sconto, poi come
    // freebie): si tiene la versione piu completa. Senza questo merge la
    // variante "gratis" poteva essere scartata come duplicato.
    const key = url.replace(/\/+$/, '').toLowerCase();
    const existing = seenUrls.get(key);
    if (existing) {
      mergeDeal(existing, {
        id: url, title, developer, url, discount, free,
        ends: parseDate(cells['column-3']),
        dateAdded: parseDate(cells['column-4']),
        tags, badges,
      });
      duplicates++;
      continue;
    }

    const deal = {
      id: url,
      title,
      developer,
      url,
      discount,
      free,
      ends: parseDate(cells['column-3']),
      dateAdded: parseDate(cells['column-4']),
      tags,
      badges,
    };
    seenUrls.set(key, deal);
    deals.push(deal);
  }

  // Il filtro "solo gratuiti" si applica DOPO il merge, cosi un deal non
  // perde il flag free per via della deduplicazione.
  const result = freeOnly ? deals.filter((d) => d.free) : deals;

  // Piu recenti prima, poi sconto piu alto.
  result.sort((a, b) => {
    const da = a.dateAdded || '';
    const db = b.dateAdded || '';
    if (da !== db) return da < db ? 1 : -1;
    return (b.discount ?? -1) - (a.discount ?? -1);
  });

  return {
    deals: result,
    stats: {
      rows: totalRows,
      free: deals.filter((d) => d.free).length,
      kept: result.length,
      skipped,
      duplicates,
    },
  };
}

/* ================================================================== */
/*  Fonte secondaria: REST API di WordPress                           */
/* ================================================================== */

/**
 * Il sito e' protetto da anti-bot e blocca i client non-browser: se la pagina
 * /deals/ non e' raggiungibile, si ripiega sugli articoli esposti dal REST API
 * di WordPress. Sono dati meno precisi (niente sconto ne' scadenza), ma
 * coprono comunque i plugin gratuiti, che e' cio' che interessa alla PWA.
 */

const ANCHOR_HREF_RE = /<a\b[^>]*href=(['"])(https?:\/\/[^'"]+)\1[^>]*>/gi;

const FREE_WORDS =
  /\b(?:free|gratis|100\s*%\s*off|for free|no cost|free to (?:limited|try)|PWYW|pay what you want)\b/i;

const SOCIAL_HOSTS = /\.(facebook|twitter|x|instagram|youtube|linkedin|pinterest|tiktok|threads)\./i;

/** Prima URL esterna contenuta in un post (salta il sito stesso e i social). */
function firstExternalLink(html) {
  ANCHOR_HREF_RE.lastIndex = 0;
  let match;
  while ((match = ANCHOR_HREF_RE.exec(String(html || ''))) !== null) {
    const href = decodeEntities(match[2]);
    let host;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (host.endsWith('audiopluginguy.com')) continue;
    if (SOCIAL_HOSTS.test(host)) continue;
    return href;
  }
  return '';
}

/** "News: Morningdew Media has released JORNA…" -> "Morningdew Media" */
function developerFromTitle(title) {
  const stripped = String(title || '').replace(/^(?:news|deal|deals|free|review|news:)\s*:?\s*/i, '').trim();
  const match = stripped.match(
    /^(.+?)\s+(?:has|have|is|are|launches|launched|releases|released|announced|announces|offers|offering|unveils|publishes|dropped)\b/i
  );
  return match ? match[1].trim() : '';
}

/** Il titolo di un post può arrivare come stringa o come { rendered }. */
function postTitle(post) {
  const raw = post.title;
  if (typeof raw === 'string') return cleanText(raw);
  if (raw && typeof raw === 'object' && typeof raw.rendered === 'string') return cleanText(raw.rendered);
  return '';
}

/**
 * Converte i post del REST API in deal, con lo stesso formato di parseDeals.
 * @param {Array<object>} posts
 * @param {{freeOnly?: boolean, limit?: number}} [options]
 */
export function parsePosts(posts, options = {}) {
  const { freeOnly = false, limit = 200 } = options;
  const list = Array.isArray(posts) ? posts : [];
  const deals = [];
  const seen = new Set();

  for (const post of list) {
    if (!post || typeof post !== 'object') continue;
    if (deals.length >= limit) break;

    const title = postTitle(post);
    if (!title) continue;

    const content = (post.content && post.content.rendered) || '';
    const text = cleanText(content);
    const free = FREE_WORDS.test(title) || FREE_WORDS.test(text);
    if (freeOnly && !free) continue;

    const external = firstExternalLink(content) || post.link || '';
    const fallbackId = post.id != null ? String(post.id) : post.slug ? String(post.slug) : '';
    // Senza link e senza id la card non avrebbe nulla su cui agire: si scarta.
    if (!external && !fallbackId) continue;

    const key = (external || fallbackId).replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    deals.push({
      id: external || fallbackId,
      title,
      developer: developerFromTitle(title),
      url: external || post.link || '',
      discount: free ? 100 : null,
      free,
      ends: null,
      dateAdded: typeof post.date === 'string' ? post.date.slice(0, 10) : null,
      tags: [],
      badges: free ? [{ label: 'FREE', kind: 'freebie' }] : [],
    });
  }

  deals.sort((a, b) => ((a.dateAdded || '') < (b.dateAdded || '') ? 1 : -1));

  return {
    deals,
    stats: {
      posts: list.length,
      free: deals.filter((d) => d.free).length,
      kept: deals.length,
    },
  };
}
