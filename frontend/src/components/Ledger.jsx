import { useEffect, useMemo, useRef, useState } from 'react'
import { dateLabel, signed } from '../format.js'

export default function Ledger({ rows, selectedId, onSelect }) {
  const [sort, setSort] = useState('date')
  const listRef = useRef(null)
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.error_mwh)), 1)

  const ordered = useMemo(
    () => (sort === 'date' ? rows : [...rows].sort((a, b) => Math.abs(b.error_mwh) - Math.abs(a.error_mwh))),
    [rows, sort]
  )

  // Keep the selected day visible inside the list without scrolling the page.
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector('[aria-current="true"]')
    if (!list || !el) return
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight
  }, [selectedId, sort, rows])

  function onKeyDown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = [...e.currentTarget.querySelectorAll('button')]
    const i = buttons.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    buttons[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), buttons.length - 1)].focus()
  }

  return (
    <div className="ledger">
      <div className="ledger-head">
        <span className="ledger-title">Days</span>
        <div className="sort" role="group" aria-label="Sort days">
          <button type="button" aria-pressed={sort === 'date'} onClick={() => setSort('date')}>Date</button>
          <button type="button" aria-pressed={sort === 'miss'} onClick={() => setSort('miss')}>Largest miss</button>
        </div>
      </div>
      <ul ref={listRef} className="ledger-list" onKeyDown={onKeyDown}>
        {ordered.map((r) => {
          const w = (Math.abs(r.error_mwh) / maxAbs) * 100
          return (
            <li key={r.row_id}>
              <button type="button" aria-current={r.row_id === selectedId ? 'true' : undefined} onClick={() => onSelect(r.row_id)}>
                <span className="l-date">
                  {dateLabel(r.date)}
                  {r.outage_flag === 1 && <span className="l-outage">outage</span>}
                </span>
                <span className="l-bar" aria-hidden="true">
                  <i className={r.error_mwh < 0 ? 'neg' : 'pos'} style={{ width: `${w / 2}%` }} />
                </span>
                <span className={`l-val ${r.error_mwh < 0 ? 'neg' : 'pos'}`}>{signed(r.error_mwh)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
