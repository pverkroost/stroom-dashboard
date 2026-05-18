// Template voor gebruiker 002 — aanpassen bij onboarding
// Bevat geen API keys. Tarieven, locatie, panelen en apparaten zijn niet-gevoelig.
(function() {
  window.CONFIG = {
    userId: '002',
    integraties: {
      solarEdge: true,
      growatt:   false,
      homey:     false,
    },
    tarieven: {
      opslag:            0.03073, // voorlopig zelfde als 001
      eb:                0.09161,
      btw:               1.21,
      vasteKostenPerDag: 1.35,
      teruglevering:     0.0353,
    },
    panelen: {
      lat:           52.3667, // standaard Nijverdal — aanpassen bij onboarding
      lon:           6.4667,
      totaalPiekKw:  4.0,
      rendement:     0.8,
      solarEdge: { piekKw: 4.0, panelen: 10, locatie: 'dak' },
      growatt:   { piekKw: 0,   panelen: 0,  locatie: '—' },
    },
    apparaten: [
      { naam: 'Auto (EV)',    icon: '🚗',  uren: 6,   vermogen: 7.4, type: 'laden',       automatisering: false, batterij: true,  volgorde: 1, grootverbruik: false, klaarOmTekst: 'Auto moet opgeladen zijn om',    korteTekst: '🔋 Opgeladen zijn om' },
      { naam: 'Wasmachine',   icon: '👕',  uren: 2,   vermogen: 1.5, type: 'starten',     automatisering: false, batterij: false, volgorde: 2, grootverbruik: true,  klaarOmTekst: 'Wasmachine moet gereed zijn om', korteTekst: '👕 Gereed zijn om'    },
      { naam: 'Vaatwasser',   icon: '🍽️', uren: 3,   vermogen: 1.8, type: 'starten',     automatisering: false, batterij: false, volgorde: 3, grootverbruik: true,  klaarOmTekst: 'Vaatwasser moet gereed zijn om', korteTekst: '🍽️ Gereed zijn om'   },
      { naam: 'Boiler',       icon: '🚿',  uren: 1,   vermogen: 2.0, type: 'inschakelen', automatisering: false, batterij: false, volgorde: 4, grootverbruik: true,  klaarOmTekst: 'Boiler moet opgewarmd zijn om',  korteTekst: '🚿 Opgewarmd zijn om' },
    ],
  };
})();
