import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * After the build, write dist/sw.js: the service worker with the exact list
 * of files to keep on the phone, so the app opens instantly.
 */
function serviceWorker(): Plugin {
  return {
    name: 'tucker-service-worker',
    apply: 'build',
    closeBundle() {
      const dist = path.join(root, 'dist');
      if (!fs.existsSync(dist)) return;
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(`/${path.relative(dist, full).split(path.sep).join('/')}`);
        }
      };
      walk(dist);
      const keep = files.filter((f) => f !== '/sw.js' && f !== '/index.html' && !f.endsWith('.map')).sort();
      const hash = crypto.createHash('sha256');
      for (const f of ['/index.html', ...keep]) {
        hash.update(f);
        hash.update(fs.readFileSync(path.join(dist, f)));
      }
      const version = hash.digest('hex').slice(0, 12);
      const template = fs.readFileSync(path.join(root, 'src', 'service-worker.template.js'), 'utf8');
      const out = template
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace("'__PRECACHE__'", JSON.stringify(['/', ...keep]));
      fs.writeFileSync(path.join(dist, 'sw.js'), out);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
