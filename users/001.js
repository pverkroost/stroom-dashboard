// Gebruiker 001
// Bevat geen API keys. Tarieven, locatie, panelen en apparaten zijn niet-gevoelig.
(function() {
  window.CONFIG = {
    userId: '001',
    integraties: {
      solarEdge:   true,
      growatt:     true,
      homey:       true,
      homeConnect: true,
      homewizard:  true,   // P1 via Homey-push (primair, realtime)
      homewizardCloud: true, // P1 via HomeWizard-cloud als fallback wanneer de Homey-push hapert
    },
    // HomeWizard P1 teken-conventie. Default false = standaard HomeWizard:
    // negatief vermogenW = teruglevering, positief = verbruik uit het net. Zet op
    // true als jouw meter teruglevering juist positief doorgeeft (omkeert alleen
    // de richting-interpretatie, niet de getoonde absolute waarde).
    homewizardVermogenInverteren: false,
    tarieven: {
      leverancier:       'Sepa Green',
      opslag:            0.02508, // € per kWh excl. btw (jaarnota 2025/2026)
      eb:                0.11618, // energiebelasting € per kWh excl. btw (gewogen gem. jaarnota 2025/2026)
      btw:               1.21,
      vasteKostenPerDag: 1.35,    // € per dag excl. btw
      // Sepa Green brengt een vaste afslag in rekening bij teruglevering:
      // terugleverprijs = (epex − bedrag) × btw. Zie js/prijsformule.js.
      teruglevering:     { methode: 'afslag', bedrag: 0.0353 }, // € per kWh excl. btw
    },
    panelen: {
      lat:           52.3667, // Nijverdal
      lon:           6.4667,
      totaalPiekKw:  7.8,
      rendement:     0.8,
      solarEdge: { piekKw: 3.2, panelen: 8,  locatie: 'garage/kantoor' },
      growatt:   { piekKw: 4.6, panelen: 14, locatie: 'huis' },
    },
    apparaten: [
      { naam: 'Auto',                    icon: '🚗',       uren: 6,   vermogen: 2.3, type: 'laden',       automatisering: true,  batterij: true,  volgorde: 1, grootverbruik: false, klaarOmTekst: 'Auto moet opgeladen zijn om',       korteTekst: '🔋 Opgeladen zijn om',
        // Snelkaart bovenaan de hoofdtab: deadline per weekdag ("vertrek om"). Dit zijn de
        // defaults; het opgeslagen weekschema uit Neon (Instellingen → Weekschema) gaat voor.
        snelkaart: true, deadlineLabel: 'vertrek om',
        weekschema: { ma: '06:30', di: '06:30', wo: '08:15', do: '06:30', vr: '08:15', za: '09:00', zo: '09:00' } },
      { naam: 'Warmtepomp (warm water)', icon: '♨️',       uren: 2,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 6, grootverbruik: true,  klaarOmTekst: 'Warmtepomp moet gereed zijn om',    korteTekst: '♨️ Gereed zijn om',    opmerking: 'buffert warm water, niet voor verwarming' },
      { naam: 'Wasmachine',              icon: '👕',       uren: 2,   vermogen: 1.5, type: 'starten',     automatisering: false, batterij: false, volgorde: 3, grootverbruik: true,  klaarOmTekst: 'Wasmachine moet gereed zijn om',    korteTekst: '👕 Gereed zijn om',    comboMet: 'Droger', homeConnect: true, homeConnectControl: true, haId: null },
      { naam: 'Droger',                  icon: '🌀',       uren: 2,   vermogen: 2.0, type: 'starten',     automatisering: false, batterij: false, volgorde: 4, grootverbruik: true,  klaarOmTekst: 'Droger moet gereed zijn om',        korteTekst: '🌀 Gereed zijn om',    naApparaat: 'Wasmachine', homeConnect: true, homeConnectControl: true, haId: null },
      { naam: 'Vaatwasser',              icon: '🍽️',      uren: 3.5, vermogen: 1.8, type: 'starten',     automatisering: false, batterij: false, volgorde: 2, grootverbruik: true,  klaarOmTekst: 'Vaatwasser moet gereed zijn om',    korteTekst: '🍽️ Gereed zijn om',
        // Snelkaart ("klaar om"): puur advies — de vaatwasser heeft geen aansturing.
        snelkaart: true, deadlineLabel: 'klaar om',
        weekschema: { ma: '07:00', di: '07:00', wo: '07:00', do: '07:00', vr: '07:00', za: '09:00', zo: '09:00' } },
      { naam: 'E-bikes (2x)',            icon: '🚲',       uren: 4,   vermogen: 0.2, type: 'laden',       automatisering: false, batterij: false, volgorde: 5, grootverbruik: false, klaarOmTekst: 'E-bike moet opgeladen zijn om',     korteTekst: '🚲 Opgeladen zijn om'  },
      { naam: 'Boiler kantoor',          icon: '🚿',       uren: 1,   vermogen: 2.5, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 7, grootverbruik: true,  klaarOmTekst: 'Boiler moet opgewarmd zijn om',     korteTekst: '🚿 Opgewarmd zijn om'  },
      { naam: 'Airco',                   icon: '❄️',       uren: 3,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 8, grootverbruik: true,  klaarOmTekst: 'Airco moet actief zijn om',         korteTekst: '❄️ Actief zijn om'    },
      // Oven + kookplaat: Home Connect kan deze niet veilig op afstand starten
      // (oven vereist fysieke Remote-Start-activatie, kookplaat is API-monitor-only).
      // Daarom homeConnect: true zonder homeConnectControl → alleen koppeling/status.
      { naam: 'Oven',                    icon: '🔥',       uren: 1,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 9,  grootverbruik: true,  klaarOmTekst: 'Oven moet gereed zijn om',          korteTekst: '🔥 Gereed zijn om',    homeConnect: true, haId: null },
      { naam: 'Kookplaat',               icon: '🍳',       uren: 0.5, vermogen: 3.5, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 10, grootverbruik: true,  klaarOmTekst: 'Kookplaat moet gereed zijn om',     korteTekst: '🍳 Gereed zijn om',    homeConnect: true, haId: null },
    ],
    // Energie-inzicht (Inzicht-tab, v2.90.0). Historische cijfers uit de Sepa Green
    // jaarnota's. Korrel = factuurjaar (mei–mei) met de factuurperiodes eronder; de
    // maandbedragen zijn VOORSCHOT (termijnbedragen), niet werkelijke kosten per maand.
    // afname/teruglevering = kWh bruto van de slimme meter. kostenIncl = werkelijke
    // kosten incl. btw per periode (levering + belasting + netbeheer + vaste kosten).
    // Nieuwe jaarnota erbij? Voeg een factuurjaar toe (periodewaarden uit de nota).
    facturen: [
      {
        jaar: '2024/2025', van: '2024-05-03', tot: '2025-05-03',
        leverancier: 'Sepa Green', saldering: true, gasInclBtw: 353.97, gasM3: 3,
        periodes: [
          { van: '2024-05-03', tot: '2025-01-01', afname: 5239, teruglevering: 2675, kostenIncl: 725.07 },
          { van: '2025-01-01', tot: '2025-05-03', afname: 5767, teruglevering: 794,  kostenIncl: 1428.87 },
        ],
        voorschot: { mei: 158.00, jun: 158.00, jul: 158.00, aug: 158.00, sep: 158.00, okt: 158.00, nov: 158.00, dec: 158.00, jan: 158.00, feb: 158.00, mrt: 158.00, apr: 158.00 },
        bijbetaling: 611.91,
      },
      {
        jaar: '2025/2026', van: '2025-05-03', tot: '2026-05-03',
        leverancier: 'Sepa Green', saldering: false, gasInclBtw: 0, gasM3: 0,
        periodes: [
          { van: '2025-05-03', tot: '2025-10-17', afname: 2603, teruglevering: 2044, kostenIncl: 649.38 },
          { van: '2025-10-17', tot: '2026-01-01', afname: 3599, teruglevering: 26,   kostenIncl: 762.92 },
          { van: '2026-01-01', tot: '2026-05-03', afname: 5934, teruglevering: 756,  kostenIncl: 1507.50 },
        ],
        voorschot: { mei: 52.15, jun: 122.45, jul: 123.51, aug: 143.12, sep: 150.82, okt: 176.56, nov: 230.98, dec: 267.54, jan: 311.60, feb: 282.35, mrt: 455.44, apr: 256.15 },
        bijbetaling: 347.13,
      },
    ],
  };
})();
