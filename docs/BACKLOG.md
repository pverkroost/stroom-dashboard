# Energie IQ — Backlog

## BUGS (eerst fixen)

- [x] **#1 Apparaatscherm te negatief** ✅ Afgerond in v2.53.0 — rode/oranje
  "kost € X meer" badges en regels verwijderd. Beste tijd toont "bespaar
  € X.XX" in groen, geselecteerd/nu toont groen "beste tijd ✓" (bij gelijk)
  of grijs neutraal "beste tijd: € X.XX goedkoper" (bij slechter). Toegepast
  op apparaatkaartjes, detail panel, vertrekplanner en tijdlijn-tooltip.

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
  parameter gebouwd in v2.54.0. Eén Vercel deploy met `users/<id>.js`
  voor niet-gevoelige config (tarieven, panelen, apparaten) en
  `USERS_MAPPING` env var voor server-side userId → slug vertaling.
  Per-user env vars: `SOLAREDGE_API_KEY_<SLUG>`, `GROWATT_API_TOKEN_<SLUG>`,
  `HOMEY_CLOUD_ID_<SLUG>`, `APP_PINCODE_<SLUG>`. Redis-keys nu
  `laadplanning_<slug>_<apparaat>`. Echte auth (#19) nog niet gebouwd.

- [ ] **#19 Multi-tenant architectuur** — Echte SaaS wanneer 5+ gebruikers.
  Auth via Clerk/Supabase, per-user tarieven/panelen/apparaten/API-secrets
  in Upstash Redis, laadplanning_<user>_<apparaat>.

## NICE-TO-HAVE

- [ ] Warmtepomp via API (Daikin/Mitsubishi/Nibe/Vaillant/Bosch)
- [ ] Boiler via Homey
- [ ] "Volledig gratis op zon"-badge als solar > apparaatverbruik
- [ ] Geselecteerd-uur-lijn doortrekken op Morgen + Zon tab

## OPEN VRAGEN

- HomeWizard P1 aanschaffen? (€29, blokkeert #11 en #12)
- Welke netbeheerder? (Enexis-portal check uitgesteld)
- Welk merk warmtepomp?
- Dakrichting/hoek panelen? (verbetert Open-Meteo nauwkeurigheid)
- API Client (OAuth2) in Homey — weggooien of bewaren?
- HOMEY_TOKEN env var — nog gebruikt of dood?

## CONCURRENTIEANALYSE

### HomeWizard Energy+ (€0,99/m of €11,95/j)
Doen wel: schakelen op goedkoopste uren, zonne-energie surplus,
P1 realtime verbruik, sluipverbruik, omvormers koppelen.
Doen NIET: kostenvergelijking per apparaat vooraf, klaar-om logica,
EPEX grafiek 24+ uur, EV batterijdelta, Homey flows.
Onderscheid Energie IQ: planningsintelligentie, kostentransparantie,
EV-logica, Homey-automatisering, actiegericht.
