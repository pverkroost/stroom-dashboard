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
      totaalPiekKw:  16, // placeholder DC-piek (zelfde als solarEdge.piekKw, geen growatt)
      rendement:     0.8,
      // Placeholder waarden — app overschrijft solarEdge.piekKw runtime met de
      // echte waarde uit /api/solaredge?type=details (gecached in localStorage).
      // 40 panelen visueel geteld; piekKw 16 = geschat DC-piek; AC nominaal omvormer ≈ 13,1 kW.
      solarEdge: { piekKw: 16, panelen: 40, locatie: 'dak' },
      growatt:   { piekKw: 0,  panelen: 0,  locatie: '—' },
    },
    apparaten: [
      { naam: 'Auto (PHEV)',             icon: '🚗',       uren: 3.5, vermogen: 7.2, type: 'laden',       automatisering: false, batterij: true,  volgorde: 1, grootverbruik: false, klaarOmTekst: 'Auto moet opgeladen zijn om',       korteTekst: '🔋 Opgeladen zijn om', batterijKwh: 25, omschrijving: 'Range Rover PHEV · 7.2 kW · ~25 kWh', autoInfo: { merk: 'Range Rover', type: 'PHEV', bouwjaar: 2021, batterijKwh: 25, laadVermogenKw: 7.2 } },
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
