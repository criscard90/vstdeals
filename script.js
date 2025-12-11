async function loadData() {
  const output = document.getElementById("output");
  output.textContent = "Caricamento...";

  const url = "https://www.audiopluginguy.com/deals/";
  try {
    // Primo tentativo: diretto
    const res = await fetch(url);

    if (!res.ok) throw new Error("Errore HTTP: " + res.status);

    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);
    return;

  } catch (err) {
    console.warn("Fetch diretto fallito, riprovo con corsproxy.io...", err);
  }

  // Secondo tentativo: corsproxy.io
  try {
    const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(url);
    const res2 = await fetch(proxyUrl);

    if (!res2.ok) throw new Error("Errore proxy: " + res2.status);

    const data2 = await res2.json();
    output.textContent = JSON.stringify(data2, null, 2);

  } catch (err2) {
    output.textContent = "Errore anche col proxy: " + err2;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}
