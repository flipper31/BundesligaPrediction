/**
 * Trägt die Prognosen aus predictions.json in die Kicktipp-Tipprunde ein.
 * Nutzt die vom kicktipp-agent gespeicherte Login-Session (~/.config/kicktipp-agent/session.json).
 *
 *   node scripts/submit-to-kicktipp.mjs           → TROCKENLAUF (zeigt nur, was eingetragen würde)
 *   node scripts/submit-to-kicktipp.mjs --submit  → trägt die Tipps wirklich ein + speichert
 *
 * Optional: --matchday-index N  (Default 1 = 1. Spieltag; Index 0 = Bonusfragen)
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Playwright aus dem kicktipp-agent-Ordner beziehen (dort installiert)
const require = createRequire(join(__dirname, '..', 'kicktipp-agent', 'package.json'))
const { chromium } = require('playwright')
const args = process.argv.slice(2)
const SUBMIT = args.includes('--submit')
const idxArg = args.indexOf('--matchday-index')
const SPIELTAG_INDEX = idxArg >= 0 ? Number(args[idxArg + 1]) : 1

const COMMUNITY = 'nrm-bundesliga'
const SESSION = join(homedir(), '.config', 'kicktipp-agent', 'session.json')
const preds = JSON.parse(readFileSync(join(__dirname, '..', 'frontend', 'public', 'predictions.json'), 'utf8'))

// Vereinsnamen (unsere + Kicktipp-Schreibweise) auf einen gemeinsamen Schlüssel abbilden
function teamKey(name) {
  const n = name.toLowerCase()
  const map = [
    ['bayern', 'bayern'], ['stuttgart', 'stuttgart'], ['köln', 'koeln'], ['koln', 'koeln'],
    ['hoffenheim', 'hoffenheim'], ['elversberg', 'elversberg'], ['leverkusen', 'leverkusen'],
    ['union', 'union'], ['frankfurt', 'frankfurt'], ['leipzig', 'leipzig'],
    ['gladbach', 'gladbach'], ['mönchengladbach', 'gladbach'], ['monchengladbach', 'gladbach'],
    ['dortmund', 'dortmund'], ['hamburg', 'hamburg'], ['freiburg', 'freiburg'],
    ['bremen', 'bremen'], ['werder', 'bremen'], ['augsburg', 'augsburg'],
    ['schalke', 'schalke'], ['mainz', 'mainz'], ['paderborn', 'paderborn'],
  ]
  for (const [needle, k] of map) if (n.includes(needle)) return k
  return n.replace(/[^a-zäöü]/g, '')
}

// Unsere Prognosen nach Team-Schlüsselpaar indexieren
const predByPair = new Map()
for (const m of preds.matches) {
  predByPair.set(teamKey(m.home.name) + '|' + teamKey(m.away.name), m)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
await page.goto(`https://www.kicktipp.com/${COMMUNITY}/predict?spieltagIndex=${SPIELTAG_INDEX}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

// Spiel-Zeilen einsammeln: je heimTipp-Input das Team-Paar aus derselben Zeile lesen
const rows = await page.evaluate(() => {
  const out = []
  for (const inp of document.querySelectorAll("input[id$='_heimTipp']")) {
    const id = inp.id.replace('_heimTipp', '')
    const tr = inp.closest('tr')
    if (!tr) continue
    // Team-Namen = die beiden Mannschafts-Zellen der Zeile
    // Team-Zellen = enthalten mind. 3 Buchstaben und sind keine Datums-/Zeit-Zelle
    const teams = [...tr.querySelectorAll('td')]
      .map((td) => td.textContent.trim())
      .filter((t) => /[a-zäöüß]{3,}/i.test(t) && !/\d{1,2}[:/]\d/.test(t))
    out.push({ id, home: teams[0], away: teams[1] })
  }
  return out
})

console.log(`Spieltag-Index ${SPIELTAG_INDEX} — ${rows.length} Spiele auf der Seite gefunden\n`)

const plan = []
for (const r of rows) {
  const m = predByPair.get(teamKey(r.home || '') + '|' + teamKey(r.away || ''))
  if (!m) {
    console.log(`  ⚠️  keine Prognose für: ${r.home} vs ${r.away}`)
    continue
  }
  plan.push({ id: r.id, home: r.home, away: r.away, h: m.prediction.score.home, g: m.prediction.score.away })
  console.log(`  ${r.home} ${m.prediction.score.home}:${m.prediction.score.away} ${r.away}`)
}

if (!SUBMIT) {
  console.log(`\nTROCKENLAUF — nichts eingetragen. Zum echten Eintragen: --submit`)
  await browser.close()
  process.exit(0)
}

// Tipps eintragen
for (const p of plan) {
  await page.fill(`#${p.id}_heimTipp`, String(p.h))
  await page.fill(`#${p.id}_gastTipp`, String(p.g))
}
// Speichern — Klick per JS (Button liegt außerhalb des Viewports)
const hasBtn = await page.evaluate(() => {
  const btn = document.querySelector('button[name="submitbutton"], input[name="submitbutton"]')
  if (!btn) return false
  btn.click()
  return true
})
if (!hasBtn) { console.error('Speicher-Button nicht gefunden!'); await browser.close(); process.exit(1) }
await page.waitForLoadState('domcontentloaded').catch(() => {})
await page.waitForTimeout(2000)

// Verifizieren: Werte nach dem Speichern zurücklesen
const saved = await page.evaluate(() =>
  [...document.querySelectorAll("input[id$='_heimTipp']")].map((i) => ({
    id: i.id.replace('_heimTipp', ''), h: i.value, g: document.getElementById(i.id.replace('heimTipp', 'gastTipp'))?.value,
  })),
)
console.log(`\n✅ Eingetragen & gespeichert. Kontrolle:`)
for (const p of plan) {
  const s = saved.find((x) => x.id === p.id)
  console.log(`  ${p.home} ${s?.h}:${s?.g} ${p.away}  ${s?.h == p.h && s?.g == p.g ? '✓' : '✗ (' + p.h + ':' + p.g + ' erwartet)'}`)
}
await browser.close()
