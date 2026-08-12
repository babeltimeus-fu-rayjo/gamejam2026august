// chart.json export/import + localStorage autosave.

export function exportChart(chart) {
  const json = JSON.stringify(chart.serialize(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "chart.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function importChartFile(chart, file) {
  const text = await file.text();
  chart.loadSerialized(JSON.parse(text)); // throws with readable message
}

function autosaveKey(chart) {
  return `chartEditor.autosave.${chart.song.audioFile}|${Math.round(chart.song.duration)}`;
}

let saveTimer = null;
export function scheduleAutosave(chart) {
  if (!chart.song.audioFile) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(autosaveKey(chart), JSON.stringify(chart.serialize()));
    } catch { /* storage full/unavailable — autosave is best-effort */ }
  }, 2000);
}

export function findAutosave(chart) {
  try {
    const raw = localStorage.getItem(autosaveKey(chart));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearAutosave(chart) {
  try { localStorage.removeItem(autosaveKey(chart)); } catch {}
}
