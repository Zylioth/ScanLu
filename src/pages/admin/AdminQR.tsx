import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { Download, Printer } from 'lucide-react'
import { useSettings } from '../../lib/hooks'
import { APP_NAME } from '../../lib/brand'
import { Button } from '../../components/ui'

type PaperSize = 'A6' | 'A5' | 'A4'

const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A6: { w: 105, h: 148 },
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
}

export function AdminQR() {
  const { t } = useTranslation()
  const settings = useSettings()
  const [size, setSize] = useState<PaperSize>('A5')
  const [headline, setHeadline] = useState('')
  const [subtext, setSubtext] = useState('Scan to order your drink · Imbas untuk pesan minuman')
  const [footer, setFooter] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const svgRef = useRef<string | null>(null)
  const headlineEdited = useRef(false)

  const targetUrl = useMemo(() => {
    // VITE_PUBLIC_APP_URL wins (set in CI), otherwise derive from where the app
    // is actually served, including a subpath such as /ScanLu/ on Pages.
    //
    // Point at the site root, not /menu: on GitHub Pages any deep link returns
    // 404.html (with the app inside), and a scanned QR should be a clean 200.
    // The '/' route redirects to /menu by itself.
    const configured = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined
    const origin = `${window.location.origin}${import.meta.env.BASE_URL}`
    const base = (configured && configured.trim().length > 0 ? configured : origin).replace(/\/$/, '')
    return base
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const dataUrl = await QRCode.toDataURL(targetUrl, {
        errorCorrectionLevel: 'H',
        margin: 4,
        width: 900,
        color: { dark: '#0B3D2E', light: '#FFFFFF' },
      })
      const svg = await QRCode.toString(targetUrl, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 4,
        color: { dark: '#0B3D2E', light: '#FFFFFF' },
      })
      if (!alive) return
      setQrDataUrl(dataUrl)
      svgRef.current = svg
    })()
    return () => {
      alive = false
    }
  }, [targetUrl])

  // Seed the printed card from the host's own words. This used to hard-code
  // "Selamat Hari Raya", which is wrong on every other day of the year.
  useEffect(() => {
    if (!settings.data) return
    if (!headlineEdited.current) {
      setHeadline(settings.data.message_banner?.trim() || settings.data.event_name)
    }
    setFooter((prev) => prev || (settings.data!.free_mode ? t('qr.footer') : ''))
  }, [settings.data, t])

  const download = (kind: 'png' | 'svg') => {
    if (kind === 'png' && qrDataUrl) {
      const link = document.createElement('a')
      link.href = qrDataUrl
      link.download = 'order-qr.png'
      link.click()
      return
    }
    if (kind === 'svg' && svgRef.current) {
      const blob = new Blob([svgRef.current], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'order-qr.svg'
      link.click()
      URL.revokeObjectURL(url)
    }
  }

  const paper = PAPER_MM[size]

  return (
    <div className="grid gap-4 p-3 lg:grid-cols-[320px_1fr]">
      {/* The page size follows the selector; the stylesheet rule is only a fallback. */}
      <style>{`@media print { @page { size: ${size} portrait; margin: 0; } }`}</style>
      <div className="no-print space-y-3 rounded-[var(--radius-md)] border border-hairline bg-panel p-4">
        <label className="block text-sm font-medium text-ink">
          Headline
          <input
            value={headline}
            onChange={(event) => {
              headlineEdited.current = true
              setHeadline(event.target.value.slice(0, 40))
            }}
            className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-sm font-medium text-ink">
          Subtext
          <input
            value={subtext}
            onChange={(event) => setSubtext(event.target.value.slice(0, 80))}
            className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-sm font-medium text-ink">
          Footer
          <input
            value={footer}
            onChange={(event) => setFooter(event.target.value.slice(0, 60))}
            className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-sm font-medium text-ink">
          {t('qr.size')}
          <select
            value={size}
            onChange={(event) => setSize(event.target.value as PaperSize)}
            className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 text-sm text-ink"
          >
            <option value="A6">A6</option>
            <option value="A5">A5</option>
            <option value="A4">A4</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            {t('qr.print')}
          </Button>
          <Button variant="secondary" onClick={() => download('png')} disabled={!qrDataUrl}>
            <Download className="size-4" aria-hidden="true" />
            PNG
          </Button>
          <Button variant="secondary" onClick={() => download('svg')}>
            <Download className="size-4" aria-hidden="true" />
            SVG
          </Button>
        </div>
        <p className="text-xs text-ink-muted">{t('qr.currentUrl', { url: targetUrl })}</p>
      </div>

      <div className="flex justify-center overflow-auto lg:max-h-[calc(100dvh-6rem)]">
        <div
          className="print-area flex-none"
          style={{
            width: `${paper.w}mm`,
            minHeight: `${paper.h}mm`,
            background: '#FFF9EE',
            padding: '10mm',
            boxSizing: 'border-box',
            color: '#2B1B12',
          }}
        >
          <div
            style={{
              border: '2px solid #D9A441',
              borderRadius: 10,
              padding: '6mm',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cg fill='none' stroke='%23D9A441' stroke-width='1' stroke-opacity='0.28'%3E%3Cpath d='M0 14 L14 0 L28 14 L14 28 Z'/%3E%3Cpath d='M7 14 L14 7 L21 14 L14 21 Z'/%3E%3C/g%3E%3C/svg%3E\")",
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(20px, 5vw, 30px)',
                  fontWeight: 600,
                  margin: 0,
                  color: '#0B3D2E',
                }}
              >
                {headline}
              </p>
              <p style={{ margin: '2mm 0 0', fontSize: 12, color: '#6B5646' }}>
                {settings.data?.event_name ?? APP_NAME}
              </p>
            </div>

            <div
              style={{
                background: '#fff',
                padding: '4mm',
                borderRadius: 8,
                border: '1px solid #E7D8BD',
                margin: '4mm 0',
              }}
            >
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={subtext}
                  width={900}
                  height={900}
                  style={{ width: 'min(58mm, 62vw)', height: 'auto', display: 'block' }}
                />
              ) : null}
            </div>

            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#0B3D2E' }}>{subtext}</p>
              <p style={{ margin: '2mm 0 0', fontSize: 10, fontFamily: 'var(--font-mono)', color: '#6B5646', wordBreak: 'break-all' }}>
                {targetUrl}
              </p>
              {footer ? (
                <p style={{ margin: '3mm 0 0', fontSize: 10, color: '#6B5646' }}>{footer}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
