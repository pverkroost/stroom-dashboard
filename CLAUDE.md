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
- **Frontend**: vanilla JS + Chart.js, geserveerd vanuit de repo-root (`index.html`, `css/`, `js/`).
  PWA-basis sinds v2.76.2: `manifest.json` + `icons/` (standalone homescreen-app, opent op de
  hoofdtab). Bewust geen service worker — offline/push komt met backlog #97.
- **Backend**: serverless functies in `api/` (Vercel)
  - `api/growatt.js` — Growatt OpenAPI plant data
  - `api/solaredge.js` — SolarEdge Monitoring API (overview/power/energy)
  - `api/homey.js` — Homey cloud webhook proxy + connectivity check
  - `api/homewizard.js` — HomeWizard P1 live verbruik/teruglevering: POST (Homey-push, gedeelde push-token) cachet in Redis, GET levert aan de frontend
  - `api/homeconnect.js` — Home Connect (BSH) OAuth2 auth-redirect + appliance status/start/stop (sessie)
  - `api/homeconnect/callback.js` — OAuth2 redirect-target: code → tokens in Redis (state-CSRF-verified)
  - `api/planLaden.js` — plant laad-actie via QStash (publishJSON met delay)
  - `api/cronLaden.js` — wordt door QStash aangeroepen om Homey-webhook te triggeren
  - `api/auth.js` — login/logout/me samengevoegd in één function (routing via `?action=`),
    om onder de Vercel Hobby 12-functie-limiet te blijven (bcrypt + HMAC sessie-cookie).
    Sinds v2.76.0 ook `?action=schema` (GET/POST weekschema snelkaarten, tabel `user_schedule`)
  - `api/db/migrate.js` — maakt `app_user`- en `user_schedule`-tabel in Neon (idempotent).
    Vereist `MIGRATE_SECRET` (Bearer-header of `?secret=`), anders 401 — zie *Security*
- **Auth-libs** (root `lib/`, gedeeld door api): `lib/session.js` (HMAC encode/decode + `eq_session`-cookie),
  `lib/auth.js` (`getSession`/`requireSession` uit request-cookie).
- **State**: laadplanningen in Upstash Redis (sleutel `laadplanning_<userId>_<apparaat>`, bv. `laadplanning_001_autophev`).
  Home Connect-tokens in `homeconnect_tokens_<userId>`, OAuth state-nonces in `homeconnect_state_<state>`.
  HomeWizard P1 live meetwaarde in `homewizard_<userId>` (`{ vermogenW, importKwh?, exportKwh?, updatedAt }`, TTL 600s).
  Gebruikers (email + bcrypt-hash + userId) in Neon PostgreSQL tabel `app_user`.
  Weekschema snelkaarten in Neon tabel `user_schedule` (user_id, apparaat_key, dag 0-6, tijd 'HH:MM').

## Auth (sinds v2.72.0)
Echte login met e-mail + wachtwoord i.p.v. de rauwe `?u=`-parameter. Login, logout
en me zitten sinds v2.74.1 in één function `api/auth.js` (routing via `?action=login`
/`logout`/`me`) om onder de Vercel Hobby 12-functie-limiet te blijven; de beveiliging
per actie is ongewijzigd. Stateless: na login zet `POST /api/auth?action=login` een
HMAC-ondertekende `HttpOnly` cookie `eq_session` (30 dagen) met `{ uid, email, userId }`.
`getValidUserId` (in `api/_helpers.js`) leest eerst die sessie, valt anders terug op
`?u=` (backwards-compat tijdens de transitie — niet meteen verwijderen). `js/bootstrap.js`
doet bij laden `GET /api/auth?action=me`: 401 → login-overlay, 200 → laadt `users/<id>.js`
+ app-modules. Bedien-acties (Homey start/stop, `planLaden` POST/DELETE, Home Connect
start/stop) vereisen sinds v2.77.0 een geldige sessie via `requireSessionUserId` — géén
`?u=`-fallback. De vroegere pincode (`APP_PINCODE_<id>`) is toen vervallen: sinds de echte
login was hij een dubbele laag die vooral frictie gaf; netto blijft één verplichte laag
(de sessie) over, niet nul.
Wachtwoorden: bcrypt (cost 10) in Neon-tabel `app_user`. Nieuwe gebruiker:
`node scripts/create-user.mjs`. Rate limiting op de login-actie: 10 pogingen per IP per
5 min (`applyGate`, sliding window via Upstash). Generieke foutmelding (geen e-mail-
enumeratie) + timing-egalisatie met dummy bcrypt-compare. Uitloggen via knop in de
Instellingen-tab → `POST /api/auth?action=logout` (wist `eq_session`). `SESSION_SECRET`
env var vereist (min. 32 tekens).

