import { useRef, useState } from 'react'
import { ask } from '../api.js'
import { dateLabel, signed } from '../format.js'

const EXAMPLES = [
  'Why was Aug 15 so far off?',
  'Show the 3 worst misses',
  'What do outages cost us?',
  'Does wind speed matter?',
]

export default function Agent({ onOpenDay }) {
  const [text, setText] = useState('')
  const [state, setState] = useState({ status: 'idle' })
  const controller = useRef(null)

  async function submit(q) {
    if (!q.trim()) return
    controller.current?.abort()
    controller.current = new AbortController()
    setState({ status: 'loading' })
    try {
      const data = await ask(q, controller.current.signal)
      setState({ status: 'done', data })
    } catch (e) {
      if (e.name !== 'AbortError') setState({ status: 'error' })
    }
  }

  return (
    <div className="ask ask-grid">
      <div>
        <form onSubmit={(e) => { e.preventDefault(); submit(text) }}>
          <label htmlFor="q">Question</label>
          <div className="ask-row">
            <input id="q" value={text} onChange={(e) => setText(e.target.value)} placeholder="Why did block A miss on Aug 15?" autoComplete="off" />
            <button type="submit" className="primary" disabled={state.status === 'loading' || !text.trim()}>Explain</button>
          </div>
        </form>

        <div className="answer" aria-live="polite">
          {state.status === 'idle' && <p className="muted">Answers are computed from the fitted model, so every figure can be traced back to a row.</p>}
          {state.status === 'loading' && <p className="muted">Working it out…</p>}
          {state.status === 'error' && <p className="error">The agent did not respond. Check that the backend is running, then ask again.</p>}
          {state.status === 'done' && (
            <>
              <p className="answer-text">{state.data.result}</p>
              <p className="muted small">{state.data.mode === 'llm' ? 'Summarised by an LLM from computed findings.' : 'Rule-based answer from the fitted model.'}</p>
              {state.data.evidence.length > 0 && (
                <table className="data evidence">
                  <caption>Rows behind this answer</caption>
                  <thead><tr><th>Day</th><th>Block</th><th>Miss, MWh</th><th><span className="sr">Open</span></th></tr></thead>
                  <tbody>
                    {state.data.evidence.map((e) => (
                      <tr key={e.row_id}>
                        <th scope="row">{dateLabel(e.date)}</th>
                        <td>{e.block}</td>
                        <td className={e.error_mwh < 0 ? 'neg' : 'pos'}>{signed(e.error_mwh)}</td>
                        <td><button type="button" className="link" onClick={() => onOpenDay(e.row_id)}>Open day</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <details>
                <summary>How the agent got there</summary>
                <ol>{state.data.reasoning_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </details>
            </>
          )}
        </div>
      </div>

      <div className="prompts">
        <h3>Questions to start with</h3>
        <ul>
          {EXAMPLES.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => { setText(s); submit(s) }}>{s}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
