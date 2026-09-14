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
import { validateStatistics } from './flashscore-stats.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Playwright aus dem kicktipp-agent-Ordner beziehen (dort installiert)
const require = createRequire(join(__dirname, '..', 'kicktipp-agent', 'package.json'))
const { chromium } = require('playwright')
const args = process.argv.slice(2)
const SUBMIT = args.includes('--submit')
const idxArg = args.indexOf('--matchday-index')
const SPIELTAG_INDEX = idxArg >= 0 ? Number(args[idxArg + 1]) : 1
if (!Number.isInteger(SPIELTAG_INDEX) || SPIELTAG_INDEX < 1 || SPIELTAG_INDEX > 34) {
  throw new Error('Spieltag muss zwischen 1 und 34 liegen; Bonusfragen bleiben unberuehrt.')
}

const COMMUNITY = 'nrm-bundesliga'
const SESSION = join(homedir(), '.config', 'kicktipp-agent', 'session.json')
const preds = JSON.parse(readFileSync(join(__dirname, '..', 'frontend', 'public', 'predictions.json'), 'utf8'))
const source = JSON.parse(readFileSync(join(__dirname, '..', 'scraper', 'src', 'data', 'germany_bundesliga.json'), 'utf8'))

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
  if (m.group !== `${SPIELTAG_INDEX}. Spieltag` || m.actual) continue
  if (!Number.isFinite(Date.parse(m.kickoff))) throw new Error(`Ungueltiger Anstoss: ${m.id}`)
  if (Date.parse(m.kickoff) <= Date.now()) continue
  const basis = m.prediction?.dataBasis?.matchIds
  if (!Array.isArray(basis) || !basis.length) throw new Error(`Keine Statistik-Datenbasis: ${m.id}`)
  for (const id of basis) validateStatistics(source[id]?.statistics)
  const key = teamKey(m.home.name) + '|' + teamKey(m.away.name)
  if (predByPair.has(key)) throw new Error(`Doppelte Paarung: ${key}`)
  const score = m.prediction?.score
  if (!score || ![score.home, score.away].every((v) => Number.isInteger(v) && v >= 0)) {
    throw new Error(`Ungueltiger Tipp: ${key}`)
  }
  predByPair.set(key, m)
}
if (!predByPair.size) throw new Error('Keine offenen Prognosen fuer diesen Spieltag.')

const browser = await chromium.launch({ headless: true })
try {
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
if (!rows.length) throw new Error('Keine Tippfelder gefunden. Session oder Spieltag pruefen.')
const pageIndex = await page.locator('input[name="spieltagIndex"]').inputValue()
if (Number(pageIndex) !== SPIELTAG_INDEX) throw new Error('Kicktipp zeigt einen anderen Spieltag.')

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
if (plan.length !== predByPair.size || new Set(plan.map((p) => p.id)).size !== plan.length) {
  throw new Error('Nicht alle offenen Prognosen konnten eindeutig zugeordnet werden.')
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

// Eine neue Seite liest den Serverstand statt nur die gerade befuellten Felder.
const verification = await context.newPage()
await verification.goto(`https://www.kicktipp.com/${COMMUNITY}/predict?spieltagIndex=${SPIELTAG_INDEX}`, { waitUntil: 'domcontentloaded' })
await verification.locator("input[id$='_heimTipp']").first().waitFor()
const saved = await verification.evaluate(() =>
  [...document.querySelectorAll("input[id$='_heimTipp']")].map((i) => ({
    id: i.id.replace('_heimTipp', ''), h: i.value, g: document.getElementById(i.id.replace('heimTipp', 'gastTipp'))?.value,
  })),
)
console.log(`\nKontrolle des erneut geladenen Serverstands:`)
let mismatches = 0
for (const p of plan) {
  const s = saved.find((x) => x.id === p.id)
  if (s?.h !== String(p.h) || s?.g !== String(p.g)) mismatches++
  console.log(`  ${p.home} ${s?.h}:${s?.g} ${p.away}  ${s?.h == p.h && s?.g == p.g ? '✓' : '✗ (' + p.h + ':' + p.g + ' erwartet)'}`)
}
if (mismatches) throw new Error(`${mismatches} Tipps nicht korrekt gespeichert.`)
console.log(`${plan.length} Tipps serverseitig verifiziert.`)
} finally {
await browser.close()
}
