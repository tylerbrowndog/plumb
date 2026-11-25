import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Fonts are small and inlined, so the app works offline and as a single file.
export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 40000 },
})
