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
      homewizard:  true,
    },
    // HomeWizard P1 teken-conventie. Default false = standaard HomeWizard:
    // negatief vermogenW = teruglevering, positief = verbruik uit het net. Zet op
    // true als jouw meter teruglevering juist positief doorgeeft (omkeert alleen
    // de richting-interpretatie, niet de getoonde absolute waarde).
    homewizardVermogenInverteren: false,
    tarieven: {
      opslag:            0.02508, // € per kWh excl. btw (jaarnota 2025/2026)
      eb:                0.11618, // energiebelasting € per kWh excl. btw (gewogen gem. jaarnota 2025/2026)
      btw:               1.21,
      vasteKostenPerDag: 1.35,    // € per dag excl. btw
      teruglevering:     0.0353,  // afslag bij teruglevering € per kWh excl. btw
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
      { naam: 'Auto',                    icon: '🚗',       uren: 6,   vermogen: 2.3, type: 'laden',       automatisering: true,  batterij: true,  volgorde: 1, grootverbruik: false, klaarOmTekst: 'Auto moet opgeladen zijn om',       korteTekst: '🔋 Opgeladen zijn om' },
      { naam: 'Warmtepomp (warm water)', icon: '♨️',       uren: 2,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 6, grootverbruik: true,  klaarOmTekst: 'Warmtepomp moet gereed zijn om',    korteTekst: '♨️ Gereed zijn om',    opmerking: 'buffert warm water, niet voor verwarming' },
      { naam: 'Wasmachine',              icon: '👕',       uren: 2,   vermogen: 1.5, type: 'starten',     automatisering: false, batterij: false, volgorde: 3, grootverbruik: true,  klaarOmTekst: 'Wasmachine moet gereed zijn om',    korteTekst: '👕 Gereed zijn om',    comboMet: 'Droger', homeConnect: true, homeConnectControl: true, haId: null },
      { naam: 'Droger',                  icon: '🌀',       uren: 2,   vermogen: 2.0, type: 'starten',     automatisering: false, batterij: false, volgorde: 4, grootverbruik: true,  klaarOmTekst: 'Droger moet gereed zijn om',        korteTekst: '🌀 Gereed zijn om',    naApparaat: 'Wasmachine', homeConnect: true, homeConnectControl: true, haId: null },
      { naam: 'Vaatwasser',              icon: '🍽️',      uren: 3.5, vermogen: 1.8, type: 'starten',     automatisering: false, batterij: false, volgorde: 2, grootverbruik: true,  klaarOmTekst: 'Vaatwasser moet gereed zijn om',    korteTekst: '🍽️ Gereed zijn om'    },
      { naam: 'E-bikes (2x)',            icon: '🚲',       uren: 4,   vermogen: 0.2, type: 'laden',       automatisering: false, batterij: false, volgorde: 5, grootverbruik: false, klaarOmTekst: 'E-bike moet opgeladen zijn om',     korteTekst: '🚲 Opgeladen zijn om'  },
      { naam: 'Boiler kantoor',          icon: '🚿',       uren: 1,   vermogen: 2.5, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 7, grootverbruik: true,  klaarOmTekst: 'Boiler moet opgewarmd zijn om',     korteTekst: '🚿 Opgewarmd zijn om'  },
      { naam: 'Airco',                   icon: '❄️',       uren: 3,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 8, grootverbruik: true,  klaarOmTekst: 'Airco moet actief zijn om',         korteTekst: '❄️ Actief zijn om'    },
      // Oven + kookplaat: Home Connect kan deze niet veilig op afstand starten
      // (oven vereist fysieke Remote-Start-activatie, kookplaat is API-monitor-only).
      // Daarom homeConnect: true zonder homeConnectControl → alleen koppeling/status.
      { naam: 'Oven',                    icon: '🔥',       uren: 1,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 9,  grootverbruik: true,  klaarOmTekst: 'Oven moet gereed zijn om',          korteTekst: '🔥 Gereed zijn om',    homeConnect: true, haId: null },
      { naam: 'Kookplaat',               icon: '🍳',       uren: 0.5, vermogen: 3.5, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 10, grootverbruik: true,  klaarOmTekst: 'Kookplaat moet gereed zijn om',     korteTekst: '🍳 Gereed zijn om',    homeConnect: true, haId: null },
    ],
  };
})();
