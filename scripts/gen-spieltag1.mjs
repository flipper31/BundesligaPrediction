// Einmaliges Script: erzeugt die Prognosen für den 1. Spieltag aus den Scrape-Daten.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scraped = JSON.parse(readFileSync(join(__dirname, '..', 'scraper', 'src', 'data', 'germany_bundesliga.json'), 'utf8'))
const OUT = join(__dirname, '..', 'frontend', 'public', 'predictions.json')

const de = {
  'Bayern Munich': 'Bayern München', 'Stuttgart': 'VfB Stuttgart', 'Mainz': 'Mainz 05',
  'Paderborn': 'SC Paderborn', 'FC Koln': '1. FC Köln', 'Hoffenheim': 'TSG Hoffenheim',
  'Elversberg': 'SV Elversberg', 'Bayer Leverkusen': 'Bayer Leverkusen', 'Union Berlin': 'Union Berlin',
  'Eintracht Frankfurt': 'Eintracht Frankfurt', 'RB Leipzig': 'RB Leipzig',
  'B. Monchengladbach': 'Bor. Mönchengladbach', 'Dortmund': 'Bor. Dortmund',
  'Hamburger SV': 'Hamburger SV', 'Freiburg': 'SC Freiburg', 'Werder Bremen': 'Werder Bremen',
  'Augsburg': 'FC Augsburg', 'Schalke': 'Schalke 04',
}

// Prognose je Heimteam. st = [possH, possA, shotsH, shotsA, sotH, sotA, cornH, cornA]
const P = {
  'Bayern Munich': { s: [3, 1], c: 62, st: [64, 36, 18, 8, 8, 3, 7, 3], r: 'Zum Saisonauftakt ist der Rekordmeister im eigenen Stadion haushoher Favorit (Quote 1.20). Stuttgart hat eine spielstarke, offensive Elf und wird auch selbst zu Chancen kommen — ein Clean Sheet ist gegen den VfB unwahrscheinlich. Bayern gewinnt souverän, lässt hinten aber einen Treffer zu.' },
  'Mainz': { s: [2, 1], c: 53, st: [55, 45, 14, 8, 5, 3, 6, 4], r: 'Mainz ist gegen Aufsteiger Paderborn favorisiert (1.64) und im eigenen Stadion eine Macht. Paderborn ist als Neuling limitiert, aber in der ersten Euphorie gefährlich. Zum Auftakt gibt es noch keine Formdaten — auf dem Papier gewinnt Mainz knapp.' },
  'FC Koln': { s: [1, 2], c: 47, st: [48, 52, 11, 13, 4, 5, 4, 6], r: 'Enge Kiste mit leichtem Quotenvorteil für Hoffenheim (2.24 auswärts gegen 2.92). Der FC Köln startet nach dem Wiederaufstieg mit Heimvorteil, aber Hoffenheim hat die etabliertere Bundesliga-Elf. Knapper Auswärtssieg der TSG — mit der niedrigsten Confidence des Spieltags.' },
  'Elversberg': { s: [1, 3], c: 58, st: [38, 62, 8, 16, 3, 7, 3, 7], r: 'Aufsteiger Elversberg trifft auf einen Champions-League-Kandidaten — Leverkusen ist klarer Favorit (1.58 auswärts). Die individuelle Klasse von Bayer ist eine Nummer zu groß. Elversberg wird zuhause alles reinwerfen und wohl auch treffen, verliert aber deutlich.' },
  'Union Berlin': { s: [1, 1], c: 45, st: [48, 52, 11, 12, 4, 4, 5, 5], r: 'Fast identische Quoten (2.56 zu 2.58) — ein echtes 50:50-Spiel. Union ist zuhause traditionell unangenehm und zweikampfstark, Frankfurt individuell besser besetzt. Ohne Formdaten zum Auftakt ist das Remis der logischste Tipp.' },
  'RB Leipzig': { s: [2, 1], c: 54, st: [58, 42, 15, 9, 6, 3, 7, 4], r: 'Leipzig ist gegen Gladbach favorisiert (1.54) und offensiv eines der stärksten Teams der Liga. Gladbach ist unberechenbar und schlägt gerne mal zu — ein Gegentor ist einzuplanen. RB gewinnt das Heimspiel, muss aber arbeiten.' },
  'Dortmund': { s: [3, 1], c: 60, st: [62, 38, 17, 8, 7, 3, 8, 3], r: 'Der BVB ist gegen Aufsteiger Hamburg klarer Favorit (1.30) und im Signal-Iduna-Park eine Macht. Der HSV feiert die Bundesliga-Rückkehr und wird mutig auftreten, ist defensiv aber anfällig. Klarer Dortmunder Sieg mit einem HSV-Ehrentreffer.' },
  'Freiburg': { s: [2, 1], c: 50, st: [53, 47, 13, 10, 5, 4, 6, 5], r: 'Freiburg ist im heimischen Europa-Park-Stadion leicht favorisiert (1.96) und seit Jahren eine der stabilsten Adressen der Liga. Werder hat Offensivqualität und trifft auswärts regelmäßig. Knapper Heimsieg in einem offenen Spiel.' },
  'Augsburg': { s: [2, 1], c: 50, st: [54, 46, 13, 9, 5, 4, 6, 4], r: 'Augsburg startet mit Heimvorteil als leichter Favorit (2.12) gegen Aufsteiger Schalke. S04 bringt großen Anhang und Wucht mit, ist aber als Neuling defensiv ein Fragezeichen. Knapper Heimsieg der Fuggerstädter.' },
}

const toIso = (d) => { const [dd, t] = d.split(' '); const [D, M, Y] = dd.split('.'); return `${Y}-${M}-${D}T${t}:00+02:00` }

const matches = []
for (const s of Object.values(scraped)) {
  if (s.stage !== 'ROUND 1') continue
  const p = P[s.home.name]
  if (!p) { console.warn('Keine Prognose für', s.home.name); continue }
  const [poH, poA, shH, shA, sotH, sotA, coH, coA] = p.st
  matches.push({
    id: s.matchId,
    group: '1. Spieltag',
    kickoff: toIso(s.date),
    home: { name: de[s.home.name] || s.home.name, logo: s.home.image, flag: '⚽' },
    away: { name: de[s.away.name] || s.away.name, logo: s.away.image, flag: '⚽' },
    prediction: {
      score: { home: p.s[0], away: p.s[1] },
      confidence: p.c,
      expectedStats: {
        possession: { home: poH, away: poA },
        shots: { home: shH, away: shA },
        shotsOnTarget: { home: sotH, away: sotA },
        corners: { home: coH, away: coA },
      },
      reasoning: p.r,
    },
  })
}

matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model: 'Claude (Datenbasis: Flashscore-Scrape inkl. Wettquoten, Saisonstart 2026/27)',
  demo: false,
  matches,
}, null, 2))
console.log(matches.length + ' Prognosen für den 1. Spieltag geschrieben')
