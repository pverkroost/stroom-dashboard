# Energie IQ

Persoonlijk dashboard voor een dynamisch stroomcontract. Combineert EPEX day-ahead prijzen, zonne-opbrengst en weersverwachting — en stuurt slimme stekkers via Homey aan om apparaten op het goedkoopste moment te laten draaien.

## Functionaliteit
- **Vandaag / Morgen tab** — uurprijzen, totaalprijs en terugleverprijs in één grafiek, plus slimme inplanning per apparaat
- **Zon tab** — live opwekking (SolarEdge + Growatt), opbrengst vandaag/gisteren/maand, en voorspelde opbrengst voor morgen op basis van Open-Meteo
- **Apparaten** — auto (PHEV), warmtepomp, wasmachine/droger, vaatwasser, e-bikes, boiler, airco, oven, kookplaat — elk met eigen vermogen en draaiuren
- **Home Connect** — BSH-apparaten (wasmachine/droger starten op afstand, oven/kookplaat monitoring) via OAuth2-koppeling
- **Auto laden** — automatische start/stop via Homey-webhook op het goedkoopste tijdvenster, gepland via QStash
- **Teruglevering vs zelf verbruiken** — per uur advies op basis van zonne-voorspelling en stroomprijs

## Tech stack
| Laag | Tools |
|---|---|
| Frontend | Vanilla JS, Chart.js, HTML/CSS |
| Backend | Vercel serverless (`api/*.js`) |
| State | Upstash Redis (laadplanning per apparaat) |
| Scheduling | Upstash QStash (vertraagde webhooks naar `/api/cronLaden`) |
| Externe APIs | EnergyZero (EPEX), SolarEdge Monitoring, Growatt OpenAPI, Open-Meteo, Homey cloud webhooks, Home Connect (BSH) |

## Projectstructuur
```
.
├── index.html              hoofdpagina (Energie IQ)
├── css/stijl.css
├── js/
│   ├── config.js           tarieven, locatie, panelen, apparaten
│   ├── app.js              tab-navigatie, status, init
│   ├── prijzen.js          EnergyZero ophalen + prijsformule
│   ├── solar.js            SolarEdge + Growatt + Open-Meteo
│   └── apparaten.js        slim-inplannen logica + UI
├── api/                    Vercel serverless functions
│   ├── auth.js             login/logout/me (routing via ?action=)
│   ├── growatt.js          Growatt plant power
│   ├── solaredge.js        SolarEdge overview/power/energy
│   ├── homewizard.js       HomeWizard P1 live verbruik (Homey-push → Redis)
│   ├── homey.js            Homey webhook proxy + connectivity check
│   ├── homeconnect.js      Home Connect OAuth2 + appliance status/start/stop
│   ├── homeconnect/
│   │   └── callback.js     OAuth2 redirect-target (code → tokens in Redis)
│   ├── planLaden.js        laadplanning aanmaken (QStash publish)
│   └── cronLaden.js        QStash callback → Homey webhook (signature-verified)
└── CLAUDE.md               instructies voor Claude (versie, deploy, tarieven)
```

## Environment variables
In Vercel → Settings → Environment Variables:

