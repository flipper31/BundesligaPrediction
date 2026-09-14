import { useEffect, useState } from 'react'
import './App.css'

function ConfidenceBar({ value }) {
  return (
    <div className="confidence">
      <div className="confidence-track">
        <div className="confidence-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="confidence-label">KI-Einschätzung: {value}%</span>
    </div>
  )
}

function TeamBadge({ team }) {
  return (
    <div className="team">
      {team.logo ? (
        <img className="team-logo" src={team.logo} alt="" loading="lazy" />
      ) : (
        <span className="team-flag">{team.flag}</span>
      )}
      <span className="team-name">{team.name}</span>
    </div>
  )
}

function StatRow({ label, home, away, isPercent }) {
  const h = parseFloat(home) || 0
  const a = parseFloat(away) || 0
  const total = h + a || 1
  return (
    <div className="stat-row">
      <span className="stat-value">{home == null ? '–' : `${home}${isPercent ? '%' : ''}`}</span>
      <div className="stat-bars">
        <span className="stat-label">{label}</span>
        <div className="stat-track">
          <div className="stat-home" style={{ width: `${(h / total) * 100}%` }} />
          <div className="stat-away" style={{ width: `${(a / total) * 100}%` }} />
        </div>
      </div>
      <span className="stat-value">{away == null ? '–' : `${away}${isPercent ? '%' : ''}`}</span>
    </div>
  )
}

// exakt | tendenz | daneben — Vergleich Prognose vs. echtes Ergebnis
function hitType(prediction, actual) {
  if (!actual) return null
  const p = prediction.score
  const a = actual.score
  if (p.home === a.home && p.away === a.away) return 'exakt'
  if (Math.sign(p.home - p.away) === Math.sign(a.home - a.away)) return 'tendenz'
  return 'daneben'
}

const HIT_LABEL = {
  exakt: '🎯 Exakt getroffen',
  tendenz: '✅ Tendenz richtig',
  daneben: '❌ Daneben',
}

// Interne Vergleichswertung; nicht die aus Kicktipp abgerufenen Community-Punkte.
const POINTS = { exakt: 4, tendenz: 2, daneben: 0 }

// Getippter Ausgang aus dem Score
function tippTyp(score) {
  if (score.home > score.away) return 'Heimsieg'
  if (score.home < score.away) return 'Auswärtssieg'
  return 'Unentschieden'
}

