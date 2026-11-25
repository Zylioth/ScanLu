/**
 * Serves dist/ the way GitHub Pages does, so the subpath build can be tested
 * locally: files under /ScanLu/, and any unknown path returns 404.html so the
 * SPA router can take over.
 *
 *   node scripts/serve-pages.mjs [port]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const PORT = Number(process.argv[2] ?? 4174)
const PREFIX = '/ScanLu'
const ROOT = 'dist'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function readIfFile(path) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return await readFile(path)
  } catch {
    return null
  }
}

function resolveSafe(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  const target = join(ROOT, clean)
  if (!target.startsWith(normalize(ROOT))) return null
  return target
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`)

  if (url.pathname === PREFIX) {
    response.writeHead(301, { location: `${PREFIX}/` })
    response.end()
    return
  }

  if (!url.pathname.startsWith(`${PREFIX}/`)) {
    response.writeHead(302, { location: `${PREFIX}${url.pathname}` })
    response.end()
    return
  }

  const relative = url.pathname.slice(PREFIX.length)
  const requested = relative === '/' || relative === '' ? '/index.html' : relative
  const filePath = resolveSafe(requested)
  const body = filePath ? await readIfFile(filePath) : null

  if (body) {
    response.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(body)
    return
  }

  // GitHub Pages behaviour: unknown path serves 404.html with a 404 status.
  const fallback = await readIfFile(join(ROOT, '404.html'))
  if (fallback) {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(fallback)
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found')
})

server.listen(PORT, () => {
  console.log(`pages-style server on http://localhost:${PORT}${PREFIX}/`)
})
