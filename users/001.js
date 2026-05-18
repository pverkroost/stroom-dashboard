// Gebruiker 001 — Pieter
// Bevat geen API keys. Tarieven, locatie, panelen en apparaten zijn niet-gevoelig.
(function() {
  const VOLVO_SVG = `<svg viewBox="0 0 52 24" width="48" height="22" xmlns="http://www.w3.org/2000/svg" style="display:block;margin-bottom:2px">
  <path d="M4,20 L3,14 L6,12 L11,6 L37,6 L42,10 L48,10 L49,14 L49,20 Z" fill="#1a3a5c"/>
  <path d="M12,12 L15.5,7.5 L22,7.5 L22,12 Z" fill="#88c0d8" opacity="0.82"/>
  <rect x="23" y="7.5" width="10" height="4.5" rx="0.5" fill="#88c0d8" opacity="0.82"/>
  <path d="M34.5,7.5 L39,12 L34.5,12 Z" fill="#88c0d8" opacity="0.62"/>
  <line x1="23" y1="12" x2="23" y2="19.5" stroke="#14304e" stroke-width="0.8"/>
  <circle cx="12" cy="20" r="4" fill="#08141e"/>
  <circle cx="12" cy="20" r="1.8" fill="#2a4060"/>
  <circle cx="38" cy="20" r="4" fill="#08141e"/>
  <circle cx="38" cy="20" r="1.8" fill="#2a4060"/>
  <rect x="3" y="13.5" width="3" height="1.8" rx="0.6" fill="#f5e070"/>
  <rect x="46.5" y="11" width="2.5" height="2.5" rx="0.4" fill="#dd2222"/>
</svg>`;

  window.CONFIG = {
    userId: '001',
    tarieven: {
      opslag:            0.03073, // € per kWh excl. btw
      eb:                0.09161, // energiebelasting € per kWh excl. btw
      btw:               1.21,
      vasteKostenPerDag: 1.35,    // € per dag excl. btw
      teruglevering:     0.0353,  // afslag bij teruglevering € per kWh excl. btw
    },
    panelen: {
      lat:           52.36,
      lon:           6.46,
      totaalPiekKw:  7.8,
      rendement:     0.8,
      solarEdge: { piekKw: 3.2, panelen: 8,  locatie: 'garage/kantoor' },
      growatt:   { piekKw: 4.6, panelen: 14, locatie: 'huis' },
    },
    apparaten: [
      { naam: 'Auto (PHEV)',             icon: VOLVO_SVG, uren: 6,   vermogen: 2.3, type: 'laden',       automatisering: true,  batterij: true,  volgorde: 1, grootverbruik: false, klaarOmTekst: 'Auto moet opgeladen zijn om',       korteTekst: '🔋 Opgeladen zijn om' },
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
