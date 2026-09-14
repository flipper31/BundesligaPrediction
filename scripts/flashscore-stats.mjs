import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const cacheDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'flashscore')
const separator = '\u00f7'
let signaturePromise

// The public feed is record-delimited, not JSON. SE selects the match period;
// SG/SH/SI identify the label and home/away values. Top stats repeat later.
export function parseStatisticsFeed(raw) {
  let period = null
  let sawMatch = false
  const statistics = new Map()
  for (const record of raw.split('~')) {
    const fields = Object.fromEntries(record.split('\u00ac').map(token => token.trim()).filter(Boolean).map(token => {
      const i = token.indexOf(separator)
      if (i < 1) throw new Error('Invalid Flashscore statistics record')
      return [token.slice(0, i), token.slice(i + 1)]
    }))
    if (fields.SE) {
      period = fields.SE
      sawMatch ||= period === 'Match'
    }
    if (period !== 'Match' || !fields.SD) continue
    if (!fields.SG || fields.SH == null || fields.SI == null) throw new Error('Incomplete statistics row')
    const stat = { category: fields.SG, homeValue: fields.SH, awayValue: fields.SI }
    const previous = statistics.get(fields.SD)
    if (previous && JSON.stringify(previous) !== JSON.stringify(stat)) throw new Error(`Conflicting statistic ${fields.SG}`)
    statistics.set(fields.SD, stat)
  }
  if (!sawMatch) throw new Error('Full-match statistics missing')
  const result = [...statistics.values()]
  validateStatistics(result)
  return result
}

export function numericStat(statistics, category) {
  const stat = statistics?.find(s => s.category === category)
  const parse = value => {
    if (typeof value !== 'string' || !/^\d+(?:[.,]\d+)?%?$/.test(value.trim())) return null
    return Number(value.trim().replace('%', '').replace(',', '.'))
  }
  return { home: parse(stat?.homeValue), away: parse(stat?.awayValue) }
}

export function validateStatistics(statistics) {
  const categories = ['Expected goals (xG)', 'Ball possession', 'Total shots', 'Shots on target', 'Corner kicks']
  const values = Object.fromEntries(categories.map(category => [category, numericStat(statistics, category)]))
  for (const [category, pair] of Object.entries(values)) {
    for (const n of Object.values(pair)) {
      if (!Number.isFinite(n) || n < 0) throw new Error(`Missing or invalid ${category}`)
      if (['Total shots', 'Shots on target', 'Corner kicks'].includes(category) && !Number.isInteger(n)) throw new Error(`Non-integer ${category}`)
    }
  }
  const possession = values['Ball possession']
  if (possession.home > 100 || possession.away > 100 || Math.abs(possession.home + possession.away - 100) > 1) throw new Error('Invalid possession total')
  for (const side of ['home', 'away']) {
    if (values['Shots on target'][side] > values['Total shots'][side]) throw new Error('Shots on target exceed total shots')
  }
  return values
}

async function getSignature() {
  signaturePromise ??= (async () => {
    const response = await fetch('https://www.flashscore.com/football/germany/bundesliga/results/', { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Flashscore configuration HTTP ${response.status}`)
    const html = await response.text()
    const match = html.match(/"feed_sign"\s*:\s*("(?:\\.|[^"\\])*")/)
    if (!match) throw new Error('Public Flashscore feed configuration missing')
    return JSON.parse(match[1])
  })()
  return signaturePromise
}

export async function getMatchStatistics(matchId, { cacheDir = cacheDirectory } = {}) {
  if (!/^[a-zA-Z0-9]{8}$/.test(matchId)) throw new Error('Invalid match ID')
  const cachePath = join(cacheDir, `${matchId}.json`)
  let snapshot
  try {
    snapshot = JSON.parse(await readFile(cachePath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!snapshot) {
    const url = `https://2.flashscore.ninja/2/x/feed/df_st_1_${matchId}`
    const response = await fetch(url, {
      headers: { 'x-fsign': await getSignature(), referer: 'https://www.flashscore.com/' },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error(`Statistics ${matchId}: HTTP ${response.status}`)
    const raw = await response.text()
    parseStatisticsFeed(raw)
    snapshot = { matchId, url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), raw }
    await mkdir(cacheDir, { recursive: true })
    await writeFile(cachePath, JSON.stringify(snapshot, null, 2) + '\n')
  }
  if (snapshot.matchId !== matchId || createHash('sha256').update(snapshot.raw).digest('hex') !== snapshot.sha256) throw new Error(`Corrupt statistics cache ${matchId}`)
  return {
    statistics: parseStatisticsFeed(snapshot.raw),
    statisticsSource: { url: snapshot.url, retrievedAt: snapshot.retrievedAt, sha256: snapshot.sha256, period: 'Match' },
  }
}
