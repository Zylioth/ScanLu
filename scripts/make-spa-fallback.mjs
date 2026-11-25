/**
 * GitHub Pages has no rewrite rules, so a deep link like /ScanLu/ticket/<id>
 * returns 404. Serving index.html from 404.html makes the SPA router take over.
 */
import { copyFileSync, existsSync } from 'node:fs'

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html is missing. Run the build first.')
  process.exit(1)
}

copyFileSync('dist/index.html', 'dist/404.html')
console.log('dist/404.html written, deep links will fall back to the app shell')
