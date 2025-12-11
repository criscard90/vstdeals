async function loadData() {
  const output = document.getElementById("output");
  output.textContent = "Caricamento...";

  // URL della pagina da scrapare
  const pageUrl = "https://www.audiopluginguy.com/deals/";

  // Passiamo tramite corsproxy.io per bypassare CORS
  const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(pageUrl);

  try {
    // Fetch della pagina HTML
    const res = await fetch(proxyUrl);
    const html = await res.text();

    // Parse HTML in DOM
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Trova tutti gli script che contengono le offerte
    const scripts = Array.from(doc.querySelectorAll("script")).map(s => s.textContent);

    // Cerca lo script con "var apg_deals"
    let dealsJson = null;
    for (let s of scripts) {
      const match = s.match(/var\s+apg_deals\s*=\s*(\{[\s\S]*?\});/);
      if (match) {
        dealsJson = JSON.parse(match[1]);
        break;
      }
    }

    if (!dealsJson) {
      output.textContent = "Offerte non trovate!";
      return;
    }

    // Crea tabella HTML
    const table = document.createElement("table");
    table.style.borderCollapse = "collapse";
    table.style.width = "100%";
    table.innerHTML = `
      <tr>
        <th style="border:1px solid #ccc;padding:4px;">Nome</th>
        <th style="border:1px solid #ccc;padding:4px;">Prezzo scontato</th>
        <th style="border:1px solid #ccc;padding:4px;">Prezzo originale</th>
        <th style="border:1px solid #ccc;padding:4px;">Sconto</th>
        <th style="border:1px solid #ccc;padding:4px;">Link</th>
      </tr>
    `;

    for (let key in dealsJson) {
      const deal = dealsJson[key];
      const row = document.createElement("tr");

      row.innerHTML = `
        <td style="border:1px solid #ccc;padding:4px;">${deal.name}</td>
        <td style="border:1px solid #ccc;padding:4px;">${deal.price}</td>
        <td style="border:1px solid #ccc;padding:4px;">${deal.regular_price}</td>
        <td style="border:1px solid #ccc;padding:4px;">${deal.discount}</td>
        <td style="border:1px solid #ccc;padding:4px;"><a href="${deal.url}" target="_blank">Link</a></td>
      `;

      table.appendChild(row);
    }

    output.textContent = ""; // pulisco il pre
    output.appendChild(table);

  } catch (err) {
    output.textContent = "Errore nel caricamento delle offerte: " + err;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}
