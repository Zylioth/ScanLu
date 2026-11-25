import type { TFunction } from 'i18next'
import { OrderError, type OrderErrorCode } from './types'

type Translate = TFunction

const MESSAGES: Record<OrderErrorCode, string> = {
  ORDERS_CLOSED: 'error.ORDERS_CLOSED',
  CART_EMPTY: 'error.CART_EMPTY',
  NAME_REQUIRED: 'error.NAME_REQUIRED',
  MAX_CUPS_PER_ORDER: 'error.MAX_CUPS_PER_ORDER',
  MAX_ACTIVE_ORDERS_PER_PERSON: 'error.MAX_ACTIVE_ORDERS_PER_PERSON',
  MAX_CUPS_PER_PERSON: 'error.MAX_CUPS_PER_PERSON',
  PER_PERSON_COOLDOWN: 'error.PER_PERSON_COOLDOWN',
  MAX_CUPS_PER_HOUR: 'error.MAX_CUPS_PER_HOUR',
  MAX_CUPS_PER_DAY: 'error.MAX_CUPS_PER_DAY',
  MAX_QUEUE_CUPS: 'error.MAX_QUEUE_CUPS',
  ITEM_HOURLY_CAP: 'error.ITEM_HOURLY_CAP',
  ITEM_UNAVAILABLE: 'error.ITEM_UNAVAILABLE',
  OUT_OF_STOCK: 'error.OUT_OF_STOCK',
  ORDER_NOT_FOUND: 'error.ORDER_NOT_FOUND',
  INVALID_TRANSITION: 'error.INVALID_TRANSITION',
  NOT_ALLOWED: 'error.NOT_ALLOWED',
  NETWORK: 'error.NETWORK',
}

/**
 * Turns a backend error into the sentence a guest reads. Every blocked action
 * says why, and how long to wait when the backend knows (design.md §1.5).
 */
export function describeOrderError(
  error: unknown,
  t: Translate,
  options: { maxCupsPerOrder?: number } = {},
): string {
  const orderError = error instanceof OrderError ? error : null
  const code = orderError?.code
  if (!code) return t('error.generic')

  const key = MESSAGES[code] ?? 'error.generic'
  const retry = orderError?.retryAfterSeconds ?? 0

  if (code === 'MAX_CUPS_PER_ORDER') {
    return t(key, { count: options.maxCupsPerOrder ?? 2 })
  }
  if (code === 'PER_PERSON_COOLDOWN') {
    return t(key, { seconds: Math.max(1, retry) })
  }
  if (code === 'MAX_CUPS_PER_HOUR' || code === 'MAX_QUEUE_CUPS') {
    return t(key, { minutes: Math.max(1, Math.ceil(retry / 60)) })
  }
  if (code === 'MAX_CUPS_PER_DAY') {
    return t(key, { minutes: Math.max(1, Math.ceil(retry / 60)) })
  }
  if (code === 'OUT_OF_STOCK') {
    return t(key, { detail: orderError?.detail ?? '' })
  }
  return t(key)
}
