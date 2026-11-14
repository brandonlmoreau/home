(() => {
  const STORAGE_KEY = "construction-tracker-v1";
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const els = {
    status: document.getElementById("status-label"),
    liveTime: document.getElementById("live-time"),
    liveHint: document.getElementById("live-hint"),
    clockBtn: document.getElementById("clock-btn"),
    weekRange: document.getElementById("week-range"),
    weekTotal: document.getElementById("week-total"),
    dayList: document.getElementById("day-list"),
    historyList: document.getElementById("history-list"),
    downloadBackup: document.getElementById("download-backup"),
    importBackup: document.getElementById("import-backup"),
    downloadApp: document.getElementById("download-app"),
    installBtn: document.getElementById("install-btn"),
    installHint: document.getElementById("install-hint"),
    dialog: document.getElementById("confirm-dialog"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogText: document.getElementById("dialog-text"),
  };

  let state = loadState();
  let tickTimer = null;
  let deferredInstall = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyState();
      return {
        version: 1,
        activeShift: parsed.activeShift || null,
        weeks: parsed.weeks && typeof parsed.weeks === "object" ? parsed.weeks : {},
      };
    } catch {
      return emptyState();
    }
  }

  function emptyState() {
    return { version: 1, activeShift: null, weeks: {} };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function mondayOf(date) {
    const d = startOfDay(date);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const offset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + offset);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function toDateKey(date) {
    const d = startOfDay(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatShortDate(date) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function formatRange(monday) {
    const sunday = addDays(monday, 6);
    const sameMonth = monday.getMonth() === sunday.getMonth();
    const left = monday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const right = sunday.toLocaleDateString(undefined, {
      month: sameMonth ? undefined : "short",
      day: "numeric",
      year: "numeric",
    });
    return `${left} – ${right}`;
  }

  function formatDuration(ms, withSeconds = false) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (withSeconds) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    if (h === 0) return `0:${String(m).padStart(2, "0")}`;
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  function ensureWeek(weekKey) {
    if (!state.weeks[weekKey]) {
      state.weeks[weekKey] = { days: {} };
    }
    return state.weeks[weekKey];
  }

  function ensureDay(week, dayKey) {
    if (!week.days[dayKey]) week.days[dayKey] = [];
    return week.days[dayKey];
  }

  /** Split a shift across calendar midnights so Mon–Sun day totals stay accurate. */
  function splitShift(clockInIso, clockOutIso) {
    const start = new Date(clockInIso);
    const end = new Date(clockOutIso);
    if (!(end > start)) return [];

    const segments = [];
    let cursor = new Date(start);
    while (cursor < end) {
      const dayStart = startOfDay(cursor);
      const nextMidnight = addDays(dayStart, 1);
      const segEnd = end < nextMidnight ? end : nextMidnight;
      segments.push({
        in: cursor.toISOString(),
        out: segEnd.toISOString(),
        dayKey: toDateKey(cursor),
        weekKey: toDateKey(mondayOf(cursor)),
        ms: segEnd - cursor,
      });
      cursor = segEnd;
    }
    return segments;
  }

  function commitShift(clockInIso, clockOutIso) {
    const segments = splitShift(clockInIso, clockOutIso);
    for (const seg of segments) {
      if (seg.ms <= 0) continue;
      const week = ensureWeek(seg.weekKey);
      const day = ensureDay(week, seg.dayKey);
      day.push({ in: seg.in, out: seg.out });
    }
  }

  function dayTotalMs(week, dayKey, now = new Date()) {
    const entries = week?.days?.[dayKey] || [];
    let total = entries.reduce((sum, e) => sum + (new Date(e.out) - new Date(e.in)), 0);

    if (state.activeShift) {
      const openSegs = splitShift(state.activeShift.clockIn, now.toISOString());
      for (const seg of openSegs) {
        if (seg.dayKey === dayKey) total += seg.ms;
      }
    }
    return total;
  }

  function weekTotalMs(weekKey, now = new Date()) {
    const monday = parseDateKey(weekKey);
    let total = 0;
    for (let i = 0; i < 7; i++) {
      total += dayTotalMs(state.weeks[weekKey], toDateKey(addDays(monday, i)), now);
    }
    return total;
  }

  function currentOpenMs(now = new Date()) {
    if (!state.activeShift) return 0;
    return Math.max(0, now - new Date(state.activeShift.clockIn));
  }

  function render() {
    const now = new Date();
    const monday = mondayOf(now);
    const weekKey = toDateKey(monday);
    ensureWeek(weekKey);

    const clockedIn = Boolean(state.activeShift);
    els.status.dataset.state = clockedIn ? "in" : "out";
    els.status.textContent = clockedIn ? "Clocked in" : "Clocked out";
    els.clockBtn.dataset.mode = clockedIn ? "out" : "in";
    els.clockBtn.textContent = clockedIn ? "Clock Out" : "Clock In";

    const openMs = currentOpenMs(now);
    els.liveTime.textContent = formatDuration(openMs, true);
    if (clockedIn) {
      const started = new Date(state.activeShift.clockIn);
      els.liveHint.textContent = `Started ${started.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })}`;
    } else {
      els.liveHint.textContent = "Ready for the day";
    }

    els.weekRange.textContent = formatRange(monday);
    els.weekTotal.textContent = formatDuration(weekTotalMs(weekKey, now));

    const todayKey = toDateKey(now);
    els.dayList.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const dayDate = addDays(monday, i);
      const dayKey = toDateKey(dayDate);
      const ms = dayTotalMs(state.weeks[weekKey], dayKey, now);
      const li = document.createElement("li");
      li.className = "day-row";
      if (dayKey === todayKey) li.classList.add("is-today");
      if (ms === 0) li.classList.add("is-empty");
      li.innerHTML = `
        <span class="day-name">${DAY_NAMES[i]}</span>
        <span class="day-date">${formatShortDate(dayDate)}</span>
        <span class="day-hours">${ms ? formatDuration(ms) : "—"}</span>
      `;
      els.dayList.appendChild(li);
    }

    renderHistory(weekKey, now);
  }

  function renderHistory(currentWeekKey, now) {
    const keys = Object.keys(state.weeks)
      .filter((k) => k !== currentWeekKey)
      .sort((a, b) => (a < b ? 1 : -1));

    // Drop truly empty past weeks from the view (keep if they have any hours)
    const nonempty = keys.filter((k) => weekTotalMs(k, now) > 0 || Object.keys(state.weeks[k].days || {}).length);

    if (!nonempty.length) {
      els.historyList.innerHTML = `<p class="history-empty">No past weeks yet. Finish this week and next Monday it will land here.</p>`;
      return;
    }

    els.historyList.innerHTML = "";
    for (const weekKey of nonempty) {
      const monday = parseDateKey(weekKey);
      const total = weekTotalMs(weekKey, now);
      const item = document.createElement("article");
      item.className = "history-item";
      item.innerHTML = `
        <button type="button" class="history-summary" aria-expanded="false">
          <strong>${formatRange(monday)}</strong>
          <em>${formatDuration(total)}</em>
          <span class="chev" aria-hidden="true"></span>
        </button>
        <div class="history-details"></div>
      `;
      const details = item.querySelector(".history-details");
      const list = document.createElement("ol");
      list.className = "day-list";
      for (let i = 0; i < 7; i++) {
        const dayDate = addDays(monday, i);
        const dayKey = toDateKey(dayDate);
        const ms = dayTotalMs(state.weeks[weekKey], dayKey, now);
        const li = document.createElement("li");
        li.className = "day-row" + (ms === 0 ? " is-empty" : "");
        li.innerHTML = `
          <span class="day-name">${DAY_NAMES[i]}</span>
          <span class="day-date">${formatShortDate(dayDate)}</span>
          <span class="day-hours">${ms ? formatDuration(ms) : "—"}</span>
        `;
        list.appendChild(li);
      }
      details.appendChild(list);

      item.querySelector(".history-summary").addEventListener("click", () => {
        const open = item.hasAttribute("open");
        item.toggleAttribute("open", !open);
        item.querySelector(".history-summary").setAttribute("aria-expanded", String(!open));
      });

      els.historyList.appendChild(item);
    }
  }

  function clockIn() {
    if (state.activeShift) return;
    state.activeShift = { clockIn: new Date().toISOString() };
    saveState();
    render();
    startTicker();
  }

  function clockOut() {
    if (!state.activeShift) return;
    const clockInIso = state.activeShift.clockIn;
    const clockOutIso = new Date().toISOString();
    commitShift(clockInIso, clockOutIso);
    state.activeShift = null;
    saveState();
    render();
    stopTicker();
  }

  function startTicker() {
    stopTicker();
    tickTimer = setInterval(render, 1000);
  }

  function stopTicker() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "Construction Tracker",
      data: state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(`construction-tracker-backup-${toDateKey(new Date())}.json`, blob);
  }

  async function downloadAppFile() {
    if (document.documentElement.dataset.standalone === "1") {
      alert("You are already using the downloaded app file.");
      return;
    }
    // Bundle a standalone HTML the phone can keep offline.
    const [html, css, js] = await Promise.all([
      fetch("index.html").then((r) => r.text()),
      fetch("styles.css").then((r) => r.text()),
      fetch("app.js").then((r) => r.text()),
    ]);
    const main = html.match(/<main[\s\S]*<\/main>/)?.[0];
    const dialog = html.match(/<dialog[\s\S]*<\/dialog>/)?.[0];
    if (!main || !dialog) throw new Error("Could not assemble standalone file");

    const standalone = `<!DOCTYPE html>
<html lang="en" data-standalone="1">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#1a1c1e" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<title>Construction Tracker</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
${css}
</style>
</head>
<body>
${main}
${dialog}
<script>
${js}
</script>
</body>
</html>`;

    downloadBlob("construction-tracker.html", new Blob([standalone], { type: "text/html" }));
  }

  els.clockBtn.addEventListener("click", () => {
    if (state.activeShift) clockOut();
    else clockIn();
  });

  function importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed.data || parsed;
        if (!data || typeof data !== "object" || !data.weeks) {
          throw new Error("Not a Construction Tracker backup");
        }
        if (!window.confirm("Replace all hours on this phone with the backup?")) return;
        state = {
          version: 1,
          activeShift: data.activeShift || null,
          weeks: data.weeks || {},
        };
        saveState();
        if (state.activeShift) startTicker();
        else stopTicker();
        render();
      } catch (err) {
        console.error(err);
        alert("Could not import that file. Use a backup JSON from this app.");
      }
    };
    reader.readAsText(file);
  }

  els.downloadBackup.addEventListener("click", downloadBackup);
  els.importBackup.addEventListener("change", () => {
    const file = els.importBackup.files && els.importBackup.files[0];
    els.importBackup.value = "";
    if (file) importBackupFile(file);
  });
  els.downloadApp.addEventListener("click", () => {
    downloadAppFile().catch((err) => {
      console.error(err);
      alert("Could not build the download file. Try again while online.");
    });
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    els.installBtn.hidden = false;
    els.installHint.textContent = "Install puts Construction Tracker on your home screen like a normal app.";
  });

  els.installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    els.installBtn.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // Keep week archive correct if an open shift spans past Sunday night.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });

  render();
  if (state.activeShift) startTicker();
})();
