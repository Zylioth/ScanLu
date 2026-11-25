import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BellRing, RotateCcw } from 'lucide-react'
import type { Order } from '../lib/types'
import { playGuestChime, vibrate, VIBRATE_READY } from '../lib/audio'
import { useMediaQuery } from '../lib/hooks'
import { Ticket } from './Ticket'
import { SlideToConfirm } from './SlideToConfirm'
import { cx } from './ui'

type Phase = 'shake' | 'tear' | 'settled'

function TornEdge({ side }: { side: 'top' | 'bottom' }) {
  const teeth = 22
  const width = 360
  const step = width / teeth
  const points: string[] = []
  for (let i = 0; i <= teeth * 2; i++) {
    const x = (i * step) / 2
    const y = i % 2 === 0 ? 0 : side === 'top' ? 6 : 6
    points.push(`${x.toFixed(1)},${y}`)
  }
  const path =
    side === 'top'
      ? `M0 8 L${points.join(' L')} L${width} 8 Z`
      : `M0 0 L${points.join(' L')} L${width} 0 Z`

  return (
    <svg
      viewBox={`0 0 ${width} 8`}
      preserveAspectRatio="none"
      className={cx('block h-2 w-full text-panel', side === 'top' ? '-mt-2' : '-mb-2')}
      aria-hidden="true"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}

function Confetti() {
  const bits = Array.from({ length: 12 }, (_, index) => index)
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-24 overflow-hidden" aria-hidden="true">
      {bits.map((index) => (
        <i
          key={index}
          className="confetti-bit absolute top-0 block size-1.5 rounded-[1px]"
          style={{
            left: `${6 + index * 8}%`,
            backgroundColor: index % 3 === 0 ? '#F0D08A' : index % 3 === 1 ? '#A8D8C1' : '#FFFFFF',
            ['--dx' as string]: `${(index % 2 === 0 ? 1 : -1) * (6 + index * 3)}px`,
            ['--rot' as string]: `${160 + index * 30}deg`,
            ['--dur' as string]: `${1.1 + (index % 4) * 0.25}s`,
            ['--delay' as string]: `${(index % 5) * 0.08}s`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * The one big moment (design.md §5.5): shake, tear along the perforation, then
 * the torn stub settles into the READY card. Sound, vibration and the title
 * blink run until the guest acts. Reduced motion skips straight to the card.
 */
export function ReadyAlert({
  order,
  eventName,
  freeMode,
  onCollected,
  onDismiss,
  busy,
}: {
  order: Order
  eventName: string
  freeMode: boolean
  onCollected: () => void
  onDismiss: () => void
  busy: boolean
}) {
  const { t, i18n } = useTranslation()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [phase, setPhase] = useState<Phase>(reducedMotion ? 'settled' : 'shake')
  const [replayKey, setReplayKey] = useState(0)
  const repeatCount = useRef(0)

  useEffect(() => {
    if (replayKey === 0 && reducedMotion) {
      setPhase('settled')
      return
    }
    if (reducedMotion) {
      setPhase('settled')
      return
    }
    setPhase('shake')
    const toTear = window.setTimeout(() => setPhase('tear'), 250)
    const toSettled = window.setTimeout(() => setPhase('settled'), 1100)
    return () => {
      window.clearTimeout(toTear)
      window.clearTimeout(toSettled)
    }
  }, [replayKey, reducedMotion])

  // Sound, haptics and the title blink keep going until this unmounts.
  useEffect(() => {
    const originalTitle = document.title
    let cancelled = false
    let timeoutId = 0
    const blinkId = window.setInterval(() => {
      document.title =
        document.title.startsWith('🔔') ? originalTitle : `🔔 ${t('ticket.ready')}`
    }, 900)

    const ring = () => {
      if (cancelled) return
      playGuestChime()
      void vibrate(VIBRATE_READY)
      repeatCount.current += 1
      const nextDelay = repeatCount.current >= 10 ? 15000 : 4000
      timeoutId = window.setTimeout(ring, nextDelay)
    }
    ring()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      window.clearInterval(blinkId)
      document.title = originalTitle
    }
  }, [t])

  const secondary =
    i18n.language === 'ms'
      ? 'Your drink is ready! Please collect it at the counter.'
      : 'Minuman anda dah siap! Sila ambil di kaunter.'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-cocoa-900/72 px-4 py-6 backdrop-blur-sm"
      role="alertdialog"
      aria-live="assertive"
      aria-label={`${t('ticket.ready')} ${order.display_number}`}
    >
      <p className="sr-only">{`${t('ticket.ready')} ${order.display_number}`}</p>

      {phase !== 'settled' ? (
        <div className={cx('relative w-full max-w-[360px]', phase === 'shake' && 'tear-shake')}>
          <div className={phase === 'tear' ? 'tear-top' : undefined}>
            <Ticket order={order} eventName={eventName} freeMode={freeMode} split="top" />
            <TornEdge side="bottom" />
          </div>
          <div className={phase === 'tear' ? 'tear-bottom' : undefined}>
            <TornEdge side="top" />
            <Ticket order={order} eventName={eventName} freeMode={freeMode} split="bottom" />
          </div>
        </div>
      ) : (
        <div className="w-full max-w-[360px]">
          <div className="ready-card ready-glow relative overflow-hidden rounded-[var(--radius-md)] bg-brand-700 p-6 text-center text-cream-50 shadow-[var(--shadow-ticket)]">
            <Confetti />
            <div className="relative mx-auto mb-3 grid size-16 place-items-center">
              <span className="ring-wave absolute inset-0 rounded-full border-2 border-gold-300/70" aria-hidden="true" />
              <BellRing className="bell-swing size-9 text-gold-300" aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold tracking-[0.12em] text-gold-300 uppercase">
              {t('ticket.ready')}
            </p>
            <p className="ticket-number mt-2 text-gold-300">{order.display_number}</p>
            <p className="mt-1 text-base font-medium">{order.customer_name}</p>
            <p className="mt-3 text-sm text-cream-50/85">{t('ticket.readyBody')}</p>
            <p className="mt-1 text-xs text-cream-50/70 italic">{secondary}</p>

            <div className="mt-5">
              <SlideToConfirm
                label={t('ticket.slide')}
                ariaLabel={t('ticket.slideAria')}
                alternativeLabel={t('ticket.confirmButton')}
                onComplete={onCollected}
                disabled={busy}
                tone="onDark"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                repeatCount.current = 0
                setReplayKey((k) => k + 1)
              }}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-cream-50/75 hover:bg-white/12 hover:text-cream-50"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t('ticket.replay')}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="ml-2 rounded-full px-3 py-2 text-xs font-medium text-cream-50/60 hover:bg-white/12 hover:text-cream-50"
            >
              {t('ticket.later')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