## Weekschema-snelkaarten (sinds v2.76.0)
Bovenaan de hoofdtab (`#snelkaartSection`, boven "Slim inplannen") staat per apparaat met
`snelkaart: true` in `users/<id>.js` een kaart die direct het aanbevolen startmoment toont
("Zet nu aan" / "Zet aan om HH:MM") o.b.v. een deadline uit een vast weekschema
(`deadlineLabel`: "klaar om" voor de vaatwasser, "vertrek om" voor de auto).
- **Code**: `js/weekschema.js` (kaarten, overrule, beheer in Instellingen) + gedeelde helper
  `berekenBlokVoorDeadline(uren, kW, deadlineDate, planUren)` en `deadlineVanHHMM()` in
  `js/apparaten.js`. Die helper vervangt de vroeger gedupliceerde deadline-filtering in
  `herbereken()` (vertrekplanner) en `hcGoedkoopsteBlok()` (Home Connect).
- **Defaults**: per apparaat `weekschema: { ma:'07:00', …, zo:'09:00' }` in `users/<id>.js`.
  Opgeslagen waarden uit Neon gaan daar overheen; de server kent de defaults niet
  (`bron: 'default'` = niets opgeslagen → frontend gebruikt config).
- **Opslag**: tabel `user_schedule` (één rij per user/apparaat/dag, dag = JS `getDay()`,
  0 = zondag). `GET /api/auth?action=schema` (userId via sessie of `?u=`) en
  `POST /api/auth?action=schema` `{ schema: { <apSleutel>: { <dag>: 'HH:MM' } } }`
  (sessie vereist, vervangt per apparaat, rate limit 30/min/IP). Bewust op `api/auth.js`
  gehangen: geen 12e function verbruiken (#97), en de Neon-client + sessie-check zaten daar al.
  Na deploy éénmalig `GET /api/db/migrate` aanroepen voor de nieuwe tabel (met `MIGRATE_SECRET`,
  zie *Security*).
- **Auto**: SoC is onbekend → de kaart rekent altijd met de volle `ap.uren`. "Plan in via
  Homey" opent het bestaande detailpaneel met het berekende blok voorgeselecteerd en start
  de bestaande `planInladen`-flow (sessie-auth). De vaatwasser heeft geen aansturing: puur advies.
- **Overrule**: "andere tijd voor nu" op de kaart wijzigt alleen de deadline in deze sessie
  (`_snelkaartOverride`), niet het opgeslagen weekschema.
- **Randgeval**: deadline voorbij de bekende prijzen terwijl morgen-prijzen nog niet binnen
  zijn (vóór ~14:00) → "Wacht op morgen-prijzen" (helper geeft `wachtOpMorgen: true`).

## Security
Gecentraliseerd in `api/_helpers.js` (gedeeld door alle endpoints):
- **Rate limiting**: sliding window via Upstash Redis (`INCR` + `EXPIRE`). Login 10/5min per IP.
  Fail-open bij Redis-storing zodat een Upstash-uitval de app niet platlegt.
- **Sessie-auth op bedien-endpoints**: `requireSessionUserId` (401 zonder geldige
  `eq_session`) op `/api/homey` POST, `/api/planLaden` POST/DELETE en
  `/api/homeconnect?action=start|stop`. Lees-acties mogen nog via `getValidUserId` (`?u=`).
- **Brute-force lockout op token-endpoints**: telt 401-failures per IP+endpoint in een
  15-min window. 5+ fails → 5 min lockout, 10+ fails → 1 u lockout (`recordAuthFailure` /
  `checkAuthLockout`). Succesvolle token wist de teller (`clearAuthFailures`). Sinds v2.77.0
  alleen nog op `/api/db/migrate` (de pincode-endpoints bestaan niet meer).
- **CORS-lockdown**: alleen `https://energieiq.nl` en `https://stroom-dashboard.vercel.app`
  krijgen een `Access-Control-Allow-Origin`-header (`ALLOWED_ORIGINS`).
- **QStash signature-verificatie**: `cronLaden` valideert binnenkomende calls via
  `@upstash/qstash` Receiver (current + next signing key).
- **Migrate-endpoint achter token**: `GET /api/db/migrate` vereist `MIGRATE_SECRET` (env var,
  min. 32 tekens) via `Authorization: Bearer <token>` of `?secret=<token>`; timing-safe
  vergelijking, 401 zonder schema-info, 503 (fail-closed) als de var ontbreekt. Rate limit
  5/min/IP + brute-force-lockout. Aanroepen:
  `curl -H "Authorization: Bearer $MIGRATE_SECRET" https://energieiq.nl/api/db/migrate`
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
  programma op het gekozen tijdstip klaar is. Blijft als directe-start fallback.
- **Slim inplannen op goedkoopste EPEX-uur (sinds v2.73.0, #91)**: zelfde QStash-patroon
  als de auto, maar `type:'homeconnect'`. `api/planLaden.js` berekent niets zelf —
  de frontend zoekt het goedkoopste blok (`berekenGoedkoopsteBlok`, evt. begrensd door
  een "klaar om"-deadline) en POST't `{ type:'homeconnect', apparaat, haId, programKey,
  options, startTijd }`. Eén QStash-bericht (geen stop, machine stopt zelf) → op het
  geplande moment doet `api/cronLaden.js` `PUT /programs/active`. Status in Redis
  (`gepland`/`gestart`/`fout`); 409 = "Remote Start staat uit" → definitieve fout
  (geen QStash-retry), overige fouten → 502 zodat QStash retry't. Annuleren = DELETE
  (QStash-message + Redis wissen). Na het inplannen van de was: droger-chaining-knop.

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
| `MIGRATE_SECRET`              | Token voor `/api/db/migrate` — min. 32 tekens, sterk random (≠ SESSION_SECRET) |

**Per gebruiker (suffix = userId, bv. `_001`, `_002`):**

| Variable suffix               | Omschrijving                                             |
|-------------------------------|----------------------------------------------------------|
| `GROWATT_API_TOKEN_<NNN>`     | Growatt OpenAPI token per user                           |
| `SOLAREDGE_API_KEY_<NNN>`     | SolarEdge Monitoring API key per user                    |
| `SOLAREDGE_SITE_ID_<NNN>`     | SolarEdge site ID per user                               |
| `HOMEY_CLOUD_ID_<NNN>`        | Homey cloud-id per user                                  |
| `HOMEWIZARD_PUSH_TOKEN_<NNN>` | Gedeelde secret die de Homey-flow meestuurt bij de P1-push naar `/api/homewizard` POST |

### Vercel env vars setup (overgang naar genummerde suffixen)

Hernoemen (nieuwe maken met waarde van oude → Vercel redeploy → oude verwijderen):
- `GROWATT_API_TOKEN` → `GROWATT_API_TOKEN_001`
- `SOLAREDGE_API_KEY` → `SOLAREDGE_API_KEY_001`
- `SOLAREDGE_SITE_ID` → `SOLAREDGE_SITE_ID_001`
- `HOMEY_CLOUD_ID` → `HOMEY_CLOUD_ID_001`

Nieuw toevoegen (leeg laten tot user 002 echte keys heeft):
- `GROWATT_API_TOKEN_002`, `SOLAREDGE_API_KEY_002`, `SOLAREDGE_SITE_ID_002`,
  `HOMEY_CLOUD_ID_002`

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
