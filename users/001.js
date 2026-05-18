// Gebruiker 001
// Bevat geen API keys. Tarieven, locatie, panelen en apparaten zijn niet-gevoelig.
(function() {
  window.CONFIG = {
    userId: '001',
    integraties: {
      solarEdge: true,
      growatt:   true,
      homey:     true,
    },
    tarieven: {
      opslag:            0.03073, // € per kWh excl. btw
      eb:                0.09161, // energiebelasting € per kWh excl. btw
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
      { naam: 'Auto (PHEV)',             icon: '🚗',       uren: 6,   vermogen: 2.3, type: 'laden',       automatisering: true,  batterij: true,  volgorde: 1, grootverbruik: false, klaarOmTekst: 'Auto moet opgeladen zijn om',       korteTekst: '🔋 Opgeladen zijn om' },
      { naam: 'Warmtepomp (warm water)', icon: '♨️',       uren: 2,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 6, grootverbruik: true,  klaarOmTekst: 'Warmtepomp moet gereed zijn om',    korteTekst: '♨️ Gereed zijn om',    opmerking: 'buffert warm water, niet voor verwarming' },
      { naam: 'Wasmachine',              icon: '👕',       uren: 2,   vermogen: 1.5, type: 'starten',     automatisering: false, batterij: false, volgorde: 3, grootverbruik: true,  klaarOmTekst: 'Wasmachine moet gereed zijn om',    korteTekst: '👕 Gereed zijn om',    comboMet: 'Droger' },
      { naam: 'Droger',                  icon: '🌀',       uren: 2,   vermogen: 2.5, type: 'starten',     automatisering: false, batterij: false, volgorde: 4, grootverbruik: true,  klaarOmTekst: 'Droger moet gereed zijn om',        korteTekst: '🌀 Gereed zijn om',    naApparaat: 'Wasmachine' },
      { naam: 'Vaatwasser',              icon: '🍽️',      uren: 3.5, vermogen: 1.8, type: 'starten',     automatisering: false, batterij: false, volgorde: 2, grootverbruik: true,  klaarOmTekst: 'Vaatwasser moet gereed zijn om',    korteTekst: '🍽️ Gereed zijn om'    },
      { naam: 'E-bikes (2x)',            icon: '🚲',       uren: 4,   vermogen: 0.2, type: 'laden',       automatisering: false, batterij: false, volgorde: 5, grootverbruik: false, klaarOmTekst: 'E-bike moet opgeladen zijn om',     korteTekst: '🚲 Opgeladen zijn om'  },
      { naam: 'Boiler kantoor',          icon: '🚿',       uren: 1,   vermogen: 2.5, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 7, grootverbruik: true,  klaarOmTekst: 'Boiler moet opgewarmd zijn om',     korteTekst: '🚿 Opgewarmd zijn om'  },
      { naam: 'Airco',                   icon: '❄️',       uren: 3,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 8, grootverbruik: true,  klaarOmTekst: 'Airco moet actief zijn om',         korteTekst: '❄️ Actief zijn om'    },
    ],
  };
})();
