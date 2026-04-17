(() => {
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);

  // ---------- Elements ----------
  const form = $("booking");
  const submitBtn = $("submitBtn");
  const errorEl = $("formError");
  const summaryEl = $("summary");

  const startInput = $("startAddress");
  const endInput = $("endAddress");
  const swapBtn = $("swapBtn");
  const useLocBtn = $("useLocation");
  const recentChipsEl = $("recentChips");

  const timeChipsEl = $("timeChips");
  const whenInput = $("whenLocal");
  const whenHint = $("whenHint");

  const passengerInput = $("passengerName");
  const notesInput = $("notes");

  const successEl = $("success");
  const successSub = $("successSub");
  const copyBtn = $("copyBtn");
  const againBtn = $("againBtn");
  const successTitle = qs(".success-title", successEl);

  const toastEl = $("toast");

  // ---------- State ----------
  const LS_RECENT = "unclemiki.recentAddresses";
  let placesSession = "";
  let selectedTimeMode = null; // "now" | "offset30" | "offset60" | "tonight" | "tomorrow" | "custom"

  // ---------- Boot ----------
  init();
  cleanupLegacy();

  function init() {
    renderRecent();
    attachPlaces("startAddress");
    attachPlaces("endAddress");
    wireTimeChips();
    wireUseLocation();
    wireSwap();
    wireChangeListeners();
    form.addEventListener("submit", submit);
    againBtn.addEventListener("click", resetForm);
    copyBtn.addEventListener("click", copySummary);

    // Default to +30 min preset
    selectTime("offset30");
    setTimeout(() => startInput.focus({ preventScroll: true }), 80);
  }

  function cleanupLegacy() {
    try { localStorage.removeItem("unclemiki.familyCode"); } catch {}
  }

  // ---------- Helpers ----------
  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function cryptoRandom() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function clearError() { errorEl.hidden = true; errorEl.textContent = ""; }
  function toast(msg, ms = 1800) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // ---------- Time chips ----------
  function wireTimeChips() {
    timeChipsEl.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.offset != null) selectTime("offset" + btn.dataset.offset);
        else if (btn.dataset.preset) selectTime(btn.dataset.preset);
      });
    });
    whenInput.addEventListener("input", () => {
      if (selectedTimeMode !== "custom") selectTime("custom", /*keepValue*/ true);
      refreshSummary();
    });
  }

  function selectTime(mode, keepValue = false) {
    selectedTimeMode = mode;
    timeChipsEl.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-checked", "false"));
    let chip = null;
    let d = null;

    if (mode.startsWith("offset")) {
      const mins = parseInt(mode.slice(6), 10);
      chip = timeChipsEl.querySelector(`[data-offset="${mins}"]`);
      d = new Date(Date.now() + mins * 60_000);
      d.setSeconds(0, 0);
      whenInput.hidden = true;
    } else if (mode === "tonight") {
      chip = timeChipsEl.querySelector(`[data-preset="tonight"]`);
      d = new Date();
      d.setHours(19, 0, 0, 0);
      if (d.getTime() < Date.now() + 15 * 60_000) d.setDate(d.getDate() + 1);
      whenInput.hidden = true;
    } else if (mode === "tomorrow") {
      chip = timeChipsEl.querySelector(`[data-preset="tomorrow"]`);
      d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
      whenInput.hidden = true;
    } else if (mode === "custom") {
      chip = timeChipsEl.querySelector(`[data-preset="custom"]`);
      whenInput.hidden = false;
      if (!keepValue || !whenInput.value) {
        const seed = new Date(Date.now() + 60 * 60_000);
        seed.setMinutes(Math.ceil(seed.getMinutes() / 15) * 15, 0, 0);
        whenInput.value = toLocalInput(seed);
      }
      whenInput.min = toLocalInput(new Date());
      d = new Date(whenInput.value);
      setTimeout(() => whenInput.focus(), 60);
    }

    if (chip) chip.setAttribute("aria-checked", "true");
    if (d && !Number.isNaN(d?.getTime())) {
      if (mode !== "custom") whenInput.value = toLocalInput(d);
    }
    refreshWhenHint();
    refreshSummary();
  }

  function currentDate() {
    if (!whenInput.value) return null;
    const d = new Date(whenInput.value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function refreshWhenHint() {
    const d = currentDate();
    if (!d) { whenHint.textContent = ""; return; }
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    whenHint.textContent = `I'll roll up ${fmt.format(d)}.`;
  }

  // ---------- Summary preview ----------
  function refreshSummary() {
    const d = currentDate();
    const from = startInput.value.trim();
    const to = endInput.value.trim();
    if (!d || !from || !to) { summaryEl.textContent = ""; return; }
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    summaryEl.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = fmt.format(d);
    summaryEl.append(strong, document.createTextNode(` · ${from} → ${to}`));
  }

  // ---------- Recent addresses ----------
  function loadRecent() {
    try { return JSON.parse(localStorage.getItem(LS_RECENT) || "[]"); } catch { return []; }
  }
  function saveRecent(addr) {
    if (!addr) return;
    const cur = loadRecent().filter((a) => a.toLowerCase() !== addr.toLowerCase());
    cur.unshift(addr);
    try { localStorage.setItem(LS_RECENT, JSON.stringify(cur.slice(0, 5))); } catch {}
    renderRecent();
  }
  function renderRecent() {
    const items = loadRecent();
    if (!items.length) { recentChipsEl.hidden = true; recentChipsEl.innerHTML = ""; return; }
    recentChipsEl.innerHTML = "";
    items.forEach((addr) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip chip-recent";
      b.title = addr;
      b.textContent = short(addr);
      b.addEventListener("click", () => {
        const target = document.activeElement === endInput ? endInput : startInput;
        target.value = addr;
        target.removeAttribute("aria-invalid");
        refreshSummary();
        target.focus();
      });
      recentChipsEl.appendChild(b);
    });
    recentChipsEl.hidden = false;
  }
  function short(s) {
    const parts = s.split(",");
    return (parts[0] + (parts[1] ? "," + parts[1] : "")).trim().slice(0, 40);
  }

  // ---------- Places autocomplete (server proxy) ----------
  function attachPlaces(inputId) {
    const input = $(inputId);
    const list = $(`${inputId}-suggestions`);
    let items = [];
    let activeIdx = -1;
    let lastQuery = "";

    const render = () => {
      list.innerHTML = "";
      if (!items.length) { list.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
      items.forEach((p, i) => {
        const li = document.createElement("li");
        li.className = "ac-item" + (i === activeIdx ? " is-active" : "");
        li.setAttribute("role", "option");
        li.innerHTML = `<span class="ac-main"></span><span class="ac-sec"></span>`;
        li.querySelector(".ac-main").textContent = p.main;
        li.querySelector(".ac-sec").textContent = p.secondary;
        li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    };

    const pick = async (i) => {
      const p = items[i];
      if (!p) return;
      input.value = p.description || p.main;
      items = []; activeIdx = -1; render();
      refreshSummary();
      try {
        const qsp = new URLSearchParams({ placeId: p.placeId });
        if (placesSession) qsp.set("session", placesSession);
        const r = await fetch(`/api/places/details?${qsp}`);
        const j = await r.json();
        if (j.formattedAddress) input.value = j.formattedAddress;
        placesSession = "";
        refreshSummary();
      } catch {}
    };

    const query = debounce(async (q) => {
      if (q === lastQuery) return;
      lastQuery = q;
      if (!q || q.length < 3) { items = []; render(); return; }
      try {
        if (!placesSession) placesSession = cryptoRandom();
        const qsp = new URLSearchParams({ input: q, session: placesSession });
        const r = await fetch(`/api/places/autocomplete?${qsp}`);
        if (!r.ok) { items = []; render(); return; }
        const j = await r.json();
        items = j.predictions || [];
        activeIdx = -1; render();
      } catch { items = []; render(); }
    }, 180);

    input.addEventListener("input", () => { refreshSummary(); query(input.value.trim()); });
    input.addEventListener("focus", () => { if (items.length) render(); });
    input.addEventListener("blur", () => { setTimeout(() => { items = []; render(); }, 120); });
    input.addEventListener("keydown", (e) => {
      if (list.hidden || !items.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = (activeIdx + 1) % items.length; render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = (activeIdx - 1 + items.length) % items.length; render(); }
      else if (e.key === "Enter") { e.preventDefault(); if (activeIdx >= 0) pick(activeIdx); else pick(0); }
      else if (e.key === "Escape") { items = []; render(); }
    });
  }

  // ---------- Swap ----------
  function wireSwap() {
    swapBtn.addEventListener("click", () => {
      const a = startInput.value; const b = endInput.value;
      startInput.value = b; endInput.value = a;
      [startInput, endInput].forEach((i) => i.removeAttribute("aria-invalid"));
      refreshSummary();
    });
  }

  // ---------- Use my location ----------
  function wireUseLocation() {
    useLocBtn.addEventListener("click", async () => {
      if (!("geolocation" in navigator)) { toast("Location not available."); return; }
      useLocBtn.classList.add("is-busy");
      try {
        const pos = await new Promise((res, rej) => {
          navigator.geolocation.getCurrentPosition(res, rej, {
            enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000,
          });
        });
        const { latitude, longitude } = pos.coords;
        const qsp = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
        const r = await fetch(`/api/places/reverse?${qsp}`);
        const j = await r.json();
        if (j.formattedAddress) {
          startInput.value = j.formattedAddress;
          startInput.removeAttribute("aria-invalid");
          refreshSummary();
          toast("Pickup set.");
        } else {
          toast("Couldn't read that spot.");
        }
      } catch (err) {
        console.warn(err);
        if (err?.code === 1) toast("Allow location to auto-fill.");
        else toast("Location lookup failed.");
      } finally {
        useLocBtn.classList.remove("is-busy");
      }
    });
  }

  // ---------- Live listeners ----------
  function wireChangeListeners() {
    [startInput, endInput].forEach((el) => {
      el.addEventListener("blur", () => {
        if (!el.value.trim()) el.setAttribute("aria-invalid", "true");
        else el.removeAttribute("aria-invalid");
      });
      el.addEventListener("input", () => {
        if (el.value.trim()) el.removeAttribute("aria-invalid");
        if (!errorEl.hidden) clearError();
      });
    });
  }

  // ---------- Submit ----------
  async function submit(e) {
    e.preventDefault();
    clearError();

    const start = startInput.value.trim();
    const end = endInput.value.trim();
    const when = currentDate();
    const notes = notesInput.value.trim();
    const passengerName = passengerInput.value.trim();

    if (!start || !end) { showError("I need a pickup and a drop-off."); return; }
    if (!when) { showError("Pick a time, then send it."); return; }
    if (when.getTime() < Date.now() - 60_000) {
      showError("That's in the past — pick a future time."); return;
    }

    submitBtn.disabled = true;
    const labelEl = submitBtn.querySelector(".cta-label");
    const originalLabel = labelEl.textContent;
    labelEl.textContent = "Sending…";

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whenISO: when.toISOString(),
          startAddress: start,
          endAddress: end,
          notes, passengerName,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        showError(data.error || "Couldn't get that to Uncle. Try again in a second.");
        return;
      }

      saveRecent(start);
      saveRecent(end);
      showSuccess({ when, start, end, passengerName });
    } catch (err) {
      console.error(err);
      showError("Signal hiccup. Check your connection and send it again.");
    } finally {
      submitBtn.disabled = false;
      labelEl.textContent = originalLabel;
    }
  }

  function showSuccess({ when, start, end, passengerName }) {
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    const whenStr = fmt.format(when);
    const whoBit = passengerName ? `${passengerName} — ` : "";
    successSub.textContent = `${whoBit}${whenStr}\n${start} → ${end}`;
    successSub.style.whiteSpace = "pre-line";

    form.hidden = true;
    successEl.hidden = false;
    setTimeout(() => successTitle.focus(), 60);
  }

  async function copySummary() {
    const text = successSub.textContent.replace(/\n/g, " · ");
    try {
      await navigator.clipboard.writeText(`Uncle Miki booked: ${text}`);
      toast("Copied.");
    } catch {
      toast("Couldn't copy.");
    }
  }

  function resetForm() {
    successEl.hidden = true;
    form.hidden = false;
    form.reset();
    placesSession = "";
    [startInput, endInput].forEach((i) => i.removeAttribute("aria-invalid"));
    summaryEl.innerHTML = "";
    selectTime("offset30");
    renderRecent();
    setTimeout(() => startInput.focus({ preventScroll: true }), 60);
  }

  // ---------- SW: unregister legacy, register light cache ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