| Variable | Omschrijving |
|---|---|
| `GROWATT_API_TOKEN` | Growatt OpenAPI token |
| `SOLAREDGE_API_KEY` / `SOLAREDGE_SITE_ID` | SolarEdge Monitoring API |
| `HOMEY_CLOUD_ID` | Homey cloud-id voor `<id>.connect.athom.com` |
| `HOMEWIZARD_PUSH_TOKEN_<userId>` | Lange random secret die de Homey-flow meestuurt bij de P1-push naar `/api/homewizard` (#11) |
| `APP_PINCODE` | Pincode voor `/api/homey` + `/api/homeconnect` POST |
| `HOMECONNECT_CLIENT_ID` / `HOMECONNECT_CLIENT_SECRET` | Home Connect OAuth2 app-credentials (globaal, gedeeld) |
| `APP_URL` | Basis-URL voor QStash self-callbacks én Home Connect redirect-URI |
| `QSTASH_TOKEN` | Upstash QStash publish token |
| `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | QStash signing keys voor signature verificatie op `/api/cronLaden` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST |
| `DATABASE_URL` | Neon PostgreSQL connection string (automatisch gezet door de Vercel ↔ Neon-integratie) |
| `SESSION_SECRET` | Sterk random secret voor HMAC-ondertekening van de sessie-cookie — **minimaal 32 tekens**. Genereer met `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

## Login / authenticatie
Gebruikers loggen in met e-mail + wachtwoord; er wordt geen `?u=`-parameter meer
gebruikt voor normale toegang (de `?u=`-fallback blijft tijdelijk bestaan voor
backwards-compatibiliteit). Auth is **stateless**: na een geslaagde login zet de
server een HMAC-ondertekende, `HttpOnly` cookie `eq_session` (30 dagen geldig) met
`{ uid, email, userId }`. Elke `/api/*`-call leidt de `userId` uit die cookie af
(`getValidUserId` in `api/_helpers.js`); bij geen geldige sessie valt hij terug op
`?u=`. De pincode (`APP_PINCODE_<id>`) blijft apart vereist voor gevoelige acties
(laden starten/inplannen, Home Connect start/stop).

Login, logout en me zitten in één serverless function `api/auth.js` (routing via
`?action=`) om onder de Vercel Hobby 12-functie-limiet te blijven.

| Endpoint | Functie |
|---|---|
| `POST /api/auth?action=login` | `{ email, wachtwoord }` → zet `eq_session`-cookie (rate-limit 10/5min/IP) |
| `POST /api/auth?action=logout` | wist de cookie |
| `GET /api/auth?action=me` | huidige sessie `{ uid, email, userId }` of `401` |
| `GET /api/db/migrate` | maakt de `app_user`-tabel aan (idempotent) |

Wachtwoorden worden gehasht opgeslagen (bcrypt, cost 10) in de Neon-tabel `app_user`.

**Eerste keer opzetten:**
1. Zet `DATABASE_URL` (via Vercel ↔ Neon) en `SESSION_SECRET` in Vercel → redeploy.
2. Draai de migratie eenmalig: `curl https://energieiq.nl/api/db/migrate`.
3. Maak gebruikers aan met het script (lokaal, met `DATABASE_URL` in de env):
   ```
   node scripts/create-user.mjs pieter@example.com <wachtwoord> "Pieter" 001
   ```

Client-side constanten in `js/config.js`:
- `LAT` / `LON` — locatie voor Open-Meteo
- `GROWATT_PEAK_KW` / `SOLAREDGE_PEAK_KW` — piekvermogens
- `APPARATEN` — apparatenlijst met vermogen en draaiuren

## Security
Centraal in `api/_helpers.js`, gedeeld door alle endpoints:
- **Rate limiting** — sliding window via Upstash Redis. Login: 10 pogingen per IP per 5 min.
  Fail-open bij Redis-storing zodat een Upstash-uitval de app niet platlegt.
- **Brute-force lockout op pincode-endpoints** — failures per IP+endpoint in een 15-min window;
  5+ fails → 5 min lockout, 10+ fails → 1 u lockout. Een juiste pincode wist de teller.
- **CORS-lockdown** — alleen `https://energieiq.nl` en `https://stroom-dashboard.vercel.app`
  krijgen een `Access-Control-Allow-Origin`-header.
- **QStash signature-verificatie** — `/api/cronLaden` valideert calls met de QStash signing keys.
- **OAuth CSRF** — Home Connect-koppeling gebruikt een éénmalige `state`-nonce in Redis.
- **XSS** — `escapeHtml()` in `js/config.js` voor alle 3rd-party/user-data richting `innerHTML`.
- **Login-hardening** — generieke foutmelding (geen e-mail-enumeratie) + timing-egalisatie
  via dummy bcrypt-compare. Wachtwoorden: bcrypt cost 10.
- **ESLint** geconfigureerd, 0 errors.

## How to get API credentials

### Growatt
- Ga naar https://server.growatt.com/index
- Login → Setting → API Secret Key token
- Kopieer de token → gebruik als `GROWATT_API_TOKEN_{userId}`

### SolarEdge
- Neem contact op met je installateur
- Installateur gaat naar de betreffende installatie/residentie
- Klik op het tandwiel (links)
- Ga naar: Toegang installatie → Toegangsbeheer
- Vink "API toegang" aan en sla op
- API sleutel en Installatie-ID verschijnen na opslaan
- Gebruik als `SOLAREDGE_API_KEY_{userId}` en `SOLAREDGE_SITE_ID_{userId}`

### Homey
- Open de Homey app
- Ga naar: Instellingen → Algemeen → Homey ID
- Gebruik als `HOMEY_CLOUD_ID_{userId}`

### Home Connect (Siemens, Bosch, Neff, Gaggenau)
Voor het aansturen/monitoren van BSH-apparaten.

**1. Developer-applicatie aanmaken** op https://developer.home-connect.com (registreer een developer-account):
- **Application ID**: `energie-iq` (of eigen naam)
- **OAuth Flow**: Authorization Code Grant Flow
- **Redirect URI**: `https://energieiq.nl/api/homeconnect/callback`
- **Scope**: `IdentifyAppliance Monitor Control`

**2. Credentials in Vercel** (Settings → Environment Variables):
- `HOMECONNECT_CLIENT_ID` ← Client ID (globaal, niet per user)
- `HOMECONNECT_CLIENT_SECRET` ← Client Secret (globaal, niet per user)
- Zorg dat `APP_URL` = `https://energieiq.nl` (de redirect-URI wordt hieruit afgeleid en moet exact matchen)

**3. In de Home Connect-app op je telefoon:**
- Koppel je apparaten aan je account
- Schakel "Remote Start" in per apparaat
- Selecteer een programma op het apparaat zelf (nodig voor remote start)

**4. In de Energie IQ-app:**
- Ga naar **Instellingen → Home Connect**
- Klik "Koppel Home Connect" en log in met je Siemens/Bosch-account
- Koppel de gevonden apparaten aan de Energie IQ-apparaten

Tokens worden per user in Upstash Redis bewaard (`homeconnect_tokens_<userId>`).

| Apparaat | Ondersteuning |
|---|---|
| Wasmachine, droger | Volledig — programma's/opties kiezen + starten/inplannen |
| Oven, kookplaat | Alleen-monitoring (API kan ze niet veilig op afstand starten) |
| Vaatwasser | Niet via Home Connect — gebruik Homey of een slimme stekker |

Programma's, opties (temperatuur, centrifuge, droogdoel…) en `FinishInRelative` ("klaar om") worden **volledig dynamisch** uit de API gehaald — geen hardcoded waarden, dus het werkt automatisch voor elk merk/model. Bij twee gekoppelde toestellen biedt de app na een wasbeurt aan de droger erna in te plannen (IntelligentDry).

> **Let op — beperkingen van de Home Connect API:**
> - **Wasmachine & droger**: programma + opties kies je in de app; starten op afstand vereist dat "Remote Start" op het toestel aanstaat. Met "klaar om" plant de machine zelf het startmoment (`FinishInRelative`).
> - **Oven**: vereist per keer fysiek inschakelen van Remote Start; daarom in deze app **alleen-monitoring** (geen startknop).
> - **Kookplaat**: de API is voor kookplaten monitor-only — op afstand starten is niet mogelijk.

### Sepagreen tarieven
- Login op mijn.sepagreen.nl
- Ga naar: Mijn contract → Tariefoverzicht
- Noteer: inkoopvergoeding, energiebelasting, vaste kosten, teruglevertarief

### HomeWizard P1 Meter
- IP adres vinden via router DHCP tabel of HomeWizard app → apparaat → tandwiel
- Lokale API: `http://[ip-adres]/api/v1/data` (geen authenticatie nodig)

### HomeWizard P1 via Homey (live verbruik/teruglevering, #11)
De P1-meter heeft alleen een **lokale** API (thuisnetwerk) en is dus niet direct
bereikbaar vanuit Vercel. Daarom pusht een Homey-flow de meetwaarde periodiek naar
`/api/homewizard`, dat hem in Upstash Redis cachet (`homewizard_<userId>`, TTL 10 min).
De Zon-tab toont op de tegel **"Live verbruik"** het actuele net-vermogen
(positief = verbruik uit het net, negatief = teruglevering, in groen).

**Setup:**
1. Installeer in Homey de **HomeWizard Energy**-app en koppel de P1-meter.
2. Maak een flow die elke **1–5 min** draait (trigger: tijd/interval of "measure_power gewijzigd").
3. Voeg een **"Maak een HTTP-request"**-actie toe:
   - Methode: `POST`
   - URL: `https://energieiq.nl/api/homewizard`
   - Header: `Content-Type: application/json`
   - Body: `{ "userId": "001", "token": "<HOMEWIZARD_PUSH_TOKEN_001>", "vermogenW": [measure_power], "importKwh": [meter_power.imported], "exportKwh": [meter_power.exported] }`
     (`importKwh`/`exportKwh` zijn optioneel; `[…]` zijn Homey-flow-tags van de P1-tegel.)

**Auth-keuze:** een aparte, lange gedeelde secret `HOMEWIZARD_PUSH_TOKEN_<userId>`
(in Vercel env vars) in plaats van de interactieve `APP_PINCODE`. De pincode is kort
(brute-force-gevoelig) en wordt voor gevoelige bedien-acties gebruikt; hem in elke
push (om de paar minuten) meesturen is onwenselijk. Een lange random push-token is
de gangbare machine-to-machine ingest-aanpak en wordt eenmalig in de Homey-flow gezet.
Genereer er een met bv. `openssl rand -hex 32`.

### Kenteken lookup (RDW + EV database)

De app combineert drie bronnen voor merk/model/specs op basis van een Nederlands kenteken:

**RDW Open Data** — geen API key nodig
- `opendata.rdw.nl/resource/m9d7-ebf2.json` — basisdata (merk, handelsbenaming, datum eerste toelating)
- `opendata.rdw.nl/resource/8ys7-d773.json` — brandstofdata voor PHEV/BEV-detectie

**Eigen curated EV database** — `ev-database.json` in projectroot
- ~70 PHEV/EV modellen die populair zijn in NL, met `rdwHandelsbenaming` voor exacte RDW-match
- Bevat zowel PHEVs (Volvo XC90 T8, BMW 330e, Range Rover P400e, etc.) als BEVs
- Onze entries hebben **altijd voorrang** bij conflict met externe bronnen
- Toevoegen: nieuw object met `merk`, `model`, `variant` (optioneel), `rdwHandelsbenaming`, `bouwjaarVanaf`, `bouwjaarTot`, `type` (PHEV/BEV), `batterijKwh`, `bruikbaarKwh`, `laadVermogenAcKw`, `laadVermogenDcKw` (optioneel), `elektrischBereikKm`

**Open EV Data (KilowattApp)** — fallback voor onbekende BEVs
- Bron: `github.com/KilowattApp/open-ev-data` — MIT licentie, attributie vereist
- Bevat 1300+ BEV-modellen wereldwijd (Abarth tot Zeekr) — **geen PHEVs**
- Lokaal opgeslagen in `kilowatt-ev-data.json` (1,5 MB, server-side gebruikt door `api/kenteken.js`)
- `kilowatt-meta.json` bevat alleen het aantal entries voor snelle frontend-load
- Wordt alleen geraadpleegd als onze curated database geen match heeft, en alleen voor non-PHEV kentekens (PHEV-detectie via RDW brandstofdata voorkomt verkeerde matches)
- **Attributie**: "Open EV Data (https://github.com/KilowattApp/open-ev-data)" wordt getoond in de Integraties-tab

**Match-volgorde** (in `api/kenteken.js`):
1. Onze database — merk + bouwjaar-range + type + `rdwHandelsbenaming` exact → substring → model substring
2. Bij geen match: KilowattApp fuzzy match — merk + bouwjaar ±2 jaar + model substring
3. Bij meerdere varianten: response bevat `meerdereVarianten: true` + `varianten[]` array, frontend toont dropdown

**Updaten KilowattApp data**:
```bash
curl -o kilowatt-ev-data.json https://raw.githubusercontent.com/KilowattApp/open-ev-data/master/data/ev-data.json
# regenereer kilowatt-meta.json met:
node -e "const d=require('./kilowatt-ev-data.json'); require('fs').writeFileSync('kilowatt-meta.json', JSON.stringify({count:d.data.length,brands:d.brands.length,updated_at:d.meta.updated_at,source:'https://github.com/KilowattApp/open-ev-data'}, null, 2)+'\n')"
```

## Prijsformule
```
verbruiksprijs = (epex + OPSLAG + EB) × BTW
terugleverprijs = (epex − TERUGLEVERING_OPSLAG) × BTW
```
Actuele Sepa Green tarieven (excl. btw): zie tabel in [CLAUDE.md](CLAUDE.md#tarieven-sepa-green-excl-btw).

## Lokaal draaien
De frontend is een statische pagina — open `index.html` direct, of serveer de repo-root met bijvoorbeeld:
```
npx serve .
```
De API-endpoints werken alleen via een Vercel-deploy (of `vercel dev`) omdat ze de env vars nodig hebben.

## Deployment
Vercel deployt automatisch bij elke push naar `main`. Zie [CLAUDE.md](CLAUDE.md) voor de versienummering- en deploy-conventies.
