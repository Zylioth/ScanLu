/**
 * Client-side image processing for menu photos (system.md §12.4a).
 * Corrects EXIF orientation, centre-crops to 4:3, resizes, exports WebP.
 */

export interface ProcessOptions {
  /** 0.5 to 3. A value of 1 shows the full frame at 4:3. */
  zoom?: number
  /** -1..1 horizontal offset of the crop window. */
  offsetX?: number
  /** -1..1 vertical offset of the crop window. */
  offsetY?: number
  maxWidth?: number
  maxHeight?: number
  quality?: number
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through to <img>, some Safari versions reject the option */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode_failed'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))),
      type,
      quality,
    )
  })
}

/**
 * Crops the source to 4:3 around its centre, then scales to the target box.
 * Returns a Blob, preferring WebP and falling back to JPEG.
 */
export async function processImage(file: File, opts: ProcessOptions = {}): Promise<Blob> {
  const { zoom = 1, offsetX = 0, offsetY = 0, maxWidth = 1200, maxHeight = 900, quality = 0.8 } = opts
  const source = await loadBitmap(file)
  const sw = 'width' in source ? source.width : 0
  const sh = 'height' in source ? source.height : 0
  if (!sw || !sh) throw new Error('empty_image')

  // Largest 4:3 window that fits inside the source, shrunk by zoom.
  const targetAspect = 4 / 3
  let cropW = Math.min(sw, sh * targetAspect)
  let cropH = cropW / targetAspect
  cropW /= Math.max(1, zoom)
  cropH /= Math.max(1, zoom)

  const maxOffsetX = (sw - cropW) / 2
  const maxOffsetY = (sh - cropH) / 2
  const cropX = (sw - cropW) / 2 + offsetX * maxOffsetX
  const cropY = (sh - cropH) / 2 + offsetY * maxOffsetY

  const outW0 = Math.min(maxWidth, Math.round(cropW))
  let outH = Math.round(outW0 / targetAspect)
  let outW = outW0
  if (outH > maxHeight) {
    outH = maxHeight
    outW = Math.round(outH * targetAspect)
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(outW)
  canvas.height = Math.round(outH)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no_2d_context')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)
  if ('close' in source) source.close()

  try {
    return await canvasToBlob(canvas, 'image/webp', quality)
  } catch {
    return await canvasToBlob(canvas, 'image/jpeg', quality)
  }
}

/** Demo-mode storage: images become data URLs in localStorage, so keep them small. */
export async function processImageToDataUrl(file: File, opts: ProcessOptions = {}): Promise<string> {
  return blobToDataUrl(await processImage(file, opts))
}

/** Read a blob back as a data URL, for the preview and for demo-mode storage. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(blob)
  })
}

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'not_an_image'
  if (file.size > 12 * 1024 * 1024) return 'too_large'
  return null
}
