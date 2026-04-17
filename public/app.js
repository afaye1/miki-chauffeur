(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- Elements ----------
  const gate = $("gate");
  const gateForm = $("gateForm");
  const gateCode = $("gateCode");
  const gateSubmit = $("gateSubmit");
  const gateError = $("gateError");
  const shell = $("shell");

  const form = $("booking");
  const submitBtn = $("submitBtn");
  const errorEl = $("formError");
  const whenInput = $("whenLocal");
  const whenHint = $("whenHint");
  const successEl = $("success");
  const successSub = $("successSub");
  const againBtn = $("againBtn");

  // ---------- State ----------
  const LS_KEY = "unclemiki.familyCode";
  let familyCode = localStorage.getItem(LS_KEY) || "";
  let placesSession = "";

  // ---------- Gate logic ----------
  async function bootstrap() {
    let gated = false;
    try {
      const r = await fetch("/api/has-gate");
      const j = await r.json();
      gated = Boolean(j.gated);
    } catch { /* assume open */ }

    if (!gated) {
      showShell();
      return;
    }

    if (familyCode) {
      // Validate cached code silently
      const ok = await validateCode(familyCode);
      if (ok) { showShell(); return; }
      familyCode = "";
      localStorage.removeItem(LS_KEY);
    }
    showGate();
  }

  async function validateCode(code) {
    try {
      const r = await fetch("/api/check-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      return r.ok;
    } catch { return false; }
  }

  function showGate() {
    gate.hidden = false;
    shell.hidden = true;
    setTimeout(() => gateCode.focus(), 60);
  }
  function showShell() {
    gate.hidden = true;
    shell.hidden = false;
    initFormLogic();
  }

  gateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = gateCode.value.trim();
    if (!code) return;
    gateSubmit.disabled = true;
    gateError.hidden = true;
    const ok = await validateCode(code);
    gateSubmit.disabled = false;
    if (ok) {
      familyCode = code;
      localStorage.setItem(LS_KEY, code);
      showShell();
    } else {
      gateError.textContent = "That's not the code. Ask Uncle.";
      gateError.hidden = false;
      gateCode.select();
    }
  });

  // ---------- Form logic (runs after gate passes) ----------
  function initFormLogic() {
    // Default when = now + 30 min, rounded to :00/:15/:30/:45
    (function seedWhen() {
      const d = new Date(Date.now() + 30 * 60000);
      d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
      whenInput.value = toLocalInput(d);
      // min = now, so can't pick past
      const nowD = new Date();
      whenInput.min = toLocalInput(nowD);
      refreshWhenHint();
    })();

    whenInput.addEventListener("input", refreshWhenHint);
    whenInput.addEventListener("blur", refreshWhenHint);

    // Blur validation on required fields
    ["whenLocal", "startAddress", "endAddress"].forEach((id) => {
      const el = $(id);
      el.addEventListener("blur", () => {
        if (!el.value.trim()) el.setAttribute("aria-invalid", "true");
        else el.removeAttribute("aria-invalid");
      });
      el.addEventListener("input", () => {
        if (el.value.trim()) el.removeAttribute("aria-invalid");
        if (!errorEl.hidden) { errorEl.hidden = true; errorEl.textContent = ""; }
      });
    });

    // Wire address autocompletes
    attachPlaces("startAddress");
    attachPlaces("endAddress");

    form.addEventListener("submit", submit);
    againBtn.addEventListener("click", resetForm);
  }

  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function refreshWhenHint() {
    const fallback = "Pick a day and time.";
    if (!whenInput.value) { whenHint.textContent = fallback; return; }
    const d = new Date(whenInput.value);
    if (Number.isNaN(d.getTime())) { whenHint.textContent = fallback; return; }
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    whenHint.textContent = `I'll come by ${fmt.format(d)}.`;
  }

  // ---------- Custom Places Autocomplete (server-proxied) ----------
  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

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
        li.dataset.idx = i;
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
      // Optimistic: show the main line instantly, refine with details
      input.value = p.description || p.main;
      items = [];
      activeIdx = -1;
      render();
      try {
        const qs = new URLSearchParams({ placeId: p.placeId });
        if (placesSession) qs.set("session", placesSession);
        const r = await fetch(`/api/places/details?${qs}`, {
          headers: withAuthHeaders(),
        });
        const j = await r.json();
        if (j.formattedAddress) input.value = j.formattedAddress;
        placesSession = ""; // End the session on pick
      } catch { /* keep optimistic value */ }
    };

    const query = debounce(async (q) => {
      if (q === lastQuery) return;
      lastQuery = q;
      if (!q || q.length < 3) { items = []; render(); return; }
      try {
        if (!placesSession) placesSession = cryptoRandom();
        const qs = new URLSearchParams({ input: q, session: placesSession });
        const r = await fetch(`/api/places/autocomplete?${qs}`, {
          headers: withAuthHeaders(),
        });
        if (!r.ok) { items = []; render(); return; }
        const j = await r.json();
        items = j.predictions || [];
        activeIdx = -1;
        render();
      } catch { items = []; render(); }
    }, 180);

    input.addEventListener("input", () => query(input.value.trim()));
    input.addEventListener("focus", () => { if (items.length) render(); });
    input.addEventListener("blur", () => {
      // Delay so click on item still fires
      setTimeout(() => { items = []; render(); }, 120);
    });
    input.addEventListener("keydown", (e) => {
      if (list.hidden || !items.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = (activeIdx + 1) % items.length; render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = (activeIdx - 1 + items.length) % items.length; render(); }
      else if (e.key === "Enter") { e.preventDefault(); if (activeIdx >= 0) pick(activeIdx); else pick(0); }
      else if (e.key === "Escape") { items = []; render(); }
    });
  }

  function cryptoRandom() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function withAuthHeaders() {
    return familyCode ? { "x-family-code": familyCode } : {};
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  // ---------- Submit ----------
  async function submit(e) {
    e.preventDefault();

    const whenLocal = whenInput.value.trim();
    const startAddress = $("startAddress").value.trim();
    const endAddress = $("endAddress").value.trim();
    const notes = $("notes").value.trim();
    const passengerName = $("passengerName").value.trim();

    if (!whenLocal || !startAddress || !endAddress) {
      showError("I need a time, a pickup, and a drop-off.");
      return;
    }
    const whenDate = new Date(whenLocal);
    if (Number.isNaN(whenDate.getTime())) {
      showError("That date/time isn't right.");
      return;
    }
    if (whenDate.getTime() < Date.now() - 5 * 60000) {
      showError("That's in the past — pick a future time.");
      return;
    }

    submitBtn.disabled = true;
    const labelEl = submitBtn.querySelector(".cta-label");
    const originalLabel = labelEl.textContent;
    labelEl.textContent = "Sending…";

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withAuthHeaders() },
        body: JSON.stringify({
          whenISO: whenDate.toISOString(),
          startAddress, endAddress, notes, passengerName,
        }),
      });
      const data = await res.json();

      if (res.status === 401) {
        // Code expired/invalidated
        familyCode = "";
        localStorage.removeItem(LS_KEY);
        showError("Family code stopped working — refresh and re-enter.");
        return;
      }
      if (!res.ok || !data.ok) {
        showError(data.error || "Couldn't get that to Uncle. Try again in a second.");
        return;
      }

      form.hidden = true;
      successEl.hidden = false;
      const fmt = new Intl.DateTimeFormat(undefined, {
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit",
      });
      successSub.textContent = `I'll be there ${fmt.format(whenDate)} — ${startAddress} → ${endAddress}.`;
    } catch (err) {
      console.error(err);
      showError("Signal hiccup. Check your connection and send it again.");
    } finally {
      submitBtn.disabled = false;
      labelEl.textContent = originalLabel;
    }
  }

  function resetForm() {
    successEl.hidden = true;
    form.hidden = false;
    form.reset();
    const d = new Date(Date.now() + 30 * 60000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    whenInput.value = toLocalInput(d);
    whenInput.min = toLocalInput(new Date());
    refreshWhenHint();
    placesSession = "";
    setTimeout(() => $("startAddress").focus(), 60);
  }

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  // Kick it off
  bootstrap();
})();
