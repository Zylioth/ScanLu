import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { Download, Printer } from 'lucide-react'
import { useSettings } from '../../lib/hooks'
import { APP_NAME } from '../../lib/brand'
import { printQrCard, renderQrCard } from '../../lib/qrCard'
import { Button, Skeleton } from '../../components/ui'

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
  const [cardUrl, setCardUrl] = useState<string | null>(null)
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
      if (!alive) return
      setQrDataUrl(dataUrl)
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

  const paper = PAPER_MM[size]

  // Render the whole card once. The preview, the PNG and the print all use this
  // same image, so what you see is exactly what comes out.
  useEffect(() => {
    if (!qrDataUrl) return
    let alive = true
    void (async () => {
      try {
        const url = await renderQrCard({
          widthMm: paper.w,
          heightMm: paper.h,
          headline,
          eventName: settings.data?.event_name ?? APP_NAME,
          subtext,
          footer,
          url: targetUrl,
          qrDataUrl,
        })
        if (alive) setCardUrl(url)
      } catch {
        if (alive) setCardUrl(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [paper.w, paper.h, headline, subtext, footer, targetUrl, qrDataUrl, settings.data?.event_name])

  const download = (kind: 'card' | 'qr') => {
    const href = kind === 'card' ? cardUrl : qrDataUrl
    if (!href) return
    const link = document.createElement('a')
    link.href = href
    link.download = kind === 'card' ? `scanlu-card-${size}.png` : 'scanlu-qr.png'
    link.click()
  }

  return (
    <div className="grid gap-4 p-3 lg:grid-cols-[320px_1fr]">
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
          <Button onClick={() => cardUrl && printQrCard(cardUrl, paper.w, paper.h)} disabled={!cardUrl}>
            <Printer className="size-4" aria-hidden="true" />
            {t('qr.print')}
          </Button>
          <Button variant="secondary" onClick={() => download('card')} disabled={!cardUrl}>
            <Download className="size-4" aria-hidden="true" />
            {t('qr.downloadCard')}
          </Button>
          <Button variant="secondary" onClick={() => download('qr')} disabled={!qrDataUrl}>
            <Download className="size-4" aria-hidden="true" />
            {t('qr.downloadQr')}
          </Button>
        </div>
        <p className="text-xs text-ink-muted">{t('qr.currentUrl', { url: targetUrl })}</p>
      </div>

      {/* The card is one image, drawn once. Preview, PNG and print are identical. */}
      <div className="flex justify-center overflow-auto lg:max-h-[calc(100dvh-6rem)]">
        {cardUrl ? (
          <img
            src={cardUrl}
            alt={t('qr.preview')}
            style={{ width: `${paper.w}mm`, maxWidth: '100%', height: 'auto', display: 'block' }}
            className="rounded-[var(--radius-sm)] shadow-[var(--shadow-lift)]"
          />
        ) : (
          <Skeleton className="h-64 w-full max-w-sm" />
        )}
      </div>
    </div>
  )
}
