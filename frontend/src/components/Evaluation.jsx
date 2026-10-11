import { num, signed } from '../format.js'

function Interval({ d }) {
  const m = Math.max(Math.abs(d.ci_low), Math.abs(d.ci_high), Math.abs(d.coef)) * 1.1
  const x = (v) => 80 + (v / m) * 74
  return (
    <svg className="interval" viewBox="0 0 160 20" role="img" aria-label={`${d.label} 90% interval ${num(d.ci_low, 2)} to ${num(d.ci_high, 2)}`}>
      <line className="zero" x1="80" x2="80" y1="2" y2="18" />
      <line className={d.reliable ? 'ci strong' : 'ci'} x1={x(d.ci_low)} x2={x(d.ci_high)} y1="10" y2="10" />
      <circle className={d.reliable ? 'pt strong' : 'pt'} cx={x(d.coef)} cy="10" r="3.5" />
    </svg>
  )
}

export default function Evaluation({ metrics, drivers }) {
  const best = Math.min(...metrics.table.map((r) => r.mae))
  const worst = Math.max(...metrics.table.map((r) => r.mae))
  const op = metrics.table.find((r) => r.key === 'operator')
  const bl = metrics.table.find((r) => r.key === 'baseline')
  return (
    <div className="eval">
      <div>
        <h2>Forecast accuracy</h2>
        <p className="muted small" style={{ marginTop: 6 }}>Lower is better. The bar shows MAE relative to the weakest method.</p>
        <div className="scroll" style={{ marginTop: 10 }}>
          <table className="data acc">
            <thead>
              <tr><th>Method</th><th>MAE</th><th>RMSE</th><th>WAPE</th><th>MAE, no outage</th></tr>
            </thead>
            <tbody>
              {metrics.table.map((r) => (
                <tr key={r.key} className={r.mae === best ? 'best' : ''}>
                  <th scope="row">{r.label}</th>
                  <td className="mae-cell">
                    <span className="mae-wrap">
                      <span className="mae-bar" aria-hidden="true"><i style={{ width: `${(r.mae / worst) * 100}%` }} /></span>
                      {num(r.mae, 2)}
                    </span>
                  </td>
                  <td>{num(r.rmse, 2)}</td>
                  <td>{num(r.wape * 100, 1)}%</td>
                  <td>{num(r.mae_normal_days, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          MAE, RMSE in MWh. WAPE is total absolute error divided by total actual output. {metrics.validation} {metrics.test_rows} test rows, {metrics.test_rows_with_outage} with an outage.
        </p>
        {bl.mae > op.mae && (
          <p className="small">
            The weather-only baseline is {num(bl.mae - op.mae, 1)} MWh worse on MAE than the operator forecast, so it is a floor to beat, not a replacement. Correcting the operator forecast for outages gives the best result.
          </p>
        )}
      </div>
      <div>
        <h2>What drives the miss</h2>
        <p className="muted small" style={{ marginTop: 6 }}>An interval that crosses zero means the effect cannot be told apart from noise.</p>
        <div className="scroll" style={{ marginTop: 10 }}>
          <table className="data drv">
            <thead>
              <tr><th>Driver</th><th>Effect on miss</th><th>90% interval</th><th>Reliable</th></tr>
            </thead>
            <tbody>
              {drivers.drivers.map((d) => (
                <tr key={d.key}>
                  <th scope="row">{d.label}</th>
                  <td>{signed(d.coef, 3)} {d.unit ? `MWh per ${d.unit}` : 'MWh when flagged'}</td>
                  <td><Interval d={d} /></td>
                  <td className={d.reliable ? 'reliable-yes' : ''}>{d.reliable ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Linear model of actual − forecast on the four inputs; intervals from 300 bootstrap resamples. Together they explain {num(drivers.r2 * 100, 0)}% of the variance in miss.
        </p>
      </div>
    </div>
  )
}
