# Energie IQ — Backlog

> Effort: **S** <30min · **M** 30min–2u · **L** 2–8u · **XL** meerdere sessies

## 🟢 OPEN

### Snel te doen (UX/bugs)
- **#2** [M] UX review apparaatscherm tijdkeuze — slider/klaar-om/handmatig/overnemen; welke primair? mockup
- **#3** [M] Laadstatus uit Homey — toon of de auto écht laadt
- **#4** [S] Goedkoopste blok visueel highlighten in grafiek
- **#5** [S] Teruglevering-blok op Zon-tab — actietaal: "Zet apparaten aan tussen 09–14u, gratis zon"
- **#17** [S] Prijsdetail uit sectietitels → alleen op klik
- **#51** [S] `fetchPrijzen` onderscheid leeg vs netwerkfout
- **#72** [S] `js/config.js` schema-validatie van `window.CONFIG`

### Nieuwe features
- **#6** [M] "Vandaag bespaard"-widget (vereist #11)
- **#7** [M] Inzichten-tab voor prijsdata (context ipv focus)
- **#8** [S] Solar contextueel — alleen tonen als relevant voor de actie
- **#9** [M] Push-notificaties "goedkoopste uur over 20 min" (vereist #15)
- **#10** [M] Onboarding-uitleg API keys + contractdata in instellingen
- **#16** [M] Meer niet-favoriete apparaten met eigen actiekaart
- **#41** [M] Wachtwoord wijzigen in instellingen — sectie "Beveiliging" + `POST /api/changePassword` — zie details

> ⚠️ Nummer #41 botst met een afgerond item (v2.64.0, `setInterval` visibility-pauze). Overweeg te hernummeren.

### Integraties (hardware/services)
- **#11** [L] HomeWizard P1 slimme meter — blokkeert #6 en #13
- **#12** [S] Teruglevering stoppen bij negatieve prijs via Homey (vereist #11)
- **#13** [L] Growatt via Home Assistant — volwaardige dagdata
- **#15** [M] Vercel Pro upgrade — push-notificaties + cron-precisie
- **#91** [L] QStash-planning wasmachine/droger via Home Connect — goedkoopste uur i.p.v. `FinishInRelative` — zie details

### Architectuur / refactors
- **#37** [L] Abstracte omvormer-architectuur — `omvormers[]` per user — zie details
- **#53** [L] DST-bug in solar mapping — `aggregateToHourly` op timestamp ipv uur
- **#64** [M] `switchTab` opsplitsen per tab-handler
- **#67** [M] `berekenGoedkoopsteBlok` O(n²) → O(n) met prefix-sums
- **#76** [M] `_terugleverRendering` flag → async/idempotent rendering
- **#77** [S] Solar HTML-blokken dedupe (zelf-verbruik vs terugleveren)
- **#83** [M] KilowattApp lazy-load (1.5MB cold-start verkorten)
- **#90** [XL] CSP `'unsafe-inline'` weghalen — ~50 inline `onclick` refactor — zie details

### Tests & validatie
- **#61b** [M] Test framework opzetten (Jest/Vitest) + coverage op `berekenPrijs`, `berekenGoedkoopsteBlok`, `bepaalBrandstoftype`
- **#88** [M] ev-database JSON-schema in CI tegen typo's

### Multi-user / commercieel
- **#19** [XL] Multi-tenant SaaS (Clerk/Supabase auth + Redis-config per user) — zie details
- **#39** [XL] Lemon Squeezy freemium-betaalmuur (vereist #19) — zie details

### Nice-to-have
- Warmtepomp via API (Daikin/Mitsubishi/Nibe/Vaillant/Bosch)
- Boiler via Homey
- "Volledig gratis op zon"-badge als solar > apparaatverbruik
- Geselecteerd-uur-lijn doortrekken op Morgen + Zon tab

