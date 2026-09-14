# Bundesliga AI Predictions

KI-generierte Spieltags-Prognosen für die Fußball-Bundesliga (Saison 2026/27) —
mit Begründung, erwarteten Statistiken und laufender Erfolgs-Auswertung.
Schwesterprojekt zu [WorldCupPrediction](https://github.com/flipper31/WorldCupPrediction).

## Architektur

```
scraper/ (Flashscore-Scraper, Playwright)
  └── country=germany league=bundesliga  → Spielplan + Ergebnisse + Statistiken + Quoten

Update-Ablauf (manuell, per "Mach Update"):
  1. scrapen            → scraper/src/data/germany_bundesliga.json
  2. Ergebnisse         → frontend/public/predictions.json (actual anreichern)
  3. nächsten Spieltag  → Prognosen an die Form anpassen / neu erstellen
  4. build + deploy     → Nginx (LXC 110, Port 8182)

frontend/ (React + Vite)  → statischer Build → http://192.168.178.135:8182
```

## Update ausführen

Projektpfad: `C:\Development\BundesligaPrediction`. Nur auf ausdrueckliches
"Mach Update" starten, keine Uhrzeit-Routine und keine Wiederholung nach einer
Fertigmeldung. Alte WM-Daten bleiben unberuehrt.

```bash
cd scraper
npm run start -- country=germany league=bundesliga fileType=json
```

Danach: Ergebnisse in `frontend/public/predictions.json` anreichern, kommende
Spieltags-Tipps an die Form anpassen, dann bauen & deployen (siehe unten).

## Deployment

```bash
cd frontend && npm run build
tar -czf ../bundesliga-dist.tar.gz -C dist .
scp ../bundesliga-dist.tar.gz root@192.168.178.252:/tmp/
ssh root@192.168.178.252 "pct push 110 /tmp/bundesliga-dist.tar.gz /tmp/bundesliga-dist.tar.gz && pct exec 110 -- bash -c 'tar -xzf /tmp/bundesliga-dist.tar.gz -C /var/www/bundesliga'"
```

Nginx-Block im Container 110 unter `/data/nginx/custom/http.conf` (Port 8182).

Seite: http://192.168.178.135:8182

## Kicktipp-Automatik

Unsere Prognosen werden automatisch in die Kicktipp-Tipprunde eingetragen —
kein manuelles Abtippen. Basis: [kicktipp-agent](https://github.com/christianheidorn/kicktipp-agent)
(geklont in `kicktipp-agent/`, gitignored) für Login/Session.

**Einmaliges Setup** (Login mit Passwort, macht der User selbst):
```bash
node kicktipp-agent/dist/index.js set-community
```

**Tipps eintragen** (Brücke liest predictions.json → trägt Spiel-Tipps ein):
```bash
node scripts/submit-to-kicktipp.mjs            # Trockenlauf (zeigt nur die Zuordnung)
node scripts/submit-to-kicktipp.mjs --submit   # trägt wirklich ein + speichert + verifiziert
```

Wichtige Eigenheiten der Community `nrm-bundesliga`:
- **Bonusfragen liegen auf `spieltagIndex=0`** (Meister, Herbstmeister …) — die trägt
  der User per Hand ein. Dadurch ist alles um 1 verschoben: **1. Spieltag = `spieltagIndex=1`**,
  N. Spieltag = `spieltagIndex=N`. Steuerbar über `--matchday-index N`.
- Nur Spiel-Ergebnisse werden automatisch getippt, keine Bonusfragen.
- Bei "Mach Update" direkt mit `--matchday-index N --submit` eintragen, ohne
  erneute Bestaetigung. Danach den gespeicherten Serverstand neu laden und pruefen.
- Bereits angepfiffene Spiele und Bonusfragen werden nicht veraendert.

## Prognose-Prinzipien

- Wettquoten sind **ein** Input neben Form/Statistiken — kein reines Quoten-Echo
- Aktuell dienen die abgerufenen Quoten als Vergleich bei der KI-Analyse; es gibt
  keine feste rechnerische Gewichtung und kein kalibriertes Quotenmodell.
- Torschüsse/xG schlagen das reine Ergebnis bei der Formbewertung
- Kein „zu Null"-Tipp, wenn die Abwehr löchrig ist **und** der Gegner treffen kann
- Tipps gespielter Spiele werden nie nachträglich geändert (saubere Bilanz)

## Statistik-Pflicht

Keine neuen Prognosen und keine Kicktipp-Uebertragung ohne validierte Statistiken.
Pflichtfelder: xG, Ballbesitz, Schuesse, Schuesse aufs Tor und Ecken. Nullwerte
bleiben unbekannt; nur echte numerische Nullen sind Null.

`scripts/flashscore-stats.mjs` liest den oeffentlichen Flashscore-Statistikfeed.
Es werden nur Werte fuer das gesamte Spiel (`Match`) verwendet, nicht die
Halbzeiten; doppelte Kategorien werden auf Widersprueche geprueft. Originalantwort,
Abrufzeit und SHA-256 liegen pro Spiel unter `data/flashscore/`. Bereits validierte
Endstaende werden aus diesem Cache gelesen, nicht wiederholt abgefragt. Der Feed
ist keine garantierte offizielle API; Formatfehler muessen das Update stoppen.

Der lokale, gitignorierte Scraper importiert `getMatchStatistics` aus
`../../../../../scripts/flashscore-stats.mjs` in
`scraper/src/scraper/services/matches/index.js`. Bei `FINISHED` wird dieser Abruf
anstelle der alten DOM-Statistikextraktion benutzt. `scraper/src/index.js` setzt
bei Fehlern `process.exitCode = 1`. Diese zwei Anpassungen bei einem frischen
Scraper-Checkout wieder uebernehmen.

Bei leeren Statistiken aus einem bereits abgeschlossenen Scrape nur diese
nachladen, nicht nochmals alle Spielplaene und Quoten:
```bash
node scripts/repair-statistics.mjs
node --test scripts/flashscore-stats.test.mjs scripts/update-predictions.test.mjs
```

Erst danach neue Tipps anhand der Daten erstellen und mit einer Proposal-Datei
zusammenfuehren, beispielsweise:
```bash
node scripts/update-predictions.mjs data/predictions/round-4.json
node scripts/submit-to-kicktipp.mjs --matchday-index 4 --submit
```

Der Merge verweigert fehlende Kerndaten, unvollstaendige Spieltage, begonnene
Spiele und das Ueberschreiben vorhandener Tipps. Die Modellangabe fuer neue Tipps
ab Spieltag 4 ist `GPT-6-Astra`. Alte Prediction-Objekte bleiben unveraendert.
Die Prozentwerte sind subjektive Tendenz-Einschaetzungen, keine kalibrierten
Wahrscheinlichkeiten fuer exakte Ergebnisse. Die Website-Punkte sind eine interne
4/2/0-Vergleichswertung und nicht aus Kicktipp abgerufene Community-Punkte.
