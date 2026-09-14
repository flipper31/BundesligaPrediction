import test from 'node:test'
import assert from 'node:assert/strict'
import { berlinKickoff, buildUpdate } from './update-predictions.mjs'

const now = new Date('2026-09-13T20:00:00Z')
function fixture() {
  const stats = [['Expected goals (xG)', '1.1', '2.1'], ['Ball possession', '40%', '60%'], ['Total shots', '8', '20'], ['Shots on target', '3', '6'], ['Corner kicks', '2', '7']].map(([category, homeValue, awayValue]) => ({ category, homeValue, awayValue }))
  const previous = { model: 'Historical', matches: [] }
  const source = {}
  const proposal = { round: 4, matches: [] }
  for (let i = 0; i < 9; i++) {
    const home = { name: `Home ${i}`, image: 'home.png' }
    const away = { name: `Away ${i}`, image: 'away.png' }
    for (let round = 1; round <= 3; round++) {
      const id = `${i}-${round}`
      source[id] = { matchId: id, stage: `ROUND ${round}`, date: '12.09.2026 15:30', status: 'FINISHED', home, away, result: { home: '1', away: '2' }, statistics: structuredClone(stats), statisticsSource: { sha256: 'test', period: 'Match' } }
      previous.matches.push({ id, home, away, kickoff: '2026-09-12T13:30:00Z', prediction: { score: { home: 3, away: 0 }, reasoning: 'Frozen original' } })
    }
    const id = `new-${i}`
    source[id] = { matchId: id, stage: 'ROUND 4', date: '19.09.2026 15:30', status: '', home, away }
    proposal.matches.push({ id, score: { home: 2, away: 1 }, confidence: 50, reasoning: 'Test proposal' })
  }
  return { previous, source, proposal }
}

test('converts Berlin summer/winter kickoffs and rejects bad dates', () => {
  assert.equal(berlinKickoff('19.09.2026 15:30'), '2026-09-19T13:30:00.000Z')
  assert.equal(berlinKickoff('19.12.2026 15:30'), '2026-12-19T14:30:00.000Z')
  assert.throws(() => berlinKickoff('31.02.2026 15:30'))
  assert.throws(() => berlinKickoff('bad'))
})
test('enriches 27 results and appends nine predictions without mutating history', () => {
  const f = fixture()
  const before = JSON.stringify(f.previous)
  const result = buildUpdate(f.previous, f.source, f.proposal, now)
  assert.equal(result.matches.length, 36)
  assert.equal(result.matches.filter(m => m.actual).length, 27)
  assert.equal(result.model, 'GPT-6-Astra')
  assert.equal(JSON.stringify(f.previous), before)
  for (const m of f.previous.matches) assert.deepEqual(result.matches.find(n => n.id === m.id).prediction, m.prediction)
  assert.deepEqual(result.matches.find(m => m.actual).actual.stats.xg, { home: 1.1, away: 2.1 })
})
test('blocks missing stats, duplicate proposals, changed history and started games', () => {
  for (const damage of [
    f => { f.source['0-3'].statistics = [{}, {}] },
    f => { f.source['0-3'].statisticsSource = null },
    f => { f.proposal.matches[1] = f.proposal.matches[0] },
    f => { f.source['new-0'].date = '13.09.2026 15:30' },
    f => { f.proposal.matches[0].score.home = -1 },
    f => { f.previous.matches.push({ ...f.previous.matches[0], id: 'new-0' }) },
  ]) {
    const f = fixture()
    damage(f)
    assert.throws(() => buildUpdate(f.previous, f.source, f.proposal, now))
  }
})
