/**
 * The printed QR card, drawn once into a canvas so the preview, the PNG download
 * and the printed page are the same pixels.
 *
 * It used to be a styled div plus a print stylesheet, which hard-coded A5 and
 * never removed the page padding, so a card came out across several pages. A
 * canvas has no layout to leak.
 */

export interface QrCardSpec {
  widthMm: number
  heightMm: number
  headline: string
  eventName: string
  subtext: string
  footer: string
  url: string
  qrDataUrl: string
}

// Roughly 305 dpi. Enough that an A6 card still prints crisp.
const PX_PER_MM = 12

const CREAM = '#FFF9EE'
const INK = '#2B1B12'
const INK_MUTED = '#6B5646'
const GOLD = '#D9A441'
const BRAND = '#0B3D2E'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    const next = line + char
    if (ctx.measureText(next).width > maxWidth && line.length > 0) {
      lines.push(line)
      line = char
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('qr_decode_failed'))
    image.src = src
  })
}

export async function renderQrCard(spec: QrCardSpec): Promise<string> {
  await document.fonts.ready

  const w = Math.round(spec.widthMm * PX_PER_MM)
  const h = Math.round(spec.heightMm * PX_PER_MM)
  const mm = (value: number) => Math.round(value * PX_PER_MM)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no_2d_context')

  ctx.fillStyle = CREAM
  ctx.fillRect(0, 0, w, h)

  // Inset frame
  const inset = mm(9)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(2, mm(0.7))
  ctx.beginPath()
  ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, mm(3))
  ctx.stroke()

  const centre = w / 2
  const innerWidth = w - inset * 2 - mm(10)

  const headlineSize = Math.min(mm(7.5), w * 0.068)
  const eventSize = Math.max(12, headlineSize * 0.42)
  const bodySize = Math.max(12, w * 0.026)
  const urlSize = Math.max(10, bodySize * 0.9)
  const footerSpace = spec.footer ? mm(12) : 0

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Measure first, so the block can sit centred on the page with the footer
  // pinned to the bottom instead of leaving the lower half empty.
  ctx.font = `600 ${headlineSize}px "Fraunces Variable", Fraunces, Georgia, serif`
  const headlineLines = wrap(ctx, spec.headline, innerWidth)
  ctx.font = `400 ${bodySize}px "Instrument Sans Variable", system-ui, sans-serif`
  const subtextLines = wrap(ctx, spec.subtext, innerWidth)
  ctx.font = `400 ${urlSize}px "IBM Plex Mono", ui-monospace, monospace`
  const urlLines = wrap(ctx, spec.url, innerWidth)

  // The event name is only worth a line when it says something the headline does not.
  const showEvent =
    spec.eventName.trim().length > 0 &&
    spec.eventName.trim().toLowerCase() !== spec.headline.trim().toLowerCase()

  const qrSize = Math.min(mm(56), innerWidth, h * 0.36)
  const pad = mm(4)
  const panel = qrSize + pad * 2
  const gapBefore = mm(6)
  const gapAfter = mm(7)

  const blockHeight =
    headlineLines.length * headlineSize * 1.12 +
    (showEvent ? eventSize * 1.7 : 0) +
    gapBefore +
    panel +
    gapAfter +
    subtextLines.length * bodySize * 1.35 +
    urlLines.length * urlSize * 1.35

  const available = h - inset * 2 - footerSpace - mm(6)
  let y = inset + mm(6) + Math.max(0, (available - blockHeight) / 2) + headlineSize * 0.8

  ctx.fillStyle = BRAND
  ctx.font = `600 ${headlineSize}px "Fraunces Variable", Fraunces, Georgia, serif`
  for (const line of headlineLines) {
    ctx.fillText(line, centre, y)
    y += headlineSize * 1.12
  }

  if (showEvent) {
    ctx.fillStyle = INK_MUTED
    ctx.font = `400 ${eventSize}px "Instrument Sans Variable", system-ui, sans-serif`
    ctx.fillText(spec.eventName, centre, y + eventSize * 0.5)
    y += eventSize * 1.7
  }

  const panelX = centre - panel / 2
  const panelY = y + gapBefore

  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = '#E7D8BD'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(panelX, panelY, panel, panel, mm(2))
  ctx.fill()
  ctx.stroke()

  const qr = await loadImage(spec.qrDataUrl)
  ctx.drawImage(qr, panelX + pad, panelY + pad, qrSize, qrSize)

  y = panelY + panel + gapAfter + bodySize
  ctx.fillStyle = BRAND
  ctx.font = `600 ${bodySize}px "Instrument Sans Variable", system-ui, sans-serif`
  for (const line of subtextLines) {
    ctx.fillText(line, centre, y)
    y += bodySize * 1.35
  }

  ctx.fillStyle = INK_MUTED
  ctx.font = `400 ${urlSize}px "IBM Plex Mono", ui-monospace, monospace`
  for (const line of urlLines) {
    ctx.fillText(line, centre, y)
    y += urlSize * 1.35
  }

  if (spec.footer) {
    ctx.font = `400 ${bodySize * 0.95}px "Instrument Sans Variable", system-ui, sans-serif`
    ctx.fillStyle = INK
    ctx.fillText(spec.footer, centre, h - inset - mm(6))
  }

  return canvas.toDataURL('image/png')
}

/**
 * Print through a throwaway iframe that contains nothing but the card, so the
 * admin shell and its padding cannot spill onto extra pages.
 */
export function printQrCard(dataUrl: string, widthMm: number, heightMm: number): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    return
  }

  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `@page{size:${widthMm}mm ${heightMm}mm;margin:0}` +
      `html,body{margin:0;padding:0;background:#fff}` +
      `img{display:block;width:${widthMm}mm;height:${heightMm}mm}` +
      `</style></head><body><img src="${dataUrl}" alt=""></body></html>`,
  )
  doc.close()

  const image = doc.querySelector('img')
  const go = () => {
    win.focus()
    win.print()
    // Safari keeps resolving print() after the dialog opens; give it room.
    window.setTimeout(() => frame.remove(), 60_000)
  }
  if (image && !image.complete) image.addEventListener('load', go, { once: true })
  else go()
}
