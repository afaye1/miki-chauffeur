# Miki Chauffeuring

A tiny, single-page PWA for booking personal chauffeur rides that lands the event
directly on `alioune@afdvmarketing.com`'s Google Calendar.

## Fields captured
- Passenger name (optional)
- When (datetime-local)
- Pickup address
- Drop-off address
- Notes (optional)

## Env
- `GOOGLE_SERVICE_ACCOUNT` — full JSON of a GCP service account with domain-wide delegation
- `DELEGATED_USER` — user to impersonate (default `alioune@afdvmarketing.com`)
- `TIMEZONE` — IANA zone for event times (default `America/Toronto`)
- `DEFAULT_RIDE_MINUTES` — event duration (default `60`)
- `PORT` — default `3000`

## Local run
```
npm install
GOOGLE_SERVICE_ACCOUNT="$(cat service_account.json)" \
DELEGATED_USER=alioune@afdvmarketing.com \
npm start
```
