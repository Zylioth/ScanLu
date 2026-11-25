import { useCallback, useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cx } from './ui'

/**
 * Slide to confirm. Pointer drag for touch, keyboard support on the same
 * control, and a separate plain button because a slide gesture must never be
 * the only way to complete an action (design.md §9).
 */
export function SlideToConfirm({
  label,
  onComplete,
  disabled,
  alternativeLabel,
  ariaLabel,
  tone = 'onLight',
}: {
  label: string
  onComplete: () => void
  disabled?: boolean
  alternativeLabel: string
  ariaLabel: string
  /** onDark is for the emerald ready card; keeps the fallback button legible. */
  tone?: 'onLight' | 'onDark'
}) {
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const hintId = useId()

  const commit = useCallback(() => {
    if (done) return
    setDone(true)
    setProgress(1)
    onComplete()
  }, [done, onComplete])

  const updateFromClientX = (clientX: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const usable = rect.width - 56
    const raw = (clientX - rect.left - 28) / usable
    const next = Math.min(1, Math.max(0, raw))
    setProgress(next)
    if (next >= 0.92) commit()
  }

  return (
    <div className="space-y-2">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-describedby={hintId}
        onPointerDown={(event) => {
          if (disabled || done) return
          dragging.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          updateFromClientX(event.clientX)
        }}
        onPointerMove={(event) => {
          if (!dragging.current || disabled || done) return
          updateFromClientX(event.clientX)
        }}
        onPointerUp={() => {
          dragging.current = false
          if (!done) setProgress(0)
        }}
        onPointerCancel={() => {
          dragging.current = false
          if (!done) setProgress(0)
        }}
        onKeyDown={(event) => {
          if (disabled || done) return
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            const next = Math.min(1, progress + 0.25)
            setProgress(next)
            if (next >= 0.75) commit()
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            setProgress(Math.max(0, progress - 0.25))
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            commit()
          }
        }}
        className="slide-track select-none"
      >
        <div className="slide-fill" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
        <span className="slide-label" aria-hidden="true">
          {done ? '' : label}
        </span>
        <div
          className="slide-thumb"
          style={{ left: `calc(${progress} * (100% - 56px) + 4px)` }}
          aria-hidden="true"
        >
          <Check className="size-6" strokeWidth={2.5} />
        </div>
      </div>
      <button
        type="button"
        onClick={commit}
        disabled={disabled || done}
        className={cx(
          'w-full py-2 text-sm font-medium underline underline-offset-4 disabled:opacity-40',
          tone === 'onDark'
            ? 'text-cream-50/85 hover:text-cream-50'
            : 'text-ink-muted hover:text-ink',
        )}
      >
        {alternativeLabel}
      </button>
      <p id={hintId} className="sr-only">
        Use the arrow keys to slide, or press Enter to confirm.
      </p>
    </div>
  )
}
