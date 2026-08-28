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

```bash
cd scraper
npm run start country=germany league=bundesliga fileType=json
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
- Vor dem echten Eintragen immer erst Trockenlauf zeigen und bestätigen lassen.

## Prognose-Prinzipien

- Wettquoten sind **ein** Input neben Form/Statistiken — kein reines Quoten-Echo
- Torschüsse/xG schlagen das reine Ergebnis bei der Formbewertung
- Kein „zu Null"-Tipp, wenn die Abwehr löchrig ist **und** der Gegner treffen kann
- Tipps gespielter Spiele werden nie nachträglich geändert (saubere Bilanz)