### Open vragen
- HomeWizard P1 aanschaffen? (€29, blokkeert #11 + #12)
- Welke netbeheerder? (Enexis-portal check uitgesteld)
- Welk merk warmtepomp?
- Dakrichting/hoek panelen? (verbetert Open-Meteo nauwkeurigheid)
- API Client (OAuth2) in Homey — weggooien of bewaren?
- `HOMEY_TOKEN` env var — nog gebruikt of dood?


## 📖 DETAILS (uitgebreide context)

### #19 — Multi-tenant SaaS
Echte SaaS-architectuur wanneer 5+ gebruikers. Auth via Clerk of Supabase,
per-user tarieven / panelen / apparaten / API-secrets in Upstash Redis,
key-pattern `laadplanning_<user>_<apparaat>` (al gehanteerd sinds v2.54.0).

**Huidige multi-user** (v2.54.0+): één Vercel deploy, `?u=001` URL-param,
niet-gevoelige config in `users/<id>.js`, secrets via env-var-suffix
(`SOLAREDGE_API_KEY_001` etc.). Geen auth — URL-id's zijn raadbaar. OK voor
0–5 vertrouwde users; daarboven vervangen door echte auth.

### #37 — Abstracte omvormer-architectuur
In plaats van hardcoded `SolarEdge` en `Growatt` een generieke `omvormers[]`
array per gebruiker met `type`, `naam` en credentials. Werkt dan voor elk
merk zonder code-aanpassingen.

Vereist refactor van `js/solar.js` en de API-endpoints zodat fetch + render
data-driven worden uit `users/<id>.js`. Bouwt voort op de `integraties`-vlag
uit v2.55.0.

### #39 — Lemon Squeezy freemium-betaalmuur
**Freemium-model:**
- Gratis: stroomprijzen, grafiek, slim inplannen basis
- Premium (€ 5/m of € 50/j): automatisch inplannen via Homey,
  vertrekplanner, kenteken-lookup, push-notificaties

**Implementatie:**
- Lemon Squeezy account → product met maand- en jaar-abonnement
- Webhook slaat betaalstatus op in Upstash Redis: `premium_${userId}: true/false`
- Bij app-load: check premium via `/api/checkPremium`
- Premium-features conditioneel tonen/verbergen

**Voordelen Lemon Squeezy:** BTW + facturatie automatisch (EU), iDEAL/CC/SEPA
ondersteund, klantportaal, goede Vercel-integratie via webhooks.

**Volgorde:** vereist #19 eerst — zonder echte user-identiteit kan een
`premium`-vlag niet betrouwbaar aan een betaling gekoppeld worden.

### #41 — Wachtwoord wijzigen in instellingen tab
Gebruiker kan zijn wachtwoord wijzigen via de instellingen-tab in de app.

**UI** — nieuwe sectie "Beveiliging" in de instellingen-tab:
- Invoerveld huidig wachtwoord
- Invoerveld nieuw wachtwoord
- Invoerveld nieuw wachtwoord bevestigen
- Knop "Wachtwoord wijzigen"

**API** — `POST /api/changePassword`:
- `requireSession()`-check (gebruiker moet ingelogd zijn)
- Valideer huidig wachtwoord via `bcrypt.compare`
- Valideer nieuw wachtwoord: minimaal 8 tekens
- Valideer nieuw wachtwoord === bevestiging
- Hash nieuw wachtwoord via bcrypt (cost 10)
- `UPDATE app_user SET wachtwoord_hash = $1 WHERE id = $2` (id uit sessie)
- Rate limiting: max 5 pogingen per IP per 15 minuten
- Generieke foutmelding bij verkeerd huidig wachtwoord

Bouwt voort op de auth-implementatie uit v2.72.0 (`lib/auth.js` `requireSession`,
`api/_helpers.js` rate-limit-helpers, Neon-tabel `app_user`).

### #90 — CSP `'unsafe-inline'` weghalen
Huidige CSP staat `script-src 'self' 'unsafe-inline'` toe omdat overal in
`js/apparaten.js`, `js/solar.js`, `js/app.js` HTML wordt opgebouwd met inline
`onclick="..."` in template-strings. Dat verzwakt CSP fors: XSS via injected
inline-script wordt nog toegestaan.

**Refactor:**
- Vervang `onclick="..."` in template-strings door `addEventListener` na
  `innerHTML=`, of event-delegation op een container met data-attributes
  (`data-action="planInladen"`, `data-apparaat="..."`)
- Idem `oninput`, `onchange`, `ondblclick`, `ondragstart`
- Inline `<style>` mag blijven (minder gevaarlijk, of overweeg hashes/nonces)
- Daarna `'unsafe-inline'` uit `script-src` in `vercel.json` halen

Substantieel: ~50+ call-sites in `apparaten.js` alleen. Maakt de XSS-defense
uit v2.61.0 echt waterdicht ipv best-effort.

### #91 — QStash planning voor wasmachine en droger via Home Connect
Momenteel gebruiken wasmachine/droger `FinishInRelative` via Home Connect — de
machine kiest zélf het startmoment binnen het venster. Dit optimaliseert **niet**
op de goedkoopste uren.

**Gewenste situatie** — zelfde aanpak als de auto (QStash + Upstash Redis):
- Gebruiker stelt "Klaar om"-tijd in
- App berekent het goedkoopste startmoment op basis van EPEX-prijzen
- QStash plant de Home Connect API-call op exact dat tijdstip
- Op het geplande moment: `PUT /programs/active` via Home Connect

**Verschil met auto:**
- Auto gebruikt een Homey-webhook (aan/uit)
- Wasmachine/droger gebruikt de Home Connect API (programma + opties)
- Redis slaat op: `{ startTijd, stopTijd, haId, programKey, options, userId }`
- `cronLaden.js` uitbreiden met Home Connect-support naast Homey

**Vereist:**
- Home Connect-tokens in Redis (✅ al gebouwd)
- `getHomeConnectToken()` helper (✅ al gebouwd)
- Uitbreiding `api/planLaden.js` voor `type: 'homeconnect'`
- Uitbreiding `api/cronLaden.js` voor Home Connect-actie

Voordeel boven `FinishInRelative`: de app stuurt op de écht goedkoopste uren
(EPEX + zon), niet alleen "klaar vóór tijdstip X". Vereist wél dat "Remote Start"
op het toestel aanstaat op het geplande moment.


## ✅ AFGEROND

Compact changelog per versie. Items zonder verdere uitleg = bug/cleanup;
zie git-log of eerdere PR's voor details.

**v2.68.0** — Bucket A code-hygiene
- **#46** `dbg()` helper; productie-`console.log` gegated achter `?debug=1`
- **#49 + #87** `apIsBruikbaar()` centrale guard tegen NaN-propagatie
- **#56** SolarEdge api_key in URL — non-issue gesloten (vereist door API)
- **#60** `TOTAL_PEAK_KW` computed-fallback uit som omvormer-piekKw
- **#63** `apiStatus` `Object.seal()` + JSDoc typedef (typo's falen luid)
- **#66** `window.APP_VERSION` single-source voor cache-bust + footer-stamp
- **#73** `getTodayStart` memoize (60s cache)
- **#74** `parseFloat(toFixed)` → `Math.round(x*1000)/1000` in `prijzen.js`
- **#78** cronLaden `WEBHOOKS` hardcoded — won't-fix (gekoppeld aan Homey-flows)
- **#79** `readRawBody` async iterator + 64KB size-limit (DoS-bescherming)
- **#86** `volgorde` fallback uit array-index ipv `ap.volgorde`-veld

**v2.67.0** — UX
- **#47** Broken `<script>setTimeout` via innerHTML → expliciete `setTimeout` caller-side
- **#48** `alert()` → inline error-div in auto-config dialog
- **#65** `INTEGRATIES` default `false` (was `true`)
- **#68** `displayNaam` fallback naar `ap.naam` ipv hardcoded `'Auto'`

**v2.66.1** — Dedupes
- **#70** `zoekKenteken*` → `_KENTEKEN_CTX` + `_zoekKenteken(contextId)`
- **#71** `bouwAutoConfigHtml` + `_bouwAutoConfigInner` → gedeeld `_bouwAutoConfigBody`
- **#82** `_upper()` helper + cascade-array voor `matchEvDatabase`

**v2.66.0** — API hardening
- **#69** Modal Escape-key + listener cleanup
- **#75** Dode growatt-branch uit `fetchSolarData` verwijderd
- **#80 + #81** `api/homey.js` AbortController(5s) + `r.ok` ipv `===200`
- **#84** planLaden `stopTijd > now+60s` validatie
- **#85** SolarEdge datum in `Europe/Amsterdam` ipv UTC

**v2.65.0** — Robustness + dependency cleanup
- **#52** `growattFractie()` NaN-guard voor users zonder solar-integraties
- **#54** Growatt JSON-parse hardening (rate-limit HTML respons)
- **#55** SolarEdge `r.ok` check + 502-mapping van 401/429
- **#61a** `package.json`: `private:true` + `engines.node>=18` + quoted lint globs
- **#62** `node-fetch` verwijderd (Node 18+ globale `fetch`); 4 transitive deps weg
- **#89** Lint glob quotes (meegenomen bij #61a)

**v2.64.0** — UX
- **#41** `setInterval` visibility-pauze + refresh-bij-terug-naar-tab
- **#42** Bootstrap vóór DOMContentLoaded — non-issue (scripts onderaan body)
- **#44** EV-database + kilowatt-meta cache-bust querystring

**v2.63.0** — Security-headers + DST-fixes
- **#40** `vercel.json` met CSP, X-Frame-Options DENY, `maxDuration: 10`, regio `fra1`
- **#43** `cacheVandaag` filter op timestamp (DST + midnight-safe)
- **#45** `setHours(+N)` → `setTime(+N*3600000)` op 8 sites (DST-safe duur-additie)
- **#50** `fetchPrijzen` AbortController(10s) + graceful `null`-return
- **#57** Rate-limit op `/api/kenteken` (al gebouwd in v2.62.0, expliciet gesloten)
- **#58 + #59** `VALID_USERS` + `getValidUserId()` centralisatie in `api/_helpers.js`

**v2.62.0 + v2.62.1** — Resterende KRITIEK uit code-review
- **#0d** Rate-limiting via Upstash Redis (`/api/kenteken` 10/min, `/api/planLaden`
  + `/api/homey` 5/min) + brute-force-lockout op pin-endpoints (≥5 fails = 5min,
  ≥10 = 1h)
