/**
 * Chimes are synthesised with WebAudio rather than shipped as mp3 files, so the
 * bundle stays small and there is no binary asset to keep in sync. The guest
 * chime is a warm bell with a long decay; the admin chime is a shorter
 * two-tone so the two are never confused across a noisy room.
 */

let ctx: AudioContext | null = null
let unlocked = false

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  return ctx
}

/** Must be called from a real user gesture. Safe to call repeatedly. */
export async function unlockAudio(): Promise<boolean> {
  const ac = audioContext()
  if (!ac) return false
  try {
    if (ac.state === 'suspended') await ac.resume()
    // A near-silent blip is what actually unlocks iOS.
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    gain.gain.value = 0.0001
    osc.connect(gain).connect(ac.destination)
    osc.start()
    osc.stop(ac.currentTime + 0.02)
    unlocked = ac.state === 'running'
    return unlocked
  } catch {
    return false
  }
}

export function isAudioUnlocked(): boolean {
  return unlocked && ctx?.state === 'running'
}

function bell(at: number, freq: number, duration: number, peak: number) {
  const ac = audioContext()
  if (!ac) return
  const t0 = ac.currentTime + at
  const master = ac.createGain()
  master.connect(ac.destination)
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

  // Fundamental plus two partials gives a bell rather than a beep.
  const partials: Array<[number, number, OscillatorType]> = [
    [1, 1, 'sine'],
    [2.02, 0.42, 'sine'],
    [3.01, 0.18, 'triangle'],
  ]
  for (const [ratio, level, type] of partials) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = type
    osc.frequency.value = freq * ratio
    gain.gain.value = level
    osc.connect(gain).connect(master)
    osc.start(t0)
    osc.stop(t0 + duration)
  }
}

/** ~1.5 s warm bell. */
export function playGuestChime(): void {
  if (!isAudioUnlocked()) return
  bell(0, 880, 1.5, 0.22)
  bell(0.16, 1318.5, 1.2, 0.1)
}

/** Short two-tone "ding-ding" for a new order on the iPad. */
export function playAdminChime(): void {
  if (!isAudioUnlocked()) return
  bell(0, 660, 0.32, 0.16)
  bell(0.14, 990, 0.4, 0.14)
}

export async function vibrate(pattern: number[]): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  try {
    return navigator.vibrate(pattern)
  } catch {
    return false
  }
}

export const VIBRATE_READY = [300, 150, 300, 150, 600]
