async function request(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(`${options?.method || 'GET'} ${url} failed (${res.status})`)
  return res.json()
}

export const getData = () => request('/api/data')
export const getMetrics = () => request('/api/metrics')
export const getDrivers = () => request('/api/drivers')
export const getExplain = (id) => request(`/api/explain/${id}`)
export const ask = (text, signal, llm = true) =>
  request('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, llm }),
    signal,
  })
