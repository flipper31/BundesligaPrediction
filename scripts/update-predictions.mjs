import { readFile, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { validateStatistics, numericStat } from './flashscore-stats.mjs'

export function berlinKickoff(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid kickoff: ${value}`)
  const [, d, m, y, h, min] = match
  if (+m < 1 || +m > 12 || +d < 1 || +h > 23 || +min > 59) throw new Error('Invalid local kickoff')
  const target = Date.UTC(+y, +m - 1, +d, +h, +min)
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  let utc = target
  const localTime = t => {
    const p = Object.fromEntries(formatter.formatToParts(t).map(p => [p.type, p.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  }
  for (let i = 0; i < 3; i++) utc += target - localTime(utc)
  if (localTime(utc) !== target || new Date(target).getUTCDate() !== +d) throw new Error('Invalid local kickoff')
  return new Date(utc).toISOString()
}

function score(value) {
  if (!value || !['home', 'away'].every(side => /^\d+$/.test(String(value[side])) && Number.isSafeInteger(Number(value[side])))) throw new Error('Invalid score')
  return { home: Number(value.home), away: Number(value.away) }
}

export function buildUpdate(previous, source, proposal, now = new Date()) {
  if (!Number.isInteger(proposal.round) || proposal.round < 1 || proposal.round > 34) throw new Error('Invalid round')
  const output = structuredClone(previous)
  const originals = new Map(previous.matches.map(m => [m.id, m]))
  if (originals.size !== previous.matches.length) throw new Error('Duplicate saved match IDs')
  const names = new Map()
  for (const match of previous.matches) {
    const raw = source[match.id]
    if (!raw) throw new Error(`Saved match absent from source: ${match.id}`)
    for (const side of ['home', 'away']) names.set(raw[side].name, match[side])
  }
  const finished = Object.values(source).filter(m => m.status === 'FINISHED')
  if (!finished.length) throw new Error('No results for analysis')
  const coverage = new Map()
  const statFields = { xg: 'Expected goals (xG)', possession: 'Ball possession', shots: 'Total shots', shotsOnTarget: 'Shots on target', corners: 'Corner kicks', bigChances: 'Big chances' }
  for (const raw of finished) {
    validateStatistics(raw.statistics)
    if (!raw.statisticsSource?.sha256 || raw.statisticsSource.period !== 'Match') throw new Error(`Missing statistics provenance: ${raw.matchId}`)
    if (Date.parse(berlinKickoff(raw.date)) > now.getTime()) throw new Error('Result for future fixture')
    for (const side of ['home', 'away']) coverage.set(raw[side].name, (coverage.get(raw[side].name) || 0) + 1)
    const existing = output.matches.find(m => m.id === raw.matchId)
    if (!existing) throw new Error(`Finished match has no original prediction: ${raw.matchId}`)
    existing.actual = {
      score: score(raw.result),
      stats: Object.fromEntries(Object.entries(statFields).map(([key, label]) => [key, numericStat(raw.statistics, label)])),
      source: raw.statisticsSource,
    }
  }
  const upcoming = Object.values(source).filter(m => m.stage === `ROUND ${proposal.round}`)
  if (upcoming.length !== 9 || proposal.matches.length !== 9 || new Set(proposal.matches.map(m => m.id)).size !== 9) throw new Error('Expected nine unique fixtures and predictions')
  const sourceIds = new Set(upcoming.map(m => m.matchId))
  for (const proposed of proposal.matches) {
    if (!sourceIds.has(proposed.id)) throw new Error(`Prediction not on source schedule: ${proposed.id}`)
    const raw = source[proposed.id]
    const kickoff = berlinKickoff(raw.date)
    if (raw.status === 'FINISHED' || Date.parse(kickoff) <= now.getTime()) throw new Error('Cannot predict a started match')
    if (originals.has(proposed.id)) throw new Error('Existing predictions are immutable in this update command')
    if (![raw.home.name, raw.away.name].every(name => (coverage.get(name) || 0) >= proposal.round - 1)) throw new Error('Incomplete team statistics history')
    if (!proposed.reasoning?.trim() || !Number.isInteger(proposed.confidence) || proposed.confidence < 0 || proposed.confidence > 100) throw new Error('Invalid prediction')
    output.matches.push({
      id: proposed.id, group: `${proposal.round}. Spieltag`, kickoff,
      home: { ...names.get(raw.home.name), name: names.get(raw.home.name)?.name || raw.home.name, logo: raw.home.image },
      away: { ...names.get(raw.away.name), name: names.get(raw.away.name)?.name || raw.away.name, logo: raw.away.image },
      prediction: {
        score: score(proposed.score), confidence: proposed.confidence,
        confidenceBasis: 'Subjective assessment of the outcome, not a calibrated exact-score probability',
        expectedStats: proposed.expectedStats,
        reasoning: proposed.reasoning,
        model: 'GPT-6-Astra', createdAt: now.toISOString(),
        dataBasis: { source: 'Flashscore', matchesWithValidatedStatistics: finished.length, throughRound: proposal.round - 1, matchIds: finished.map(m => m.matchId), limitations: `Only ${proposal.round - 1} league matches per team; no verified upcoming lineups or injury report. Expected stats are estimates, not observed values.` },
      },
    })
  }
  for (const [id, old] of originals) {
    if (JSON.stringify(old.prediction) !== JSON.stringify(output.matches.find(m => m.id === id).prediction)) throw new Error('Historical prediction changed')
  }
  output.matches.sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))
  output.generatedAt = now.toISOString()
  output.model = 'GPT-6-Astra'
  output.demo = false
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/update-predictions.mjs <proposal.json>')
  const path = fileURLToPath(new URL('../frontend/public/predictions.json', import.meta.url))
  const sourcePath = fileURLToPath(new URL('../scraper/src/data/germany_bundesliga.json', import.meta.url))
  const previous = JSON.parse(await readFile(path, 'utf8'))
  const source = JSON.parse(await readFile(sourcePath, 'utf8'))
  const proposal = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'))
  const result = buildUpdate(previous, source, proposal)
  await writeFile(path + '.tmp', JSON.stringify(result, null, 2) + '\n')
  await rename(path + '.tmp', path)
  console.log(`${result.matches.length} predictions, ${result.matches.filter(m => m.actual).length} results with validated statistics. Historical predictions unchanged.`)
}
