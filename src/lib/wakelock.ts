/**
 * Screen Wake Lock wrapper (system.md §9). The guest ticket keeps the phone
 * awake while waiting; the lock is dropped on unmount and re-acquired when the
 * tab becomes visible again, because the platform releases it on hide.
 */

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

let sentinel: WakeLockSentinelLike | null = null
let wanted = false
let visibilityHooked = false

function supportsWakeLock(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

async function acquire(): Promise<void> {
  if (!wanted || sentinel || !supportsWakeLock()) return
  try {
    const locks = (navigator as unknown as {
      wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }).wakeLock
    sentinel = await locks.request('screen')
    sentinel.addEventListener('release', () => {
      sentinel = null
    })
  } catch {
    // Denied, low battery, or not allowed in this context. Not fatal.
    sentinel = null
  }
}

async function onVisibility() {
  if (document.visibilityState === 'visible') await acquire()
}

export async function requestWakeLock(): Promise<boolean> {
  wanted = true
  if (!visibilityHooked) {
    document.addEventListener('visibilitychange', onVisibility)
    visibilityHooked = true
  }
  await acquire()
  return sentinel !== null
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false
  if (visibilityHooked) {
    document.removeEventListener('visibilitychange', onVisibility)
    visibilityHooked = false
  }
  if (sentinel) {
    try {
      await sentinel.release()
    } catch {
      /* already gone */
    }
    sentinel = null
  }
}

export function isWakeLocked(): boolean {
  return sentinel !== null
}
