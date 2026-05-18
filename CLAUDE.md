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
- **Backend**: serverless functies in `api/` (Vercel)
  - `api/growatt.js` — Growatt OpenAPI plant data
  - `api/solaredge.js` — SolarEdge Monitoring API (overview/power/energy)
  - `api/homey.js` — Homey cloud webhook proxy + connectivity check
  - `api/planLaden.js` — plant laad-actie via QStash (publishJSON met delay)
  - `api/cronLaden.js` — wordt door QStash aangeroepen om Homey-webhook te triggeren
- **State**: laadplanningen in Upstash Redis (sleutel `laadplanning_<userId>_<apparaat>`, bv. `laadplanning_001_autophev`)

## Multi-user (sinds v2.54.0)
Eén Vercel deploy, meerdere gebruikers via `?u=001` URL-parameter.
- **`users/<id>.js`** zet `window.CONFIG` (niet-gevoelige config: tarieven, panelen, apparaten).
  Geldige user-id's hardcoded in `index.html` inline loader; onbekend → fallback naar `001`.
- **Server-side**: alle `/api/*` endpoints lezen `?u=<id>` (of body), valideren tegen
  `GELDIGE_USERS = ['001', '002']`, en lezen env vars met userId-suffix
  (`process.env[`SOLAREDGE_API_KEY_${userId}`]`). Geen mapping-tabel — userId IS de suffix.
- **Frontend fetch helper**: `apiUrl(path)` in `js/config.js` hangt `?u=<id>` aan elke `/api/*` call.
- **QStash → cronLaden**: body bevat ook `userId` zodat cronLaden de juiste Homey cloud-id pakt
  bij de scheduled webhook (na signature-verificatie).
- **Toevoegen nieuwe user**: maak `users/<nieuw-id>.js`, update `GELDIGE_USERS` array in
  zowel `index.html` als alle 5 API endpoints, vul per-user env vars in Vercel.
  Geen auth; URL-id's zijn raadbaar (volgt #19 in backlog).

## Externe APIs
- **EnergyZero** (`api.energyzero.nl/v1/energyprices`) — EPEX day-ahead prijzen, excl. btw
- **Open-Meteo** — weersverwachting voor zonne-opbrengst voorspelling (LAT/LON in `js/config.js`)
- **Growatt OpenAPI** — plant power voor 14 panelen op huis
- **SolarEdge Monitoring API** — 8 panelen op garage/kantoor (overview, power per uur, energy per dag)
- **Homey** (`<cloud-id>.connect.athom.com`) — slimme stekker bediening via webhooks
- **Upstash Redis + QStash** — persistente laadplanning en scheduled triggers

## Environment variables (Vercel)
Alle in Settings → Environment Variables van het Vercel-project:

**Globaal (gedeeld over users):**

| Variable                      | Waarde / omschrijving                                    |
|-------------------------------|----------------------------------------------------------|
| `APP_URL`                     | Volledige basis-URL voor self-callbacks vanuit QStash    |
| `QSTASH_TOKEN`                | Upstash QStash publish token                             |
| `QSTASH_CURRENT_SIGNING_KEY`  | Huidige QStash signing key (signature verificatie cronLaden) |
| `QSTASH_NEXT_SIGNING_KEY`     | Volgende QStash signing key (key rotation)               |
| `UPSTASH_REDIS_REST_URL`      | Upstash Redis REST endpoint                              |
| `UPSTASH_REDIS_REST_TOKEN`    | Upstash Redis REST token                                 |

**Per gebruiker (suffix = userId, bv. `_001`, `_002`):**

| Variable suffix               | Omschrijving                                             |
|-------------------------------|----------------------------------------------------------|
| `GROWATT_API_TOKEN_<NNN>`     | Growatt OpenAPI token per user                           |
| `SOLAREDGE_API_KEY_<NNN>`     | SolarEdge Monitoring API key per user                    |
| `SOLAREDGE_SITE_ID_<NNN>`     | SolarEdge site ID per user                               |
| `HOMEY_CLOUD_ID_<NNN>`        | Homey cloud-id per user                                  |
| `APP_PINCODE_<NNN>`           | Pincode voor `/api/homey` POST + `/api/planLaden` POST   |

### Vercel env vars setup (overgang naar genummerde suffixen)

Hernoemen (nieuwe maken met waarde van oude → Vercel redeploy → oude verwijderen):
- `GROWATT_API_TOKEN` → `GROWATT_API_TOKEN_001`
- `SOLAREDGE_API_KEY` → `SOLAREDGE_API_KEY_001`
- `SOLAREDGE_SITE_ID` → `SOLAREDGE_SITE_ID_001`
- `HOMEY_CLOUD_ID` → `HOMEY_CLOUD_ID_001`
- `APP_PINCODE` → `APP_PINCODE_001`

Nieuw toevoegen (leeg laten tot user 002 echte keys heeft):
- `GROWATT_API_TOKEN_002`, `SOLAREDGE_API_KEY_002`, `SOLAREDGE_SITE_ID_002`,
  `HOMEY_CLOUD_ID_002`, `APP_PINCODE_002`

Vercel heeft geen rename-knop; maak de nieuwe `_001` aan, trigger redeploy,
verwijder daarna de oude variabele zonder suffix.

Client-side constanten staan per-user in `users/<id>.js` (zet `window.CONFIG`):
- `tarieven.opslag` / `eb` / `btw` / `vasteKostenPerDag` / `teruglevering`
- `panelen.lat` / `lon` — locatie voor Open-Meteo
- `panelen.solarEdge.piekKw` + `growatt.piekKw` — piekvermogens panelen
- `apparaten` — lijst met vermogen, draaiuren, automatisering-vlag etc.

`js/config.js` is een thin compat-laag die `window.CONFIG.*` exposeert als
oude constants (`OPSLAG`, `EB`, `LAT`, `APPARATEN`, …) zodat bestaande code
ongewijzigd werkt. Pas waarden aan in het juiste `users/<id>.js` bestand.

## Tarieven (Sepa Green, excl. btw) — referentie voor 001
Bron: laatste tariefblad. Aanpassen in `users/001.js` en de Tarieven-sectie van `index.html`.

| Tarief                        | Waarde            | Constante in code        |
|-------------------------------|-------------------|--------------------------|
| Inkoopvergoeding              | € 0,03073 / kWh   | `OPSLAG`                 |
| Energiebelasting              | € 0,09161 / kWh   | `EB`                     |
| BTW                           | 21 %              | `BTW = 1.21`             |
| Vaste kosten (lev. + netbeh.) | € 1,35 / dag      | `VASTE_KOSTEN_PER_DAG`   |
| Afslag bij teruglevering      | € 0,03530 / kWh   | `TERUGLEVERING_OPSLAG`   |

Prijsformule (`js/prijzen.js`): `(epex + OPSLAG + EB) × BTW`
Teruglevering (`js/config.js`): `(epex − TERUGLEVERING_OPSLAG) × BTW`