function StatsSummary({ finished }) {
  const total = finished.length
  const rows = finished.map((m) => hitType(m.prediction, m.actual))
  const exakt = rows.filter((r) => r === 'exakt').length
  const tendenz = rows.filter((r) => r === 'tendenz').length
  const daneben = rows.filter((r) => r === 'daneben').length
  const treffer = exakt + tendenz
  const quote = Math.round((treffer / total) * 100)
  const punkte = finished.reduce((sum, m) => sum + POINTS[hitType(m.prediction, m.actual)], 0)
  const maxPunkte = total * POINTS.exakt

  // Confidence-Kalibrierung: waren sichere Tipps auch erfolgreicher?
  const buckets = [
    { label: 'Sehr sicher (≥ 65%)', test: (c) => c >= 65 },
    { label: 'Sicher (55–64%)', test: (c) => c >= 55 && c < 65 },
    { label: 'Unsicher (< 55%)', test: (c) => c < 55 },
  ].map((b) => {
    const ms = finished.filter((m) => b.test(m.prediction.confidence))
    const hit = ms.filter((m) => hitType(m.prediction, m.actual) !== 'daneben').length
    return { ...b, n: ms.length, quote: ms.length ? Math.round((hit / ms.length) * 100) : null }
  })

  // Trefferquote nach getipptem Ausgang
  const ausgaenge = ['Heimsieg', 'Unentschieden', 'Auswärtssieg'].map((label) => {
    const ms = finished.filter((m) => tippTyp(m.prediction.score) === label)
    const hit = ms.filter((m) => hitType(m.prediction, m.actual) !== 'daneben').length
    return { label, n: ms.length, quote: ms.length ? Math.round((hit / ms.length) * 100) : null }
  })

  return (
    <section className="stats-summary">
      <h2>📊 Wie gut ist die KI?</h2>
      <p className="stats-sub">Auswertung über alle {total} bisher getippten Spiele der Saison</p>

      <div className="stat-tiles">
        <div className="tile tile-accent">
          <span className="tile-num">{quote}%</span>
          <span className="tile-label">Trefferquote</span>
          <span className="tile-sub">exakt + Tendenz</span>
        </div>
        <div className="tile">
          <span className="tile-num">{exakt}</span>
          <span className="tile-label">🎯 Exakt</span>
          <span className="tile-sub">{Math.round((exakt / total) * 100)}% der Spiele</span>
        </div>
        <div className="tile">
          <span className="tile-num">{tendenz}</span>
          <span className="tile-label">✅ Tendenz</span>
          <span className="tile-sub">richtiger Sieger</span>
        </div>
        <div className="tile">
          <span className="tile-num">{daneben}</span>
          <span className="tile-label">❌ Daneben</span>
          <span className="tile-sub">{Math.round((daneben / total) * 100)}% der Spiele</span>
        </div>
      </div>

      <div className="points-bar">
        <div className="points-head">
          <span><strong>{punkte}</strong> von {maxPunkte} möglichen Punkten</span>
          <span className="points-scheme">Interne Wertung: 4 = exakt · 2 = Tendenz · 0 = daneben</span>
        </div>
        <div className="points-track">
          <div className="points-fill" style={{ width: `${(punkte / maxPunkte) * 100}%` }} />
        </div>
      </div>

      <div className="stats-cols">
        <div className="stats-col">
          <h3>Selbsteinschätzung im Check</h3>
          <p className="col-hint">Waren Tipps mit hoher Sicherheit auch erfolgreicher?</p>
          {buckets.map((b) => (
            <div key={b.label} className="bar-row">
              <span className="bar-label">{b.label}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${b.quote ?? 0}%` }} />
              </div>
              <span className="bar-val">{b.quote != null ? `${b.quote}%` : '–'} <span className="bar-n">({b.n})</span></span>
            </div>
          ))}
        </div>
        <div className="stats-col">
          <h3>Nach getipptem Ausgang</h3>
          <p className="col-hint">Wo lag die KI häufiger richtig?</p>
          {ausgaenge.map((p) => (
            <div key={p.label} className="bar-row">
              <span className="bar-label">{p.label}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${p.quote ?? 0}%` }} />
              </div>
              <span className="bar-val">{p.quote != null ? `${p.quote}%` : '–'} <span className="bar-n">({p.n})</span></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function MatchCard({ match }) {
  const [expanded, setExpanded] = useState(false)
  const { home, away, prediction, actual, kickoff, group } = match
  const date = new Date(kickoff)
  const hit = hitType(prediction, actual)

  return (
    <div className="match-card" onClick={() => setExpanded(!expanded)}>
      <div className="match-meta">
        <span>{group}</span>
        <span>
          {date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}
          {' · '}
          {date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
        </span>
      </div>

      <div className="match-teams">
        <TeamBadge team={home} />
        <div className="match-score">
          {actual ? (
            <>
              <span className="score actual">{actual.score.home} : {actual.score.away}</span>
              <span className="score-tag">Endstand</span>
              <span className="score-pred">Tipp: {prediction.score.home} : {prediction.score.away}</span>
            </>
          ) : (
            <>
              <span className="score">{prediction.score.home} : {prediction.score.away}</span>
              <span className="score-tag">Prognose</span>
            </>
          )}
        </div>
        <TeamBadge team={away} />
      </div>

      {hit && <div className={`hit-badge hit-${hit}`}>{HIT_LABEL[hit]}</div>}

      {!actual && <ConfidenceBar value={prediction.confidence} />}

      {expanded && (
        <div className="match-details">
          {actual?.stats && actual.stats.possession.home != null && (
            <div className="stats-block">
              <h4>Tatsächliche Statistiken (Flashscore)</h4>
              {actual.stats.xg && <StatRow label="Expected Goals (xG)" home={actual.stats.xg.home} away={actual.stats.xg.away} />}
              <StatRow label="Ballbesitz" home={actual.stats.possession.home} away={actual.stats.possession.away} isPercent />
              <StatRow label="Torschüsse" home={actual.stats.shots.home} away={actual.stats.shots.away} />
              <StatRow label="Schüsse aufs Tor" home={actual.stats.shotsOnTarget.home} away={actual.stats.shotsOnTarget.away} />
              <StatRow label="Ecken" home={actual.stats.corners.home} away={actual.stats.corners.away} />
            </div>
          )}
          {prediction.expectedStats && (
            <div className="stats-block">
              <h4>{actual ? 'Erwartete Statistiken (Prognose)' : 'Erwartete Statistiken'}</h4>
              <StatRow label="Ballbesitz" home={prediction.expectedStats.possession.home} away={prediction.expectedStats.possession.away} isPercent />
              <StatRow label="Torschüsse" home={prediction.expectedStats.shots.home} away={prediction.expectedStats.shots.away} />
              <StatRow label="Schüsse aufs Tor" home={prediction.expectedStats.shotsOnTarget.home} away={prediction.expectedStats.shotsOnTarget.away} />
              <StatRow label="Ecken" home={prediction.expectedStats.corners.home} away={prediction.expectedStats.corners.away} />
            </div>
          )}
          <div className="reasoning">
            <h4>Warum die AI das denkt</h4>
            <p>{prediction.reasoning}</p>
          </div>
        </div>
      )}

      <div className="expand-hint">{expanded ? '▲ weniger' : '▼ Begründung & Stats'}</div>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('predictions.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="status">Fehler beim Laden der Predictions: {error}</div>
  if (!data) return <div className="status">Lade Predictions…</div>

  const finished = data.matches.filter((m) => m.actual)
  const bilanz = {
    exakt: finished.filter((m) => hitType(m.prediction, m.actual) === 'exakt').length,
    tendenz: finished.filter((m) => hitType(m.prediction, m.actual) === 'tendenz').length,
    daneben: finished.filter((m) => hitType(m.prediction, m.actual) === 'daneben').length,
  }

  return (
    <div className="app">
      <header>
        <h1>⚽ Bundesliga AI Predictions</h1>
        <p className="subtitle">
          Bundesliga 2026/27 · Form, xG und Spielstatistiken
        </p>
        <p className="generated">
          Stand: {new Date(data.generatedAt).toLocaleString('de-DE')} · Modell: {data.model}
        </p>
        {finished.length > 0 && (
          <div className="bilanz">
            <strong>AI-Bilanz:</strong> 🎯 {bilanz.exakt} exakt · ✅ {bilanz.tendenz} Tendenz · ❌ {bilanz.daneben} daneben
            {' '}({finished.length} {finished.length === 1 ? 'Spiel' : 'Spiele'} gewertet)
          </div>
        )}
      </header>

      {finished.length >= 10 && <StatsSummary finished={finished} />}

      <main>
        {data.matches.map((m) => (
          <MatchCard key={m.id} match={m} />
        ))}
      </main>

      <footer>
        Predictions sind KI-generiert und keine Wett-Empfehlung.
      </footer>
    </div>
  )
}
