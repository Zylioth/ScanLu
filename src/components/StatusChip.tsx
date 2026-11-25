import { Ban, BellRing, Coffee, PackageCheck, Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OrderStatus } from '../lib/types'
import { Chip, cx } from './ui'

const meta: Record<
  OrderStatus,
  { icon: typeof Receipt; tone: 'info' | 'warning' | 'success' | 'muted' | 'danger'; key: string }
> = {
  placed: { icon: Receipt, tone: 'info', key: 'status.placed' },
  preparing: { icon: Coffee, tone: 'warning', key: 'status.preparing' },
  ready: { icon: BellRing, tone: 'success', key: 'status.ready' },
  collected: { icon: PackageCheck, tone: 'muted', key: 'status.collected' },
  cancelled: { icon: Ban, tone: 'danger', key: 'status.cancelled' },
}

export function StatusChip({
  status,
  className,
  size = 'md',
}: {
  status: OrderStatus
  className?: string
  size?: 'md' | 'lg'
}) {
  const { t } = useTranslation()
  const { icon: Icon, tone, key } = meta[status]
  return (
    <Chip
      tone={tone}
      className={cx(size === 'lg' && 'px-3.5 py-1.5 text-sm', className)}
      icon={<Icon className={size === 'lg' ? 'size-4' : 'size-3.5'} aria-hidden="true" />}
    >
      {t(key)}
    </Chip>
  )
}
