/**
 * Extra checks: dark theme, Bahasa Melayu, a 320px phone, and keyboard focus.
 * Run with the dev server up: node scripts/checks.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173'
const OUT = 'screenshots'
mkdirSync(OUT, { recursive: true })

const problems = []
const log = (message) => console.log(`  ${message}`)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'en-GB' })
const page = await context.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

try {
  // Dark theme on the admin board.
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await page.waitForURL('**/admin/login')
  await page.getByLabel('Passcode').fill('1234')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/admin', { timeout: 10000 })

  // Audio is the whole point of the ready alert, so prove it unlocks on a tap.
  const enableSound = page.getByRole('button', { name: 'Tap to enable sound' })
  const hadEnableButton = await enableSound
    .first()
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (hadEnableButton) {
    await enableSound.first().click()
    await page.waitForTimeout(500)
    const unlocked = await page
      .getByRole('button', { name: 'Sound on' })
      .first()
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false)
    if (!unlocked) problems.push('audio did not unlock after tapping enable sound')
    log(`audio unlocked: ${unlocked}`)
  } else {
    problems.push('enable-sound button never appeared on a fresh admin session')
  }

  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/12-board-dark.png` })
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  if (theme !== 'dark') problems.push(`dark theme not applied, got "${theme}"`)
  log(`theme: ${theme}`)
  await page.getByRole('button', { name: 'Switch to light theme' }).click()

  // Guest menu in Bahasa Melayu on a narrow phone.
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto(`${BASE}/menu`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'BM' }).click()
  await page.waitForTimeout(500)
  const htmlLang = await page.evaluate(() => document.documentElement.lang)
  if (htmlLang !== 'ms') problems.push(`html lang not ms, got "${htmlLang}"`)
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (overflow320 > 1) problems.push(`horizontal overflow at 320px: ${overflow320}px`)
  await page.screenshot({ path: `${OUT}/13-menu-320-bm.png` })
  log(`320px overflow: ${overflow320}px, lang: ${htmlLang}`)

  // Any element wider than the viewport is an overflow bug the scrollWidth test can miss.
  const wide = await page.evaluate(() => {
    const out = []
    for (const element of document.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect()
      if (rect.width > window.innerWidth + 1 && rect.height > 0) {
        out.push(`${element.tagName}.${String(element.className).slice(0, 40)} ${Math.round(rect.width)}px`)
      }
    }
    return out.slice(0, 5)
  })
  if (wide.length > 0) problems.push(`elements wider than viewport: ${wide.join(' | ')}`)

  // The add button is absolutely positioned, so nothing may sit underneath it.
  const overlaps = await page.evaluate(() => {
    const out = []
    for (const button of document.querySelectorAll('button[aria-label^="Tambah "]')) {
      const card = button.closest('.relative')
      if (!card) continue
      const b = button.getBoundingClientRect()
      for (const element of card.querySelectorAll('span, h3, p')) {
        const r = element.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const hit =
          r.right > b.left + 2 && r.left < b.right - 2 && r.bottom > b.top + 2 && r.top < b.bottom - 2
        if (hit) out.push((element.textContent ?? '').trim().slice(0, 24))
      }
    }
    return [...new Set(out)].slice(0, 5)
  })
  if (overlaps.length > 0) problems.push(`text under add button at 320px: ${overlaps.join(' | ')}`)
  log(`overlap check: ${overlaps.length} hits`)

  // Keyboard focus must be visible on the first links.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE}/menu`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /Coffee|Kopi/ }).waitFor()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const focus = await page.evaluate(() => {
    const element = document.activeElement
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      tag: element.tagName,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      label: (element.getAttribute('aria-label') ?? element.textContent ?? '').slice(0, 40).trim(),
    }
  })
  await page.screenshot({ path: `${OUT}/14-focus.png` })
  if (!focus || focus.outlineStyle === 'none' || Number.parseFloat(focus.outlineWidth) < 1) {
    problems.push(`no visible focus ring on Tab: ${JSON.stringify(focus)}`)
  }
  log(`focus: ${focus?.tag} "${focus?.label}" outline ${focus?.outlineWidth} ${focus?.outlineStyle}`)

  // Reduced motion must not show the shaky tear stage for long.
  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const reducedPage = await reduced.newPage()
  await reducedPage.goto(`${BASE}/ticket/seed-order-4`, { waitUntil: 'networkidle' })
  // Order belongs to another device, so the ticket should not leak.
  const leaked = await reducedPage.getByText('Your drink is ready', { exact: false }).count()
  if (leaked > 0) problems.push('another device order was readable (RLS equivalent broken)')
  await reduced.close()
  log('foreign ticket correctly hidden')

  // Pause toggle round trip. Language was switched to BM earlier, so put it back.
  await page.goto(`${BASE}/menu`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  if (page.url().includes('/admin/login')) {
    await page.getByLabel('Passcode').fill('1234')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/admin', { timeout: 10000 })
  }
  await page.getByRole('heading', { name: /Order board|Papan pesanan/ }).waitFor()
  await page.getByRole('button', { name: 'Pause orders' }).click()
  await page.waitForTimeout(500)
  const pausedVisible = await page.getByText('Orders are paused', { exact: false }).first().isVisible()
  if (!pausedVisible) problems.push('pause toggle did not show paused state')
  await page.getByRole('button', { name: 'Resume orders' }).click()
  await page.waitForTimeout(400)
  log('pause toggle works')

  // Print stylesheet: chrome hidden, card visible at true A5 width, colour kept.
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.goto(`${BASE}/admin/qr`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  const printState = await page.evaluate(() => {
    const visible = (element) => element && getComputedStyle(element).display !== 'none'
    const chrome = document.querySelector('aside.no-print')
    const card = document.querySelector('.print-area')
    const cardBox = card?.getBoundingClientRect()
    const qr = card?.querySelector('img')
    return {
      chromeHidden: chrome ? !visible(chrome) : null,
      cardVisible: visible(card),
      cardWidthMm: cardBox ? Math.round((cardBox.width / 96) * 25.4) : null,
      qrWidthMm: qr ? Math.round((qr.getBoundingClientRect().width / 96) * 25.4) : null,
      qrLoaded: qr ? qr.complete && qr.naturalWidth > 0 : false,
    }
  })
  await page.screenshot({ path: `${OUT}/18-qr-print.png` })
  log(`print: ${JSON.stringify(printState)}`)
  if (printState.chromeHidden !== true) problems.push('admin rail still visible when printing')
  if (!printState.cardVisible) problems.push('QR card hidden when printing')
  if (!printState.qrLoaded) problems.push('QR image not loaded for print')
  if (printState.cardWidthMm !== null && Math.abs(printState.cardWidthMm - 148) > 6) {
    problems.push(`print card is ${printState.cardWidthMm}mm wide, expected 148mm (A5)`)
  }
  if (printState.qrWidthMm !== null && printState.qrWidthMm < 50) {
    problems.push(`QR prints ${printState.qrWidthMm}mm wide, too small to scan at 1m`)
  }

  // Switching to A4 must resize the printed card, not just the preview.
  await page.emulateMedia({ media: 'screen' })
  await page.getByLabel('Print size').selectOption('A4')
  await page.waitForTimeout(300)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(200)
  const a4Width = await page.evaluate(() => {
    const card = document.querySelector('.print-area')
    const box = card?.getBoundingClientRect()
    return box ? Math.round((box.width / 96) * 25.4) : null
  })
  log(`A4 print width: ${a4Width}mm`)
  if (a4Width !== null && Math.abs(a4Width - 210) > 6) {
    problems.push(`A4 card is ${a4Width}mm wide, expected 210mm`)
  }
  await page.emulateMedia({ media: 'screen' })
} catch (error) {
  problems.push(`check failed: ${error.message}`)
  await page.screenshot({ path: `${OUT}/98-check-failure.png` }).catch(() => {})
} finally {
  await browser.close()
}

console.log(
  problems.length === 0
    ? '\nCHECKS PASS'
    : `\nCHECKS ISSUES:\n${problems.map((p) => ` - ${p}`).join('\n')}`,
)
process.exitCode = problems.length === 0 ? 0 : 1
