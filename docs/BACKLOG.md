# Energie IQ — Backlog

Gedistilleerd uit `docs/chat001.md` + `docs/chat002.md`. Werk dat al af is staat onderaan onder "Done".

---

## Features (geprioriteerd in chat)

- [ ] **#10 Tijdnavigatie vereenvoudigen** — één doorlopende 24u tijdlijn, "Morgen"-tab verwijderen. EPEX day-ahead komt rond 12:00–14:00 binnen, max 48u beschikbaar.
- [ ] **#12 Laadstatus uit Homey** — daadwerkelijke status slimme stekker tonen (laadt de auto echt?).
- [ ] **#13 "Vandaag bespaard / te besparen"** — widget die besparing t.o.v. gemiddelde dagprijs toont. Vereist meting (zie #17).
- [ ] **#14 Goedkoopste blok visueel highlighten in grafiek**.
- [ ] **#15 Prijsdata naar nieuwe "Inzichten"-tab** — context i.p.v. focus.
- [ ] **#16 Solar contextueel** — alleen tonen als het de actie beïnvloedt.
- [ ] **#17 Slimme meter koppelen** — HomeWizard P1 (€29) is de favoriete optie. Blokkeert #13 en #18.
- [ ] **#18 Teruglevering stoppen bij negatieve prijs** — grootverbruikers automatisch aanzetten via Homey. Vereist #17.
- [ ] **#19 Growatt via Home Assistant** — alternatief omdat de Growatt OpenAPI alleen `current_power` + `total_energy` geeft (geen dag/maand-data).
- [ ] **#20 Meer apparaten** — extra niet-favoriete apparaten met eigen actiekaart.
- [ ] **#21 Push-notificaties** — bv. "Goedkoopste uur start over 20 min."
- [ ] **#25 Prijsdetail uit sectietitels/badges** — minder druk, alleen tonen bij klik op kaart.
- [ ] **#26 Teruglevering-blok op Zon-tab vereenvoudigen** — actietaal: "Zet tussen 09:00–14:00 je apparaten aan — gratis zon."

## Ideeën / nice-to-haves

- [ ] **Kenteken via RDW-API** — automatisch automerk/kleur en eventueel batterij-info ophalen op basis van kenteken-invoer.
- [ ] **Warmtepomp via API** — Daikin/Mitsubishi/Nibe/Vaillant/Bosch.
- [ ] **Boiler via Homey**.
- [ ] **"Volledig gratis op zon"-badge** — als solar > apparaatverbruik.
- [ ] **Geselecteerd-uur-lijn doortrekken op Morgen + Zon tab** — werkt al op Vandaag.
- [ ] **Geplande start via Homey-flow met "Wacht tot"-kaart** — alternatief voor de huidige QStash-aanpak. Was begonnen, niet afgemaakt.

## Open vragen voor Pieter

