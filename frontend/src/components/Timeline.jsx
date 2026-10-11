import { dateLabel, num, signed } from '../format.js'

const W = 760, L = 46, R = 12, T = 22
const MAIN_H = 190, GAP = 34, STRIP_H = 64

export default function Timeline({ rows, selectedId, onSelect }) {
  const n = rows.length
  const bw = (W - L - R) / n
  const x = (i) => L + (i + 0.5) * bw
  const yMax = Math.ceil(Math.max(...rows.flatMap((r) => [r.forecast_mwh, r.actual_mwh])) / 20) * 20
  const y = (v) => T + MAIN_H - (v / yMax) * MAIN_H
  const eMax = Math.max(10, Math.ceil(Math.max(...rows.map((r) => Math.abs(r.error_mwh))) / 5) * 5)
  const stripTop = T + MAIN_H + GAP
  const stripMid = stripTop + STRIP_H / 2
  const ey = (v) => stripMid - (v / eMax) * (STRIP_H / 2)
  const H = stripTop + STRIP_H + 24
  const line = (key) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ')
  const ticks = [0, 1, 2, 3, 4].map((k) => (yMax / 4) * k)

  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Forecast and actual generation by day">
      <defs>
        <pattern id="outage-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
        </pattern>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
          <text className="tick" x={L - 8} y={y(t) + 4} textAnchor="end">{t}</text>
        </g>
      ))}
      <text className="axis-title" x={0} y={T - 13}>Output, MWh</text>

      {rows.map((r, i) => (
        <g key={r.row_id}>
          {r.outage_flag === 1 && (
            <rect className="outage-band" x={x(i) - bw / 2} y={T} width={bw} height={stripTop + STRIP_H - T} />
          )}
          {r.row_id === selectedId && (
            <rect className="selected-band" x={x(i) - bw / 2} y={T} width={bw} height={stripTop + STRIP_H - T} />
          )}
        </g>
      ))}

      <path className="line forecast" d={line('forecast_mwh')} />
      <path className="line actual" d={line('actual_mwh')} />
      {rows.map((r, i) => (
        <circle key={r.row_id} className={`dot ${r.outage_flag ? 'outage' : ''}`} cx={x(i)} cy={y(r.actual_mwh)} r={r.row_id === selectedId ? 5 : 2.8} />
      ))}

      <line className="zero" x1={L} x2={W - R} y1={stripMid} y2={stripMid} />
      <text className="tick" x={L - 8} y={ey(eMax) + 4} textAnchor="end">+{eMax}</text>
      <text className="tick" x={L - 8} y={ey(0) + 4} textAnchor="end">0</text>
      <text className="tick" x={L - 8} y={ey(-eMax) + 4} textAnchor="end">−{eMax}</text>
      <text className="axis-title" x={0} y={stripTop - 10}>Miss (actual − forecast), MWh</text>
      {rows.map((r, i) => {
        const h = Math.abs(ey(r.error_mwh) - stripMid)
        return (
          <rect
            key={r.row_id}
            className={r.error_mwh < 0 ? 'bar short' : 'bar over'}
            x={x(i) - bw * 0.3}
            width={bw * 0.6}
            y={r.error_mwh < 0 ? stripMid : stripMid - h}
            height={Math.max(h, 0.5)}
          />
        )
      })}

      {rows.map((r, i) =>
        i % 5 === 0 ? (
          <text key={r.row_id} className="tick" x={x(i)} y={H - 6} textAnchor="middle">{dateLabel(r.date)}</text>
        ) : null
      )}

      {rows.map((r, i) => (
        <rect
          key={r.row_id}
          className="hit"
          x={x(i) - bw / 2}
          y={T}
          width={bw}
          height={stripTop + STRIP_H - T}
          tabIndex={0}
          role="button"
          aria-pressed={r.row_id === selectedId}
          aria-label={`${dateLabel(r.date)}: forecast ${num(r.forecast_mwh)}, actual ${num(r.actual_mwh)} MWh, miss ${signed(r.error_mwh)}${r.outage_flag ? ', outage' : ''}`}
          onClick={() => onSelect(r.row_id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(r.row_id)
            }
          }}
        />
      ))}
    </svg>
  )
}