- **#0e** QStash message-cleanup bij overschrijven/annuleren — `qstashStartId` /
  `qstashStopId` in Redis-payload, `client.messages.delete()` vóór nieuwe publish
- **#0f** CORS-lockdown — alleen `energieiq.nl` + `stroom-dashboard.vercel.app`
- **#0g** Pincode in-memory cache: 5min TTL + wipe op detail-paneel close

**v2.61.0** — Code-review + KRITIEK fixes
- **#0a** Volledige code-review uitgevoerd (12 KRITIEK / 23 WAARSCHUWING /
  27 SUGGESTIE). Direct gefixt: XSS-escape op RDW/EV-data render
  (`escapeHtml` in config.js), DELETE planLaden pincode-check + frontend
  cached-pin flow, cronLaden AbortController(5s) + invalid-userId 400 +
  `r.ok` check. `api/cleanupRedis.js` verwijderd (3 KRITIEK in één klap).
  Rest doorgezet als #0d–#0g + #40–#89.

**v2.60.3** — UI-tekst
- **#0c** "Over Energie IQ" dubbele header weg + tekst geüpdatet

**v2.59.x** (kenteken-feature, niet aan specifieke patch-versie getagd)
- **#14** RDW-kenteken-lookup gebouwd (`api/kenteken.js` + frontend-dialog,
  `ev-database.json` + `kilowatt-ev-data.json`)

**v2.54.0 + v2.54.1** — Basis multi-user
- **#18** `?u=001` URL-param, `users/<id>.js` voor niet-gevoelige config,
  env-var-suffixen voor secrets, Redis-keys `laadplanning_<userId>_<apparaat>`.
  Echte auth blijft tracked als #19.

**v2.53.0** — Apparaatscherm tone
- **#1** Negatieve "kost € X meer"-badges weg; groen "bespaar € X" /
  "beste tijd ✓" / grijs neutraal bij slechter

**Eerder / niet versie-getagd**
- **#0b** ESLint globals + eqeqeq audit


## CONCURRENTIEANALYSE

### HomeWizard Energy+ (€ 0,99/m of € 11,95/j)
- ✅ Schakelen op goedkoopste uren, zonne-energie surplus, P1 realtime
  verbruik, sluipverbruik, omvormers koppelen
- ❌ Kostenvergelijking per apparaat vooraf, klaar-om logica, EPEX-grafiek
  24+ uur, EV-batterijdelta, Homey-flows

**Onderscheid Energie IQ:** planningsintelligentie, kostentransparantie,
EV-logica, Homey-automatisering, actie-gericht.
