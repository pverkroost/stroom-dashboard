# Energie IQ — Backlog

> Effort: **S** <30min · **M** 30min–2u · **L** 2–8u · **XL** meerdere sessies

## 🟢 OPEN

### 🔴 Urgent / deadline
- **#104** [L] 🔴 **URGENT — SolarEdge Monitoring API V1 → V2 migratie (deadline 2026-11-01)**.
  SolarEdge zet de V1 API (statische `?api_key=` in `api/solaredge.js`) uit op 1 november 2026;
  daarna valt SolarEdge-data weg voor **alle** SolarEdge-users (001 Pieter + 003 Patrick). De
  intermitterende HTTP 503 "Scheduled V1 deprecation window" van nu is de voorbode. V2 = OAuth 2.0
  Site Access + Bearer-token (zelfde patroon als Home Connect), Free tier 2.000 credits/maand →
  pollfrequentie moet omlaag — zie details

### Snel te doen (UX/bugs)
- **#2** [M] UX review apparaatscherm tijdkeuze — slider/klaar-om/handmatig/overnemen; welke primair? mockup
- **#3** [M] Laadstatus uit Homey — toon of de auto écht laadt
- **#4** [S] Goedkoopste blok visueel highlighten in grafiek
- **#5** [S] Teruglevering-blok op Zon-tab — actietaal: "Zet apparaten aan tussen 09–14u, gratis zon"
- **#17** [S] Prijsdetail uit sectietitels → alleen op klik
- **#51** [S] `fetchPrijzen` onderscheid leeg vs netwerkfout
- **#72** [S] `js/config.js` schema-validatie van `window.CONFIG`

### Nieuwe features
- **#6** [M] "Vandaag bespaard"-widget (vereist #11 — afgerond in v2.74.0)
- **#7** [M] Inzichten-tab voor prijsdata (context ipv focus)
- **#8** [S] Solar contextueel — alleen tonen als relevant voor de actie
- **#9** [M] Push-notificaties "goedkoopste uur over 20 min" (vereist #15) — uitgewerkt in #97 + #98
- **#10** [M] Onboarding-uitleg API keys + contractdata in instellingen
- **#16** [M] Meer niet-favoriete apparaten met eigen actiekaart
- **#41** [M] Wachtwoord wijzigen in instellingen — sectie "Beveiliging" + `POST /api/changePassword` — zie details
- **#97** [L] Push-notificaties deel 1: PWA-fundament + Web Push infra (`manifest.json`, `sw.js`, `api/push.js` met `?action=` routing, `js/push.js`, Instellingen-UI). Vereist VAPID-keys + env vars `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`PUSH_SECRET`. Let op Vercel 12-functielimiet (na `push.js` = 12/12). Uitwerking van #9 — zie details
- **#98** [M] Push-notificaties deel 2: slimme trigger via Homey (P1 negatief + verliesgevende/negatieve EPEX-prijs → `api/push?action=send`) met Redis-cooldown tegen spam. Vervolg op #97
- **#99** [M] iOS Shortcut widget-endpoint (read-only): `?action=widget` aan bestaand endpoint (NIET nieuw i.v.m. functielimiet), auth via read-only `WIDGET_TOKEN_<id>`, geeft per apparaat het goedkoopste tijdvenster terug. Bedien-acties blijven achter sessie-auth

> ⚠️ Nummer #41 botst met een afgerond item (v2.64.0, `setInterval` visibility-pauze). Overweeg te hernummeren.

### Integraties (hardware/services)
- **#12** [S] ⏸️ GEPARKEERD — Teruglevering stoppen bij negatieve prijs: omvormer terugregelen niet haalbaar via cloud-API's (SolarEdge/Growatt vereisen lokale Modbus TCP). Alternatief: overschot opmaken via eigen apparaten + push-melding (#98). Alleen zinvol met Home Assistant/Modbus — zie details
- **#13** [L] Growatt via Home Assistant — volwaardige dagdata
- **#15** [M] Vercel Pro upgrade — push-notificaties + cron-precisie
- **#96** [M] MELCloud-integratie Mitsubishi Ecodan warmtepomp — koelen/warm water op zonneoverschot via (onofficiële) MELCloud API; eerst haalbaarheid onderzoeken

