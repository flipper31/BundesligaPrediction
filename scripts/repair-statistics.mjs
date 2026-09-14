import { readFile, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getMatchStatistics } from './flashscore-stats.mjs'

const path = fileURLToPath(new URL('../scraper/src/data/germany_bundesliga.json', import.meta.url))
const data = JSON.parse(await readFile(path, 'utf8'))
const finished = Object.values(data).filter(m => m.status === 'FINISHED')
if (!finished.length) throw new Error('No finished matches in scraped data')
for (const match of finished) {
  Object.assign(match, await getMatchStatistics(match.matchId))
  console.log(`${match.matchId}: ${match.home.name} - ${match.away.name}: ${match.statistics.length} statistics validated`)
}
await writeFile(path + '.tmp', JSON.stringify(data, null, 2) + '\n')
await rename(path + '.tmp', path)
console.log(`${finished.length} complete full-match statistics saved. No fixtures re-scraped.`)
