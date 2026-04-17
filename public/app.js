(() => {
  const form = document.getElementById("booking");
  const submitBtn = document.getElementById("submitBtn");
  const errorEl = document.getElementById("formError");
  const whenInput = document.getElementById("whenLocal");
  const whenHint = document.getElementById("whenHint");
  const successEl = document.getElementById("success");
  const successSub = document.getElementById("successSub");
  const successLink = document.getElementById("successLink");
  const againBtn = document.getElementById("againBtn");

  // Default whenLocal to "now + 30 min" (rounded to :00/:15/:30/:45)
  (function seedDefaultWhen() {
    const d = new Date(Date.now() + 30 * 60000);
    const q = 15;
    d.setMinutes(Math.ceil(d.getMinutes() / q) * q, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    whenInput.value =
      d.getFullYear() + "-" +
      pad(d.getMonth() + 1) + "-" +
      pad(d.getDate()) + "T" +
      pad(d.getHours()) + ":" +
      pad(d.getMinutes());
  })();

  // Live hint: humanized when-string
  function refreshWhenHint() {
    if (!whenInput.value) {
      whenHint.textContent = "Pick any date & time.";
      return;
    }
    const d = new Date(whenInput.value);
    if (Number.isNaN(d.getTime())) {
      whenHint.textContent = "Pick any date & time.";
      return;
    }
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    whenHint.textContent = fmt.format(d);
  }
  whenInput.addEventListener("input", refreshWhenHint);
  whenInput.addEventListener("blur", refreshWhenHint);
  refreshWhenHint();

  // Validation on blur (per UX rules — 22% fewer errors, 42% faster completion)
  const required = ["whenLocal", "startAddress", "endAddress"];
  required.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("blur", () => {
      if (!el.value.trim()) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    });
    el.addEventListener("input", () => {
      if (el.value.trim()) el.removeAttribute("aria-invalid");
      if (!errorEl.hidden) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
    });
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  async function submit(e) {
    e.preventDefault();

    const whenLocal = whenInput.value.trim();
    const startAddress = document.getElementById("startAddress").value.trim();
    const endAddress = document.getElementById("endAddress").value.trim();
    const notes = document.getElementById("notes").value.trim();
    const passengerName = document.getElementById("passengerName").value.trim();

    if (!whenLocal || !startAddress || !endAddress) {
      showError("When, pickup and drop-off are required.");
      return;
    }

    const whenDate = new Date(whenLocal);
    if (Number.isNaN(whenDate.getTime())) {
      showError("That date / time doesn't look right.");
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.querySelector(".cta-label").textContent;
    submitBtn.querySelector(".cta-label").textContent = "Booking…";

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whenISO: whenDate.toISOString(),
          startAddress,
          endAddress,
          notes,
          passengerName,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        showError(data.error || "Couldn't save the booking. Try again in a second.");
        return;
      }

      // Success UI
      form.hidden = true;
      successEl.hidden = false;
      const fmt = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      successSub.textContent = `${fmt.format(whenDate)} · ${startAddress} → ${endAddress}`;
      if (data.htmlLink) successLink.href = data.htmlLink;
      else successLink.hidden = true;
    } catch (err) {
      console.error(err);
      showError("Network hiccup. Check connection and retry.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector(".cta-label").textContent = originalLabel;
    }
  }

  form.addEventListener("submit", submit);

  againBtn.addEventListener("click", () => {
    successEl.hidden = true;
    form.hidden = false;
    form.reset();
    (function reseed() {
      const d = new Date(Date.now() + 30 * 60000);
      const q = 15;
      d.setMinutes(Math.ceil(d.getMinutes() / q) * q, 0, 0);
      const pad = (n) => String(n).padStart(2, "0");
      whenInput.value =
        d.getFullYear() + "-" +
        pad(d.getMonth() + 1) + "-" +
        pad(d.getDate()) + "T" +
        pad(d.getHours()) + ":" +
        pad(d.getMinutes());
      refreshWhenHint();
    })();
  });

  // Register service worker (progressive enhancement)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* offline-only feature */ });
    });
  }
})();
