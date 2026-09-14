import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStatisticsFeed, numericStat, validateStatistics } from './flashscore-stats.mjs'

const feed = 'SE\u00f7Match\u00ac~' + [
  ['432', 'Expected goals (xG)', '1.11', '2.64'],
  ['12', 'Ball possession', '37%', '63%'],
  ['34', 'Total shots', '8', '30'],
  ['13', 'Shots on target', '5', '5'],
  ['16', 'Corner kicks', '2', '14'],
].map(([id, label, home, away]) => `SD\u00f7${id}\u00acSG\u00f7${label}\u00acSH\u00f7${home}\u00acSI\u00f7${away}\u00ac~`).join('')

test('parses full-match data, deduplicates groups and excludes halves', () => {
  const stats = parseStatisticsFeed(feed + 'SF\u00f7Shots\u00ac~SD\u00f734\u00acSG\u00f7Total shots\u00acSH\u00f78\u00acSI\u00f730\u00ac~SE\u00f71st Half\u00ac~SD\u00f734\u00acSG\u00f7Total shots\u00acSH\u00f72\u00acSI\u00f713\u00ac~')
  assert.equal(stats.length, 5)
  assert.deepEqual(numericStat(stats, 'Total shots'), { home: 8, away: 30 })
  assert.deepEqual(numericStat(stats, 'Expected goals (xG)'), { home: 1.11, away: 2.64 })
})
test('rejects empty, malformed, partial and conflicting feeds', () => {
  for (const raw of ['', '<html>Error</html>', feed.replace('SE\u00f7Match', 'SE\u00f71st Half'), feed.replace('SG\u00f7Total shots', 'SG\u00f7Unknown'), feed + 'SD\u00f734\u00acSG\u00f7Total shots\u00acSH\u00f799\u00acSI\u00f730\u00ac~']) {
    assert.throws(() => parseStatisticsFeed(raw))
  }
})
test('zero is valid but missing data is never zero', () => {
  const stats = parseStatisticsFeed(feed.replace('SH\u00f75', 'SH\u00f70'))
  assert.equal(numericStat(stats, 'Shots on target').home, 0)
  assert.equal(numericStat(stats, 'Unknown').home, null)
  assert.throws(() => validateStatistics([{}, {}]))
})
test('rejects impossible totals', () => {
  assert.throws(() => parseStatisticsFeed(feed.replace('37%', '70%')))
  assert.throws(() => parseStatisticsFeed(feed.replace('SH\u00f75', 'SH\u00f79')))
})