### Architectuur / refactors
- **#37** [L] Abstracte omvormer-architectuur — `omvormers[]` per user — zie details
- **#53** [L] DST-bug in solar mapping — `aggregateToHourly` op timestamp ipv uur
- **#64** [M] `switchTab` opsplitsen per tab-handler
- **#67** [M] `berekenGoedkoopsteBlok` O(n²) → O(n) met prefix-sums
- **#76** [M] `_terugleverRendering` flag → async/idempotent rendering
- **#77** [S] Solar HTML-blokken dedupe (zelf-verbruik vs terugleveren)
- **#83** [M] KilowattApp lazy-load (1.5MB cold-start verkorten)
- **#90** [XL] CSP `'unsafe-inline'` weghalen — ~50 inline `onclick` refactor — zie details
- **#107** [M] Home Connect-tokens versleutelen in Redis. Ontdekt bij de HomeWizard cloud-bouw (v2.79.0):
  `homeconnect_tokens_<userId>` staat plaintext in Redis. De nieuwe `lib/crypto.js` (AES-256-GCM) kan dit
  oplossen. Actie: token-opslag/uitlezing (`storeHomeConnectTokens`/`getHomeConnectTokens` in
  `api/_helpers.js`, gebruikt door `api/homeconnect.js` + `callback.js` + `cronLaden.js`) door `lib/crypto.js`
  halen, met migratiepad voor bestaande plaintext-tokens: bij de eerstvolgende refresh versleuteld
  terugschrijven (plaintext-JSON herkennen aan `{`-prefix vs `v1.`), of users opnieuw laten koppelen.
  Vereist #106 (vaste `CREDS_ENCRYPTION_KEY`) om te voorkomen dat een `SESSION_SECRET`-rotatie alle koppelingen wist.

### Tests & validatie
- **#61b** [M] Test framework opzetten (Jest/Vitest) + coverage op `berekenPrijs`, `berekenGoedkoopsteBlok`, `bepaalBrandstoftype`
- **#88** [M] ev-database JSON-schema in CI tegen typo's
- **#95** [S] TEST (geen code): teken-test P1 overdag bij zon — teruglevering moet negatief `vermogenW` geven. Zo niet → `homewizardVermogenInverteren: true` in `users/001.js`. (Vlag al gebouwd in v2.75.1)

