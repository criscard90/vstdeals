async function loadData() {
  const output = document.getElementById("output");
  output.textContent = "Caricamento...";

  const apiUrl = "https://cdn.audiopluginguy.com/apg-deals/api/apg-deals.json";

  try {
    let res = await fetch(apiUrl);
    if (!res.ok) throw new Error("Errore HTTP " + res.status);

    let deals = await res.json();

    // Mostra tutto in modo leggibile
    output.textContent = JSON.stringify(deals, null, 2);

  } catch (err) {
    console.warn("Errore diretto, provo con corsproxy.io", err);

    try {
      const proxy = "https://corsproxy.io/?" + encodeURIComponent(apiUrl);
      const res2 = await fetch(proxy);
      const deals2 = await res2.json();
      output.textContent = JSON.stringify(deals2, null, 2);
    } catch (err2) {
      output.textContent = "Errore anche col proxy: " + err2;
    }
  }
}
