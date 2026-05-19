# Energie IQ — Backlog

## SNEL TE DOEN

- [ ] **#2 UX review apparaatscherm tijdkeuze** — Er zijn nu meerdere manieren
  om tijd in te stellen (slider, klaar-om input, handmatig wijzigen,
  overnemen knop). Review welke primair is, welke weg kunnen, en of ze
  consistent samenwerken. Mockup maken.

- [ ] **#3 Laadstatus uit Homey** — Daadwerkelijke status slimme stekker tonen
  (laadt de auto echt?).

- [ ] **#4 Goedkoopste blok visueel highlighten in grafiek**.

- [ ] **#5 Teruglevering-blok op Zon-tab vereenvoudigen** — Actietaal:
  "Zet tussen 09:00–14:00 je apparaten aan — gratis zon."

## PRODUCT — KERN VERBETERINGEN

- [ ] **#6 "Vandaag bespaard / te besparen"** — Widget die besparing t.o.v.
  gemiddelde dagprijs toont. Vereist slimme meter (#10).

- [ ] **#7 Prijsdata naar nieuwe "Inzichten"-tab** — Context i.p.v. focus.

- [ ] **#8 Solar contextueel** — Alleen tonen als het de actie beïnvloedt.

- [ ] **#9 Push-notificaties** — Bv. "Goedkoopste uur start over 20 min."
  Vereist Vercel Pro (#15).

- [ ] **#10 Onboarding uitleg API keys en contractdata** — Uitleg in instellingen
  hoe gebruikers SolarEdge, Growatt, Sepagreen, HomeWizard P1 en Homey
  zelfstandig kunnen koppelen inclusief waar je contractdata vindt.

## INTEGRATIES

- [ ] **#11 Slimme meter koppelen via HomeWizard P1** — Realtime verbruik,
  teruglevering en gas. Blokkeert #6 en #13.

- [ ] **#12 Teruglevering stoppen bij negatieve prijs** — Grootverbruikers
  automatisch aanzetten via Homey. Vereist #11.

- [ ] **#13 Growatt via Home Assistant** — Alternatief voor beperkte
  Growatt OpenAPI (alleen current_power + total_energy, geen dag/maand).

- [ ] **#14 Kenteken via RDW-API** — Automerk en batterij-info ophalen
  op basis van kenteken-invoer.

## LATER

- [ ] **#15 Vercel Pro** — Voor push-notificaties en precisere cron
  (nu via QStash opgelost, maar Pro geeft meer mogelijkheden).

- [ ] **#16 Meer apparaten uitbreiden** — Extra niet-favoriete apparaten
  met eigen actiekaart en automatisering.

- [ ] **#17 Prijsdetail uit sectietitels/badges** — Minder druk,
  alleen tonen bij klik op kaart.

## MULTI-USER

- [~] **#18 Eerste externe gebruiker** — Basis multi-user via `?u=001`
  parameter gebouwd in v2.54.0, vereenvoudigd in v2.54.1. Eén Vercel deploy
  met `users/<id>.js` voor niet-gevoelige config (tarieven, panelen,
  apparaten). Geen mapping-tabel: userId IS de env-var suffix.
  Per-user env vars: `SOLAREDGE_API_KEY_001`, `GROWATT_API_TOKEN_001`,
  `HOMEY_CLOUD_ID_001`, `APP_PINCODE_001` (idem `_002` etc.). Redis-keys
  `laadplanning_<userId>_<apparaat>`. Echte auth (#19) nog niet gebouwd.

- [ ] **#19 Multi-tenant architectuur** — Echte SaaS wanneer 5+ gebruikers.
  Auth via Clerk/Supabase, per-user tarieven/panelen/apparaten/API-secrets
  in Upstash Redis, laadplanning_<user>_<apparaat>.

## NICE-TO-HAVE

- [ ] Warmtepomp via API (Daikin/Mitsubishi/Nibe/Vaillant/Bosch)
- [ ] Boiler via Homey
- [ ] "Volledig gratis op zon"-badge als solar > apparaatverbruik
- [ ] Geselecteerd-uur-lijn doortrekken op Morgen + Zon tab

### #37 — Abstracte omvormer/integratie architectuur
In plaats van hardcoded SolarEdge en Growatt, een generieke
`omvormers[]` array per gebruiker met `type`, `naam` en credentials.
Werkt dan voor elk merk omvormer zonder code aanpassingen.
Vereist refactor van `js/solar.js` en de api endpoints zodat de
fetch + render dynamisch worden gedreven door de omvormers-array
in `users/<id>.js`. Bouwt voort op de `integraties`-vlag uit v2.55.0.

### #39 — Betaalmuur via Lemon Squeezy
Implementeer freemium model met Lemon Squeezy als payment provider.

**Freemium model**:
- Gratis: stroomprijzen, grafiek, slim inplannen basis
- Premium (€ 5/m of € 50/j): automatisch inplannen via Homey,
  vertrekplanner, kenteken lookup, push notificaties

**Implementatie**:
- Lemon Squeezy account aanmaken op lemonsqueezy.com
- Product aanmaken met maandelijks + jaarlijks abonnement
- Webhook instellen die betaalstatus opslaat in Upstash Redis
  per gebruiker: `premium_${userId}: true/false`
- Bij app laden: check premium status via `/api/checkPremium`
- Premium features conditioneel tonen/verbergen op basis van status

**Voordelen Lemon Squeezy**:
- BTW en facturatie automatisch afgehandeld voor EU
- iDEAL, creditcard, SEPA ondersteund
- Klant beheert zelf abonnement via klantenportaal
- Goede Vercel integratie via webhooks

**Volgorde**: eerst #27 (multi-tenant auth) bouwen, dan pas #39 — zonder
echte gebruiker-identiteit kan een per-user `premium`-vlag niet betrouwbaar
gekoppeld worden aan een betaling.

## CODE REVIEW v2.61.0 — WAARSCHUWINGEN

Uit volledige code review (#0a, agent-rapport). KRITIEKE issues zijn óf
direct gefixt in v2.61.0 óf doorgezet als #0d–#0g. Onderstaande zijn
WAARSCHUWING-prioriteit: bugs op edge-cases of structurele issues.

- [ ] **#46 console.log in productie** (`js/apparaten.js:1036-1041,1075,1217`) —
  Vervuilt console + info-disclosure. Verwijder of gate op `?debug=1`.
- [ ] **#47 <script> via innerHTML werkt niet** (`js/apparaten.js:1472`) — Scripts
  geïnjecteerd via innerHTML worden niet uitgevoerd. Vervang met handmatige
  `setTimeout` na de `innerHTML =` toewijzing.
- [ ] **#48 alert() blocking in modal** (`js/apparaten.js:1481-1482`) — Werkt
  niet altijd in modale contexten (z-index/overlay). Vervang met inline error.
- [ ] **#49 ap.uren/vermogen edge case** (`js/apparaten.js:1147`) — Bij wel
  `autoInfo.kenteken` maar geen `vermogen` crasht `berekenGoedkoopsteBlok`.
  Verstrakke check: `ap.uren && ap.vermogen`.
- [ ] **#51 Empty Prices array** (`js/prijzen.js:9`) — `if (!data?.Prices?.length)`
  toont "Geen prijsdata" zonder retry. Onderscheid leeg vs netwerkfout.
- [ ] **#52 TOTAL_PEAK_KW=0 NaN** (`js/solar.js:122-126`) — `GROWATT_PEAK_KW /
  TOTAL_PEAK_KW` geeft NaN bij user zonder integraties. Guard met
  `TOTAL_PEAK_KW > 0`.
- [ ] **#53 DST in solar mapping** (`js/solar.js:60`) — `solarData.map` index niet
  congruent met `prijzen[i].tijd.getHours()` op 23/25-uur dagen. Split index/uur.
- [ ] **#54 growatt JSON.parse zonder try** (`api/growatt.js:25-27`) — Crash bij
  niet-JSON respons (rate-limit HTML). Wrap in try.
- [ ] **#55 solaredge geen r.ok check** (`api/solaredge.js:39`) — Bij 401/429
  belandt `data.details` undefined als `peakPower:null` bij client. Check `r.ok`.
- [ ] **#56 SolarEdge api_key in query** (`api/solaredge.js:28`) — Belandt
  mogelijk in proxy/LB-logs. Gebruik header-auth waar mogelijk.
- [ ] **#60 users/002.js totaalPiekKw placeholder** — `totaalPiekKw: 16` en
  `solarEdge.piekKw: 16` zijn beide placeholder met dezelfde waarde. Maak
  `totaalPiekKw` computed uit som van per-omvormer piekKw.
- [ ] **#61 package.json onvolledig** — Mist `private:true`, `engines.node>=18`,
  geen `test`-script, geen test-framework. Voeg toe; overweeg test-coverage op
  `berekenPrijs` en `berekenGoedkoopsteBlok`.
- [ ] **#62 node-fetch dependency overbodig** (`package.json:9`) — Node 18+ heeft
  globale `fetch`. Verwijder `node-fetch ^2.6.9` afhankelijkheid; bespaart bundle/koudstart.
- [ ] **#90 CSP `'unsafe-inline'` verwijderen** (`vercel.json` + alle JS-renders) —
  Huidige CSP staat `script-src 'self' 'unsafe-inline'` toe omdat overal in
  `js/apparaten.js`, `js/solar.js`, `js/app.js` HTML wordt opgebouwd met inline
  `onclick="..."`-handlers in template-strings. Dat verzwakt CSP fors: XSS via
  injected inline-script wordt nog steeds toegestaan. Refactor:
  - Vervang alle `onclick="..."` in template-strings door `addEventListener` na
    `innerHTML=`, of door event-delegation op een container met data-attributes
    (`data-action="planInladen"`, `data-apparaat="..."`).
  - Idem `oninput`, `onchange`, `ondblclick`, `ondragstart`.
  - Inline `<style>` blokken kunnen blijven (`'unsafe-inline'` in style-src is
    minder gevaarlijk, maar overweeg ook hashes/nonces).
  - Daarna `'unsafe-inline'` uit script-src in `vercel.json` halen.
  Substantiële refactor (~50+ call-sites in apparaten.js alleen), maar maakt
  XSS-defense in v2.61.0 echt waterdicht in plaats van best-effort.

## CODE REVIEW v2.61.0 — SUGGESTIES

Uit volledige code review (#0a). Nice-to-have verbeteringen, code-kwaliteit,
performance micro-optimalisaties.

- [ ] **#63 apiStatus magische keys** (`js/app.js:7,93`) — Typo's blijven onopgemerkt.
  Constants of JSDoc typedef.
- [ ] **#64 switchTab grote if/else** (`js/app.js:25-79`) — Splits per tab-handler.
- [ ] **#65 INTEGRATIES default true** (`js/app.js:259-265`) — Contra-intuïtief voor
  nieuwe users. Default `false` zou veiliger zijn.
- [ ] **#66 Versie-stamp hardcoded** (`js/app.js:410`) — Hardcoded versie-string
  inconsistent met CLAUDE.md auto-bump-regel. Haal uit één constante.
- [ ] **#67 berekenGoedkoopsteBlok O(n²)** (`js/apparaten.js:168-186`) — Inner loop
  per i. Bij planUren=48 nog OK; pre-compute solar prefix-sums voor O(n).
- [ ] **#68 displayNaam 'Auto' fallback** (`js/apparaten.js:1240-1247`) — Bij 2e
  batterij-apparaat krijgen beiden 'Auto'. Maak typename-aware.
- [ ] **#69 Modal Escape-key handler** (`js/apparaten.js:1581`) — Overlay heeft
  geen keydown-listener. Voeg toe.
- [ ] **#70 zoekKentekenInPanel/Dialog 95% duplicate** (`js/apparaten.js:
  1568-1572,1604-1611`) — Extract helper `_zoek(inputId, resId, contextId)`.
- [ ] **#71 bouwAutoConfigHtml/_Inner 90% duplicate** (`js/apparaten.js:1393-1473`)
  — Extract gedeelde body in één helper.
- [ ] **#72 config.js geen schema-check** (`js/config.js:11-29`) — Crash zonder
  begrijpelijke fout bij ontbrekend veld in `window.CONFIG`.
- [ ] **#73 getTodayStart memoize** (`js/config.js:62-63`) — Wordt 100+ keer per
  render gebouwd. Memoize per tick.
- [ ] **#74 parseFloat(toFixed) roundtrip** (`js/prijzen.js:139`) — Gebruik
  `Math.round(x*1000)/1000`.
- [ ] **#75 Dode growatt-branch in solar** (`js/solar.js:82-89`) — `SOLAR_SOURCES`
  growatt is uitgecommentarieerd op regel 45, maar branch staat er nog.
- [ ] **#76 _terugleverRendering flag** (`js/solar.js:256-261`) — Vervang door
  async/await + idempotent rendering.
- [ ] **#77 Solar HTML-blokken dedupe** (`js/solar.js:307,321`) — "Zelf verbruiken"
  vs "Terugleveren" 80% identiek. Extract template-helper.
- [ ] **#78 cronLaden hardcoded WEBHOOKS** (`api/cronLaden.js:11-13`) — Nieuwe
  apparaten met automatisering vergen code-deploy. Maak data-driven via
  `users/<id>.js` of env var.
- [ ] **#79 readRawBody simpler** (`api/cronLaden.js:21-28`) — `for await (const c
  of req)` is leesbaarder; voeg size-limit toe tegen DoS via grote body.
- [ ] **#80 homey.js geen fetch-timeout** (`api/homey.js:53`) — AbortController
  toevoegen, vergelijkbaar met cronLaden in v2.61.0.
- [ ] **#81 homey.js r.status===200 te strikt** (`api/homey.js:54`) — Athom kan
  204 No Content geven. Check `r.ok` of `r.status < 300`.
- [ ] **#82 kenteken match-helper dedupe** (`api/kenteken.js:34-63`) — Match-logica
  herhaald in 3 functies. Extract `kandidatenInRange(...)`.
- [ ] **#83 KilowattApp lazy-load** (`api/kenteken.js:1-3`) — 1.5MB `kilowatt-ev-data
  .json` op cold-start. Lazy-load via dynamic import bij geen ev-database match.
- [ ] **#84 planLaden stopTijd > now check** (`api/planLaden.js:22,28`) — Als
  stopTijd in verleden ligt, webhook direct. Valideer.
- [ ] **#85 solaredge date in Europe/Amsterdam** (`api/solaredge.js:30`) — UTC-date
  kan 1-2u off rond middernacht NL. Forceer NL-datum.
- [ ] **#86 volgorde dupliceerd met array-index** (`users/001.js:27,002.js:30`) —
  Leid af van array-volgorde.
- [ ] **#87 Auto-config null-propagatie** (`users/002.js:30`) — `uren: null,
  vermogen: null` propageert NaN in `ap.uren * ap.vermogen` op meerdere call-sites.
  Centraliseer "auto nog niet ingesteld" guard.
- [ ] **#88 ev-database geen schema-validatie** — Typo `type:'BEC'` ipv `'BEV'`
  blijft onopgemerkt. JSON-schema in CI.
- [ ] **#89 package lint glob quotes** (`package.json:3-4`) — `js/**/*.js` werkt
  niet altijd op Windows zonder shell-expansie. Gebruik quotes.

## OPEN VRAGEN

- HomeWizard P1 aanschaffen? (€29, blokkeert #11 en #12)
- Welke netbeheerder? (Enexis-portal check uitgesteld)
- Welk merk warmtepomp?
- Dakrichting/hoek panelen? (verbetert Open-Meteo nauwkeurigheid)
- API Client (OAuth2) in Homey — weggooien of bewaren?
- HOMEY_TOKEN env var — nog gebruikt of dood?

## AFGEROND

- **#41 setInterval visibility-pauze** ✅ Afgerond in v2.64.0 — 5min poll gated
  op `document.visibilityState === 'visible'`. Bij `visibilitychange → visible`
  directe refresh als laatste run > 1min geleden was. Bespaart EnergyZero/
  SolarEdge/Open-Meteo quota voor users met de tab in achtergrond.
- **#42 Bootstrap vóór DOMContentLoaded** ✅ Non-issue, gesloten in v2.64.0 —
  scripts staan onderaan `<body>` (regels 248-252 van `index.html`), na alle
  HTML. DOM is gegarandeerd geparsed wanneer `app.js` draait. Agent-rapport
  baseerde de waarschuwing op generieke best-practice, niet op de feitelijke
  page-structuur.
- **#44 ev-database/kilowatt-meta cache-bust** ✅ Afgerond in v2.64.0 — beide
  fetches in `js/app.js` hebben nu `?v=…` querystring (zelfde versie als
  script-tags). Na release zien gebruikers direct de nieuwe EV-DB ipv stale
  CDN/browser-cache.
- **#40 vercel.json met security-headers + maxDuration** ✅ Afgerond in v2.63.0 —
  CSP (`default-src 'self'` + script-src met cdnjs.cloudflare.com, connect-src
  met api.energyzero.nl + api.open-meteo.com), X-Frame-Options DENY,
  X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin,
  Permissions-Policy (camera/microphone/geolocation/interest-cohort uit).
  `maxDuration: 10` voor alle api/*.js. Regio `fra1` (Frankfurt, dichtbij NL).
- **#43 cacheVandaag filter DST/midnight-safe** ✅ Afgerond in v2.63.0 —
  `js/app.js:getPrijzenVooruit` filtert nu op `p.tijd.getTime() >= hourStart`
  ipv `.getHours() >= nowUur`. Werkt correct na midnight-passage zonder fresh
  fetch én op 23/25-uur DST-dagen.
- **#45 setHours(+N) → setTime(+N\*3600000) in apparaten.js** ✅ Afgerond in
  v2.63.0 — 8 sites vervangen door ms-gebaseerde duur-additie. Bij DST-back
  (oktober) telt nu 3 uur laden ook echt 3 uur ipv 4 (clock-time hop). Lijn 281
  (`target.setHours(now.getHours() + N, 0, 0, 0)`) bewust ongewijzigd: dat is
  een absolute klok-tijd-set, geen duur-additie.
- **#50 fetchPrijzen timeout + graceful fallback** ✅ Afgerond in v2.63.0 —
  AbortController(10s) + check op `res.ok`. Bij timeout/netwerkfout/non-2xx
  retourneert `null` met `console.warn`, waarna de bestaande `renderGeenData`-
  flow in `laadPrijzen` overneemt. EnergyZero-uitval blokkeert nu niet meer de
  Promise.all-init.
- **#57 Rate-limit op kenteken** ✅ Afgerond in v2.62.0 — 10 req/min/IP via
  `applyGate` in `api/_helpers.js`. (Eerder reeds geïmplementeerd; nu pas
  expliciet uit WAARSCHUWING-lijst gehaald.)
- **#58 + #59 GELDIGE_USERS + veiligUserId centralisatie** ✅ Afgerond in v2.63.0 —
  `VALID_USERS` constante en `getValidUserId(req)` helper in `api/_helpers.js`.
  Alle 5 endpoints + cronLaden importeren nu uit één bron; geen lokale
  `GELDIGE_USERS = […]` of `veiligUserId(req)` definities meer. `index.html`
  inline-loader heeft nog steeds een eigen lijst (frontend kan geen `require`
  doen), met expliciete sync-comment.
- **#0d — Rate-limiting op publieke API endpoints** ✅ Afgerond in v2.62.0+v2.62.1 —
  v2.62.0: shared `api/_helpers.js` met Upstash Redis sliding-window counter
  (`ratelimit_<endpoint>_<ip>` met TTL 60s). Limits: `/api/kenteken` 10/min,
  `/api/planLaden` 5/min, `/api/homey` 5/min. IP uit `x-forwarded-for`. Fail-open
  bij Redis-storing zodat Upstash-uitval de app niet platlegt.
  v2.62.1: brute-force-protectie als extra laag op pin-endpoints. Aparte
  `authfail_<endpoint>_<ip>` counter binnen 15min-window: ≥5 failures = 5min
  lockout, ≥10 failures = 1h lockout via `authlock_*` key met TTL. Lockout-check
  vóór pin-validatie, INCR alleen op 401 (geen geldige verzoeken telt), wist
  bij succesvolle pin. Toegepast op `planLaden` POST+DELETE en `homey` POST.
- **#0e — QStash message-cleanup bij overschrijven/annuleren** ✅ Afgerond in v2.62.0 —
  Redis-payload uitgebreid met `qstashStartId`/`qstashStopId`. POST annuleert
  eerst bestaande messages via `client.messages.delete()`. DELETE doet hetzelfde
  vóór `redis.del`. Defense-in-depth: `cronLaden.js` stoppen-handler checkt nu
  ook of planning nog bestaat (skip Homey-webhook bij geannuleerde planning).
- **#0f — CORS lockdown** ✅ Afgerond in v2.62.0 — `setCors()` in `_helpers.js`
  reflecteert Origin alleen als hij in allow-list staat (`https://energieiq.nl`,
  `https://stroom-dashboard.vercel.app`). Toegepast op alle 5 publieke endpoints
  (`kenteken`, `planLaden`, `homey`, `growatt`, `solaredge`). cronLaden ongewijzigd
  (server-to-server via QStash, geen browser-CORS).
- **#0g — Pincode in-memory cache wipen** ✅ Afgerond in v2.62.0 —
  `cachePlanPin()`/`wisCachedPlanPin()` helpers in `js/apparaten.js` met 5min
  TTL via setTimeout. Wipe bij `sluitApDetail()` (paneel sluiten = einde sessie).
  Vervangen alle directe `_cachedPlanPin = pin` assignments.
- **#0a — Volledige code review en kritieke fixes** ✅ Afgerond in v2.61.0 —
  agent-rapport doorgenomen (12 KRITIEK, 23 WAARSCHUWING, 27 SUGGESTIE). Direct
  gefixt in v2.61.0: XSS-escape op alle RDW/EV-data render in `js/apparaten.js`
  (`escapeHtml`-helper in `js/config.js`), pincode-check op DELETE in
  `api/planLaden.js` + frontend cached-pin/prompt-flow, cronLaden timeout via
  AbortController (5s) + invalid-userId 400 ipv stille fallback naar 001 +
  `r.ok` check vóór `redis.del`. Eerder gefixt: `api/cleanupRedis.js` verwijderd
  (3 KRITIEK in één klap). Resterende 4 KRITIEK doorgezet als #0d–#0g.
  WAARSCHUWINGEN en SUGGESTIES als items #40–#89.
- **#0b — ESLint globals en eqeqeq audit** ✅ Afgerond
- **#0c — "Over Energie IQ" tekst bijwerken** ✅ Afgerond in v2.60.3 —
  dubbele header verwijderd (alleen groene balk behouden), intro vervangen
  door "Energie IQ helpt je slim te plannen wanneer je apparaten gebruikt
  op basis van je dynamische energiecontract.", lijst bijgewerkt met
  RDW/EV-database kenteken lookup. Geen interne tech (Vercel/Redis/QStash)
  genoemd in app-UI — die staan in README/CLAUDE.md.
- **#1 Apparaatscherm te negatief** ✅ Afgerond in v2.53.0 — rode/oranje
  "kost € X meer" badges en regels verwijderd. Beste tijd toont "bespaar
  € X.XX" in groen, geselecteerd/nu toont groen "beste tijd ✓" (bij gelijk)
  of grijs neutraal "beste tijd: € X.XX goedkoper" (bij slechter). Toegepast
  op apparaatkaartjes, detail panel, vertrekplanner en tijdlijn-tooltip.

## CONCURRENTIEANALYSE

### HomeWizard Energy+ (€0,99/m of €11,95/j)
Doen wel: schakelen op goedkoopste uren, zonne-energie surplus,
P1 realtime verbruik, sluipverbruik, omvormers koppelen.
Doen NIET: kostenvergelijking per apparaat vooraf, klaar-om logica,
EPEX grafiek 24+ uur, EV batterijdelta, Homey flows.
Onderscheid Energie IQ: planningsintelligentie, kostentransparantie,
EV-logica, Homey-automatisering, actiegericht.
