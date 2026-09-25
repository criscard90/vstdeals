/**
 * Scarica la pagina reale dei deal e la salva in /tmp/apg.html.
 * Serve per aggiornare la fixture dei test e per ispezionare l'HTML a mano.
 *
 *   npm run scrape
 *   node test/parser.test.mjs /tmp/apg.html
 *
 * Attenzione: la protezione anti-bot del sito blocca fetch di Node/undici con
 * 403 anche quando si mandano header da browser (il blocco e' basato su
 * fingerprint TLS/HTTP2, non sugli header). Per questo il download usa curl,
 * che viene invece accettato.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseDeals } from '../parser.js';

export const DEALS_URL = 'https://www.audiopluginguy.com/deals/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function download(url) {
  return execFileSync(
    'curl',
    [
      '-sS',
      '-m',
      '60',
      '-L',
      '-A',
      UA,
      '-H',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H',
      'Accept-Language: en-US,en;q=0.9',
      '-w',
      '\n__HTTP_STATUS__:%{http_code}',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
}

const MARKER = '\n__HTTP_STATUS__:';
const raw = download(DEALS_URL);
const splitAt = raw.lastIndexOf(MARKER);
const html = splitAt === -1 ? raw : raw.slice(0, splitAt);
const status = splitAt === -1 ? '?' : raw.slice(splitAt + MARKER.length).trim();

if (status !== '200') {
  console.error(`Errore HTTP ${status} su ${DEALS_URL}`);
  console.error("Il sito blocca la richiesta: aspetta qualche minuto e riprova.");
  process.exit(1);
}

writeFileSync('/tmp/apg.html', html);

const { deals, stats } = parseDeals(html);
console.log(`Salvati ${html.length} byte in /tmp/apg.html`);
console.log('stats:', stats);
console.log(`gratis: ${deals.filter((d) => d.free).length}/${deals.length}`);
