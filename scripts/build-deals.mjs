/**
 * scripts/build-deals.mjs — scarica i deal da AudioPluginGuy e genera deals.json.
 * Può essere eseguito localmente o dentro una GitHub Action periodica.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDeals, parsePosts } from '../parser.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEALS_URL = 'https://www.audiopluginguy.com/deals/';
const POSTS_API_URL =
  'https://www.audiopluginguy.com/wp-json/wp/v2/posts?per_page=40&_fields=id,date,link,slug,title,content';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function curl(url) {
  try {
    return execFileSync(
      'curl',
      [
        '-s',
        '-m',
        '45',
        '-L',
        '-A',
        UA,
        url,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
  } catch (err) {
    console.warn(`Errore curl su ${url}:`, err.message);
    return null;
  }
}

let result = null;

// 1. Prova la pagina principale dei deal
console.log('Download da:', DEALS_URL);
const html = curl(DEALS_URL);
if (html && html.includes('ultimate-plugin-deals-list')) {
  const parsed = parseDeals(html);
  if (parsed.deals.length > 0) {
    result = {
      ok: true,
      source: 'audiopluginguy.com/deals',
      sourceUrl: DEALS_URL,
      fetchedAt: new Date().toISOString(),
      stats: parsed.stats,
      deals: parsed.deals,
    };
    console.log(`Estratti ${parsed.deals.length} deal dalla tabella (${parsed.stats.free} gratuiti).`);
  }
}

// 2. Se fallisce, prova il REST API di WordPress
if (!result) {
  console.log('Provo il fallback REST API:', POSTS_API_URL);
  const postsRaw = curl(POSTS_API_URL);
  if (postsRaw) {
    try {
      const posts = JSON.parse(postsRaw);
      const parsed = parsePosts(posts);
      if (parsed.deals.length > 0) {
        result = {
          ok: true,
          source: 'audiopluginguy.com/wp-json',
          sourceUrl: POSTS_API_URL,
          fetchedAt: new Date().toISOString(),
          stats: parsed.stats,
          deals: parsed.deals,
        };
        console.log(`Estratti ${parsed.deals.length} deal dal REST API (${parsed.stats.free} gratuiti).`);
      }
    } catch (e) {
      console.warn('Errore parsing JSON dei post:', e.message);
    }
  }
}

// 3. Salvataggio
const outPath = join(root, 'deals.json');
if (result) {
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('deals.json generato con successo!');
} else {
  if (existsSync(outPath)) {
    console.warn('Scraping fallito ma deals.json esistente preservato.');
  } else {
    console.error('Scraping fallito e nessun deals.json precedente.');
    process.exit(1);
  }
}
