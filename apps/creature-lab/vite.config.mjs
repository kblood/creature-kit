// Vite config of the kit's Creature Lab app (apps/creature-lab).
//   npm run lab:dev    -> http://127.0.0.1:5206/apps/creature-lab/ (Animal Lab, composer)
//   npm run lab:build  -> apps/creature-lab/dist/index.html (+ compatible page URLs/assets), relative URLs (base './')
// The dev server is rooted at the KIT root so the page, the kit's own modules (/src/*.ts) and three
// (/node_modules/three/...) share one origin, as the browser tests (tests/browser/) import them by those paths. The build is
// rooted at the app folder so dist/ holds just the page. The library build (npm run build -> dist/) never includes apps/.
import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const app = fileURLToPath(new URL('.', import.meta.url));
const kit = resolve(app, '../..');

export default defineConfig(({command}) => ({
  root: command === 'build' ? app : kit,
  base: './',
  publicDir: false,
  // node_modules may be a junction to another checkout's node_modules: keep Vite's dependency cache out of it.
  cacheDir: resolve(app, '.vite'),
  server: {host: '127.0.0.1', port: 5206, strictPort: false, fs: {allow: [kit]}},
  preview: {host: '127.0.0.1', port: 5207},
  build: {
    outDir: resolve(app, 'dist'),
    emptyOutDir: true,
    // three.js alone is about 700 kB minified; the page is one chunk by design.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {input: {index:resolve(app,'index.html'),composer:resolve(app,'creature-lab.html'),planet:resolve(app,'planet-skin.html'),benchmark:resolve(app,'benchmark.html')}},
  },
}));
