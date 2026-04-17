import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const DELEGATED_USER = process.env.DELEGATED_USER || "alioune@afdvmarketing.com";
const DEFAULT_TZ = process.env.TIMEZONE || "America/Toronto";
const DEFAULT_RIDE_MINUTES = parseInt(process.env.DEFAULT_RIDE_MINUTES || "60", 10);
const FAMILY_CODE = (process.env.FAMILY_CODE || "").trim();
const MAPS_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
const MAPS_COUNTRY = (process.env.MAPS_COUNTRY || "ca").trim();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_HOUR || "20", 10);

// ---------- Google Calendar ----------
function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT env var is required");
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`GOOGLE_SERVICE_ACCOUNT must be valid JSON: ${e.message}`); }
}
const CAL_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
async function getCalendarClient() {
  const sa = loadServiceAccount();
  const jwt = new google.auth.JWT({
    email: sa.client_email, key: sa.private_key, scopes: CAL_SCOPES, subject: DELEGATED_USER,
  });
  await jwt.authorize();
  return google.calendar({ version: "v3", auth: jwt });
}

// ---------- App ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "32kb" }));

// ---------- Rate limit (token bucket per IP) ----------
const buckets = new Map();
function rateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || "unknown").trim();
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const rec = buckets.get(ip) || { count: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
  rec.count++;
  buckets.set(ip, rec);
  if (rec.count > RATE_LIMIT) {
    return res.status(429).json({ ok: false, error: "Slow down — try again in a bit." });
  }
  // Basic cleanup
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  }
  next();
}

// ---------- Family code gate ----------
function familyGate(req, res, next) {
  if (!FAMILY_CODE) return next();
  const got = (req.headers["x-family-code"] || req.query.code || "").toString().trim();
  if (got.toLowerCase() !== FAMILY_CODE.toLowerCase()) {
    return res.status(401).json({ ok: false, error: "Wrong family code." });
  }
  next();
}

// ---------- Health + passcode check ----------
app.get("/healthz", (_req, res) => res.json({ ok: true, user: DELEGATED_USER }));

app.post("/api/check-code", rateLimit, (req, res) => {
  const got = (req.body?.code || "").toString().trim();
  if (!FAMILY_CODE) return res.json({ ok: true, gated: false });
  if (got.toLowerCase() === FAMILY_CODE.toLowerCase()) return res.json({ ok: true, gated: true });
  return res.status(401).json({ ok: false, error: "Wrong family code." });
});

app.get("/api/has-gate", (_req, res) => res.json({ gated: Boolean(FAMILY_CODE) }));

// ---------- Places proxy (server-side key) ----------
async function placesFetch(pathname, query) {
  const url = new URL(`https://maps.googleapis.com${pathname}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("key", MAPS_KEY);
  const r = await fetch(url.toString());
  return r.json();
}

app.get("/api/places/autocomplete", rateLimit, familyGate, async (req, res) => {
  if (!MAPS_KEY) return res.json({ predictions: [] });
  const input = (req.query.input || "").toString().trim();
  const session = (req.query.session || "").toString().trim() || crypto.randomUUID();
  if (!input) return res.json({ predictions: [], session });
  try {
    const data = await placesFetch("/maps/api/place/autocomplete/json", {
      input,
      sessiontoken: session,
      components: `country:${MAPS_COUNTRY}`,
      types: "geocode|establishment",
    });
    const predictions = (data.predictions || []).slice(0, 5).map((p) => ({
      placeId: p.place_id,
      main: p.structured_formatting?.main_text || p.description,
      secondary: p.structured_formatting?.secondary_text || "",
      description: p.description,
    }));
    res.json({ predictions, session });
  } catch (err) {
    console.error("[places/autocomplete]", err?.message || err);
    res.status(502).json({ predictions: [], error: "Places lookup failed." });
  }
});

app.get("/api/places/details", rateLimit, familyGate, async (req, res) => {
  if (!MAPS_KEY) return res.json({ formattedAddress: "" });
  const placeId = (req.query.placeId || "").toString().trim();
  const session = (req.query.session || "").toString().trim();
  if (!placeId) return res.status(400).json({ error: "placeId required" });
  try {
    const data = await placesFetch("/maps/api/place/details/json", {
      place_id: placeId,
      sessiontoken: session,
      fields: "formatted_address,name",
    });
    const r = data.result || {};
    res.json({ formattedAddress: r.formatted_address || r.name || "" });
  } catch (err) {
    console.error("[places/details]", err?.message || err);
    res.status(502).json({ formattedAddress: "", error: "Details lookup failed." });
  }
});

// ---------- Booking ----------
app.post("/api/book", rateLimit, familyGate, async (req, res) => {
  const { whenISO, startAddress, endAddress, notes, passengerName } = req.body || {};

  if (!whenISO || !startAddress || !endAddress) {
    return res.status(400).json({
      ok: false, error: "I need a time, a pickup, and a drop-off.",
    });
  }
  const start = new Date(whenISO);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ ok: false, error: "That date/time isn't right." });
  }
  // Sanity bounds: not in the past, not more than a year out
  const now = Date.now();
  if (start.getTime() < now - 5 * 60_000) {
    return res.status(400).json({ ok: false, error: "That's in the past — pick a future time." });
  }
  if (start.getTime() > now + 365 * 24 * 3600_000) {
    return res.status(400).json({ ok: false, error: "Too far in the future." });
  }

  const end = new Date(start.getTime() + DEFAULT_RIDE_MINUTES * 60_000);
  const safeName = (passengerName || "").toString().trim().slice(0, 80);
  const summary = safeName ? `Uncle duty — ${safeName}` : "Uncle duty — ride";
  const safeStart = startAddress.toString().trim().slice(0, 240);
  const safeEnd = endAddress.toString().trim().slice(0, 240);
  const safeNotes = notes ? notes.toString().trim().slice(0, 600) : "";

  const description = [
    `Riding: ${safeName || "—"}`,
    `Grab at: ${safeStart}`,
    `Drop at: ${safeEnd}`,
    safeNotes ? `Note: ${safeNotes}` : null,
    "",
    "— Sent via Uncle Miki (miki.lemikinos.me)",
  ].filter(Boolean).join("\n");

  try {
    const cal = await getCalendarClient();
    const { data } = await cal.events.insert({
      calendarId: "primary",
      requestBody: {
        summary, description,
        location: `${safeStart} → ${safeEnd}`,
        start: { dateTime: start.toISOString(), timeZone: DEFAULT_TZ },
        end: { dateTime: end.toISOString(), timeZone: DEFAULT_TZ },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 30 },
            { method: "popup", minutes: 10 },
          ],
        },
      },
    });
    return res.json({
      ok: true, eventId: data.id,
      startISO: data.start?.dateTime, endISO: data.end?.dateTime,
    });
  } catch (err) {
    console.error("[book] calendar insert failed:", err?.message || err);
    return res.status(502).json({ ok: false, error: "Calendar save failed. Try again." });
  }
});

// ---------- Static: no-cache on HTML + SW so clients always see latest ----------
app.use((req, res, next) => {
  const p = req.path;
  if (p === "/" || p.endsWith(".html") || p === "/sw.js" || p === "/manifest.webmanifest") {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  next();
});
app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: "5m" }));

app.listen(PORT, () => {
  console.log(`[miki] listening on :${PORT} for ${DELEGATED_USER}  gate=${Boolean(FAMILY_CODE)}`);
});
