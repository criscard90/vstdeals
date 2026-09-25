/**
 * Test del parser sull'HTML reale di https://www.audiopluginguy.com/deals/
 * Eseguire: npm test   (usa la copia locale in test/fixture-deals.html)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDeals, cleanText, parseDiscount, decodeEntities } from '../parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = process.argv[2] || join(here, 'fixture-deals.html');
const html = readFileSync(fixture, 'utf8');

let failures = 0;
function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${status}] ${label}${detail ? ' — ' + detail : ''}`);
}

/* ---------- unità: helper ---------- */
check('decodeEntities numeriche', decodeEntities('&#8211;&#x2014;') === '\u2013\u2014');
check('decodeEntities nominate', decodeEntities('a &amp; b &nbsp;c') === 'a & b  c');
check('cleanText rimuove i tag', cleanText('<b>Hei</b> &amp; ciao') === 'Hei & ciao');
check('parseDiscount 100%', parseDiscount('100%') === 100);
check('parseDiscount testo', parseDiscount('up to 71% off') === 71);
check('parseDiscount assente', parseDiscount('n/a') === null);

/* ---------- integrazione: pagina reale ---------- */
const { deals, stats } = parseDeals(html);

check('estrane righe trovate', stats.rows >= 4, `rows=${stats.rows}`);
check('deal estratti', deals.length >= 3, `deals=${deals.length}`);
check('nessuna riga malformata scartata', stats.skipped === 0, `skipped=${stats.skipped}`);
check('deal gratuiti presenti', stats.free >= 2, `free=${stats.free}`);
check('duplicati uniti col merge', stats.duplicates >= 1, `duplicates=${stats.duplicates}`);

const required = ['id', 'title', 'url', 'developer', 'discount', 'free', 'ends', 'dateAdded', 'badges', 'tags'];
const bad = deals.filter((d) => required.some((k) => !(k in d)));
check('tutti i campi presenti', bad.length === 0, `incompleti=${bad.length}`);

const noUrl = deals.filter((d) => !/^https?:\/\//.test(d.url));
check('URL assoluti', noUrl.length === 0, `non assoluti=${noUrl.length}`);

const noTitle = deals.filter((d) => d.title.length < 5);
check('titoli non vuoti', noTitle.length === 0, `vuoti=${noTitle.length}`);

const withDev = deals.filter((d) => d.developer.length > 0);
check('developer estratti', withDev.length > deals.length * 0.9, `${withDev.length}/${deals.length}`);

const badDates = deals.filter((d) => d.dateAdded && !/^\d{4}-\d{2}-\d{2}$/.test(d.dateAdded));
check('date ISO valide', badDates.length === 0, `errate=${badDates.length}`);

const sorted = deals.every((d, i) => i === 0 || (deals[i - 1].dateAdded || '') >= (d.dateAdded || ''));
check('ordinamento per data decrescente', sorted);

const dupes = deals.length - new Set(deals.map((d) => d.url)).size;
check('nessun duplicato', dupes === 0, `duplicati=${dupes}`);

/* un deal gratuito noto, verificato a mano sulla pagina reale */
const heater = deals.find((d) => /heater\s*v2/i.test(d.title));
check('deal noto "Heater v2" trovato', !!heater);
if (heater) {
  check('  -> sviluppatore NoiseAsh', heater.developer === 'NoiseAsh', heater.developer);
  check('  -> sconto 100%', heater.discount === 100, String(heater.discount));
  check('  -> marcato come gratuito', heater.free === true);
  check('  -> data inserimento 2026-09-25', heater.dateAdded === '2026-09-25', String(heater.dateAdded));
  check('  -> badge FREEBIE presente', heater.badges.some((b) => b.kind === 'freebie'),
    heater.badges.map((b) => b.kind).join(','));
}

/* filtro freeOnly */
const onlyFree = parseDeals(html, { freeOnly: true });
check('freeOnly restituisce solo free', onlyFree.deals.every((d) => d.free),
  `n=${onlyFree.deals.length}`);
check('freeOnly = numero free', onlyFree.deals.length === stats.free,
  `${onlyFree.deals.length} vs ${stats.free}`);

/* robustezza: input vuoti o spazzatura */
for (const [name, input] of [['stringa vuota', ''], ['html senza deal', '<html><body>niente</body></html>'], ['undefined', undefined]]) {
  const r = parseDeals(input);
  check(`input tollerato: ${name}`, Array.isArray(r.deals) && r.deals.length === 0);
}

/* ---------- campione ---------- */
console.log('\n--- Primi 3 deal ---');
for (const d of deals.slice(0, 3)) {
  console.log(` • [${d.free ? 'FREE' : (d.discount + '%')}] ${d.developer} :: ${d.title.slice(0, 70)}`);
  console.log(`   ends=${d.ends} added=${d.dateAdded} badges=[${d.badges.map((b) => b.label).join('|')}] tags=[${d.tags.join(',')}]`);
}

console.log(`\n${failures === 0 ? 'TUTTI I TEST PASSATI' : failures + ' TEST FALLITI'}`);
process.exit(failures === 0 ? 0 : 1);
