# Energie IQ — Backlog

Gedistilleerd uit `docs/chat001.md` + `docs/chat002.md`. Werk dat al af is staat onderaan onder "Done".

---

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
- [ ] **#27 Multi-user support — eerste extra gebruiker** — app multi-tenant maken zodat een tweede persoon Energie IQ kan gebruiken voor zijn/haar situatie. Vereist nogal wat. Onder te verdelen in:

  **A. Identiteit & toegang**
  - Hoe weet de app welke gebruiker dit is? Opties: (i) login + sessie, (ii) per-user URL (energieiq.nl/u/pverk), (iii) URL-parameter, (iv) gewoon aparte Vercel-deploy per user.
  - Eigen pincode per user (nu globaal `APP_PINCODE`).
  - Eerste-keer-setup wizard om profiel in te vullen.

  **B. Per-user configuratie (nu hardcoded in `js/config.js`)**
  - Tarieven (OPSLAG, EB, BTW, vaste kosten, terugleveropslag — leveranciersafhankelijk)
  - LAT/LON voor Open-Meteo
  - Zonnepanelen: welke merken, aantal panelen per inverter, piekvermogen, efficiency
  - `APPARATEN` lijst (een ander huishouden heeft geen Volvo PHEV, wel misschien een EV-laadpaal)
  - `SOLAR_SOURCES` (alleen SolarEdge, alleen Growatt, beide, of geen)

  **C. Per-user secrets (nu globale Vercel env vars)**
  - SolarEdge API key + site ID
  - Growatt API token + device SN
  - Homey cloud ID + flow-namen voor laden start/stop
  - QStash + Redis blijven gedeeld; planning-keys moeten user-prefix krijgen (`laadplanning_<user>_<apparaat>`)
  - Niet realistisch om voor elke user nieuwe Vercel env vars handmatig in te stellen → secrets in Upstash Redis per user (of een aparte secrets-store).

  **D. Backend wijzigingen**
  - API endpoints moeten user-context kennen: route-param (`/api/u/<user>/solaredge`) of session/header.
  - `api/homey.js`, `api/planLaden.js`, `api/cronLaden.js`, `api/growatt.js`, `api/solaredge.js` — alle vijf zoeken nu in `process.env`; moeten naar user-lookup.
  - QStash callbacks moeten user-id meekrijgen in de body.

  **E. UX**
  - "Wie ben ik?" indicator in header (naam + avatar, of subtieler).
  - Setup-wizard voor nieuwe gebruiker (tarieven invoeren, API-keys koppelen, apparaten toevoegen).
  - Mogelijk een "demo-modus" voor mensen die het willen proberen zonder real-time API's.

  **F. Operationeel**
  - Hoe komt een nieuwe gebruiker erin: self-serve registratie of jij voegt handmatig toe?
  - Documentatie voor anderen om API-keys te vinden (SolarEdge dashboard, Growatt portal, Homey OAuth, etc.).
  - Privacy: alle user-data zit straks in Upstash Redis — dat moet versleuteld of in elk geval per-user gescheiden.

  **Open te bespreken:**
  - Doel = 1 specifieke extra persoon (snel + hands-on) of breed beschikbaar maken (uitgebreider)?
  - Account-systeem (echte auth) of light-weight (gedeelde URL met user-code)?
  - Multi-tenant op één deploy, of aparte deploy per user (simpel, schaalt niet)?

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

## Done

- Bug: "Kost € X meer" consistent tussen kaart en detailscherm
- Bug: iPhone pincode-veld niet meer onder toetsenbord
- Bug: pincode-state reset bij Start ↔ Stop switch
- Bug: "Morgen prijzen nog niet beschikbaar" niet meer dubbel
- Bug: solar-tegels consistent tussen Vandaag/Zon tab
- Bug: `renderTeruglevering` geen dubbele rijen meer
- Bug: grafiek-legenda alleen onder

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
