import { num, signed } from '../format.js'

const W = 440, LABEL_W = 108, VALUE_W = 48, ROW_H = 32, BAR_H = 16, TOP = 6

export default function Waterfall({ detail }) {
  let run = 0
  const items = detail.steps.map((s) => {
    const a = run
    run += s.value
    return { label: s.label, a, b: run, v: s.value }
  })
  items.push({ label: 'Total miss', a: 0, b: run, v: run, total: true })

  const all = items.flatMap((i) => [i.a, i.b, 0])
  let lo = Math.min(...all), hi = Math.max(...all)
  const pad = Math.max((hi - lo) * 0.08, 0.5)
  lo -= pad
  hi += pad
  if (hi - lo < 6) { const m = (hi + lo) / 2; lo = m - 3; hi = m + 3 }
  const plotL = LABEL_W + 8, plotR = W - VALUE_W
  const x = (v) => plotL + ((v - lo) / (hi - lo)) * (plotR - plotL)
  const H = TOP + items.length * ROW_H + 4

  return (
    <svg className="waterfall" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`How the ${signed(detail.error_mwh)} MWh miss breaks down by driver`}>
      <line className="zero" x1={x(0)} x2={x(0)} y1={TOP} y2={H - 2} />
      {items.map((it, i) => {
        const cy = TOP + i * ROW_H + ROW_H / 2
        const x1 = x(Math.min(it.a, it.b)), x2 = x(Math.max(it.a, it.b))
        const cls = it.total ? 'total' : it.v < 0 ? 'short' : 'over'
        const next = items[i + 1]
        return (
          <g key={it.label}>
            {it.total && <line className="total-rule" x1={0} x2={W} y1={cy - ROW_H / 2 + 1} y2={cy - ROW_H / 2 + 1} />}
            <text className={`row-label ${it.total ? 'strong' : ''}`} x={0} y={cy + 4}>{it.label}</text>
            <rect className={`wbar ${cls}`} x={x1} y={cy - BAR_H / 2} width={Math.max(x2 - x1, 2)} height={BAR_H} />
            {next && !next.total && (
              <line className="connector" x1={x(it.b)} x2={x(it.b)} y1={cy + BAR_H / 2} y2={cy + ROW_H - BAR_H / 2} />
            )}
            <text className={`row-value ${it.total ? 'strong' : ''}`} x={W} y={cy + 4} textAnchor="end">{signed(it.v)}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Inputs({ detail }) {
  const rows = [
    ['irradiance_wm2', 'Irradiance', 'W/m²', 0],
    ['wind_speed_ms', 'Wind speed', 'm/s', 1],
    ['temperature_c', 'Temperature', '°C', 1],
  ]
  return (
    <table className="inputs">
      <thead>
        <tr><th>Input</th><th>This day</th><th>Average day</th></tr>
      </thead>
      <tbody>
        {rows.map(([k, label, unit, d]) => (
          <tr key={k}>
            <th scope="row">{label}</th>
            <td>{num(detail.inputs[k], d)} {unit}</td>
            <td>{num(detail.typical_inputs[k], d)} {unit}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">Outage flag</th>
          <td className={detail.inputs.outage_flag ? 'flag' : ''}>{detail.inputs.outage_flag ? 'Outage' : 'None'}</td>
          <td>{num(detail.typical_inputs.outage_flag * 100, 0)}% of days</td>
        </tr>
      </tbody>
    </table>
  )
}
