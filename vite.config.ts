import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { parsePlugin } from './server/parse-plugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), parsePlugin()],
})
