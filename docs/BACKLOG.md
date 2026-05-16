# Energie IQ — Backlog

Gedistilleerd uit `docs/chat001.md` + `docs/chat002.md`. Werk dat al af is staat onderaan onder "Done".

---

## Bugs / fixes

- [ ] **"Kost € X meer" inconsistent** — berekening verschilt tussen apparaatkaart en detailscherm. Moet overal `Math.abs(kostenKeuze − kostenBeste)` zijn.
- [ ] **iPhone pincode-invoer** — toetsenbord valt over het veld. Veld bovenaan detailscherm, `inputmode="numeric"`, `scrollIntoView` op focus.
- [ ] **Pincode-state reset** — bij switchen tussen "Nu starten" en "Nu stoppen" blijft oude state staan (drie groene puntjes blijven hangen).
- [ ] **"Morgen prijzen nog niet beschikbaar" dubbel** — meldingsregel verschijnt twee keer in Auto-PHEV kaart.
- [ ] **Solar-tegels inconsistent tussen Vandaag/Zon tab** — Live + Vandaag-waardes lopen niet 1-op-1. Oorzaak waarschijnlijk dubbele API-calls; cachen via `window.solarData`.
- [ ] **`renderTeruglevering` dubbele rijen** — container niet leeggemaakt vóór render in de Zon-tab.
- [ ] **Grafiek-legenda** — soms zowel boven als onder. Alleen onder, met 3 items (verbruiksprijs, zonne-opbrengst, terugleverprijs).

## Features (geprioriteerd in chat)

- [ ] **#10 Tijdnavigatie vereenvoudigen** — één doorlopende 24u tijdlijn, "Morgen"-tab verwijderen. EPEX day-ahead komt rond 12:00–14:00 binnen, max 48u beschikbaar.
- [ ] **#11 Pincode op "Plan dit in"** — planning via QStash heeft óók pincode-beveiliging nodig (nu alleen bij Nu starten/stoppen). Genoemd als beveiligingsrisico.
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
- [ ] **API-status check in instellingen** — per databron live status (✓ Actief, laatste update) i.p.v. hardcoded.

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

## Done (afgerond in chats of in v2.49.4)

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
