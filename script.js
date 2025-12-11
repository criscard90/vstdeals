async function loadData() {
  const output = document.getElementById("output");
  output.textContent = "Caricamento...";

  try {
    const res = await fetch("https://www.audiopluginguy.com/deals/");
    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    output.textContent = "Errore: " + err;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}