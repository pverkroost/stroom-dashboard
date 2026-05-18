# Energie IQ

Persoonlijk dashboard voor een dynamisch stroomcontract. Combineert EPEX day-ahead prijzen, zonne-opbrengst en weersverwachting — en stuurt slimme stekkers via Homey aan om apparaten op het goedkoopste moment te laten draaien.

## Functionaliteit
- **Vandaag / Morgen tab** — uurprijzen, totaalprijs en terugleverprijs in één grafiek, plus slimme inplanning per apparaat
- **Zon tab** — live opwekking (SolarEdge + Growatt), opbrengst vandaag/gisteren/maand, en voorspelde opbrengst voor morgen op basis van Open-Meteo
- **Apparaten** — auto (PHEV), warmtepomp, wasmachine/droger, vaatwasser, e-bikes, boiler, airco — elk met eigen vermogen en draaiuren
- **Auto laden** — automatische start/stop via Homey-webhook op het goedkoopste tijdvenster, gepland via QStash
- **Teruglevering vs zelf verbruiken** — per uur advies op basis van zonne-voorspelling en stroomprijs

## Tech stack
| Laag | Tools |
|---|---|
| Frontend | Vanilla JS, Chart.js, HTML/CSS |
| Backend | Vercel serverless (`api/*.js`) |
| State | Upstash Redis (laadplanning per apparaat) |
| Scheduling | Upstash QStash (vertraagde webhooks naar `/api/cronLaden`) |
| Externe APIs | EnergyZero (EPEX), SolarEdge Monitoring, Growatt OpenAPI, Open-Meteo, Homey cloud webhooks |

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
│   ├── growatt.js          Growatt plant power
│   ├── solaredge.js        SolarEdge overview/power/energy
│   ├── homey.js            Homey webhook proxy + connectivity check
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
| `APP_PINCODE` | Pincode voor `/api/homey` POST |
| `APP_URL` | Basis-URL voor QStash self-callbacks |
| `QSTASH_TOKEN` | Upstash QStash publish token |
| `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | QStash signing keys voor signature verificatie op `/api/cronLaden` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST |

Client-side constanten in `js/config.js`:
- `LAT` / `LON` — locatie voor Open-Meteo
- `GROWATT_PEAK_KW` / `SOLAREDGE_PEAK_KW` — piekvermogens
- `APPARATEN` — apparatenlijst met vermogen en draaiuren

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

### Sepagreen tarieven
- Login op mijn.sepagreen.nl
- Ga naar: Mijn contract → Tariefoverzicht
- Noteer: inkoopvergoeding, energiebelasting, vaste kosten, teruglevertarief

### HomeWizard P1 Meter
- IP adres vinden via router DHCP tabel of HomeWizard app → apparaat → tandwiel
- Lokale API: `http://[ip-adres]/api/v1/data` (geen authenticatie nodig)

### Kenteken lookup (RDW + EV database)
- Geen API key nodig — publieke RDW Open Data
- Endpoints gebruikt door `api/kenteken.js`:
  - `opendata.rdw.nl/resource/m9d7-ebf2.json` (basisdata: merk, handelsbenaming, eerste toelating)
  - `opendata.rdw.nl/resource/8ys7-d773.json` (brandstofdata: PHEV/BEV-detectie)
- EV database: `ev-database.json` in projectroot bevat `batterijKwh`, `bruikbaarKwh` en `laadVermogenAcKw` voor ~50 populaire PHEV/EV modellen in Nederland
- Match-volgorde: merk + bouwjaar-range → `rdwHandelsbenaming` exacte match → substring match → `model` substring
- Toevoegen aan database: nieuw object in de array van `ev-database.json` met `merk`, `model`, `rdwHandelsbenaming`, `bouwjaarVanaf`, `bouwjaarTot`, `type` (PHEV/BEV), `batterijKwh`, `bruikbaarKwh`, `laadVermogenAcKw`

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
