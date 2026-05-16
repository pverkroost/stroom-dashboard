# Energie IQ - Claude Instructies

## Project
Energie IQ is een persoonlijk dashboard voor een dynamisch stroomcontract (Sepa Green). De app combineert EPEX day-ahead prijzen met zonne-opbrengst (SolarEdge + Growatt) en weersverwachting, en stuurt slimme stekkers via Homey aan voor automatisch laden op het goedkoopste moment.

Het hoofdbestand is `index.html`. De legacy `stroom-dashboard.html` is verwijderd.

## Versienummering
Bij elke aanpassing aan `index.html` of de bijbehorende `js/`/`css/` bestanden:
- Hoog het versienummer automatisch op (vX.Y.0 → vX.Y+1.0 voor kleine features, vX.Y.0 → vX.Y.1 voor bugfixes/kleine wijzigingen)
- Update zowel de placeholder in de footer (`<span id="versionStamp">`) als de `?v=…` cache-bust querystrings op de `<script src>` regels
- `js/app.js` overschrijft de footer runtime met versie + huidige Nederlandse datum/tijd (Europe/Amsterdam) — format: `vX.Y.Z · DD-MM-YYYY HH:mm`

## Deployment
Na elke aanpassing altijd automatisch pushen naar GitHub met een duidelijke commit message die beschrijft wat er gewijzigd is. Vercel deployt automatisch vanuit `main`.

## Architectuur
- **Frontend**: vanilla JS + Chart.js, geserveerd vanuit de repo-root (`index.html`, `css/`, `js/`)
- **Backend**: serverless functies in `api/` (Vercel) en `netlify/functions/` (Netlify, alleen solar)
  - `api/growatt.js` — Growatt OpenAPI plant data
  - `api/solaredge.js` — SolarEdge Monitoring API (overview/power/energy)
  - `api/homey.js` — Homey cloud webhook proxy + connectivity check
  - `api/planLaden.js` — plant laad-actie via QStash (publishJSON met delay)
  - `api/cronLaden.js` — wordt door QStash aangeroepen om Homey-webhook te triggeren
- **State**: laadplanningen in Upstash Redis (sleutel `laadplanning_<apparaat>`)

## Externe APIs
- **EnergyZero** (`api.energyzero.nl/v1/energyprices`) — EPEX day-ahead prijzen, excl. btw
- **Open-Meteo** — weersverwachting voor zonne-opbrengst voorspelling (LAT/LON in `js/config.js`)
- **Growatt OpenAPI** — plant power voor 14 panelen op huis
- **SolarEdge Monitoring API** — 8 panelen op garage/kantoor (overview, power per uur, energy per dag)
- **Homey** (`<cloud-id>.connect.athom.com`) — slimme stekker bediening via webhooks
- **Upstash Redis + QStash** — persistente laadplanning en scheduled triggers

## Environment variables (Vercel)
Alle in Settings → Environment Variables van het Vercel-project:

| Variable                      | Waarde / omschrijving                                    |
|-------------------------------|----------------------------------------------------------|
| `GROWATT_API_TOKEN`           | Growatt OpenAPI token                                    |
| `GROWATT_DEVICE_SN`           | Inverter device serial (alleen ingesteld, nog niet gebruikt in `api/growatt.js`) |
| `GROWATT_PLANT_ID`            | Growatt plant ID (alleen `netlify/functions/growatt.js`) |
| `GROWATT_USERNAME`            | Growatt account e-mail (legacy ShinePhone API, ongebruikt) |
| `GROWATT_PASSWORD`            | Growatt account wachtwoord (legacy ShinePhone API, ongebruikt) |
| `SOLAREDGE_API_KEY`           | SolarEdge Monitoring API key                             |
| `SOLAREDGE_SITE_ID`           | SolarEdge site ID                                        |
| `HOMEY_CLOUD_ID`              | Homey cloud-id voor `<cloud-id>.connect.athom.com`       |
| `APP_PINCODE`                 | Pincode voor authenticatie op `/api/homey` POST          |
| `APP_URL`                     | Volledige basis-URL voor self-callbacks vanuit QStash    |
| `QSTASH_TOKEN`                | Upstash QStash publish token                             |
| `UPSTASH_REDIS_REST_URL`      | Upstash Redis REST endpoint                              |
| `UPSTASH_REDIS_REST_TOKEN`    | Upstash Redis REST token                                 |

Client-side constanten staan in `js/config.js` (niet als env var):
- `LAT` / `LON` — locatie voor Open-Meteo
- `GROWATT_PEAK_KW` / `SOLAREDGE_PEAK_KW` — piekvermogens panelen
- `APPARATEN` — lijst van apparaten (auto, wasmachine, etc.) met vermogen en draaiuren

## Tarieven (Sepa Green, excl. btw)
Bron: laatste tariefblad. Aanpassen in zowel `js/config.js` als de Tarieven-sectie van `index.html`.

| Tarief                        | Waarde            | Constante in code        |
|-------------------------------|-------------------|--------------------------|
| Inkoopvergoeding              | € 0,03073 / kWh   | `OPSLAG`                 |
| Energiebelasting              | € 0,09161 / kWh   | `EB`                     |
| BTW                           | 21 %              | `BTW = 1.21`             |
| Vaste kosten (lev. + netbeh.) | € 1,35 / dag      | `VASTE_KOSTEN_PER_DAG`   |
| Afslag bij teruglevering      | € 0,03530 / kWh   | `TERUGLEVERING_OPSLAG`   |

Prijsformule (`js/prijzen.js`): `(epex + OPSLAG + EB) × BTW`
Teruglevering (`js/config.js`): `(epex − TERUGLEVERING_OPSLAG) × BTW`
