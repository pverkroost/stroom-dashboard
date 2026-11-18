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
    // Gemeten maandverbruik van de slimme meter uit de tijd bij Essent (vóór Sepa Green).
    // Bron: Essent "Uw historisch verbruik"-PDF (maandelijkse energierapporten). Dit zijn
    // werkelijk gemeten waarden (kWh én gas m³), geen euro-schattingen. Gebruikt voor de
    // "Van het gas af"-sectie in de Inzicht-tab: gasverbruik valt na de warmtepomp
    // (geplaatst 10 april 2024) naar nul. 2024 is partieel (jan t/m apr, tot de warmtepomp).
    // afname/terug = kWh bruto; gasM3 = m³. Optelling + borging: test/inzicht.test.js.
    verbruikHistorie: {
      bron: 'Essent slimme meter',
      jaren: [
        { jaar: '2021', maanden: [
          { m: '2021-01', afname: 329, terug: 5,   gasM3: 345 },
          { m: '2021-02', afname: 288, terug: 31,  gasM3: 296 },
          { m: '2021-03', afname: 243, terug: 170, gasM3: 247 },
          { m: '2021-04', afname: 199, terug: 327, gasM3: 191 },
          { m: '2021-05', afname: 164, terug: 299, gasM3: 123 },
          { m: '2021-06', afname: 177, terug: 334, gasM3: 36 },
          { m: '2021-07', afname: 223, terug: 251, gasM3: 39 },
          { m: '2021-08', afname: 133, terug: 272, gasM3: 20 },
          { m: '2021-09', afname: 330, terug: 170, gasM3: 67 },
          { m: '2021-10', afname: 410, terug: 36,  gasM3: 158 },
          { m: '2021-11', afname: 524, terug: 6,   gasM3: 227 },
          { m: '2021-12', afname: 489, terug: 1,   gasM3: 289 },
        ] },
        { jaar: '2022', maanden: [
          { m: '2022-01', afname: 448, terug: 3,   gasM3: 310 },
          { m: '2022-02', afname: 561, terug: 36,  gasM3: 234 },
          { m: '2022-03', afname: 596, terug: 217, gasM3: 233 },
          { m: '2022-04', afname: 397, terug: 302, gasM3: 170 },
          { m: '2022-05', afname: 236, terug: 345, gasM3: 61 },
          { m: '2022-06', afname: 368, terug: 337, gasM3: 36 },
          { m: '2022-07', afname: 137, terug: 369, gasM3: 22 },
          { m: '2022-08', afname: 189, terug: 359, gasM3: 32 },
          { m: '2022-09', afname: 227, terug: 178, gasM3: 82 },
          { m: '2022-10', afname: 248, terug: 43,  gasM3: 119 },
          { m: '2022-11', afname: 318, terug: 6,   gasM3: 217 },
          { m: '2022-12', afname: 360, terug: 1,   gasM3: 320 },
        ] },
        { jaar: '2023', maanden: [
          { m: '2023-01', afname: 407, terug: 3,   gasM3: 277 },
          { m: '2023-02', afname: 706, terug: 14,  gasM3: 254 },
          { m: '2023-03', afname: 407, terug: 96,  gasM3: 255 },
          { m: '2023-04', afname: 257, terug: 282, gasM3: 167 },
          { m: '2023-05', afname: 189, terug: 365, gasM3: 78 },
          { m: '2023-06', afname: 197, terug: 386, gasM3: 40 },
          { m: '2023-07', afname: 305, terug: 148, gasM3: 40 },
          { m: '2023-08', afname: 316, terug: 0,   gasM3: 26 },
          { m: '2023-09', afname: 298, terug: 67,  gasM3: 47 },
          { m: '2023-10', afname: 265, terug: 53,  gasM3: 114 },
          { m: '2023-11', afname: 391, terug: 30,  gasM3: 231 },
          { m: '2023-12', afname: 522, terug: 4,   gasM3: 275 },
        ] },
        { jaar: '2024', partieel: true, maanden: [
          { m: '2024-01', afname: 542, terug: 15,  gasM3: 326 },
          { m: '2024-02', afname: 359, terug: 51,  gasM3: 216 },
          { m: '2024-03', afname: 280, terug: 263, gasM3: 200 },
          { m: '2024-04', afname: 469, terug: 419, gasM3: 30 },
        ] },
      ],
    },
    // Warmtepomp terugverdienmodel (Inzicht-tab). Bronnen: factuur Schuttevaar 240311
    // (incl. btw € 18.863,49) en ISDE-beschikking (€ 3.300); gas afsluiten was gratis.
    // Op aannames — géén aparte meter op de warmtepomp:
    //  - gasVervangenM3Jaar = gemeten gemiddelde vóór de warmtepomp (2021 2038, 2022 1836,
    //    2023 1804 m³ uit verbruikHistorie), afgerond.
    //  - warmtepompstroom/jaar = gasVervangenM3Jaar × kWhPerM3 / scop (afgeleid, niet gemeten).
    //  - gasPrijsPerJaar = all-in markt-gasprijs per m³ incl. energiebelasting + btw (wat je
    //    anders had betaald). JAARLIJKS bijwerken; 'default' geldt voor jaren zonder eigen waarde.
    // De gerealiseerde besparing groeit vanzelf mee met de datum (js/inzicht.js warmtepompAnalyse).
    warmtepomp: {
      toestel:             'Mitsubishi Ecodan PUHZ-SW100YAA',
      installDatum:        '2024-04-10',
      investeringInclBtw:  18863.49,
      subsidie:            3300,      // ISDE
      gasVervangenM3Jaar:  1800,      // gemeten gemiddelde 2021–2023, afgerond
      kWhPerM3:            8.8,       // bruikbare warmte per m³ gas (HR-ketel, praktijk)
      scop:                3.2,       // Ecodan lucht/water, huis uit 1964, radiatoren
      stroomPrijs:         0.26,      // € per kWh (winter-zwaar, grotendeels net)
      gasVastrechtJaar:    200,       // vermeden vastrecht gas per jaar
      gasPrijsPerJaar:     { 2024: 1.30, 2025: 1.45, 2026: 1.40, default: 1.40 },
      levensduurJaar:      18,        // gemiddeld 15–20 jaar
      bijgewerkt:          '2026-11-17',
    },
    // Totale energiekosten (incl. btw) per Essent-contractjaar (20 feb t/m 19 feb), uit de
    // Essent-jaarrekeningen in de mail. Inclusief gas. De Sepa-jaren komen uit `facturen`
    // (jaarTotalen). Samen de "Kosten per jaar"-grafiek in de Inzicht-tab.
    kostenHistorie: [
      { jaar: '2021/2022', leverancier: 'Essent', periode: '20 feb 2021 t/m 19 feb 2022', kostenIncl: 2000.87, stroom: 111.05, gas: 1889.82, inclGas: true },
      { jaar: '2022/2023', leverancier: 'Essent', periode: '20 feb 2022 t/m 19 feb 2023', kostenIncl: 1730.89, stroom: -52.99, gas: 1783.88, inclGas: true },
      { jaar: '2023/2024', leverancier: 'Essent', periode: '20 feb 2023 t/m 19 feb 2024', kostenIncl: 2382.36, stroom: 382.40, gas: 1999.96, inclGas: true },
    ],
    // Zonnepanelen-terugverdienmodel (Inzicht-tab). Twee installaties:
    //  - Growatt: InstallStore factuur 2000299 (10-04-2020), PV-regel € 4.876,03 excl. btw
    //    (14× URE 310 Wp + Growatt 4200 MTLS). De 21% btw (~€ 1.024) is teruggevraagd bij de
    //    Belastingdienst = de "subsidie"; netto investering = het ex-btw-bedrag.
    //  - SolarEdge: Schuttevaar factuur 231052 (12-12-2023), € 4.481,36 (0% btw, 8× Astronergy 400 Wp).
    // Opbrengst = kWp × productiePerKwpJaar × stroomWaardePerJaar (onder saldering ≈ all-in
    // stroomprijs). Per-jaar-waarden jaarlijks bij te werken; 'default' voor de rest.
    zonnepanelen: {
      productiePerKwpJaar: 900,
      stroomWaardePerJaar: { 2020: 0.22, 2021: 0.24, 2022: 0.40, 2023: 0.35, 2024: 0.28, 2025: 0.26, 2026: 0.27, default: 0.26 },
      salderingTot: 2027,
      installaties: [
        { naam: 'Growatt (huis)',     kWp: 4.34, panelen: 14, inbedrijf: '2020-04-09', investeringNetto: 4876.03, btwTeruggevraagd: 1023.97, bron: 'InstallStore 2000299' },
        { naam: 'SolarEdge (garage)', kWp: 3.2,  panelen: 8,  inbedrijf: '2023-12-12', investeringNetto: 4481.36, bron: 'Schuttevaar 231052' },
      ],
      bijgewerkt: '2026-11-18',
    },
    // Landelijke normcijfers voor de benchmark in de Inzicht-tab (jaarverbruik).
    // Profiel: vrijstaande woning, 5 personen. Bron: Milieu Centraal / Nibud / CBS 2025.
    // stroomAllElectricKwh = huishoudelijk + warmtepomp (afgeleid), ruwe indicatie.
    normen: {
      profiel: 'vrijstaande woning, 5 personen',
      bron: 'Milieu Centraal / Nibud / CBS',
      gasM3: 2200,         // gemiddeld gas vrijstaande woning (voor de all-electric norm)
      stroomKwh: 4200,     // gemiddeld huishoudelijk stroomverbruik (zonder warmtepomp)
      evKwh: 2500,         // gemiddeld thuisladen PHEV/EV per jaar (vergelijkbaar huishouden)
      marktPrijsKwh: 0.28, // gangbaar vast stroomtarief nu, voor de contract-vergelijking
      // all-electric norm en kosten-norm worden afgeleid (normAllElectric: huishoudelijk +
      // gas omgerekend naar warmtepompstroom). Zet stroomAllElectricKwh/kostenAllElectricJaar
      // hier expliciet om de afleiding te overrulen.
    },
  };
})();
