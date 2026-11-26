import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Clock, Info, PauseCircle, Plus, Ticket as TicketIcon } from 'lucide-react'
import { useMenu, useMyActiveOrders, usePublicStatus } from '../lib/hooks'
import { cartCupCount, useCart } from '../lib/store'
import type { MenuItemView } from '../lib/types'
import { formatMoney } from '../lib/format'
import { Banner, Button, Chip, Skeleton, cx } from '../components/ui'
import { CupArt, ItemSheet } from '../components/ItemSheet'
import { WelcomeCard } from '../components/WelcomeCard'
import { LanguageToggle } from '../components/LanguageToggle'
import { StatusChip } from '../components/StatusChip'

const TINTS = ['#12664A', '#B07A18', '#2F6FB3', '#8A5A3B']

function MenuItemCard({
  item,
  freeMode,
  tintIndex,
  onOpen,
  disabled,
  remainingCups,
  maxPerOrder,
}: {
  item: MenuItemView
  freeMode: boolean
  tintIndex: number
  onOpen: () => void
  disabled: boolean
  remainingCups: number | null
  maxPerOrder: number
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.language
  const name = language === 'ms' ? item.name_ms : item.name_en
  const description = language === 'ms' ? item.description_ms : item.description_en
  const soldOut = item.available_units !== null && item.available_units <= 0
  const lowStock = item.available_units !== null && item.available_units > 0 && item.available_units <= 3
  const limitReached = remainingCups !== null && remainingCups <= 0
  const blocked = soldOut || disabled || limitReached
  const tint = TINTS[tintIndex % TINTS.length]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={blocked}
        className={cx(
          // Text stays at full contrast when unavailable; only the photo and the
          // chip row carry the state, so nothing drops below WCAG AA.
          'flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-hairline bg-panel p-3 text-left transition-colors',
          blocked ? 'border-dashed' : 'hover:border-brand-500/50 hover:bg-panel-2/50',
        )}
      >
        <div className="size-20 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-panel-2">
          {item.image_url ? (
            <img
              src={item.image_url}
              alt=""
              width={1200}
              height={900}
              loading="lazy"
              className={cx('size-full object-cover', soldOut && 'grayscale opacity-70')}
            />
          ) : (
            <CupArt
              className={cx('size-full', soldOut && 'opacity-50 grayscale')}
              tint={tint}
            />
          )}
        </div>
        <div className="mr-11 min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="min-w-0 grow basis-24 font-display text-base leading-tight font-semibold text-ink">{name}</h3>
            {!freeMode ? (
              <span className="tnum shrink-0 text-sm font-medium text-ink-muted">
                {formatMoney(item.price)}
              </span>
            ) : (
              <Chip tone="gold" className="shrink-0">
                {t('menu.free')}
              </Chip>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-muted">{description}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {soldOut ? <Chip tone="muted">{t('menu.soldOut')}</Chip> : null}
            {lowStock && !soldOut ? (
              <Chip tone="warning">{t('menu.onlyLeft', { count: item.available_units })}</Chip>
            ) : null}
            {limitReached && !soldOut ? (
              <Chip tone="info">{t('cart.limitPerOrder', { count: maxPerOrder })}</Chip>
            ) : null}
          </div>
        </div>
      </button>
      {!blocked ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('menu.addNamed', { name })}
          className="absolute top-1/2 right-3 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-brand-700 text-cream-50 transition-colors hover:bg-brand-800 active:scale-95"
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export function MenuPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const menu = useMenu()
  const status = usePublicStatus()
  const activeOrders = useMyActiveOrders()
  const cart = useCart()

  const [openItem, setOpenItem] = useState<MenuItemView | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const categories = menu.data?.categories ?? []
  const items = menu.data?.items ?? []
  const groups = menu.data?.groups ?? []
  const cups = cartCupCount(cart.lines)
  const ordersClosed = status.data ? !status.data.orders_open : false

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItemView[]>()
    for (const category of categories) {
      map.set(
        category.id,
        items.filter((item) => item.category_id === category.id),
      )
    }
    return map
  }, [categories, items])

  useEffect(() => {
    if (categories.length === 0) return
    setActiveCategory((prev) => prev ?? categories[0].id)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible?.target.id) {
          setActiveCategory(visible.target.id.replace('category-', ''))
        }
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 },
    )
    for (const element of sectionRefs.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [categories, items.length])

  const primaryActive = activeOrders.data?.[0] ?? null

  return (
    <div className="min-h-dvh bg-canvas pb-32">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/92 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2">
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl leading-tight font-semibold text-ink">
              {status.data?.event_name ?? t('menu.title')}
            </h1>
            <p className="text-xs text-ink-muted">{t('app.tagline')}</p>
          </div>
          <LanguageToggle />
        </div>

        {categories.length > 1 ? (
          <nav aria-label={t('menu.title')} className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-2.5">
            {categories.map((category) => {
              const active = activeCategory === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    const element = sectionRefs.current.get(category.id)
                    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className={cx(
                    'min-h-9 shrink-0 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
                    active
                      ? 'bg-brand-700 text-cream-50'
                      : 'bg-panel text-ink-muted ring-1 ring-hairline hover:text-ink',
                  )}
                >
                  {i18n.language === 'ms' ? category.name_ms : category.name_en}
                </button>
              )
            })}
          </nav>
        ) : null}
      </header>

      {!ordersClosed && status.data?.banner ? (
        <Banner tone="gold" icon={<Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>
          {status.data.banner}
        </Banner>
      ) : null}

      <main className="mx-auto w-full max-w-2xl px-4 pt-4">
        {primaryActive ? (
          <Link
            to={`/ticket/${primaryActive.id}`}
            className="mb-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-brand-500/30 bg-brand-700 p-3.5 text-cream-50 shadow-[var(--shadow-card)]"
          >
            <TicketIcon className="size-6 shrink-0 text-gold-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gold-300">{t('menu.yourTicket')}</p>
              <p className="tnum font-display text-lg leading-tight font-semibold">
                {primaryActive.display_number}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusChip status={primaryActive.status} className="bg-white/15 text-cream-50" />
              <ArrowRight className="size-4" aria-hidden="true" />
            </div>
          </Link>
        ) : null}

        {ordersClosed ? (
          <section
            aria-live="polite"
            className="mb-4 overflow-hidden rounded-[var(--radius-lg)] bg-brand-900 p-5 text-cream-50 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gold-300/15 text-gold-300">
                <PauseCircle className="size-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-2xl leading-tight">{t('menu.paused')}</h2>
                <p className="mt-1.5 text-sm leading-snug text-cream-50/85">
                  {status.data?.banner || t('menu.pausedBody')}
                </p>
                <p className="mt-2.5 text-xs text-gold-300">{t('menu.closedBrowse')}</p>
              </div>
            </div>
          </section>
        ) : null}

        {status.data && !ordersClosed ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <Chip tone="neutral" icon={<Clock className="size-3.5" aria-hidden="true" />}>
              {status.data.wait_minutes > 0
                ? t('menu.wait', { count: status.data.wait_minutes })
                : t('ticket.etaSoon')}
            </Chip>
            {status.data.queue_cups > 0 ? (
              <Chip tone="neutral">{t('menu.queue', { count: status.data.queue_cups })}</Chip>
            ) : null}
          </div>
        ) : null}

        {menu.loading && !menu.data ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-hairline bg-panel p-3">
                <Skeleton className="size-20 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : menu.error ? (
          <div className="rounded-[var(--radius-md)] border border-hairline bg-panel p-6 text-center">
            <p className="font-medium text-ink">{t('error.NETWORK')}</p>
            <Button variant="secondary" className="mt-3" onClick={menu.refresh}>
              {t('common.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-hairline bg-panel p-8 text-center">
            <p className="font-display text-lg text-ink">{t('menu.emptyMenu')}</p>
            <p className="mt-1 text-sm text-ink-muted">{t('menu.emptyMenuBody')}</p>
          </div>
        ) : (
          <div className="space-y-7">
            {categories.map((category) => {
              const categoryItems = itemsByCategory.get(category.id) ?? []
              if (categoryItems.length === 0) return null
              return (
                <section
                  key={category.id}
                  id={`category-${category.id}`}
                  ref={(element) => {
                    if (element) sectionRefs.current.set(category.id, element)
                    else sectionRefs.current.delete(category.id)
                  }}
                  className="scroll-mt-32"
                >
                  <h2 className="mb-2.5 text-base font-semibold text-ink">
                    {i18n.language === 'ms' ? category.name_ms : category.name_en}
                  </h2>
                  <div className="space-y-2.5">
                    {categoryItems.map((item, index) => (
                      <MenuItemCard
                        key={item.id}
                        item={item}
                        freeMode={status.data?.free_mode ?? false}
                        tintIndex={index}
                        onOpen={() => setOpenItem(item)}
                        disabled={ordersClosed}
                        remainingCups={status.data?.person_remaining ?? null}
                        maxPerOrder={status.data?.max_cups_per_order ?? 2}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </main>

      {ordersClosed ? (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-2xl px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2.5 rounded-[var(--radius-lg)] bg-brand-900 px-4 py-3 text-cream-50 shadow-[var(--shadow-lift)]">
            <PauseCircle className="size-5 shrink-0 text-gold-300" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t('menu.paused')}</p>
              {status.data?.banner ? (
                <p className="truncate text-xs text-cream-50/75">{status.data.banner}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : cups > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-2xl px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          style={{ animation: 'ticket-in 320ms var(--ease-spring) both' }}
        >
          <button
            type="button"
            onClick={() => navigate('/cart')}
            className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-brand-700 px-4 py-3.5 text-cream-50 shadow-[var(--shadow-lift)] transition-transform active:scale-[0.99]"
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              <span className="tnum grid size-7 place-items-center rounded-full bg-gold-300 text-cocoa-900 text-sm font-bold">
                {cups}
              </span>
              {t('menu.viewOrder', { count: cups })}
            </span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-gold-300">
              {t('menu.viewOrderAction')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      ) : null}

      <ItemSheet
        item={openItem}
        groups={groups}
        open={openItem !== null}
        onClose={() => setOpenItem(null)}
        freeMode={status.data?.free_mode ?? false}
        maxQty={status.data?.max_cups_per_order ?? 2}
        remainingCups={status.data?.person_remaining ?? null}
        onAdd={({ qty, optionIds, unitPrice }) => {
          if (!openItem) return
          cart.addLine({ menuItemId: openItem.id, qty, optionIds, unitPrice })
        }}
      />

      <WelcomeCard />
    </div>
  )
}
