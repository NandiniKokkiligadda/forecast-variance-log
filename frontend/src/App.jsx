import { useEffect, useMemo, useState } from 'react'
import { ask, getData, getDrivers, getExplain, getMetrics } from './api.js'
import { dateLabel, num, signed } from './format.js'
import Timeline from './components/Timeline.jsx'
import Waterfall, { Inputs } from './components/Waterfall.jsx'
import Agent from './components/Agent.jsx'
import Evaluation from './components/Evaluation.jsx'
import Ledger from './components/Ledger.jsx'

const VIEWS = [
  { id: 'review', label: 'Daily review' },
  { id: 'ask', label: 'Ask' },
  { id: 'model', label: 'Model check' },
]

const LIMITATIONS = [
  'Sixty rows over 30 days with three outages: the outage effect is clear, the weather effects are not statistically reliable.',
  'Attribution is linear and additive, so interactions such as curtailment during a grid constraint are missed.',
  'The file has no site column. Repeated dates are treated as two parallel blocks, A and B.',
  'Weather inputs are observed values, not the forecasts the operator used, so weather forecast error cannot be separated from model error.',
  'Dummy data: this demonstrates the method, not real plant performance.',
]

function useView() {
  const read = () => {
    const v = window.location.hash.replace('#/', '')
    return VIEWS.some((x) => x.id === v) ? v : 'review'
  }
  const [view, setView] = useState(read)
  useEffect(() => {
    const on = () => setView(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return view
}

export default function App() {
  const view = useView()
  const [boot, setBoot] = useState({ status: 'loading' })
  const [block, setBlock] = useState('A')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [summary, setSummary] = useState('')

  function load() {
    setBoot({ status: 'loading' })
    Promise.all([getData(), getMetrics(), getDrivers()])
      .then(([data, metrics, drivers]) => {
        const rows = data.rows
        const worst = rows.reduce((a, b) => (Math.abs(b.error_mwh) > Math.abs(a.error_mwh) ? b : a))
        setBlock(worst.block)
        setSelectedId(worst.row_id)
        setBoot({ status: 'ready', rows, metrics, drivers })
      })
      .catch(() => setBoot({ status: 'error' }))
  }
  useEffect(load, [])

  useEffect(() => {
    const label = VIEWS.find((v) => v.id === view).label
    document.title = `${label} · Forecast variance log`
  }, [view])

  const rows = boot.rows
  const blocks = useMemo(() => (rows ? [...new Set(rows.map((r) => r.block))] : []), [rows])
  const blockRows = useMemo(() => (rows ? rows.filter((r) => r.block === block) : []), [rows, block])
  const selected = rows && selectedId !== null ? rows[selectedId] : null

  useEffect(() => {
    if (selectedId === null || !selected) return
    let live = true
    setDetail(null)
    setSummary('')
    getExplain(selectedId).then((d) => live && setDetail(d)).catch(() => {})
    ask(`${selected.date} block ${selected.block}`, undefined, false).then((r) => live && setSummary(r.result)).catch(() => {})
    return () => { live = false }
  }, [selectedId])

  function openDay(id) {
    setSelectedId(id)
    setBlock(rows[id].block)
    window.location.hash = '#/review'
  }
  function switchBlock(b) {
    setBlock(b)
    const same = rows.find((r) => r.block === b && r.date === selected.date)
    if (same) setSelectedId(same.row_id)
  }

  const header = (
    <aside className="rail">
      <div className="rail-top">
        <a className="brand" href="#/review" aria-label="Forecast variance log, daily review">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="6" fill="#16404b" />
            <path d="M5 21 L12 13 L18 18 L27 8" fill="none" stroke="#f2f5f4" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M5 15 L12 17 L18 11 L27 14" fill="none" stroke="#e0a526" strokeWidth="2" strokeDasharray="3 2.5" />
          </svg>
          <span className="brand-name">Forecast<br />variance log<span>Generation misses, explained</span></span>
        </a>
      </div>
      <nav aria-label="Main">
        {VIEWS.map((v) => (
          <a key={v.id} href={`#/${v.id}`} aria-current={v.id === view ? 'page' : undefined}>{v.label}</a>
        ))}
      </nav>
      {rows && (
        <p className="dataset">
          <strong>{rows.length} rows</strong>
          {dateLabel(rows[0].date)} to {dateLabel(rows[rows.length - 1].date)}, blocks {blocks.join(' and ')}. Sample data.
        </p>
      )}
    </aside>
  )

  if (boot.status === 'loading') {
    return (
      <div className="shell">
        {header}
        <main className="page"><p className="muted status" role="status">Loading forecast data…</p></main>
      </div>
    )
  }
  if (boot.status === 'error') {
    return (
      <div className="shell">
        {header}
        <main className="page">
          <div className="page-inner">
            <h1>Could not reach the API</h1>
            <p className="lede">The forecast data did not load. Start the backend with <code>uvicorn backend.app:app --port 8000</code>, then retry.</p>
            <button type="button" className="primary" onClick={load}>Retry</button>
          </div>
        </main>
      </div>
    )
  }

  const pct = Math.abs(selected.error_mwh) / selected.forecast_mwh * 100
  const meanMiss = blockRows.reduce((t, r) => t + Math.abs(r.error_mwh), 0) / blockRows.length
  const outageDays = blockRows.filter((r) => r.outage_flag === 1).length

  return (
    <div className="shell">
      {header}
      <main className="page">
        <section hidden={view !== 'review'} aria-labelledby="h-review" className="review">
          <h1 id="h-review" className="sr">Daily review</h1>
          <div className="review-side">
            <div className="seg" role="group" aria-label="Generating block">
              {blocks.map((b) => (
                <button key={b} type="button" aria-pressed={b === block} onClick={() => switchBlock(b)}>Block {b}</button>
              ))}
            </div>
            <Ledger rows={blockRows} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          <div className="review-main">
            <div className="chart-block">
              <div className="block-head">
                <div>
                  <h2>Block {block}, forecast vs actual</h2>
                  <p>
                    The forecast missed by {num(meanMiss)} MWh on an average day
                    {outageDays > 0 ? `, and ${outageDays} of ${blockRows.length} days had an outage.` : '.'}
                  </p>
                </div>
                <ul className="legend">
                  <li><span className="sw actual" />Actual</li>
                  <li><span className="sw forecast" />Operator forecast</li>
                  <li><span className="sw outage" />Outage day</li>
                </ul>
              </div>
              <div className="timeline-wrap">
                <Timeline rows={blockRows} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
            </div>

            <div className="day">
              <div className="day-title">
                <h2>{dateLabel(selected.date)}, block {selected.block}</h2>
                {selected.outage_flag === 1 && <span className="tag outage">Outage day</span>}
              </div>
              <dl className="figures">
                <div className="miss">
                  <dt>Miss</dt>
                  <dd className={`big ${selected.error_mwh < 0 ? 'neg' : 'pos'}`}>{signed(selected.error_mwh)}<small>MWh</small></dd>
                  <dd className="sub">{num(pct, 0)}% {selected.error_mwh < 0 ? 'below' : 'above'} forecast</dd>
                </div>
                <div><dt>Forecast</dt><dd>{num(selected.forecast_mwh)}<small>MWh</small></dd></div>
                <div><dt>Actual</dt><dd>{num(selected.actual_mwh)}<small>MWh</small></dd></div>
              </dl>
              {summary && <p className="summary">{summary}</p>}
              {detail ? (
                <div className="day-cols">
                  <div>
                    <h3>Where the miss came from</h3>
                    <Waterfall detail={detail} />
                    <p className="muted small">Each row moves the running miss, in MWh. Driver effects compare this day with the average day.</p>
                  </div>
                  <div>
                    <h3>Inputs that day</h3>
                    <Inputs detail={detail} />
                  </div>
                </div>
              ) : (
                <p className="muted status" role="status">Loading breakdown…</p>
              )}
            </div>
          </div>
        </section>

        <section hidden={view !== 'ask'} aria-labelledby="h-ask" className="page-inner">
          <h1 id="h-ask">Ask about a miss</h1>
          <p className="lede">Name a date, a block, or a driver. The agent splits the miss into outage, weather and unexplained effects and lists the rows it used.</p>
          <Agent onOpenDay={openDay} />
        </section>

        <section hidden={view !== 'model'} aria-labelledby="h-model" className="page-inner">
          <h1 id="h-model">Model check</h1>
          <p className="lede">How the baseline compares with the operator forecast, and how far the driver estimates can be trusted.</p>
          <Evaluation metrics={boot.metrics} drivers={boot.drivers} />
          <h2 className="limits-head">Limitations</h2>
          <ul className="limits">{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      </main>
    </div>
  )
}
