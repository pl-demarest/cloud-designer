import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // A GitHub Pages build serves from /cloud-designer/; set BASE_PATH to match.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  build: {
    // three.js is one module of about 526 kB (three/build/three.module.js); every other chunk is
    // far below this limit.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // three.js in a chunk of its own, which stays in the browser cache across releases of
          // the editor. Only its build: the addons stay where they are, GLTFExporter in the chunk
          // the first export loads.
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ }],
        },
      },
    },
  },
})
