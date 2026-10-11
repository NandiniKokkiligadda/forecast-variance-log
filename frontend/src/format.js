const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const dateLabel = (iso) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}
export const num = (v, digits = 1) => Number(v).toFixed(digits)
export const signed = (v, digits = 1) => {
  const s = Math.abs(v).toFixed(digits)
  if (Number(s) === 0) return s
  return `${v < 0 ? '−' : '+'}${s}`
}
