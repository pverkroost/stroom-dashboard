# Energie IQ — Backlog

## PRIORITEIT (eerst doen)

### #0d — KRITIEK: Rate-limiting op pincode-write endpoints
Pincode is 4 cijfers (10k mogelijkheden); zonder rate-limiting brute-forcable
vanaf elke origin. Geldt voor `api/homey.js`, `api/planLaden.js` POST + DELETE,
en `api/cronLaden.js` indirect via signature. Voeg Upstash Redis-counter toe
per IP+endpoint: bv. `auth_fail_${ip}_${endpoint}` met TTL 15min en
exponential back-off; na 5 mislukkingen 401 voor 5min, na 10 voor 1u.

### #0e — KRITIEK: QStash message-cleanup bij overschrijven/annuleren planning
`api/planLaden.js` POST publiceert nieuwe `starten`/`stoppen` berichten zonder
de vorige te annuleren. Bij planning aanpassen of annuleren blijven oude QStash
berichten in de queue en kunnen alsnog vuren. Sla `messageId`s op in Redis
(`laadplanning_<u>_<ap>` payload uitbreiden met `qstashStartId`/`qstashStopId`)
en roep `client.messages.delete(id)` aan vóór nieuwe publishes en bij DELETE.

### #0f — KRITIEK: CORS lockdown op write- en data-endpoints
Alle endpoints zetten `Access-Control-Allow-Origin: *`. Voor write-endpoints
(`homey`, `planLaden`, `cronLaden`) opent dit brute-force vanaf elke origin
in een gebruikers-browser. Beperk via env var `ALLOWED_ORIGIN` (bv.
`https://energieiq.nl`) en respecteer `Origin`-header. Idem voor data-endpoints
(`growatt`, `solaredge`, `kenteken`) als minder kritiek.

### #0g — KRITIEK: Pincode in-memory cache wipen
`apDetailState._cachedPlanPin` blijft staan voor de duur van het detail-paneel.
Wis de cache bij sluiten van het paneel en na inactiviteit (timeout 5min).
Voorkomt dat een DevTools-inspectie de plain pincode toont na ander gebruik.

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

- [ ] **#40 Geen vercel.json** — geen deployment-config, geen security-headers
  (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy), geen
  `functions.maxDuration`. Voeg `vercel.json` toe met regio, headers en max-duration.
- [ ] **#41 setInterval zonder visibility-pauze** (`js/app.js:254`) — `laadPrijzen`
  draait elke 5min, ook in achtergrond-tab. Pauzeer via `document.visibilityState`.
- [ ] **#42 Bootstrap vóór DOMContentLoaded** (`js/app.js:253-255`) — fetch-calls
  starten vóór DOM klaar is; `getElementById` kan null zijn. Wrap in `DOMContentLoaded`.
- [ ] **#43 cacheVandaag filter DST-bug** (`js/app.js:13`) — `.getHours() >= nowUur`
  splitst niet op datum + faalt rond DST (23/25-uur dagen). Vergelijk op datum+uur.
- [ ] **#44 ev-database.json geen cache-bust** (`js/app.js:189,200`) — Na release
  oude lijst in browser cache. Voeg `?v=…` querystring toe zoals bij `.js` files.
- [ ] **#45 DST-issues in setHours-math** (`js/apparaten.js:177-179,762`) — Bij DST-
  overgang dubbel/missend uur. Gebruik `setTime(t + 3600*1000)` of Intl met
  `timeZone:'Europe/Amsterdam'`.
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
- [ ] **#50 fetchPrijzen geen timeout** (`js/prijzen.js:7-10`) — EnergyZero down →
  hangende Promise.all blokkeert hele init. AbortController 10s.
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
- [ ] **#57 Geen rate-limit op kenteken** (`api/kenteken.js`) — Gratis RDW lookup
  scraping-vatbaar. IP-rate-limit (Upstash counter, max 30/min per IP).
- [ ] **#58 GELDIGE_USERS gedupliceerd op 7+ plekken** — `index.html` + 5 API
  files + users-bestanden. Toevoegen user is foutgevoelig. Extracteer naar
  `api/_users.js` shared module.
- [ ] **#59 veiligUserId varianten** — In 5 endpoints met verschillen (homey/
  planLaden lezen body.u, anderen niet). Extract naar shared helper.
- [ ] **#60 users/002.js totaalPiekKw placeholder** — `totaalPiekKw: 16` en
  `solarEdge.piekKw: 16` zijn beide placeholder met dezelfde waarde. Maak
  `totaalPiekKw` computed uit som van per-omvormer piekKw.
- [ ] **#61 package.json onvolledig** — Mist `private:true`, `engines.node>=18`,
  geen `test`-script, geen test-framework. Voeg toe; overweeg test-coverage op
  `berekenPrijs` en `berekenGoedkoopsteBlok`.
- [ ] **#62 node-fetch dependency overbodig** (`package.json:9`) — Node 18+ heeft
  globale `fetch`. Verwijder `node-fetch ^2.6.9` afhankelijkheid; bespaart bundle/koudstart.

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
