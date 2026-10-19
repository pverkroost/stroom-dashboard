// Gebruiker 003 — Patrick (Almelo), dynamisch contract bij Zonneplan.
// Bevat geen API keys. Tarieven, locatie, panelen en apparaten zijn niet-gevoelig.
// Server-side env vars: SOLAREDGE_API_KEY_003 + SOLAREDGE_SITE_ID_003.
// Patrick heeft geen Homey (bevestigd) en geen Growatt → geen env vars daarvoor.
(function() {
  window.CONFIG = {
    userId: '003',
    integraties: {
      solarEdge:   true,
      growatt:     false,
      homey:       false,
      homeConnect: true,   // Siemens-apparaten; Miele valt NIET onder Home Connect (eigen API)
      homewizard:  false,  // geen Homey → geen push-route
      homewizardCloud: true, // P1 via HomeWizard-cloud (primaire route voor 003; koppelen in Instellingen)
    },
    tarieven: {
      leverancier:       'Zonneplan',
      opslag:            0.01653, // inkoopvergoeding verbruik € per kWh excl. btw (€ 0,02 incl.)
      eb:                0.12599, // energiebelasting € per kWh excl. btw
      btw:               1.21,
      vasteKostenPerDag: 0.16986, // € per dag excl. btw
      // Zonneplan rekent bij teruglevering dezelfde inkoopvergoeding ERBIJ (geen afslag)
      // en keert daarbovenop een zonnebonus van 10% uit (tot 7500 kWh/jaar, alleen overdag —
      // beide grenzen worden nog niet gehandhaafd, zie js/prijsformule.js).
      teruglevering: {
        methode:              'opslag',
        bedrag:               0.01653,
        zonnebonusPct:        0.10,
        zonnebonusMaxKwhJaar: 7500,
      },
    },
    panelen: {
      lat:           52.33,   // De Raadsheer 16, 7609 WR Almelo
      lon:           6.69,
      totaalPiekKw:  10.344,
      rendement:     0.8,
      // Eén installatie van 24 panelen / 10,344 kWp op het huis in Almelo.
      // App overschrijft piekKw runtime met /api/solaredge?type=details.
      solarEdge: { piekKw: 10.344, panelen: 24, locatie: 'huis' },
      growatt:   { piekKw: 0,      panelen: 0, locatie: '—' },
    },
    // VOORLOPIGE DEFAULT — Patricks exacte apparatenlijst moet nog bevestigd worden.
    // Bevestigd: geen Homey (dus `automatisering: true` is hier nooit van toepassing) en
    // geen hybride/elektrische auto (dus géén apparaat met `batterij: true` — test/
    // prijsformule.test.js bewaakt dat). Snelkaart + weekschema voor de vaatwasser (sinds
    // v2.79.4) en de jacuzzi (sinds v2.83.2) — beide puur advies, geen aansturing; ook door
    // de test bewaakt.
    // Home Connect-koppeling (haId) gebeurt via Instellingen → Integraties → Home Connect.
    apparaten: [
      { naam: 'Vaatwasser', icon: '🍽️', uren: 3.5, vermogen: 1.8, type: 'starten', automatisering: false, batterij: false, volgorde: 1, grootverbruik: true, klaarOmTekst: 'Vaatwasser moet gereed zijn om', korteTekst: '🍽️ Gereed zijn om',
        // Snelkaart ("klaar om"): zelfde defaults als user 001 — doordeweeks 07:00, weekend 09:00.
        // Patrick kan ze zelf aanpassen in Instellingen → Weekschema (opslag in Neon).
        snelkaart: true, deadlineLabel: 'klaar om',
        weekschema: { ma: '07:00', di: '07:00', wo: '07:00', do: '07:00', vr: '07:00', za: '09:00', zo: '09:00' } },
      { naam: 'Wasmachine', icon: '👕', uren: 2,   vermogen: 1.5, type: 'starten', automatisering: false, batterij: false, volgorde: 2, grootverbruik: true, klaarOmTekst: 'Wasmachine moet gereed zijn om', korteTekst: '👕 Gereed zijn om', comboMet: 'Droger', homeConnect: true, homeConnectControl: true, haId: null },
      { naam: 'Droger',     icon: '🌀', uren: 2,   vermogen: 2.0, type: 'starten', automatisering: false, batterij: false, volgorde: 3, grootverbruik: true, klaarOmTekst: 'Droger moet gereed zijn om',     korteTekst: '🌀 Gereed zijn om', naApparaat: 'Wasmachine', homeConnect: true, homeConnectControl: true, haId: null },
      // Jacuzzi: advies-only (geen aansturing op afstand, net als de vaatwasser).
      // SCHATTINGEN — vermogen 3 kW en opwarmduur 8 u zijn aannames die Patrick nog moet
      // bevestigen/aanpassen. Snelkaart "klaar om": doordeweeks 's avonds warm, in het
      // weekend 's middags; Patrick kan dat zelf aanpassen via het weekschema (opslag in Neon).
      { naam: 'Jacuzzi',    icon: '🛁', uren: 8,   vermogen: 3,   type: 'inschakelen', automatisering: false, batterij: false, volgorde: 4, grootverbruik: true, klaarOmTekst: 'Jacuzzi moet opgewarmd zijn om', korteTekst: '🛁 Opgewarmd zijn om',
        snelkaart: true, deadlineLabel: 'klaar om',
        weekschema: { ma: '19:00', di: '19:00', wo: '19:00', do: '19:00', vr: '19:00', za: '15:00', zo: '15:00' } },
      // Sunshower (infrarood + UV): verbruik te klein om op prijs te sturen. Type
      // 'seizoensadvies' (v2.84.0) → geen snelkaart, starttijd, weekschema, plan-knop of
      // prijsgrafiek; de kaart in "Slim inplannen" toont per huidige maand een advies
      // (UV = vitamine D, IR = warmte). Bereiken zijn inclusief en mogen over de
      // jaarwisseling lopen; uren/vermogen zijn hier bewust leeg (niet relevant).
      { naam: 'Sunshower',  icon: '🌞', uren: null, vermogen: null, type: 'seizoensadvies', automatisering: false, batterij: false, volgorde: 5, grootverbruik: false,
        seizoensadvies: [
          { van: 'okt', tot: 'mrt', tekst: 'UV-seizoen: de zon staat te laag voor vitamine D. 2 à 3 UV-sessies per week, overdag. IR naar wens.' },
          { van: 'apr', tot: 'mei', tekst: 'Afbouwen: de natuurlijke zon neemt het over. IR naar wens.' },
          { van: 'jun', tot: 'aug', tekst: 'UV niet nodig, je krijgt genoeg buiten. IR naar wens.' },
          { van: 'sep', tot: 'sep', tekst: 'Rustig opstarten met UV. IR naar wens.' },
        ] },
    ],
  };
})();
