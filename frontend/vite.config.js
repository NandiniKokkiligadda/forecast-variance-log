import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` proxies API calls to the FastAPI server (uvicorn backend.app:app --port 8000).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
