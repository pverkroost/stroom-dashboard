# Stroom Dashboard - Claude Instructies

## Versienummering
Bij elke aanpassing aan stroom-dashboard.html:
- Hoog het versienummer automatisch op (v1.0.0 → v1.1.0 voor kleine features, v1.0.0 → v1.0.1 voor bugfixes)
- Update de timestamp in de footer naar de huidige Nederlandse datum en tijd (Europe/Amsterdam)
- Formaat: v1.x.x · DD-MM-YYYY HH:mm

## Deployment
Na elke aanpassing altijd automatisch pushen naar GitHub met een duidelijke commit message die beschrijft wat er gewijzigd is.

## Vercel Environment Variables
De volgende environment variables moeten ingesteld zijn in het Vercel dashboard (Settings → Environment Variables):

| Variable               | Waarde / omschrijving                                        |
|------------------------|--------------------------------------------------------------|
| `GROWATT_API_TOKEN`    | Growatt OpenAPI token                                        |
| `GROWATT_DEVICE_SN`    | `CUE294500F` — inverter device serial number                 |
| `GROWATT_PLANT_ID`     | Growatt plant ID (voor legacy ShinePhone API)                |
| `GROWATT_USERNAME`     | Growatt account e-mailadres (voor legacy ShinePhone API)     |
| `GROWATT_PASSWORD`     | Growatt account wachtwoord (voor legacy ShinePhone API)      |
| `SOLAREDGE_API_KEY`    | SolarEdge Monitoring API key                                 |
| `SOLAREDGE_SITE_ID`    | SolarEdge site ID                                            |

Client-side constanten (niet als env var — staan in `js/config.js`):
- `LAT` / `LON` — locatiecoördinaten voor Open-Meteo
- `GROWATT_PEAK_KW` / `SOLAREDGE_PEAK_KW` — piekvermogens panelen
- `GROWATT_DEVICE_SN` / `GROWATT_DATALOGGER_SN` — referentie SNs

## Tarieven
- OPSLAG: 0.03194 per kWh excl. btw
- EB: 0.09161 per kWh excl. btw
- BTW: 1.21