### Docs & configuratie
- **#93** [S] Docs: tariefverificatie-notitie in `CLAUDE.md` (Sepa Green tarieven wijzigen maandelijks, contractvoorwaarden art. 2.1.1) + salderingsregels (stroom per uur, energiebelasting per jaar). Geen versie-bump
- **#94** [S] Veld `tarievenGeverifieerdOp: "YYYY-MM-DD"` in `users/<id>.js` + tonen in Instellingen; reminder om tarieven periodiek te verifiëren tegen mijn.sepagreen.nl
- **#106** [S] `CREDS_ENCRYPTION_KEY` apart in Vercel zetten. De credential-versleuteling (`lib/crypto.js`,
  AES-256-GCM, sinds v2.79.0 HomeWizard cloud — PR #4) gebruikt `CREDS_ENCRYPTION_KEY` als die bestaat,
  anders een sleutel afgeleid uit `SESSION_SECRET`. Zolang de aparte sleutel ontbreekt, betekent roteren
  van `SESSION_SECRET` dat alle users hun koppelingen opnieuw moeten maken. Actie: genereer een aparte
  32-byte key (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) en zet die
  als `CREDS_ENCRYPTION_KEY` in Vercel, bij voorkeur vóór de eerste koppeling. Daarna niet meer wijzigen.
  Geen code, alleen een env var. (#105 = de cloud-fallback zelf, in PR #4.)

### Multi-user / commercieel
- **#19** [XL] Multi-tenant SaaS (Clerk/Supabase auth + Redis-config per user) — zie details
- **#39** [XL] Lemon Squeezy freemium-betaalmuur (vereist #19) — zie details
- **#108** [L] Self-service credentials voor alle per-user koppelingen: de gebruiker voert zijn eigen
  credentials in via de app (versleuteld in Redis via `lib/crypto.js`) i.p.v. dat de beheerder ze per user
  in Vercel env vars zet. Begonnen met HomeWizard cloud (v2.79.0). Nog om te zetten: SolarEdge (valt samen
  met #104), Homey cloud-id, Home Connect (koppelt al via OAuth) — zie details

### Nice-to-have
- Zonnebonus (Zonneplan, user 003) verfijnen: alleen overdag (Open-Meteo `sunrise`/`sunset`) en
  de 7500 kWh/jaar-grens handhaven — nu vereenvoudigd op alle uren (zie `js/prijsformule.js`)
- Warmtepomp via API — uitgewerkt als #96 (Mitsubishi Ecodan via MELCloud)
- Boiler via Homey
- "Volledig gratis op zon"-badge als solar > apparaatverbruik
- Geselecteerd-uur-lijn doortrekken op Morgen + Zon tab

### Open vragen
- Home Connect-tokens staan nog plaintext in Redis (`homeconnect_tokens_<id>`); nu `lib/crypto.js`
  bestaat (v2.79.0) is dat een kleine opvolgstap.
- User 003 (Patrick): exacte apparatenlijst (`users/003.js` heeft nu een voorlopige default:
  vaatwasser/wasmachine/droger). Bevestigd: geen Homey, geen hybride/elektrische auto.
- Miele-apparaten (Patrick) vallen buiten Home Connect (eigen Miele-API) → niet ondersteund; alleen
  zijn Siemens-apparaten werken. Bekend gat.
- ~~HomeWizard P1 aanschaffen?~~ → beantwoord: aangeschaft en geïntegreerd (#11, v2.74.0)
- Welke netbeheerder? (Enexis-portal check uitgesteld)
- Welk merk warmtepomp? → Mitsubishi Ecodan (zie #96)
- Dakrichting/hoek panelen? (verbetert Open-Meteo nauwkeurigheid)
- API Client (OAuth2) in Homey — weggooien of bewaren?
- `HOMEY_TOKEN` env var — nog gebruikt of dood?


## 🚫 BEWUST NIET BOUWEN

Afgewogen en afgewezen; hier vastgelegd zodat het niet opnieuw onderzocht wordt.

- **Rain Bird beregening op zonneoverschot** — afgewezen: systeem werkt op leidingdruk,
  verwaarloosbaar verbruik, geen ROI. Heroverwegen alleen bij een beregeningspomp.
- **Omvormer export-limiet via cloud** — niet mogelijk: SolarEdge en Growatt vereisen
  lokale Modbus TCP, de cloud-API's zijn alleen-lezen (zie #12).


## 📖 DETAILS (uitgebreide context)

### #104 — 🔴 SolarEdge Monitoring API V1 → V2 migratie (deadline 2026-11-01)
SolarEdge zet de V1 Monitoring API (de statische `?api_key=` die `api/solaredge.js` nu
gebruikt) uit op **1 november 2026**. Vanaf dan valt SolarEdge-data weg voor ALLE users
met SolarEdge (001 Pieter + 003 Patrick). De intermitterende HTTP 503 "Scheduled V1
deprecation window" die nu al optreedt is de voorbode.

**Onderzoeksconclusie (okt 2026):**
- V2 is gratis voor homeowners via de Free tier: 2.000 API-credits/maand, 10 calls/min,
  1 credit per call. De "betaald voor derden"-waarschuwing betreft grote fleet-aggregators
  (PVOutput e.d.), niet een 2-site setup.
- V2 gebruikt GEEN statische key meer, maar OAuth 2.0 Site Access (Client ID + Client Secret,
  consent per user, access token 2u + refresh token). Zelfde patroon als de bestaande
  Home Connect-integratie — veel herbruikbaar (`api/_helpers.js` token-helpers).
- Endpoints: `monitoringapi.solaredge.com/v2`, Bearer-token i.p.v. `?api_key=`.

**Veld-conclusie (inventarisatie `api/solaredge.js` + `js/solar.js`, okt 2026) — ✅ beantwoord:**
De app gebruikt uitsluitend site-niveau-aggregaten:

| V1-call | Gelezen velden | Gebruik in app |
|---|---|---|
| `overview` | `overview.currentPower.power` (W), `lastDayData.energy` (Wh), `lastMonthData.energy` (Wh) | hero "Nu opgewekt", live-tegel, "Vandaag", "Deze maand" |
| `power` (15-min) | `power.values[].date`, `power.values[].value` (W) | `aggregateToHourly` → Zon-grafiek "actueel" + zon-dekking voor verstreken uren (`getSolarWatt`) |
| `energy` (DAY, gisteren) | `energy.values[0].value` (Wh) | "Gisteren" |
| `details` | `details.peakPower` (kWp) | overschrijft `panelen.solarEdge.piekKw` runtime, voedt `growattFractie` |

Geen van de in V2 geschrapte velden (`dcVoltage`, inverter-temperatuur, per-fase L1/L2/L3)
wordt gebruikt; ook `lifeTimeData`, `lastYearData`, `powerDetails`, `energyDetails`,
`currentPowerFlow` e.d. niet. **V2 levert alle benodigde data.** Dode code die bij de
migratie mag vervallen: de afgeleide `piekWatt`/`piekUur` in `fetchSolarEdge` (nergens gerenderd).

**Drie risico's / werkpakketten:**

1. **Credit-budget (grootste risico; kan NU al op V1).** `laadPrijzen` doet 3 SolarEdge-calls
   (power + overview + energy-gisteren) elke 5 min zolang de tab zichtbaar is, plus `details`
   bij elke start = tot ~36 calls/uur per account, terwijl de V2 Free tier ~66/dag toelaat.
   Zonder maatregelen is het maandbudget in dagen op. Oplossing:
   - server-side Redis-cache per user + type: overview 5–10 min, power 15 min,
     energy-gisteren 24 u, details 24 u;
   - 's nachts niet pollen (zonsondergang–zonsopkomst: power/overview zijn dan zinloos);
   - de gisteren-call niet elke 5 min herhalen.
   Vermindert óók de huidige 503's en is los van de OAuth-migratie te bouwen.
2. **Normalisatielaag.** `api/solaredge.js` is nu een dunne proxy: de V1-JSON-vorm lekt tot in
   `js/solar.js` (dat leest `overview.currentPower.power` letterlijk). Normaliseer naar een
   eigen stabiel contract, bv. `{ currentWatt, todayWh, monthWh, hourly:[{date,watt}],
   yesterdayWh, peakKwp }`, zodat de frontend niet mee hoeft te veranderen als de
   V2-response-vorm afwijkt.
3. **OAuth + endpoints.** V1 `?api_key=` → V2 Bearer-token op `monitoringapi.solaredge.com/v2`;
   OAuth Site Access flow per user, tokens in Redis (`solaredge_tokens_<userId>`, hergebruik
   homeconnect-token-patroon: state-nonce, refresh vóór expiry); tijdparameters van
   `YYYY-MM-DD HH:mm:ss` naar ISO met tijdzone (`vandaagNl()` levert al de NL-datum).
   Developer-app op developer.solaredge.com (type Site Access, scopes `SITE_DATA` +
   `DEVICE_DATA`), Client ID/Secret globaal in Vercel (zoals `HOMECONNECT_*`). Pieter (001)
   en Patrick (003) koppelen elk eenmalig via de consent-pagina. **Vercel 12-functielimiet**
   (`api/` op 11, #97 claimt de 12e): de OAuth-callback als `?action=` op `api/solaredge.js`
   zelf, niet als nieuwe function.

**Aanbevolen volgorde:** werkpakket 1 (call-reductie) eerst — werkt al op V1, verlaagt de
503's nu en is nodig om binnen het V2-creditbudget te blijven. Daarna 2 (normalisatie) en
3 (OAuth) samen als de echte migratie, vóór 1 november.

**Open check vóór de bouw:**
- Heeft Patricks mySolarEdge-account de homeowner self-access/developer-optie, of moet
  de installateur die vrijgeven?

### #108 — Self-service credentials voor alle per-user koppelingen
**Doel:** schaalbaar multi-user zonder handwerk per gebruiker. Nu moet de beheerder per nieuwe user
env vars in Vercel zetten (`SOLAREDGE_API_KEY_<id>`, `SOLAREDGE_SITE_ID_<id>`, `HOMEY_CLOUD_ID_<id>`,
`HOMEWIZARD_PUSH_TOKEN_<id>`, …) én redeployen. Met self-service voert de user zijn eigen
credentials in via Instellingen; de server valideert live en slaat ze versleuteld op in Redis
(`lib/crypto.js`, zelfde patroon als `hw_cloud_creds_<userId>`).

**Status per koppeling:**
- ✅ **HomeWizard cloud** (v2.79.0): e-mail + wachtwoord door de user, versleuteld, status/ontkoppelen in UI.
- ✅ **Home Connect**: koppelt al via OAuth door de user zelf; alleen de globale `HOMECONNECT_CLIENT_ID`/
  `_SECRET` blijven (dat hoort zo — één developer-app). Wel nog: tokens versleutelen (#107).
- ⬜ **SolarEdge**: valt samen met de V1→V2 OAuth-migratie (#104, werkpakket 3): de user koppelt via de
  SolarEdge consent-flow, tokens in `solaredge_tokens_<userId>`; de per-user `SOLAREDGE_API_KEY_<id>`/
  `SITE_ID_<id>` env vars vervallen dan vanzelf. Niet apart bouwen — meeliften met #104.
- ⬜ **Homey cloud-id**: user voert zijn Homey cloud-id in (Instellingen), opslag in Redis
  (`homey_config_<userId>`), `api/homey.js` + `cronLaden.js` lezen daar i.p.v. `HOMEY_CLOUD_ID_<id>`.
  Let op: cronLaden draait zonder sessie (QStash) → leest op userId uit de body, zoals nu.
- ⬜ **HomeWizard push-token**: user-specifieke `HOMEWIZARD_PUSH_TOKEN_<id>` kan door de app gegenereerd
  en getoond worden (eenmalig, voor in de Homey-flow), opslag gehasht in Redis. Lage prioriteit zodra de
  cloud-fallback (#105) voor de meeste users volstaat.

**Per koppeling:** Instellingen-sectie met invoer, live validatie bij opslaan, status (gekoppeld als …,
nooit het secret terugtonen), ontkoppelen. Alle schrijf-acties achter `requireSessionUserId`. Env-var-
fallback tijdelijk behouden (eerst Redis, dan env) zodat bestaande users niet breken tijdens de overgang.

**Volgorde:** #106 (vaste encryptiesleutel) → #107 (HC-tokens) → Homey cloud-id → SolarEdge via #104.
Dit is ook de voorwaarde voor #19 (multi-tenant): zonder self-service is elke nieuwe tenant handwerk.

### #12 — Teruglevering stoppen bij verlies (geparkeerd)
Oorspronkelijk idee: bij negatieve/verliesgevende EPEX-prijs de omvormer
terugregelen zodat er niet tegen verlies wordt teruggeleverd.

**Conclusie:** niet haalbaar via de cloud-API's. SolarEdge Monitoring API en
Growatt OpenAPI zijn alleen-lezen; een export-limiet instellen vereist lokale
Modbus TCP op de omvormer (bv. via Home Assistant met SolarEdge Modbus /
Growatt Modbus-integratie).

**Aanbevolen alternatief:** het overschot opmaken met eigen apparaten (auto,
wasmachine/droger, later warmtepomp #96) en een push-melding sturen zodra P1
negatief is én de prijs verliesgevend (#98).

**Status:** geparkeerd — alleen zinvol als er ooit Home Assistant/Modbus komt
(hangt samen met #13).

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

### #97 — Push-notificaties deel 1: PWA-fundament + Web Push
Uitwerking van #9. Bestanden: `manifest.json`, `sw.js` (service worker,
push-event → notificatie), `api/push.js` met `?action=` routing (subscribe /
unsubscribe / send, zelfde patroon als `api/auth.js`), `js/push.js`
(permission-flow + subscription naar backend) en een Instellingen-UI om
meldingen aan/uit te zetten.

**Vereist:** VAPID-keypair + env vars `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` en `PUSH_SECRET` (auth voor de send-actie vanuit Homey).
Subscriptions per user in Redis.

**Let op:** Vercel Hobby staat 12 serverless functions toe; na `api/push.js`
zit het project op 12/12. Elk volgend endpoint moet dus als `?action=` op een
bestaande function (zie ook #99).

Vervolg: #98 (slimme trigger via Homey met Redis-cooldown).


## ✅ AFGEROND

Compact changelog per versie. Items zonder verdere uitleg = bug/cleanup;
zie git-log of eerdere PR's voor details.

**v2.80.2** — Snelkaart-apparaten niet dubbel in "Slim inplannen"
- Hoofdtab: apparaten met `snelkaart: true` (auto, vaatwasser) staan alleen nog bovenaan bij
  "Nu bij het apparaat", niet nóg een keer in "Slim inplannen"/"Meer apparaten". Generiek per
  user (003: alleen de vaatwasser verdwijnt daar). Lege lijst → korte melding i.p.v. leeg blok.

**v2.80.1** — Weekschema instelbaar vanuit het apparaat in de lijst
- Instellingen → Apparaten: apparaten met weekschema (auto, vaatwasser) tonen een samenvattingsregel
  en een knop "📅 Weekschema" die dezelfde editor (`weekschemaEditorHtml`) onder de rij uitklapt.
  De losse sectie "Weekschema" is weg. Apparaten zonder weekschema tonen niets. Draft/open-stand
  overleven de herbouw; rij-drag negeert de editor. Opslag/API ongewijzigd.

**v2.80.0** — Weekschema per apparaat instelbaar
- De centrale kruistabel in Instellingen → Weekschema is vervangen door een blok per apparaat
  (samenvatting "ma–vr 07:00 · za–zo 09:00" + "Bewerken"). Dezelfde editor klapt ook uit op de
  snelkaart zelf ("📅 weekschema"). Opslaan en Standaard gelden per apparaat; bron-regel onderaan
  blijft. Onopgeslagen invoer en open/dicht-stand overleven de periodieke herbouw (`_wsDraft`,
  `_wsEditorOpen`). Opslag/API ongewijzigd (`?action=schema`, Neon `user_schedule`).

**v2.79.4** — Snelkaart + weekschema vaatwasser voor user 003
- `users/003.js`: vaatwasser krijgt `snelkaart: true` + default-weekschema (ma–vr 07:00, za/zo
  09:00), zelfde als 001. Alleen de vaatwasser (geen auto-kolom); test bewaakt dat.

**v2.79.3** — Home Connect op één plek in de integratielijst
- Instellingen: de losse sectie "Home Connect" is weg; OAuth-koppeling, apparaat-mapping
  (dropdowns, `localStorage` `homeconnect_mapping`) en de monitoring-uitleg zitten nu als
  uitklappaneel onder de rij "Home Connect" in de integratielijst (link "Koppelen" /
  "Beheer koppeling", zelfde patroon als HomeWizard sinds v2.79.1). Open/dicht-stand overleeft
  de periodieke herbouw van de kaart. Werking ongewijzigd.

**v2.79.2** — Handmatige bron-keuze HomeWizard P1
- In het HomeWizard-uitklappaneel (users met Homey-route én cloud): Automatisch / Alleen Homey /
  Alleen HomeWizard cloud, per user in `localStorage` (`hwBron_<id>`). "Alleen cloud" stuurt
  `forceCloud` mee naar `cloudpoll` (server slaat Homey-voorrang over). Tegel toont de bron
  + "(handmatig)"; nette melding bij cloud zonder gekoppeld account. Default blijft automatisch.

**v2.79.1** — HomeWizard-koppeling op één plek
- Instellingen: de losse sectie "HomeWizard" is weg; koppelen/status/ontkoppelen zit nu als
  uitklappaneel onder de rij "HomeWizard cloud" in de integratielijst (link "Koppelen" /
  "Beheer koppeling", zelfde patroon als "Hoe koppel ik?" bij Home Connect). Werking ongewijzigd.

**v2.79.0** — HomeWizard cloud-API als P1-fallback
- **#105** Live P1-verbruik via de (ongedocumenteerde) HomeWizard cloud-API als fallback voor de
  Homey-push: user voert zelf e-mail + wachtwoord in (Instellingen → HomeWizard), versleuteld in
  Redis (`lib/crypto.js`, AES-256-GCM; `hw_cloud_creds_<id>`), sessie-cache `hw_cloud_session_<id>`,
  open-pak-sluit WebSocket (`lib/homewizard-cloud.js`), `?action=cloudstatus|cloudsetup|cloudpoll|
  cloudunlink` op `api/homewizard.js` (sessie vereist). Homey-data houdt voorrang; tegel toont de
  bron. Vlag `integraties.homewizardCloud` (001 fallback, 003 primair). Nieuwe dep `ws`.
  Onderhoudsrisico: niet-officiële API. Tests: `test/homewizard-cloud.test.js`.

**v2.78.0** — Parametrische teruglever-prijsformule + user 003 (Zonneplan)
- **#102** `tarieven.teruglevering` per user: `{ methode:'afslag'|'opslag', bedrag, zonnebonusPct?,
  zonnebonusMaxKwhJaar? }`. Nieuw `js/prijsformule.js` (pure functies, in browser én Node)
  + `test/prijsformule.test.js` (`npm test`, 12 tests incl. bitwise backward-compat voor 001).
  `js/config.js` blijft compat-laag (`TERUGLEVERING`, `TERUGLEVERING_OPSLAG`). Instellingen →
  Tarieven nu per user gerenderd. Vereenvoudiging: zonnebonus op alle uren, 7500 kWh-grens
  niet gehandhaafd.
- **#103** User `003` Patrick (Almelo, Zonneplan): `users/003.js` (SolarEdge 10,344 kWp +
  Home Connect; geen Growatt/Homey/HomeWizard), geregistreerd in `js/bootstrap.js` en
  `api/_helpers.js`. Apparatenlijst is een voorlopige default.

- Pincode (`APP_PINCODE_<id>`) volledig verwijderd: sinds de echte login (v2.72.0) was hij
  een dubbele laag die vooral frictie gaf. Bedien-endpoints (`/api/homey` POST,
  `/api/planLaden` POST/DELETE, `/api/homeconnect` start/stop) vereisen nu een geldige
  sessie via `requireSessionUserId` (401 zonder cookie, geen `?u=`-fallback) — één
  verplichte laag i.p.v. twee, niet nul. Frontend: pincode-invoer, prompts en de 5-min
  in-memory cache weg; bedien-acties (Nu starten/stoppen, Plan dit in, annuleren, Home
  Connect start/stop/inplannen, snelkaart "Plan in via Homey") gaan direct. Brute-force-
  lockout blijft alleen op `/api/db/migrate`. QStash-verificatie, CORS, rate limiting en
  HMAC-sessie ongewijzigd.

**v2.76.2** — Homescreen-PWA opent op de snelkaarten
- PWA-basis: `manifest.json` (standalone, start_url `/`, groen thema) + iconen 192/512/180
  in `icons/`, gelinkt in `index.html` naast de bestaande iOS-meta-tags. Geen service
  worker (komt met #97). App start altijd op de hoofdtab en scrollt naar boven; na ≥ 30 min
  achtergrond springt een hervatte app terug naar de hoofdtab zodat "Nu bij het apparaat"
  direct in beeld staat.

**v2.76.1** — Snelkaarten vereenvoudigd
- **#101** Snelkaarten "Nu bij het apparaat" glanceable gemaakt: aanzettijd ("Nu" / "HH:MM")
  is het grote element, bedrag/zon-%/tijdvenster weg, deadline alleen nog als kleine
  subregel. Functies ongewijzigd (Plan in via Homey, overrule, wacht-op-morgen, niet-aangestuurd).
  De "Slim inplannen"-kaarten houden hun detail.

**v2.76.0** — Weekschema-snelkaarten
- **#100** Twee snelkaarten bovenaan de hoofdtab (vaatwasser "klaar om", auto "vertrek om"):
  aanbevolen startmoment o.b.v. een vast weekschema per weekdag, met kosten/zon/besparing,
  sessie-overrule van de deadline en (auto) de bestaande inplan-actie via Homey. Weekschema
  in Neon (`user_schedule`, `GET/POST /api/auth?action=schema`, migratie in `api/db/migrate.js`)
  + beheer in Instellingen → Weekschema; defaults per apparaat in `users/<id>.js`.
  Refactor: gedeelde `berekenBlokVoorDeadline()` + `deadlineVanHHMM()` vervangen de
  gedupliceerde deadline-logica in `herbereken()` en `hcGoedkoopsteBlok()`.
  Nieuw bestand `js/weekschema.js`. Geen bestaand open item dekte dit.

**v2.75.2** — #92 dode functie toUurRanges verwijderd uit solar.js (508ce9b)

**v2.75.1** — omkeerbare P1-vermogen teken-interpretatie via config-vlag `homewizardVermogenInverteren`

**v2.75.0** — adaptieve teruglever/verbruik-statusregel op Zon-tab o.b.v. live P1 (verving de 3 losse "zelf verbruiken"-blokken)

**v2.74.1** — login/logout/me samengevoegd tot `api/auth.js` i.v.m. Vercel Hobby 12-functielimiet

**v2.74.0** — HomeWizard P1
- **#11** HomeWizard P1 live verbruik/teruglevering via Homey-push naar Redis
  (`api/homewizard.js`, Zon-tab live-tegel) (7ae80f6)

**v2.73.0** — Slim inplannen wasmachine/droger
- **#91** QStash-planning wasmachine/droger via Home Connect op het goedkoopste
  EPEX-uur. `api/planLaden.js` + `api/cronLaden.js` uitgebreid met `type:'homeconnect'`
  (één QStash-start → `PUT /programs/active`, geen stop-bericht). Frontend: "Slim
  inplannen"-blok met deadline, goedkoopste-blok-berekening (`berekenGoedkoopsteBlok`),
  status (gepland/gestart/fout) + annuleren + droger-chaining. `FinishInRelative`
  blijft als directe-start fallback.

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
