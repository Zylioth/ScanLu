/**
 * Generates the PWA icons from geometry, so the manifest has real PNGs instead
 * of a broken reference. Run with `npm run icons` after changing the mark.
 *
 * The mark: gold crescent above a cream cup, on emerald. It is a placeholder
 * identity until the open house has its own name and logo.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public')

const EMERALD = [11, 61, 46]
const GOLD = [217, 164, 65]
const CREAM = [255, 249, 238]

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Signed distance helpers in 0..1 space. */
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1
const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  if (!inRect(x, y, x0, y0, x1, y1)) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || inRect(x, y, x0 + r, y0, x1 - r, y1)
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

/** Cup: trapezoid body with a handle ring, both in 0..1 space. */
function inCup(x, y) {
  const top = 0.60
  const bottom = 0.815
  if (y < top || y > bottom) return false
  const t = (y - top) / (bottom - top)
  const halfWidth = 0.135 - 0.038 * t
  const cx = 0.46
  if (Math.abs(x - cx) > halfWidth) return false
  // rounded base
  const baseRoundY = bottom - 0.055
  if (y > baseRoundY) {
    const dy = y - baseRoundY
    const inset = 0.038 * (1 - Math.sqrt(Math.max(0, 1 - (dy / 0.055) ** 2)))
    return Math.abs(x - cx) < halfWidth - inset
  }
  return true
}

function inHandle(x, y) {
  const cx = 0.598
  const cy = 0.665
  const outer = inEllipse(x, y, cx, cy, 0.083, 0.075)
  const inner = inEllipse(x, y, cx, cy, 0.045, 0.041)
  return outer && !inner
}

function sample(x, y, maskable) {
  // Rounded background, or full bleed for the maskable icon.
  if (maskable) {
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return EMERALD
  }
  return inRoundedRect(x, y, 0, 0, 1, 1, 0.22) ? EMERALD : null
}

function paint(x, y, maskable) {
  if (!sample(x, y, maskable)) return null
  // Crescent: big disc minus an offset disc.
  const inCrescent = inCircle(x, y, 0.5, 0.335, 0.175) && !inCircle(x, y, 0.575, 0.285, 0.162)
  if (inCrescent) return GOLD
  if (inCup(x, y) || inHandle(x, y)) return CREAM
  return null
}

function render(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4)
  const samples = 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          const color = paint(x, y, maskable)
          if (color) {
            r += color[0]
            g += color[1]
            b += color[2]
            a += 1
          }
        }
      }
      const total = samples * samples
      const index = (py * size + px) * 4
      if (a > 0) {
        rgba[index] = Math.round(r / a)
        rgba[index + 1] = Math.round(g / a)
        rgba[index + 2] = Math.round(b / a)
        rgba[index + 3] = Math.round((a / total) * 255)
      }
    }
  }
  return encodePng(size, size, rgba)
}

mkdirSync(outDir, { recursive: true })
const outputs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]
for (const [name, size, maskable] of outputs) {
  const png = render(size, maskable)
  writeFileSync(join(outDir, name), png)
  console.log(`${name} ${size}x${size} ${(png.length / 1024).toFixed(1)} KB`)
}

writeFileSync(
  join(outDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0B3D2E"/>
  <path d="M32 12a11 11 0 1 0 0 22 12.5 12.5 0 0 1 0-22z" fill="#D9A441"/>
  <path d="M21 38h17v6.5a8.5 8.5 0 0 1-17 0z" fill="#FFF9EE"/>
  <path d="M38 40h2.6a3.4 3.4 0 0 1 0 6.8H38" fill="none" stroke="#FFF9EE" stroke-width="2"/>
</svg>
`,
)
console.log('favicon.svg')
