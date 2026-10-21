# Energie IQ - Claude Instructies

## Project
Energie IQ is een persoonlijk dashboard voor een dynamisch stroomcontract (Sepa Green). De app combineert EPEX day-ahead prijzen met zonne-opbrengst (SolarEdge + Growatt) en weersverwachting, en stuurt slimme stekkers via Homey aan voor automatisch laden op het goedkoopste moment.

Het hoofdbestand is `index.html`. De legacy `stroom-dashboard.html` is verwijderd.

## Versienummering
Bij elke aanpassing aan `index.html` of de bijbehorende `js/`/`css/` bestanden:
- Hoog het versienummer automatisch op (vX.Y.0 → vX.Y+1.0 voor kleine features, vX.Y.0 → vX.Y.1 voor bugfixes/kleine wijzigingen)
- Update zowel de placeholder in de footer (`<span id="versionStamp">`) als de `?v=…` cache-bust querystrings op de `<script src>` regels
- `js/app.js` overschrijft de footer runtime met versie + huidige Nederlandse datum/tijd (Europe/Amsterdam) — format: `vX.Y.Z · DD-MM-YYYY HH:mm`

## Workflow & deployment (sinds v2.86.1)
Alles gaat **direct naar `main`** — geen feature-branches, geen pull requests. Eerdere PR-/branch-
verwijzingen in de changelog (PR #4 … #14) zijn historisch. Vercel deployt automatisch vanuit `main`.
- **Harde eis vóór elke push**: `npm test` groen én ESLint 0 errors. Niet groen = niet pushen; eerst
  fixen, dan pas committen en pushen.
- Elke aanpassing meteen committen en pushen met een duidelijke Nederlandse commit message die
  beschrijft wát er gewijzigd is (en waarom, als dat niet voor zich spreekt). Versienummer ophogen
  (zie *Versienummering*) en de changelog in `docs/BACKLOG.md` bijwerken.
- **Zware bewijslast blijft** — ook al gaat het direct naar `main` — voor werk dat geld raakt
  (kosten, scoring, prijs-/besparingsberekening, uren/kW van apparaten) of fysieke aansturing
  (Homey start/stop, Home Connect start, QStash-planning): eigen proef met handberekening in een test,
  meten in plaats van aannemen, en een smoke-test tegen de echte user-config (`users/<id>.js`) in de
  browser (Playwright + mock-API) vóór de push. Niet licht afdoen omdat er geen reviewstap meer is.
- Puur cosmetisch/documentatie: klein en omkeerbaar, maar dezelfde harde eis (test + lint) geldt.

## Architectuur
- **Frontend**: vanilla JS + Chart.js, geserveerd vanuit de repo-root (`index.html`, `css/`, `js/`).
  `js/prijsformule.js` = pure prijsformule (verbruik + parametrische teruglevering), zonder DOM,
  gedeeld door de browser (geladen vóór `js/config.js`) en `npm test` (`test/prijsformule.test.js`).
  PWA-basis sinds v2.76.2: `manifest.json` + `icons/` (standalone homescreen-app, opent op de
  hoofdtab). Bewust geen service worker — offline/push komt met backlog #97.
- **Backend**: serverless functies in `api/` (Vercel)
  - `api/growatt.js` — Growatt OpenAPI plant data
  - `api/solaredge.js` — SolarEdge Monitoring API (overview/power/energy)
  - `api/homey.js` — Homey cloud webhook proxy + connectivity check
  - `api/homewizard.js` — HomeWizard P1 live verbruik/teruglevering: POST (Homey-push, gedeelde push-token) cachet in Redis, GET levert aan de frontend.
    Sinds v2.79.0 ook de cloud-fallback via `?action=cloudstatus|cloudsetup|cloudpoll|cloudunlink` (sessie vereist) — zie *HomeWizard cloud-fallback*
  - `api/homeconnect.js` — Home Connect (BSH) OAuth2 auth-redirect + appliance status/start/stop (sessie)
  - `api/homeconnect/callback.js` — OAuth2 redirect-target: code → tokens in Redis (state-CSRF-verified)
  - `api/planLaden.js` — plant laad-actie via QStash (publishJSON met delay)
  - `api/cronLaden.js` — wordt door QStash aangeroepen om Homey-webhook te triggeren
  - `api/auth.js` — login/logout/me samengevoegd in één function (routing via `?action=`),
    om onder de Vercel Hobby 12-functie-limiet te blijven (bcrypt + HMAC sessie-cookie).
    Sinds v2.76.0 ook `?action=schema` (GET/POST weekschema snelkaarten, tabel `user_schedule`),
    sinds v2.85.0 `?action=apparaten` (GET/POST kW/uren-overrides, tabel `user_apparaat`, sessie vereist)
  - `api/db/migrate.js` — maakt `app_user`-, `user_schedule`- en `user_apparaat`-tabel in Neon (idempotent).
    Vereist `MIGRATE_SECRET` (Bearer-header of `?secret=`), anders 401 — zie *Security*
- **Auth-libs** (root `lib/`, gedeeld door api): `lib/session.js` (HMAC encode/decode + `eq_session`-cookie),
  `lib/auth.js` (`getSession`/`requireSession` uit request-cookie), `lib/crypto.js` (AES-256-GCM voor
  per-user credentials in Redis), `lib/homewizard-cloud.js` (HomeWizard cloud-protocol + sessie-cache).
- **State**: laadplanningen in Upstash Redis (sleutel `laadplanning_<userId>_<apparaat>`, bv. `laadplanning_001_autophev`).
  Home Connect-tokens in `homeconnect_tokens_<userId>`, OAuth state-nonces in `homeconnect_state_<state>`.
  HomeWizard P1 live meetwaarde in `homewizard_<userId>` (`{ vermogenW, importKwh?, exportKwh?, updatedAt, bron:'homey'|'cloud' }`, TTL 600s).
  HomeWizard-cloud: credentials versleuteld in `hw_cloud_creds_<userId>`, token + device_id in `hw_cloud_session_<userId>` (TTL 3000s).
  Gebruikers (email + bcrypt-hash + userId) in Neon PostgreSQL tabel `app_user`.
  Weekschema snelkaarten in Neon tabel `user_schedule` (user_id, apparaat_key, dag 0-6, tijd 'HH:MM').
  kW/uren-overrides per apparaat in Neon tabel `user_apparaat` (user_id, apparaat_key, data JSONB) — zie *Apparaat-overrides*.

## Auth (sinds v2.72.0)
Echte login met e-mail + wachtwoord i.p.v. de rauwe `?u=`-parameter. Login, logout
en me zitten sinds v2.74.1 in één function `api/auth.js` (routing via `?action=login`
/`logout`/`me`) om onder de Vercel Hobby 12-functie-limiet te blijven; de beveiliging
per actie is ongewijzigd. Stateless: na login zet `POST /api/auth?action=login` een
HMAC-ondertekende `HttpOnly` cookie `eq_session` (30 dagen) met `{ uid, email, userId }`.
`getValidUserId` (in `api/_helpers.js`) leest eerst die sessie, valt anders terug op
`?u=` (backwards-compat tijdens de transitie — niet meteen verwijderen). `js/bootstrap.js`
doet bij laden `GET /api/auth?action=me`: 401 → login-overlay, 200 → laadt `users/<id>.js`
+ app-modules. Bedien-acties (Homey start/stop, `planLaden` POST/DELETE, Home Connect
start/stop) vereisen sinds v2.77.0 een geldige sessie via `requireSessionUserId` — géén
`?u=`-fallback. De vroegere pincode (`APP_PINCODE_<id>`) is toen vervallen: sinds de echte
login was hij een dubbele laag die vooral frictie gaf; netto blijft één verplichte laag
(de sessie) over, niet nul.
Wachtwoorden: bcrypt (cost 10) in Neon-tabel `app_user`. Nieuwe gebruiker:
`node scripts/create-user.mjs`. Rate limiting op de login-actie: 10 pogingen per IP per
5 min (`applyGate`, sliding window via Upstash). Generieke foutmelding (geen e-mail-
enumeratie) + timing-egalisatie met dummy bcrypt-compare. Uitloggen via knop in de
Instellingen-tab → `POST /api/auth?action=logout` (wist `eq_session`). `SESSION_SECRET`
env var vereist (min. 32 tekens).

## Weekschema-snelkaarten (sinds v2.76.0)
Bovenaan de hoofdtab (`#snelkaartSection`, boven "Slim inplannen") staat per apparaat met
`snelkaart: true` in `users/<id>.js` een kaart die direct het aanbevolen startmoment toont
("Zet nu aan" / "Zet aan om HH:MM") o.b.v. een deadline uit een vast weekschema
(`deadlineLabel`: "klaar om" voor de vaatwasser, "vertrek om" voor de auto).
- **Snelkaart-principe (sinds v2.88.0)**: de hele kaart is klikbaar naar het detailscherm (hint
  "Meer ›" in de kop); op de kaart staan alleen de primaire acties ("📅 Plan in" / "⚡ Nu starten" /
  "■ Stoppen"). Elke knop vangt zijn eigen tik af (`event.stopPropagation()`), ook de twee staps
  "Zeker? Nu starten" — een knop-tik opent nooit het detailscherm. De vroegere kaart-links "andere tijd"
  (sessie-overrule) en "weekschema" zijn weg: een andere starttijd kies je in het detailscherm
  (grafiek/handmatig), het weekschema stel je daar of in Instellingen in.
- **Beheer per apparaat (sinds v2.80.0)**: één generieke editor (`weekschemaEditorHtml(ap, locatie)` in
  `js/weekschema.js`: 7 dagen, Opslaan, Standaard, bron-regel) klapt uit in het detailscherm
  (`weekschemaDetailDeel(ap)`, locatie `'detail'`, in place ververst via `#wsDetail-<key>`; v2.88.0)
  én bij het apparaat in Instellingen → Apparaten (knop "📅 Weekschema" + samenvatting in de rij, via
  `weekschemaLijstDeel(ap)`; sinds v2.80.1 — de losse Weekschema-sectie en de vroegere kruistabel zijn
  weg; apparaten zonder weekschema tonen niets). Opslaan gaat per apparaat (`POST ?action=schema` met alleen die sleutel; de server
  vervangt per apparaat, de respons bevat alleen dat apparaat → lokaal mengen, niet vervangen).
  Herbouw-bestendig: open/dicht per plek in `_wsEditorOpen`, onopgeslagen invoer in `_wsDraft[key]`,
  feedback in `_wsMsg`; de apparatenlijst wordt niet herbouwd zolang een editorveld focus heeft, en
  rij-drag start niet vanuit de editor.
- **Code**: `js/weekschema.js` (kaarten, editor + beheer in detail/Instellingen; apparaat-sleutel =
  `ap.key`, zie *Apparaat-identiteit*) + gedeelde helper
  `berekenBlokVoorDeadline(uren, kW, deadlineDate, planUren)` en `deadlineVanHHMM()` in
  `js/apparaten.js`. Die helper vervangt de vroeger gedupliceerde deadline-filtering in
  `herbereken()` (vertrekplanner) en `hcGoedkoopsteBlok()` (Home Connect).
- **Defaults**: per apparaat `weekschema: { ma:'07:00', …, zo:'09:00' }` in `users/<id>.js`.
  Opgeslagen waarden uit Neon gaan daar overheen; de server kent de defaults niet
  (`bron: 'default'` = niets opgeslagen → frontend gebruikt config).
- **Opslag**: tabel `user_schedule` (één rij per user/apparaat/dag, dag = JS `getDay()`,
  0 = zondag). `GET /api/auth?action=schema` (userId via sessie of `?u=`) en
  `POST /api/auth?action=schema` `{ schema: { <apSleutel>: { <dag>: 'HH:MM' } } }`
  (sessie vereist, vervangt per apparaat, rate limit 30/min/IP). Bewust op `api/auth.js`
  gehangen: geen 12e function verbruiken (#97), en de Neon-client + sessie-check zaten daar al.
  Na deploy éénmalig `GET /api/db/migrate` aanroepen voor de nieuwe tabel (met `MIGRATE_SECRET`,
  zie *Security*).
- **Auto**: SoC is onbekend → de kaart rekent altijd met de volle `ap.uren`. "Plan in via
  Homey" (sinds v2.88.0 "📅 Plan in") opent het bestaande detailpaneel met het berekende blok voorgeselecteerd en start
  de bestaande `planInladen`-flow (sessie-auth). De vaatwasser heeft geen aansturing: puur advies.
- **Direct starten/stoppen vanaf de kaart (sinds v2.87.0, alleen Homey-apparaten)**: knop
  "⚡ Nu starten" met bevestigingsstap op de kaart zelf (eerste tik → "Zeker? Nu starten", of
  "Zeker? Start nu, planning van HH:MM vervalt" bij een actieve QStash-planning; tweede tik voert
  uit; terugval na `_WS_BEVESTIG_MS` = 6 s; geen modale dialoog). Kern = gedeelde
  `startStopViaHomey(action, key, { planningActief })` in `js/apparaten.js` (POST `/api/homey`,
  sessie vereist; na een geslaagde start wordt de planning gewist), ook gebruikt door `homeyActie`
  in het detailscherm. Na een start toont de kaart "⚡ Laden gestart" + "■ Stoppen" zolang de
  sessie leeft (de app kent de echte laadstatus niet, backlog #3); eigen statusregel op de kaart,
  401 → "Niet ingelogd — log opnieuw in om te bedienen". State in `_snelkaartStart`
  (`snelkaartStartKnopHtml`, `snelkaartStartTik`, `snelkaartStopTik`). Test: `test/snelkaartstart.test.js`.
- **Randgeval**: deadline voorbij de bekende prijzen terwijl morgen-prijzen nog niet binnen
  zijn (vóór ~14:00): de helper geeft `wachtOpMorgen: true` én, als dat kan, een haalbaar venster van
  vandaag. Sinds v2.86.0 (brede variant, `kiesSnelkaartAdvies(haalbaar, wachtOpMorgen)` in
  `js/apparaatmodel.js`) is een haalbaar venster altijd het advies, met de hint "morgen-prijzen nog
  onbekend" in de subregel; "⏳ Wacht op morgen-prijzen" alleen als er géén venster vóór de deadline is.
  Zo zeggen snelkaart en detailscherm hetzelfde. De subregel toont de deadline ("klaar om HH:MM") alleen
  als het blok binnen `_WS_DEADLINE_TOON_MS` (3 u) vóór de deadline klaar is (v2.85.2).

## Apparaat-identiteit: stabiele `key` (sinds v2.83.1)
Elk apparaat in `APPARATEN` heeft een stabiele `ap.key` (`^[a-z0-9]{1,20}$`), gezet bij het laden door
`APPARAATMODEL.zetApparaatKeys(window.CONFIG.apparaten)` in `js/config.js` (in place, zelfde array-referentie).
`js/apparaatmodel.js` is een pure UMD-module (browser-namespace `APPARAATMODEL`, Node via require), geladen
tussen `js/prijsformule.js` en `js/config.js`. Fundament voor user-bewerkbare apparaten (later): code
identificeert een apparaat via `ap.key`, nooit meer via `ap.naam` of de array-index.
- **KRITIEK**: voor config-apparaten uit `users/<id>.js` is `key = apSleutel(naam)` (lowercase, alleen
  `[a-z0-9]`, max 20 tekens) — exact de sleutel die al in Neon (`user_schedule.apparaat_key`), Redis
  (`laadplanning_<userId>_<key>`) en de Home Connect-planning staat. `test/apparaatkey.test.js` borgt
  `key == apSleutel(naam)` voor 001/002/003 tegen de letterlijke oude implementatie. Een expliciete `key`
  in de config wint; botsingen krijgen een volgnummer (`lamp1`, `lamp12`); lege naam → `apparaat`.
- **Gebruik**: `ap.key` in `js/apparaten.js` (planning-API's, Home Connect, `apDetailState`) en
  `js/weekschema.js` (`_wsDraft`, `_wsEditorOpen`, schema-POST). `apSleutel(naam)` bestaat nog als
  compat-global in `js/config.js`, maar nieuwe code gebruikt `ap.key`.
- **localStorage op key, met eenmalige migratie** van de oude naam-/index-sleutels:
  `apparaten_config` `{ <key>: { volgorde } }` (was `{ <naam>: … }`; rijen in Instellingen → Apparaten
  dragen `data-key`), `homeconnect_mapping` `{ <key>: haId }` (was naam; `koppelHcAppliance(haId, key)`),
  `ap_voorkeur_<key>` (was `ap_voorkeur_<apIdx>`; wordt alleen geschreven). `getApparaatConfig()` en
  `hcMapping()` verplaatsen bestaande naam-sleutels naar de key en schrijven dat meteen terug.
- **Nog op naam**: de config-kruisverwijzingen `comboMet: 'Droger'` / `naApparaat: 'Wasmachine'` in
  `users/<id>.js` (was/droger-chaining). Bewust buiten deze refactor; omzetten naar key zodra apparaten
  user-bewerkbaar worden.

## Apparaat-overrides: kW en uren per user bewerkbaar (sinds v2.85.0, PR B stap 1)
Bestaande apparaten krijgen per user bewerkbare `vermogen` (kW) en `uren`, opgeslagen in Neon.
Nog niet: apparaten toevoegen/verwijderen of naam/icoon/type wijzigen (latere stap; tabel en
endpoint zijn daar generiek voor opgezet).
- **Tabel** `user_apparaat (user_id, apparaat_key, data JSONB, updated_at)`, PK (user, apparaat).
  Eén rij per apparaat met een JSON-object; nu alleen `{ vermogen?, uren? }` (server-whitelist).
  Idempotent in `api/db/migrate.js` — na deploy éénmalig `/api/db/migrate` aanroepen (`MIGRATE_SECRET`).
- **Endpoint** `GET/POST /api/auth?action=apparaten` (`handleApparaten`), **alleen met sessie** — géén
  `?u=`-fallback, ook niet voor GET (legacy `?u=`-modus ziet dus de config-waarden). Rate limit 30/min/IP.
  GET → `{ apparaten: { <key>: { vermogen?, uren? } }, bron }`; POST `{ key, vermogen?, uren? }` mengt in
  de rij (JSONB `||`, respons = samengevoegde data); POST `{ key, reset: true }` wist de rij ("Standaard").
  Ontbrekende tabel: GET degradeert naar `{}` met waarschuwing, POST → 503.
- **Validatie** (gedeeld, `valideerOverride` in `js/apparaatmodel.js`, ook door de server gebruikt):
  numeriek (komma toegestaan), vermogen > 0 en ≤ 50 kW, uren > 0 en ≤ 24, 2 decimalen, minstens één
  veld; onbekende velden vallen weg. Ongeldige DB-data wordt op GET genegeerd.
- **Merge-regel** (`pasApparaatOverridesToe(apparaten, overrides)`, puur): `ap.basis = { uren, vermogen }`
  is de config-waarde, vastgezet door `zetApparaatBasis` in `js/config.js` direct na de keys en **nooit
  meer overschreven**. Elke toepassing herberekent vanuit de basis: override-veld wint, anders config;
  `ap.override` = actieve override of `null`. Geen override (001/002) = bitwise de config-waarden.
  Uitgesloten (`isOverrideBewerkbaar`): auto (`batterij`, kenteken-flow zet kW/uren — rij toont
  "kW/uren via kenteken"), seizoensadvies, en apparaten zonder numerieke config-basis.
- **Frontend** `js/apparaatoverrides.js` (geladen na `js/weekschema.js`): `laadApparaatOverrides()` haalt
  na het laden op (app.js; één rerender als iets afwijkt), past in place toe op `APPARATEN`;
  Instellingen → Apparaten krijgt per bewerkbaar apparaat een knop "✏️ kW / uren" met uitklap-editor
  (twee numerieke velden, Opslaan, Standaard, statusregel "Standaard: 8 uur · 3 kW"), rij-subregel
  "· aangepast" bij een actieve override. Zelfde herbouw-bestendige state als de weekschema-editor
  (`_apEditorOpen`, `_apDraft`, `_apMsg`); de editor draagt `class="ws-editor ap-editor"` zodat de
  bestaande focus- en drag-guards gelden. Tests: `test/apparaatoverrides.test.js` (merge, grenzen,
  endpoint met gestubde Neon + echte sessie-cookie).

## Kaarttype seizoensadvies (sinds v2.84.0)
Derde smaak naast prijs-aansturing en advies-only: een apparaat met `type: 'seizoensadvies'`
(bv. Patricks Sunshower, infrarood + UV — verbruik te klein om op prijs te sturen) adviseert op
basis van de **huidige kalendermaand** (Europe/Amsterdam), niet op prijs of starttijd.
- **Config** per apparaat: `seizoensadvies: [ { van: 'okt', tot: 'mrt', tekst }, … ]` — bereiken
  inclusief, NL-maandafkorting (`jan`…`dec`) of 1–12, mogen over de jaarwisseling lopen; eerste
  passende bereik wint. `uren`/`vermogen` mogen `null` zijn. Teksten staan in `users/<id>.js`,
  niet in `js/`.
- **Helpers** (puur, `js/apparaatmodel.js`): `seizoensadviesTekst(lijst, maand)`,
  `seizoensadviesOntbrekendeMaanden(lijst)` (test-borging: `[]`), `huidigeMaandAmsterdam()`,
  `isSeizoensadvies(ap)`, `MAANDEN`/`MAAND_NAMEN`. Test: `test/seizoensadvies.test.js`.
- **Weergave**: `seizoensadviesKaartHtml(ap)` in `js/apparaten.js` rendert in de gewone
  "Slim inplannen"-grid (`renderApparaat` kiest 'm op type) als `.advies-card` met icoon, naam,
  "Seizoensadvies · <maand>" en de maandtekst. Geen snelkaart, weekschema, starttijd, plan-knop
  of prijsgrafiek; `openApDetail` doet niets voor dit type. Instellingen → Apparaten toont
  "seizoensadvies · per maand" als subregel.

## Apparaat-detailscherm (renderApDetail in `js/apparaten.js`)
Eén render-functie voor alle apparaten; de varianten (auto/Homey, Home Connect bestuurbaar of
alleen-monitoring, advies-only) komen uit drie vlaggen: `ap.batterij`, `ap.automatisering &&
heeftIntegratie('homey')`, `ap.homeConnect && heeftIntegratie('homeConnect')` (+ `homeConnectControl`).
- **Structuur (sinds v2.81.0)**, van boven naar beneden: 0 auto-details (batterij) · 0a kopregel
  (kW · uur · kWh) · 1 batterij-slider (batterij) · **2 prijstegels** `#prijsTegels` (links "Beste tijd"
  = onbegrensd goedkoopste blok, rechts "Nu meteen" of — zodra in de grafiek gekozen — "Gekozen tijd")
  + **besparingsbalk** `#besparingBalk` ("⬇ Bespaar € Z door te wachten tot HH:MM" / "✓ Nu is al het
  beste moment" / na kiezen "Beste tijd is € X goedkoper" of "✓ Dit is het beste moment") · 5 actie-zone
  per variant (Homey: Plan dit in + Opgeladen zijn om/Handmatig + Nu starten/stoppen; Home Connect:
  Deze tijd overnemen + `#hcDetailSectie`; advies-only: tip-strook `#adviesTip` "✋ Zet 'm zelf aan om
  HH:MM") · **6 klikbare prijsgrafiek onderaan** ("Tik op een uur om een andere starttijd te kiezen",
  sinds v2.83.0 het enige visuele tijd-element; de balkjes-slider is weg): dezelfde prijsgrafiek
  als op de hoofdtab via `bouwPrijsGrafiek()` uit `js/prijzen.js` in `#apChart`, met
  `onKlik: kiesStartIdx` — een tik op een uur kiest dat startuur. Gekozen venster omlijnd, beste
  venster licht gevuld, uren voorbij `maxIdx` (blok past niet meer vóór de horizon) gedimd; een tik
  daar clampt naar de laatst mogelijke start. `renderApGrafiek()` bouwt hem één keer per render,
  `updateApGrafiekMarkering()` → `updateGrafiekMarkering()` hertekent alleen de markering,
  `sluitApDetail` ruimt de instantie op. Het handmatig-blok (tijdveld + 15-min-steppers) blijft
  de precisie-/toetsenbordroute. Tegels + balk + tip zijn één implementatie voor alle varianten;
  alleen de actie-zone verschilt.
- **Kiezen**: `kiesStartIdx(idx)` is de ene gedeelde kies-functie (clamp op `maxIdx`, `_minuteOffset`
  0, `_handmatigGekozen` true → rechtertegel "Gekozen tijd", `updateKostenWeergave`, bij actieve
  planning `planInladen(true)`). Grafiekklik, vertrekplanner-"Overnemen" (`overneemSuggestie`) en het
  handmatig-blok (`adjustApDetail`/`selTijdWijzig`) schrijven allemaal `apDetailState.currentStartIdx`.
- **Rekenen/verversen**: `berekenBesparingNu(uren, kW, planUren, besteIdx)` (naast `effectieveKosten`)
  → `{ kostenNu, kostenBeste, besparing, nuIsBeste, gedeeltelijk, dekkingBeste/Nu, beste/nu-tijden }`.
  `_prijsOverzicht(berekendeUren)` leest `apDetailState` (gekozen = `_handmatigGekozen`, rest-laadtijd
  uit de batterij-slider); `prijsTegelsHtml(r, sel)`, `besparingBalkHtml(r, sel, leegTekst)`,
  `adviesTipHtml(tijd)` bouwen de HTML; `_verversPrijsOverzicht` vervangt ze op id vanuit
  `updateKostenWeergave` (slider/batterij) — geen volledige herrender. De deadline-blokken
  (vertrekplanner, Home Connect plan-blok) houden hun eigen vergelijking. Test:
  `test/besparing.test.js` (laadt `js/apparaten.js` in een vm-context met zon-stubs).
- **Weergave**: `fmtEuro(n)` (in `js/prijsformule.js`, compat-wrapper in `js/config.js`) → komma
  (`€ 1,50`); gebruikt in het detailscherm en de "Slim inplannen"-kaarten. `zonDekkingTekst()`
  → "volledig op eigen zonnestroom" / "60% op zon" in tegels en balk (handmatig-blok en
  vertrekplanner tonen nog "☀️ 60%"). De berekening zelf is ongewijzigd.
- **Prijsgrafiek gedeeld**: `bouwPrijsGrafiek(canvas, prijzen, { tooltipEl?, onSelect?, markering?, onKlik? })`
  in `js/prijzen.js` is de enige Chart.js-opbouw van de prijsgrafiek (bars, terugleverlijn, zon,
  dag-overgang, "nu"-lijn). Hoofdtab: `renderGrafiek(prijzen)` koppelt `onSelect` aan
  `geselecteerdStartTijd` (de "Keuze"-rij van de kaarten) en is **niet** klikbaar (geen `onKlik`).
  Detailscherm: zonder `onSelect`, mét markering en `onKlik`. `options.onClick` en de pointer-cursor
  worden alleen gezet als `onKlik` meegegeven is. Test: `test/prijsgrafiek.test.js`.

## HomeWizard cloud-fallback (sinds v2.79.0)
Live P1-verbruik komt primair via de Homey-push (`POST /api/homewizard` met `HOMEWIZARD_PUSH_TOKEN_<id>`).
Voor users zonder Homey (003) of als de push hapert (001) is er een fallback via de
**ongedocumenteerde HomeWizard cloud-API** (gereverse-engineerd; zie de Homey-apps van
smarthomesven/jtebbens en de PyPI-library `homewizard-cloud`). **Onderhoudsrisico**: HomeWizard
kan dit zonder aankondiging breken; dan faalt `cloudpoll` netjes en toont de tegel "geen live data".
- **Credentials door de user zelf**: Instellingen → Integraties → rij "HomeWizard cloud" → "Koppelen"
  (uitklappaneel, sinds v2.79.1 de enige plek) → e-mail + wachtwoord → "Koppelen"
  (`POST ?action=cloudsetup`, sessie vereist). De server valideert live (auth + discovery) en slaat
  pas dan op. **Niet** in Vercel env vars, niet door de beheerder. De UI toont alleen
  gekoppeld/niet-gekoppeld + e-mail, nooit het wachtwoord; het komt ook niet in logs of responses.
- **Versleuteling** (`lib/crypto.js`): AES-256-GCM, random IV per blob, formaat `v1.<base64url>`.
  Sleutel = env `CREDS_ENCRYPTION_KEY` (64 hex) als gezet, anders HKDF uit `SESSION_SECRET`.
  Let op: `SESSION_SECRET` roteren zonder `CREDS_ENCRYPTION_KEY` maakt opgeslagen credentials
  onleesbaar → users moeten opnieuw koppelen. (De Home Connect-tokens staan nog plaintext in Redis —
  kandidaat om ook via `lib/crypto.js` te laten lopen.)
- **Protocol** (`lib/homewizard-cloud.js`, bewezen met `tmp/hw-cloud-test.js`): auth GET
  `api.homewizardeasyonline.com/v1/auth/account/token` (Basic) → token (~3300 s); discovery GET
  `homes.api.homewizard.com/locations` → `device_id` (`p1dongle/<hex>`, **niet** het numerieke `id`);
  live via WebSocket `wss://energy-app-ws.homewizard.com/ws/`: hello `{type,message_id:1,compatibility:5,
  os:'android',source:'nl.homewizard.android.energy',token,version:'2024.1.0'}` → 200 → `subscribe_device`
  (message_id 2) → eerste `p1dongle`-state met `active_power_w` (~4 s) → verbinding dicht (open-pak-sluit).
- **Serverless**: token + device_id gecachet in `hw_cloud_session_<userId>` (TTL 3000 s); een gewone
  `cloudpoll` doet alleen de WebSocket-stap. Bij 401 op de hello één re-auth met de opgeslagen credentials.
  Server-side throttle: cloud-waarde jonger dan 1 min wordt hergebruikt; verse Homey-data (< 5 min,
  bron ≠ cloud) heeft altijd voorrang en voorkomt een cloud-call.
- **Frontend** (`js/solar.js` `fetchHomeWizard`, `js/homewizardcloud.js`): 1. verse Homey-data → gebruik;
  2. anders en `integraties.homewizardCloud` → `cloudpoll` (max 1× per 2 min per tab); 3. anders
  "geen live data". Tegel toont de bron ("via Homey" / "via HomeWizard cloud").
  **Handmatige bron-keuze** (v2.79.2, in het uitklappaneel, alleen voor users met óók de Homey-route):
  `localStorage` `hwBron_<userId>` = `auto` (default) | `homey` | `cloud`. `cloud` stuurt `{ forceCloud: true }`
  mee naar `cloudpoll` zodat de server de Homey-voorrang overslaat (1-min-throttle blijft). Testdoel; geen gevoelige data.
- **Config**: `integraties.homewizardCloud: true` in `users/001.js` (fallback) en `users/003.js` (primair).
- **Afhankelijkheid**: `ws` (Node-WebSocket-client; Vercel-runtime heeft niet gegarandeerd een globale WebSocket).

## Security
Gecentraliseerd in `api/_helpers.js` (gedeeld door alle endpoints):
- **Rate limiting**: sliding window via Upstash Redis (`INCR` + `EXPIRE`). Login 10/5min per IP.
  Fail-open bij Redis-storing zodat een Upstash-uitval de app niet platlegt.
- **Sessie-auth op bedien-endpoints**: `requireSessionUserId` (401 zonder geldige
  `eq_session`) op `/api/homey` POST, `/api/planLaden` POST/DELETE,
  `/api/homeconnect?action=start|stop` en alle `/api/homewizard?action=cloud*`-acties.
  Lees-acties mogen nog via `getValidUserId` (`?u=`).
- **Credential-versleuteling**: HomeWizard-cloud e-mail + wachtwoord AES-256-GCM in Redis
  (`lib/crypto.js`), nooit in logs/responses — zie *HomeWizard cloud-fallback*.
- **Brute-force lockout op token-endpoints**: telt 401-failures per IP+endpoint in een
  15-min window. 5+ fails → 5 min lockout, 10+ fails → 1 u lockout (`recordAuthFailure` /
  `checkAuthLockout`). Succesvolle token wist de teller (`clearAuthFailures`). Sinds v2.77.0
  alleen nog op `/api/db/migrate` (de pincode-endpoints bestaan niet meer).
- **CORS-lockdown**: alleen `https://energieiq.nl` en `https://stroom-dashboard.vercel.app`
  krijgen een `Access-Control-Allow-Origin`-header (`ALLOWED_ORIGINS`).
- **QStash signature-verificatie**: `cronLaden` valideert binnenkomende calls via
  `@upstash/qstash` Receiver (current + next signing key).
- **Migrate-endpoint achter token**: `GET /api/db/migrate` vereist `MIGRATE_SECRET` (env var,
  min. 32 tekens) via `Authorization: Bearer <token>` of `?secret=<token>`; timing-safe
  vergelijking, 401 zonder schema-info, 503 (fail-closed) als de var ontbreekt. Rate limit
  5/min/IP + brute-force-lockout. Aanroepen:
  `curl -H "Authorization: Bearer $MIGRATE_SECRET" https://energieiq.nl/api/db/migrate`
- **Home Connect OAuth CSRF**: `state`-nonce in Redis, éénmalig consumeerbaar in de callback.
- **XSS**: `escapeHtml()` in `js/config.js` voor alle 3rd-party/user-data die naar `innerHTML` gaat.
- **ESLint** geconfigureerd, 0 errors.

## Multi-user (sinds v2.54.0)
Eén Vercel deploy, meerdere gebruikers via `?u=001` URL-parameter.
- **`users/<id>.js`** zet `window.CONFIG` (niet-gevoelige config: tarieven, panelen, apparaten).
  Geldige user-id's hardcoded in `js/bootstrap.js` (`GELDIGE_USERS`); onbekend → fallback naar `001`.
  Profielen: `001` = Pieter (Sepa Green; SolarEdge + Growatt + Homey + Home Connect),
  `002` = vriend (alleen SolarEdge; geen Growatt, geen Homey),
  `003` = Patrick, Almelo (Zonneplan; SolarEdge 10,344 kWp + Home Connect voor zijn
  Siemens-apparaten; geen Growatt, geen Homey, geen auto (beide bevestigd); P1 via HomeWizard-cloud;
  snelkaart + weekschema voor de vaatwasser (v2.79.4) en de jacuzzi (v2.83.2, advies-only;
  3 kW / 8 u zijn schattingen die Patrick nog moet bevestigen); Sunshower als
  `seizoensadvies`-apparaat (v2.84.0, zie *Kaarttype seizoensadvies*).
  Apparatenlijst is nog een voorlopige default; Miele-apparaten vallen buiten Home Connect en
  worden niet ondersteund).
  Het `integraties`-veld per user bepaalt welke secties/tegels getoond worden (`heeftIntegratie()`).
- **Server-side**: alle `/api/*` endpoints lezen `?u=<id>` (of body), valideren tegen
  `VALID_USERS = ['001', '002', '003']` (`api/_helpers.js`), en lezen env vars met userId-suffix
  (`process.env[`SOLAREDGE_API_KEY_${userId}`]`). Geen mapping-tabel — userId IS de suffix.
- **Frontend fetch helper**: `apiUrl(path)` in `js/config.js` hangt `?u=<id>` aan elke `/api/*` call.
- **QStash → cronLaden**: body bevat ook `userId` zodat cronLaden de juiste Homey cloud-id pakt
  bij de scheduled webhook (na signature-verificatie).
- **Toevoegen nieuwe user**: maak `users/<nieuw-id>.js` (incl. `tarieven.teruglevering`
  als object), update de lijst op **2 plekken**: `GELDIGE_USERS` in `js/bootstrap.js` en
  `VALID_USERS` in `api/_helpers.js` (alle endpoints lezen die), vul per-user env vars in
  Vercel en maak een login aan met `node scripts/create-user.mjs <email> <ww> "<naam>" <id>`.
  `npm test` rekent de `users/*.js`-tarieven door.

## Auto / Kenteken
Voertuigspecs voor het laad-apparaat "Auto" via kenteken-lookup, **server-side in `api/kenteken.js`**:
- **RDW Open Data** (geen API-key): basisdata (merk/handelsbenaming) + brandstofdata voor PHEV/BEV-detectie.
- **`ev-database.json`** — eigen curated database (~66 PHEV/EV-modellen populair in NL), match op
  `rdwHandelsbenaming`; heeft **altijd voorrang** bij conflict met externe bronnen.
- **KilowattApp open-ev-data** (`kilowatt-ev-data.json`, 1300+ BEVs) — fallback voor onbekende
  BEVs, alleen voor non-PHEV (MIT-licentie, attributie vereist in Integraties-tab).
- Bij meerdere varianten: response `meerdereVarianten: true` → frontend toont dropdown.
- **Laadtype-selectie** (stekker / laadpaal 1- of 3-fase / anders): `werkelijkKw = Math.min(autoMaxKw, laadtypeKw)`.
- Frontend bewaart de keuze in `localStorage` onder `autoConfig_${userId}`.
- Volledige bron-/matchvolgorde-details: zie `README.md` → *Kenteken lookup*.

## Externe APIs
- **EnergyZero** (`api.energyzero.nl/v1/energyprices`) — EPEX day-ahead prijzen, excl. btw
- **Open-Meteo** — weersverwachting voor zonne-opbrengst voorspelling (LAT/LON in `js/config.js`)
- **Growatt OpenAPI** — plant power voor 14 panelen op huis
- **SolarEdge Monitoring API** — 8 panelen op garage/kantoor (overview, power per uur, energy per dag)
- **Homey** (`<cloud-id>.connect.athom.com`) — slimme stekker bediening via webhooks
- **Home Connect** (`api.home-connect.com`) — BSH-apparaten (Siemens/Bosch/Neff/Gaggenau) via OAuth2.
  Wasmachine/droger: programma's + opties + start/inplannen (`FinishInRelative`). Oven/kookplaat: alleen-monitoring.
  Vaatwasser wordt niet ondersteund via Home Connect. Volledige setup-instructie in `README.md` → *Home Connect*.
- **Upstash Redis + QStash** — persistente laadplanning en scheduled triggers

### Home Connect setup (kort)
1. developer.home-connect.com → applicatie: OAuth = Authorization Code Grant Flow,
   Redirect URI = `https://energieiq.nl/api/homeconnect/callback`, Scope = `IdentifyAppliance Monitor Control`.
2. Vercel env: `HOMECONNECT_CLIENT_ID` + `HOMECONNECT_CLIENT_SECRET` (globaal), en `APP_URL` = `https://energieiq.nl`
   (redirect-URI wordt hieruit afgeleid en moet exact matchen).
3. Home Connect-app op telefoon: apparaten koppelen, "Remote Start" aanzetten, programma selecteren.
4. Energie IQ → Instellingen → Integraties → rij "Home Connect" → "Koppelen" (uitklappaneel, sinds v2.79.3 de enige plek)
   → "Koppel Home Connect" → inloggen → apparaten koppelen aan Energie IQ-apparaten.

**Implementatie:**
- OAuth2 Authorization Code Flow (`api/homeconnect.js` + `api/homeconnect/callback.js`).
- Programma's én opties worden volledig **dynamisch** uit de API gelezen — geen hardcoded
  waarden. Aansturen: wasmachine + droger. Monitoring-only: oven + kookplaat.
- **Droger-chaining**: na het inplannen van de wasmachine biedt de UI aan de droger
  aansluitend in te plannen.
- Timing via `FinishInRelative` — de machine bepaalt zelf het startmoment zodat het
  programma op het gekozen tijdstip klaar is. Blijft als directe-start fallback.
- **Slim inplannen op goedkoopste EPEX-uur (sinds v2.73.0, #91)**: zelfde QStash-patroon
  als de auto, maar `type:'homeconnect'`. `api/planLaden.js` berekent niets zelf —
  de frontend zoekt het goedkoopste blok (`berekenGoedkoopsteBlok`, evt. begrensd door
  een "klaar om"-deadline) en POST't `{ type:'homeconnect', apparaat, haId, programKey,
  options, startTijd }`. Eén QStash-bericht (geen stop, machine stopt zelf) → op het
  geplande moment doet `api/cronLaden.js` `PUT /programs/active`. Status in Redis
  (`gepland`/`gestart`/`fout`); 409 = "Remote Start staat uit" → definitieve fout
  (geen QStash-retry), overige fouten → 502 zodat QStash retry't. Annuleren = DELETE
  (QStash-message + Redis wissen). Na het inplannen van de was: droger-chaining-knop.

## Environment variables (Vercel)
Alle in Settings → Environment Variables van het Vercel-project:

**Globaal (gedeeld over users):**

| Variable                      | Waarde / omschrijving                                    |
|-------------------------------|----------------------------------------------------------|
| `APP_URL`                     | Volledige basis-URL voor self-callbacks vanuit QStash    |
| `QSTASH_TOKEN`                | Upstash QStash publish token                             |
| `QSTASH_CURRENT_SIGNING_KEY`  | Huidige QStash signing key (signature verificatie cronLaden) |
| `QSTASH_NEXT_SIGNING_KEY`     | Volgende QStash signing key (key rotation)               |
| `UPSTASH_REDIS_REST_URL`      | Upstash Redis REST endpoint                              |
| `UPSTASH_REDIS_REST_TOKEN`    | Upstash Redis REST token                                 |
| `HOMECONNECT_CLIENT_ID`       | Home Connect (BSH) OAuth2 client id (gedeeld)            |
| `HOMECONNECT_CLIENT_SECRET`   | Home Connect (BSH) OAuth2 client secret (gedeeld)        |
| `DATABASE_URL`                | Neon PostgreSQL connection string (via Vercel↔Neon-integratie) |
| `SESSION_SECRET`              | HMAC-secret voor `eq_session`-cookie — min. 32 tekens, sterk random |
| `MIGRATE_SECRET`              | Token voor `/api/db/migrate` — min. 32 tekens, sterk random (≠ SESSION_SECRET) |
| `CREDS_ENCRYPTION_KEY`        | Optioneel: 64 hex-tekens (32 bytes) voor versleuteling van per-user credentials in Redis. Niet gezet → afgeleid uit `SESSION_SECRET` |

**Per gebruiker (suffix = userId, bv. `_001`, `_002`):**

| Variable suffix               | Omschrijving                                             |
|-------------------------------|----------------------------------------------------------|
| `GROWATT_API_TOKEN_<NNN>`     | Growatt OpenAPI token per user                           |
| `SOLAREDGE_API_KEY_<NNN>`     | SolarEdge Monitoring API key per user                    |
| `SOLAREDGE_SITE_ID_<NNN>`     | SolarEdge site ID per user                               |
| `HOMEY_CLOUD_ID_<NNN>`        | Homey cloud-id per user                                  |
| `HOMEWIZARD_PUSH_TOKEN_<NNN>` | Gedeelde secret die de Homey-flow meestuurt bij de P1-push naar `/api/homewizard` POST |

### Vercel env vars setup (overgang naar genummerde suffixen)

Hernoemen (nieuwe maken met waarde van oude → Vercel redeploy → oude verwijderen):
- `GROWATT_API_TOKEN` → `GROWATT_API_TOKEN_001`
- `SOLAREDGE_API_KEY` → `SOLAREDGE_API_KEY_001`
- `SOLAREDGE_SITE_ID` → `SOLAREDGE_SITE_ID_001`
- `HOMEY_CLOUD_ID` → `HOMEY_CLOUD_ID_001`

Nieuw toevoegen (leeg laten tot user 002 echte keys heeft):
- `GROWATT_API_TOKEN_002`, `SOLAREDGE_API_KEY_002`, `SOLAREDGE_SITE_ID_002`,
  `HOMEY_CLOUD_ID_002`

Vercel heeft geen rename-knop; maak de nieuwe `_001` aan, trigger redeploy,
verwijder daarna de oude variabele zonder suffix.

Client-side constanten staan per-user in `users/<id>.js` (zet `window.CONFIG`):
- `tarieven.opslag` / `eb` / `btw` / `vasteKostenPerDag` / `teruglevering`
- `panelen.lat` / `lon` — locatie voor Open-Meteo
- `panelen.solarEdge.piekKw` + `growatt.piekKw` — piekvermogens panelen
- `apparaten` — lijst met vermogen, draaiuren, automatisering-vlag etc.

`js/config.js` is een thin compat-laag die `window.CONFIG.*` exposeert als
oude constants (`OPSLAG`, `EB`, `LAT`, `APPARATEN`, …) zodat bestaande code
ongewijzigd werkt. Pas waarden aan in het juiste `users/<id>.js` bestand.

## Prijsformule (parametrisch per user, sinds v2.78.0)
Alle rekenwerk zit in `js/prijsformule.js` (pure functies, getest in `test/prijsformule.test.js`,
`npm test`). `js/config.js` blijft de compat-laag: `berekenTerugleverPrijs(epex)` (1 arg) en
`berekenPrijs(epex)` in `js/prijzen.js` delegeren aan de 2-arg varianten met `window.CONFIG.tarieven`.

```
verbruiksprijs  = (epex + opslag + eb) × btw                         (alle contracten)
teruglevering, per user via tarieven.teruglevering:
  { methode: 'afslag', bedrag }        → (epex − bedrag) × btw         Sepa Green (001, 002)
  { methode: 'opslag', bedrag,
    zonnebonusPct?, zonnebonusMaxKwhJaar? }
                                       → (epex + bedrag) × btw         Zonneplan (003)
    met zonnebonus (alleen 'opslag'): als zonnebonusPct > 0 én (epex + bedrag) > 0
                                       → (epex + bedrag) × (1 + zonnebonusPct) × btw
```
- Een kaal getal (`teruglevering: 0.0353`, nog in `users/002.js`) = afslag met dat bedrag.
  `normaliseerTeruglevering()` gooit bij een ongeldige methode/bedrag — geen stille 0.
- `TERUGLEVERING` (genormaliseerd object) en `TERUGLEVERING_OPSLAG` (compat: afslag-bedrag,
  0 bij methode 'opslag') staan in `js/config.js`. Nieuwe code gebruikt de functies, niet de constante.
- **Vereenvoudiging zonnebonus**: Zonneplan keert de 10% alleen overdag (zonsopkomst–ondergang)
  en tot 7500 kWh/jaar uit. Beide grenzen worden bewust **niet** gehandhaafd; de bonus geldt op
  alle uren. Geen half-werkende zonsopkomst-detectie bouwen — pas verfijnen met een echte
  zon-op/onder-bron (Open-Meteo levert `sunrise`/`sunset`). Vervolgitem in backlog.
- Instellingen → Tarieven wordt per user gerenderd uit `window.CONFIG.tarieven` (`renderInstellingen`),
  incl. `tarieven.leverancier` als die gezet is.
- **Geld-kritisch**: bij elke wijziging aan de formule eerst de verwachte waarden met de hand
  uitrekenen en in de test zetten; `npm test` moet groen zijn. Backward-compat voor 001 is
  bitwise getest tegen de oude `(epex − 0.0353) × 1.21`.

## Tarieven (Sepa Green, excl. btw) — referentie voor 001
Bron: Sepa Green Energy jaarnota 2025/2026. Aanpassen in `users/001.js`; de Tarieven-sectie
in Instellingen wordt daaruit gerenderd.

| Tarief                        | Waarde            | Constante in code        |
|-------------------------------|-------------------|--------------------------|
| Inkoopvergoeding              | € 0,02508 / kWh   | `OPSLAG`                 |
| Energiebelasting              | € 0,11618 / kWh   | `EB`                     |
| BTW                           | 21 %              | `BTW = 1.21`             |
| Vaste kosten (lev. + netbeh.) | € 1,35 / dag      | `VASTE_KOSTEN_PER_DAG`   |
| Afslag bij teruglevering      | € 0,03530 / kWh   | `tarieven.teruglevering = { methode:'afslag', bedrag }` |

`EB` is het gewogen gemiddelde over de jaarnota-perioden: periode 1+2 (4131 kWh à € 0,122863)
en periode 3 (5178 kWh à € 0,110848) → € 0,11618/kWh. `BTW` is een **vermenigvuldiger** (1.21),
géén percentage — niet als `0.21` opslaan, dat breekt de prijsformule.

Prijsformule: zie *Prijsformule (parametrisch per user)* hierboven.

## Tarieven (Zonneplan, excl. btw) — referentie voor 003
| Tarief                        | Waarde            |
|-------------------------------|-------------------|
| Inkoopvergoeding (verbruik)   | € 0,01653 / kWh (€ 0,02 incl.) |
| Energiebelasting              | € 0,12599 / kWh   |
| BTW                           | 21 %              |
| Vaste kosten                  | € 0,16986 / dag   |
| Vergoeding bij teruglevering  | EPEX **+** € 0,01653 / kWh (zelfde inkoopvergoeding als verbruik) |
| Zonnebonus                    | + 10 % over (EPEX + vergoeding), max 7500 kWh/jaar, alleen overdag (niet gehandhaafd) |
