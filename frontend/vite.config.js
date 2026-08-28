import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // relative Pfade, damit der Build unter jedem Nginx-Pfad funktioniert
  base: './',
  plugins: [react()],
})
