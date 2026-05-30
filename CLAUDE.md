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
  - `api/homeconnect.js` — Home Connect (BSH) OAuth2 auth-redirect + appliance status/start/stop (pincode)
  - `api/homeconnect/callback.js` — OAuth2 redirect-target: code → tokens in Redis (state-CSRF-verified)
  - `api/planLaden.js` — plant laad-actie via QStash (publishJSON met delay)
  - `api/cronLaden.js` — wordt door QStash aangeroepen om Homey-webhook te triggeren
  - `api/login.js` / `api/logout.js` / `api/me.js` — auth (bcrypt + HMAC sessie-cookie)
  - `api/db/migrate.js` — maakt `app_user`-tabel in Neon (idempotent)
- **Auth-libs** (root `lib/`, gedeeld door api): `lib/session.js` (HMAC encode/decode + `eq_session`-cookie),
  `lib/auth.js` (`getSession`/`requireSession` uit request-cookie).
- **State**: laadplanningen in Upstash Redis (sleutel `laadplanning_<userId>_<apparaat>`, bv. `laadplanning_001_autophev`).
  Home Connect-tokens in `homeconnect_tokens_<userId>`, OAuth state-nonces in `homeconnect_state_<state>`.
  Gebruikers (email + bcrypt-hash + userId) in Neon PostgreSQL tabel `app_user`.

## Auth (sinds v2.72.0)
Echte login met e-mail + wachtwoord i.p.v. de rauwe `?u=`-parameter. Stateless:
na login zet `/api/login` een HMAC-ondertekende `HttpOnly` cookie `eq_session`
(30 dagen) met `{ uid, email, userId }`. `getValidUserId` (in `api/_helpers.js`)
leest eerst die sessie, valt anders terug op `?u=` (backwards-compat tijdens de
transitie — niet meteen verwijderen). `js/bootstrap.js` doet bij laden `GET /api/me`:
401 → login-overlay, 200 → laadt `users/<id>.js` + app-modules. Pincode
(`APP_PINCODE_<id>`) blijft apart vereist voor gevoelige acties. Wachtwoorden:
bcrypt (cost 10) in Neon-tabel `app_user`. Nieuwe gebruiker: `node scripts/create-user.mjs`.
Rate limiting op `/api/login`: 10 pogingen per IP per 5 min (`applyGate`, sliding window
via Upstash). Generieke foutmelding (geen e-mail-enumeratie) + timing-egalisatie met
dummy bcrypt-compare. Uitloggen via knop in de Instellingen-tab → `POST /api/logout`
(wist `eq_session`). `SESSION_SECRET` env var vereist (min. 32 tekens).

## Security
Gecentraliseerd in `api/_helpers.js` (gedeeld door alle endpoints):
- **Rate limiting**: sliding window via Upstash Redis (`INCR` + `EXPIRE`). Login 10/5min per IP.
  Fail-open bij Redis-storing zodat een Upstash-uitval de app niet platlegt.
- **Brute-force lockout op pincode-endpoints**: telt 401-failures per IP+endpoint in een
  15-min window. 5+ fails → 5 min lockout, 10+ fails → 1 u lockout (`recordAuthFailure` /
  `checkAuthLockout`). Succesvolle pin wist de teller (`clearAuthFailures`).
- **CORS-lockdown**: alleen `https://energieiq.nl` en `https://stroom-dashboard.vercel.app`
  krijgen een `Access-Control-Allow-Origin`-header (`ALLOWED_ORIGINS`).
- **QStash signature-verificatie**: `cronLaden` valideert binnenkomende calls via
  `@upstash/qstash` Receiver (current + next signing key).
- **Home Connect OAuth CSRF**: `state`-nonce in Redis, éénmalig consumeerbaar in de callback.
- **XSS**: `escapeHtml()` in `js/config.js` voor alle 3rd-party/user-data die naar `innerHTML` gaat.
- **ESLint** geconfigureerd, 0 errors.

## Multi-user (sinds v2.54.0)
Eén Vercel deploy, meerdere gebruikers via `?u=001` URL-parameter.
- **`users/<id>.js`** zet `window.CONFIG` (niet-gevoelige config: tarieven, panelen, apparaten).
  Geldige user-id's hardcoded in `index.html` inline loader; onbekend → fallback naar `001`.
  Profielen: `001` = Pieter (SolarEdge + Growatt + Homey + Home Connect),
  `002` = vriend (alleen SolarEdge; geen Growatt, geen Homey). Het `integraties`-veld
  per user bepaalt welke secties/tegels getoond worden (`heeftIntegratie()`).
- **Server-side**: alle `/api/*` endpoints lezen `?u=<id>` (of body), valideren tegen
  `GELDIGE_USERS = ['001', '002']`, en lezen env vars met userId-suffix
  (`process.env[`SOLAREDGE_API_KEY_${userId}`]`). Geen mapping-tabel — userId IS de suffix.
- **Frontend fetch helper**: `apiUrl(path)` in `js/config.js` hangt `?u=<id>` aan elke `/api/*` call.
- **QStash → cronLaden**: body bevat ook `userId` zodat cronLaden de juiste Homey cloud-id pakt
  bij de scheduled webhook (na signature-verificatie).
- **Toevoegen nieuwe user**: maak `users/<nieuw-id>.js`, update `GELDIGE_USERS` array in
  zowel `index.html` als alle 5 API endpoints, vul per-user env vars in Vercel.
  Geen auth; URL-id's zijn raadbaar (volgt #19 in backlog).

