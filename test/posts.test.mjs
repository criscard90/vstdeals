/**
 * Test della fonte secondaria (REST API di WordPress) su dati reali.
 * Uso: node test/posts.test.mjs [/tmp/posts20.json]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePosts } from '../parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || join(here, 'fixture-posts.json');
const posts = JSON.parse(readFileSync(file, 'utf8'));

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
}

const { deals, stats } = parsePosts(posts);

check('post letti', stats.posts === posts.length, `posts=${stats.posts}`);
check('deal estratti', deals.length > 0, `deals=${deals.length}`);
check('deal gratuiti trovati', stats.free > 0, `free=${stats.free}`);

const fields = ['id', 'title', 'developer', 'url', 'discount', 'free', 'ends', 'dateAdded', 'tags', 'badges'];
check('tutti i campi presenti', deals.every((d) => fields.every((f) => f in d)));

const noUrl = deals.filter((d) => !/^https?:\/\//.test(d.url));
check('URL assoluti', noUrl.length === 0, `non assoluti=${noUrl.length}`);

const selfLinks = deals.filter((d) => /audiopluginguy\.com/.test(d.url));
check('nessun link verso il sito stesso', selfLinks.length === 0, `interni=${selfLinks.length}`);

const withDev = deals.filter((d) => d.developer);
check('developer estratti dal titolo', withDev.length >= deals.length * 0.5, `${withDev.length}/${deals.length}`);

const badDates = deals.filter((d) => d.dateAdded && !/^\d{4}-\d{2}-\d{2}$/.test(d.dateAdded));
check('date valide', badDates.length === 0, `errate=${badDates.length}`);

const sorted = deals.every((d, i) => i === 0 || (deals[i - 1].dateAdded || '') >= (d.dateAdded || ''));
check('ordinamento per data decrescente', sorted);

const onlyFree = parsePosts(posts, { freeOnly: true });
check('freeOnly restituisce solo free', onlyFree.deals.every((d) => d.free), `n=${onlyFree.deals.length}`);
check('freeOnly coerente', onlyFree.deals.length === stats.free, `${onlyFree.deals.length} vs ${stats.free}`);

const limited = parsePosts(posts, { limit: 3 });
check('limite rispettato', limited.deals.length === 3, `n=${limited.deals.length}`);

check('input non-array tollerato', parsePosts(null).deals.length === 0);
check('post malformati tollerati', parsePosts([null, {}, { title: { rendered: '' } }]).deals.length === 0);

console.log('\n--- Esempi ---');
for (const d of deals.slice(0, 5)) {
  console.log(` • [${d.free ? 'FREE' : '—'}] ${d.developer || '?'} :: ${d.title.slice(0, 72)}`);
  console.log(`   ${d.url.slice(0, 80)} (${d.dateAdded})`);
}

console.log(`\n${failures === 0 ? 'TUTTI I TEST PASSATI' : failures + ' TEST FALLITI'}`);
process.exit(failures === 0 ? 0 : 1);
