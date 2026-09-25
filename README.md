# Plugin Deals — PWA

Offerte e plugin gratuiti per VST, raccolti con **scraping diretto** di
[Audio Plugin Deals](https://www.audiopluginguy.com/deals/).

## Perché è stato riscritto il backend

La versione precedente leggeva un feed JSON di terze parti:

```js
const FEED_URL = 'https://politepol.com/fd/wTw62jsUzOHO.json';   // → HTTP 404, scade
```

Quel servizio è gratuito ma ha una durata limitata: quando scade, la PWA
restituiva una lista vuota. Sostituirlo con un altro feed significherebbe
stesso problema tra qualche mese. Qui si scrapa **la pagina vera**, che non ha
scadenza.

Nota sui domini: `vstdeals.com` **non** è la fonte. Oggi è un sito WordPress
di default, vuoto, e `/category/free-plugins/` risponde 404. La fonte usata da
questo progetto — riotrovata nella cronologia git, dove compariva
`https://www.audiopluginguy.com/deals/` — è `audiopluginguy.com`.

## Perché serve ancora il Worker

Il sito è protetto da Sucuri:

| Richiesta                                  | Risposta |
| ------------------------------------------ | -------- |
| `curl` senza User-Agent                    | `403`    |
| Worker attuale (fetch "nudo")              | `202` + pagina challenge `/.well-known/sgcaptcha/` |
| Con header da browser                      | `200`, ~500 KB di HTML |

Nessun proxy CORS pubblico fa da tramite (allorigins risponde `522`), quindi
l'unica soluzione è il **proprio Worker**, che deve mandare header da browser.
Il worker fa anche il parsing: al browser arrivano pochi KB di JSON invece di
mezzo megabyte di HTML.

## Deploy

```bash
npm install          # installa wrangler
npm test             # 28 test sul parser
npm run deploy       # pubblica il worker
npm run tail         # log in tempo reale
```

Il worker va pubblicato sullo stesso dominio già in uso dalla PWA
(`vstdeals.ccmixmastering.workers.dev`): `wrangler deploy` sostituisce lo
vecchio proxy generico.

### Verificare che funzioni

```bash
curl -s https://vstdeals.ccmixmastering.workers.dev/health
curl -s 'https://vstdeals.ccmixmastering.workers.dev/?free=1' | head -c 400
```

Se la risposta contiene `"blocked":"captcha"`, il worker non sta overcoming
l'anti-bot: l'errore dice esplicitamente cosa fare.

### Endpoint

| Endpoint         | Descrizione                                             |
| ---------------- | ------------------------------------------------------- |
| `/`              | tutti i deal in JSON                                   |
| `/?free=1`       | solo i plugin gratuiti                                  |
| `/?refresh=1`    | salta la cache e riscrapa (30 min di TTL)               |
| `/?limit=20`     | limita il numero di deal                                |
| `/health`        | stato della cache                                       |
| `/?url=<url>`    | proxy HTML grezzo, solo per host autorizzati             |

## Struttura

| File                          | Ruolo                                                     |
| ----------------------------- | --------------------------------------------------------- |
| `parser.js`                   | funzione pura che estrae i deal dall'HTML (Worker + browser) |
| `worker.js`                   | scraping con header da browser, cache 30 min, JSON         |
| `app.js`                      | stato, rendering, filtri, ricerca, cache locale            |
| `sw.js`                       | service worker: shell in cache, dati network-first         |
| `styles.css` / `index.html`   | interfaccia (nessuna dipendenza esterna)                   |
| `manifest.json`               | metadati PWA                                              |
| `scripts/scrape.mjs`          | scarica la pagina reale in `/tmp/apg.html`                 |
| `scripts/generate-icons.py`   | genera le icone PNG senza librerie esterne                 |
| `test/`                       | test del parser e integrità dei file                       |

## Sviluppo locale

`app.js` è un ES module: va servito via HTTP, `file://` non funziona.

```bash
python3 -m http.server 8080
# poi apri http://localhost:8080
```

I dati arrivano dal Worker remoto; per provare il parsing in locale:

```bash
npm run scrape        # salva /tmp/apg.html
npm test              # test sulla fixture
node test/parser.test.mjs /tmp/apg.html   # test sulla pagina reale
```

## Note sui dati

La pagina contiene una tabella `#ultimate-plugin-deals-list` con 6 colonne:
descrizione, sconto massimo, scadenza, data di inserimento, URL e tag. Un deal
è considerato **gratuito** se vale almeno una di queste condizioni: sconto
`100%`, badge `FREEBIE`, tag `FREE`. La stessa offerta può comparire più volte
(sconto e poi freebie): le varianti vengono unite, così il flag "gratuito" non
si perde.

I segni (visto / riscattato / non mi interessa) stanno in `localStorage` e
usano la URL del deal come identificatore. Sono quindi **diversi** da quelli
della vecchia versione, basata sul feed: la lista parte azzerata. Il pulsante
"Azzera segni" cancella anche le vecchie chiavi.
