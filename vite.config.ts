import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // A GitHub Pages build serves from /cloud-designer/; set BASE_PATH to match.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