- HomeWizard P1 aanschaffen? (€29, blokkeert #17 en #18)
- Welke netbeheerder? (Enexis-portal niet gevonden — `mijnnetbeheerder.nl` check uitgesteld)
- Welk merk warmtepomp? (alles-elektrisch huis, geen gas)
- Dakrichting/hoek panelen? (verbetert Open-Meteo nauwkeurigheid)
- Vercel Pro ($20/m) overwegen? (voor push-notificaties + preciezere cron)
- API Client (OAuth2) in Homey is aangemaakt maar ongebruikt — weggooien of bewaren?
- `HOMEY_TOKEN` env var: nog gebruikt of dood? (`api/homey.js` werkt via cloud-webhook zonder token)

## LATER / MULTI-USER

### #28 — Eerste externe gebruiker toevoegen (simpele aanpak)
Aparte Vercel deploy voor gebruiker 2 met eigen config.js (tarieven, panelen,
apparaten) en eigen env vars (API keys). Toegang via subdomeinnaam zoals jan.energieiq.nl.

Vereist:
- Nieuwe branch of fork in GitHub
- Aangepaste config.js voor gebruiker 2
- Nieuwe Vercel deploy gekoppeld aan die branch
- Subdomain instellen in TransIP: CNAME record naam=jan, waarde=cname.vercel-dns.com, TTL=300

Opmerking: maximaal zinvol voor 3-4 gebruikers, daarna echte multi-tenant (#27).

### #27 — Multi-tenant architectuur (echte SaaS)
Wanneer 5+ gebruikers: echte multi-tenant opzetten.

Vereist per gebruiker:
- Tarieven (leveranciersafhankelijk)
- Locatie + panelen (andere woning/setup)
- Apparatenlijst (andere auto/apparaten)
- API-secrets in Upstash Redis per user
- Laadplanning state per user: laadplanning_<user>_<apparaat>

Authenticatie opties:
- Echte login (email/wachtwoord, OAuth via Clerk/Supabase)
- Light (user-code in URL)

Onboarding opties:
- Handmatig door beheerder
- Zelfbediening met setup-wizard

## Nieuwe items

### #30 — Onboarding uitleg: hoe kom je aan API keys en contractdata
Voeg in de instellingen-pagina uitleg toe hoe gebruikers hun eigen API keys
en contractdata kunnen ophalen voor alle koppelingen. Doel: nieuwe gebruikers
kunnen zelfstandig onboarden zonder hulp van de ontwikkelaar.

**SolarEdge**
- Ga naar monitoring.solaredge.com → Admin → Site Access → API Access
- Kopieer de API key en Site ID

**Growatt**
- Ga naar openapi.growatt.com → registreer voor API token
- Plant ID vind je in de Growatt app of portal

**EnergyZero**
- Geen API key nodig — publieke EPEX data

**Sepagreen contractdata** (Mijn Sepagreen → Mijn contract → Tariefoverzicht)
- Inkoopvergoeding (€/kWh) — staat op je contract of Mijn Sepagreen
- Energiebelasting (€/kWh) — staat op je contract
- BTW percentage — standaard 21%
- Vaste kosten (€/dag) — staat op je contract
- Terugleververgoeding (€/kWh) — staat op je contract.
  Let op: Sepagreen rekent een bedrag IN bij teruglevering (kost geld).

**HomeWizard P1 Meter**
- Lokaal netwerk: `http://[ip-adres]/api/v1/data`
- IP adres vinden via: router DHCP-tabel of HomeWizard app →
  apparaat → tandwiel → IP adres
- Geen authenticatie nodig op lokaal netwerk

**Homey**
- Cloud ID via: my.homey.app → jouw Homey → instellingen
- Webhook key instellen in Homey-flows

### #31 — Vertrekplanner hernoemd + "Klaar om"-functie per apparaat ✅
**Afgerond in v2.52.0.**

De "Vertrekplanner" is nu auto-specifiek maar verschijnt ook bij andere
apparaten. Aanpassen:

- **Auto 🚗**: blijft "Vertrekplanner" — wanneer moet je weg?
- **Alle andere apparaten**: hernoemen naar "Klaar om" — wanneer moet
  het apparaat klaar zijn? Bijv. vaatwasser: "Klaar om 08:00" → app
  berekent wanneer te starten.

Logica "Klaar om":
- Gebruiker vult in: klaar om [tijd]
- App berekent: starttijd = klaar-tijd minus duur apparaat
- Zoekt goedkoopste blok dat eindigt vóór klaar-tijd
- Toont advies: "Start om 05:30 — klaar om 08:00 — € 0,42"

### #32 — Tijdlijn-slider op apparaatscherm ✅
**Afgerond in v2.52.2.**

Op het apparaat-detailscherm een tijdlijn/slider toevoegen waarmee de
gebruiker visueel door de uren kan scrubben en direct de impact ziet
op kosten en timing.

Werkt samen met de geselecteerde starttijd:
- Slider toont alle beschikbare uren
- Goedkoopste blok gemarkeerd
- Gebruiker sleept naar gewenst uur
- Kosten en vergelijking updaten live

### #33 — Concurrentieanalyse: HomeWizard Energy+
Prijs: € 0,99/maand of € 11,95/jaar (P1 Meter + Energy Socket).

**Wat zij doen**
- Schakelen apparaat op goedkoopste uren (simpele timer/drempelwaarde)
- Schakelen op zonne-energie surplus
- Realtime verbruik via P1 meter
- Sluipverbruik detecteren
- Inzicht en grafieken
- Omvormers koppelen (SolarEdge, Growatt, SMA, etc.)

**Wat zij NIET doen**
- Kostenvergelijking per apparaat vooraf
- Vertrekplanner / klaar-om-logica per apparaat
- Combinatie zonne-opbrengst + prijsadvies + apparaatplanning
- EPEX prijsgrafiek komende 24+ uur
- EV-laadplanning met batterijdelta-berekening
- Koppeling met Homey-flows voor automatisering

**Onderscheid Energie IQ**
- Planningsintelligentie per apparaat
- Kostentransparantie vooraf (exacte bedragen)
- EV-specifieke laadlogica
- Homey-automatisering
- Actiegericht i.p.v. alleen inzicht

### #34 — UX review apparaatscherm tijdkeuze
Er zijn nu meerdere manieren om de tijd in te stellen op het
apparaatscherm:
- Tijdlijn slider
- "Klaar om / Gereed zijn om" time input
- "Handmatig wijzigen" dropdown
- Beste tijd overnemen knop

Dit is mogelijk verwarrend voor de gebruiker. Review nodig:
- Welke methode is primair?
- Zijn alle methodes nodig of kunnen er weg?
- Zijn ze visueel duidelijk genoeg onderscheiden?
- Werken ze consistent samen (één geselecteerde tijd als waarheid)?
- Mockup maken van vereenvoudigde versie

## Done

- Bug: "Kost € X meer" consistent tussen kaart en detailscherm
- Bug: iPhone pincode-veld niet meer onder toetsenbord
- Bug: pincode-state reset bij Start ↔ Stop switch
- Bug: "Morgen prijzen nog niet beschikbaar" niet meer dubbel
- Bug: solar-tegels consistent tussen Vandaag/Zon tab
- Bug: `renderTeruglevering` geen dubbele rijen meer
- Bug: grafiek-legenda alleen onder
- #11 Pincode op "Plan dit in" (v2.51.0) — POST /api/planLaden vereist pin; gecached in detail-paneel-sessie voor stille slider-updates
- Bug: zonne-opbrengst lijn dipte onder nul (v2.50.1 monotone + v2.51.1 radicaal clip met Math.max(0, v) en tension:0)

### Afgerond in chats of v2.49.x

- Refactor naar modules (`js/config.js`, `solar.js`, `prijzen.js`, `apparaten.js`, `app.js`, `css/stijl.css`, `index.html`)
- Legacy `stroom-dashboard.html` verwijderd
- API endpoints: `api/solaredge.js`, `growatt.js`, `homey.js` (pincode), `planLaden.js` (Redis + QStash), `cronLaden.js`
- Solar voorspelling via Open-Meteo (`shortwave_radiation` + `direct_radiation`)
- Vertrekplanner met batterijslider + Overnemen-knop
- "Plan dit in" via Upstash Redis + QStash (laadplanning per apparaat)
- Apparaten + drag-and-drop volgorde in instellingen
- Homey webhooks `auto-laden-starten` / `auto-laden-stoppen` actief op "Qnect" stekker
- ⚙️ Instellingen-tab (Tarieven, Zonnepanelen, Apparaten, Integraties, Over, App info)
- Branding "Energie IQ" + domein `energieiq.nl` via Transip → Vercel
- Vandaag-tab volgorde: Slim inplannen (top 4) → grafiek → Meer apparaten → Uuroverzicht (inklapbaar)
- Zon-tab: 4 tegels + omvormer-kaartjes per systeem
- Grafiek interactief (klik op uur → apparaatkaarten updaten)
- Auto-privacy: merk-specifieke naam → "Auto (PHEV)" (app is publiek)
- Tarieven gesynchroniseerd met Sepa Green tariefblad (v2.49.4)
- CLAUDE.md + README.md geactualiseerd voor Energie IQ

---

## Belangrijke architectuur-keuzes (niet in code zichtbaar)

- **Netlify → Vercel migratie** — Netlify credit limit. `netlify/functions/` staat er nog als legacy, niet leidend.
- **Upstash Redis + QStash i.p.v. Vercel Cron** — Vercel Hobby cron is min. 1u; QStash kan op de seconde via `publishJSON({ url, delay, body })`. Vercel KV alleen op betaald plan.
- **Sepa Green prijzen wijken af van EPEX** — Sepa gebruikt eigen prijsbron (`mijn.sepagreen.nl/api/dashboard/marketprice`). Afwijking ~€0,002/kWh geaccepteerd.
- **Growatt OpenAPI beperkingen** — alleen `plant/list` werkt met `token`-header; `plant/energy` geeft `error_time format is incorrect` of `error_permission_denied`. Legacy ShinePhone API login lukt maar vervolg-endpoints redirecten naar login (IP-binding/CAPTCHA). Vandaag/gisteren/maand komt via Open-Meteo schatting. (Device SN en plant ID zitten in Vercel env vars, niet in deze doc.)
- **Homey via cloud-webhook**, niet via OAuth2 API Client (bewust simpel gehouden). URL: `https://<HOMEY_CLOUD_ID>.connect.athom.com/api/manager/logic/webhook/<key>`. De `webhooks.athom.com/webhook/<id>` URL werkt NIET (`Missing KeyPath value`).
- **Favorieten-vlag is weg** — vervangen door drag-and-drop volgorde in instellingen (localStorage, fallback naar `APPARATEN` in `config.js`). Wel `grootverbruik: true/false` per apparaat behouden voor latere filters.
- **Vertrekplanner is auto-only** — andere apparaten krijgen wel "Plan dit in" + Vertrek-knop maar geen batterijslider/-delta. Apparaten zonder automatisering tonen: "🔌 Automatisch inplannen nog niet beschikbaar voor dit apparaat."
- **Solar-toggle is bewust verwijderd** — slim inplannen rekent altijd met verwachte zonopbrengst.
- **API_BASE-prefix is weg** — alleen Vercel, relatieve `/api/...` paden.
- **Disclaimer "Berekeningen zijn per apparaat afzonderlijk. Bij gelijktijdig gebruik is zonne-energie dekking lager."** — bewust niet opgelost (Optie A), alleen disclaimer.
- **"Beste tijd" en "Jouw keuze" altijd consistent** — beide met zelfde `benodigdeUren` (afhankelijk van batterijslider) en zelfde solar-aftrek: `netto = max(0, verbruikKw − solarKw)` per uur.
- **Knop-taxonomie** per apparaat-type: `type: 'laden'` → "Nu laden", `'starten'` → "Nu starten", `'inschakelen'` → "Nu inschakelen".
- **Hardware**: SolarEdge 8 panelen op garage/kantoor (3,2 kW) + Growatt 14 op huis (4,6 kW) = 22 panelen / 7,8 kW × 0,8 efficiency.