## Auto / Kenteken
Voertuigspecs voor het laad-apparaat "Auto" via kenteken-lookup, **server-side in `api/kenteken.js`**:
- **RDW Open Data** (geen API-key): basisdata (merk/handelsbenaming) + brandstofdata voor PHEV/BEV-detectie.
- **`ev-database.json`** — eigen curated database (~66 PHEV/EV-modellen populair in NL), match op
  `rdwHandelsbenaming`; heeft **altijd voorrang** bij conflict met externe bronnen.
- **KilowattApp open-ev-data** (`kilowatt-ev-data.json`, 1300+ BEVs) — fallback voor onbekende
  BEVs, alleen voor non-PHEV (MIT-licentie, attributie vereist in Integraties-tab).
- Bij meerdere varianten: response `meerdereVarianten: true` → frontend toont dropdown.
- **Laadtype-selectie** (stekker / laadpaal 1- of 3-fase / anders): `werkelijkKw = Math.min(autoMaxKw, laadtypeKw)`.
- Frontend bewaart de keuze in `localStorage` onder `autoConfig_${userId}`.
- Volledige bron-/matchvolgorde-details: zie `README.md` → *Kenteken lookup*.

## Externe APIs
- **EnergyZero** (`api.energyzero.nl/v1/energyprices`) — EPEX day-ahead prijzen, excl. btw
- **Open-Meteo** — weersverwachting voor zonne-opbrengst voorspelling (LAT/LON in `js/config.js`)
- **Growatt OpenAPI** — plant power voor 14 panelen op huis
- **SolarEdge Monitoring API** — 8 panelen op garage/kantoor (overview, power per uur, energy per dag)
- **Homey** (`<cloud-id>.connect.athom.com`) — slimme stekker bediening via webhooks
- **Home Connect** (`api.home-connect.com`) — BSH-apparaten (Siemens/Bosch/Neff/Gaggenau) via OAuth2.
  Wasmachine/droger: programma's + opties + start/inplannen (`FinishInRelative`). Oven/kookplaat: alleen-monitoring.
  Vaatwasser wordt niet ondersteund via Home Connect. Volledige setup-instructie in `README.md` → *Home Connect*.
- **Upstash Redis + QStash** — persistente laadplanning en scheduled triggers

### Home Connect setup (kort)
1. developer.home-connect.com → applicatie: OAuth = Authorization Code Grant Flow,
   Redirect URI = `https://energieiq.nl/api/homeconnect/callback`, Scope = `IdentifyAppliance Monitor Control`.
2. Vercel env: `HOMECONNECT_CLIENT_ID` + `HOMECONNECT_CLIENT_SECRET` (globaal), en `APP_URL` = `https://energieiq.nl`
   (redirect-URI wordt hieruit afgeleid en moet exact matchen).
3. Home Connect-app op telefoon: apparaten koppelen, "Remote Start" aanzetten, programma selecteren.
4. Energie IQ → Instellingen → Home Connect → "Koppel Home Connect" → inloggen → apparaten koppelen aan Energie IQ-apparaten.

**Implementatie:**
- OAuth2 Authorization Code Flow (`api/homeconnect.js` + `api/homeconnect/callback.js`).
- Programma's én opties worden volledig **dynamisch** uit de API gelezen — geen hardcoded
  waarden. Aansturen: wasmachine + droger. Monitoring-only: oven + kookplaat.
- **Droger-chaining**: na het inplannen van de wasmachine biedt de UI aan de droger
  aansluitend in te plannen.
- Timing via `FinishInRelative` — de machine bepaalt zelf het startmoment zodat het
  programma op het gekozen tijdstip klaar is.
- Prijsoptimalisatie-variant via QStash (starten op goedkoopste moment) is nog te bouwen — backlog #40.

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
| `HOMECONNECT_CLIENT_ID`       | Home Connect (BSH) OAuth2 client id (gedeeld)            |
| `HOMECONNECT_CLIENT_SECRET`   | Home Connect (BSH) OAuth2 client secret (gedeeld)        |
| `DATABASE_URL`                | Neon PostgreSQL connection string (via Vercel↔Neon-integratie) |
| `SESSION_SECRET`              | HMAC-secret voor `eq_session`-cookie — min. 32 tekens, sterk random |

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
Bron: Sepa Green Energy jaarnota 2025/2026. Aanpassen in `users/001.js` en de Tarieven-sectie van `index.html`.

| Tarief                        | Waarde            | Constante in code        |
|-------------------------------|-------------------|--------------------------|
| Inkoopvergoeding              | € 0,02508 / kWh   | `OPSLAG`                 |
| Energiebelasting              | € 0,11618 / kWh   | `EB`                     |
| BTW                           | 21 %              | `BTW = 1.21`             |
| Vaste kosten (lev. + netbeh.) | € 1,35 / dag      | `VASTE_KOSTEN_PER_DAG`   |
| Afslag bij teruglevering      | € 0,03530 / kWh   | `TERUGLEVERING_OPSLAG`   |

`EB` is het gewogen gemiddelde over de jaarnota-perioden: periode 1+2 (4131 kWh à € 0,122863)
en periode 3 (5178 kWh à € 0,110848) → € 0,11618/kWh. `BTW` is een **vermenigvuldiger** (1.21),
géén percentage — niet als `0.21` opslaan, dat breekt de prijsformule.

Prijsformule (`js/prijzen.js`): `(epex + OPSLAG + EB) × BTW`
Teruglevering (`js/config.js`): `(epex − TERUGLEVERING_OPSLAG) × BTW`
