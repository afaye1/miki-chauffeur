import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const DELEGATED_USER = process.env.DELEGATED_USER || "alioune@afdvmarketing.com";
const DEFAULT_TZ = process.env.TIMEZONE || "America/Toronto";
const DEFAULT_RIDE_MINUTES = parseInt(process.env.DEFAULT_RIDE_MINUTES || "60", 10);

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT env var is required");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT must be valid JSON: ${e.message}`);
  }
}

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

async function getCalendarClient() {
  const sa = loadServiceAccount();
  const jwt = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: SCOPES,
    subject: DELEGATED_USER,
  });
  await jwt.authorize();
  return google.calendar({ version: "v3", auth: jwt });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, user: DELEGATED_USER }));

app.get("/api/config", (_req, res) => {
  res.json({
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || "",
    country: process.env.MAPS_COUNTRY || "ca",
  });
});

app.post("/api/book", async (req, res) => {
  const { whenISO, startAddress, endAddress, notes, passengerName } = req.body || {};

  if (!whenISO || !startAddress || !endAddress) {
    return res.status(400).json({
      ok: false,
      error: "whenISO, startAddress and endAddress are required.",
    });
  }

  const start = new Date(whenISO);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ ok: false, error: "whenISO is not a valid date." });
  }
  const end = new Date(start.getTime() + DEFAULT_RIDE_MINUTES * 60_000);

  const safeName = (passengerName || "").toString().trim().slice(0, 80);
  const summary = safeName ? `Uncle duty — ${safeName}` : "Uncle duty — ride";

  const description = [
    `Riding: ${safeName || "—"}`,
    `Grab at: ${startAddress}`,
    `Drop at: ${endAddress}`,
    notes ? `Note: ${notes}` : null,
    "",
    "— Sent via Uncle Miki (miki.lemikinos.me)",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const cal = await getCalendarClient();
    const { data } = await cal.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description,
        location: `${startAddress} → ${endAddress}`,
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
      ok: true,
      eventId: data.id,
      htmlLink: data.htmlLink,
      startISO: data.start?.dateTime,
      endISO: data.end?.dateTime,
    });
  } catch (err) {
    console.error("[book] calendar insert failed:", err?.message || err);
    return res
      .status(502)
      .json({ ok: false, error: "Calendar insert failed. Please try again." });
  }
});

app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: "1h" }));

app.listen(PORT, () => {
  console.log(`[miki] listening on :${PORT} for ${DELEGATED_USER}`);
});
