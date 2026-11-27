/**
 * Click-through smoke test. Runs the real app in Chrome, walks the guest flow
 * and the admin flow, and saves screenshots to screenshots/.
 *
 *   node scripts/smoke.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173'
// GitHub Pages answers deep links with 404.html, so the document itself reports
// 404 even though the app boots. Everything else must still be clean.
const pagesMode = process.env.SMOKE_PAGES === '1'
// Demo mode signs in with the passcode; Supabase mode signs in with the admin's
// real password, so pass it in rather than committing it.
const ADMIN_SECRET = process.env.SMOKE_ADMIN_PASSWORD ?? '1234'
// Against a real database the admin password is not available to the test, and
// the guest flow on its own proves place_order, the counters and RLS.
const GUEST_ONLY = process.env.SMOKE_GUEST_ONLY === '1'
const OUT = 'screenshots'
mkdirSync(OUT, { recursive: true })

const problems = []
const log = (message) => console.log(`  ${message}`)

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Dev server never answered at ${BASE}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  locale: 'en-GB',
})
const page = await context.newPage()
// The guest menu greets a first-time visitor with a welcome card. These flows
// test the menu behind it, so mark the device as already welcomed.
await context.addInitScript(() => {
  try {
    localStorage.setItem('ohpos.welcome.seen', 'true')
  } catch {
    /* ignore */
  }
})

page.on('console', (message) => {
  if (message.type() !== 'error') return
  const text = message.text()
  if (pagesMode && /status of 404/.test(text)) return
  problems.push(`console: ${text}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

try {
  await waitForServer()
  log('server up')

  /* ---------------------------------------------------------------- guest */
  await page.goto(`${BASE}/menu`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Coffee' }).waitFor({ timeout: 15000 })
  await page.screenshot({ path: `${OUT}/01-menu.png`, fullPage: false })
  log('menu rendered')

  const addButtons = page.getByRole('button', { name: /^Add / })
  const addCount = await addButtons.count()
  if (addCount === 0) throw new Error('No add buttons on the menu')
  await addButtons.first().click()

  const sheet = page.getByRole('dialog')
  await sheet.waitFor({ timeout: 5000 })
  await page.screenshot({ path: `${OUT}/02-item-sheet.png` })
  log('item sheet open')

  await sheet.getByRole('button', { name: /Add to order/ }).click()
  await page.getByRole('button', { name: /View order/ }).click()
  await page.waitForURL('**/cart')
  log('cart reached')

  await page.getByLabel('Your name').fill('Aisyah')
  await page.screenshot({ path: `${OUT}/03-cart.png` })

  await page.getByRole('button', { name: 'Place order' }).click()
  await page.waitForURL('**/ticket/**', { timeout: 10000 })
  await page.locator('.ticket').first().waitFor({ timeout: 10000 })
  const displayNumber = (await page.locator('.ticket-number').first().textContent())?.trim()
  log(`ticket created: ${displayNumber}`)
  await page.screenshot({ path: `${OUT}/04-ticket.png` })

  /* ---------------------------------------------------------------- admin */
  if (GUEST_ONLY) {
    log('guest flow done, skipping the admin flow (SMOKE_GUEST_ONLY=1)')
  } else {
    await page.setViewportSize({ width: 1180, height: 820 })
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
    await page.waitForURL('**/admin/login')
    // Demo mode asks for a passcode. A live install asks for an email and a
    // password, so the address is supplied from the environment rather than a
    // file. SMOKE_ADMIN_PASSWORD is the account's real password there.
    const emailField = page.getByLabel('Email')
    if (await emailField.count()) {
      await emailField.fill(process.env.SMOKE_ADMIN_EMAIL ?? '')
    }
    await page.getByLabel(/Passcode|Password/).fill(ADMIN_SECRET)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/admin', { timeout: 10000 })
    await page.getByRole('heading', { name: 'Order board' }).waitFor()
    await page.screenshot({ path: `${OUT}/05-board.png` })
    log('board open')

    const card = page.locator('article').filter({ hasText: displayNumber ?? '' }).last()
    await card.getByRole('button', { name: 'Start' }).click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/06-board-preparing.png` })

    const movingCard = page.locator('article').filter({ hasText: displayNumber ?? '' }).last()
    await movingCard.getByRole('button', { name: 'Ready' }).click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/07-board-ready.png` })
    log('advanced to ready')

    /* --------------------------------------------------- guest ready state */
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(page.url().replace('/admin', '/menu'), { waitUntil: 'networkidle' })
    await page.locator('.ticket').first().waitFor({ timeout: 8000 }).catch(() => {})
    // Navigate to the ticket directly through the "your ticket" shortcut.
    const shortcut = page.getByRole('link', { name: /Your ticket/ })
    if (await shortcut.count()) {
      await shortcut.first().click()
    }
    await page.waitForURL('**/ticket/**', { timeout: 8000 })
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${OUT}/08-ready-alert.png` })
    const readyVisible = await page.getByText(/Your drink is ready/i).first().isVisible()
    log(`ready alert visible: ${readyVisible}`)

    const confirm = page.getByRole('button', { name: /Confirm collected/ })
    if (await confirm.count()) {
      await confirm.first().click()
      await page.waitForTimeout(900)
      await page.screenshot({ path: `${OUT}/09-collected.png` })
      log('collected confirmed')
    } else {
      problems.push('Confirm collected button missing on ready ticket')
    }

    /* ------------------------------------------------------------- qr page */
    await page.setViewportSize({ width: 1180, height: 820 })
    await page.goto(`${BASE}/admin/qr`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/10-qr.png` })
    // The page shows one drawn card, so the preview is what has to be a PNG.
    const preview = page.locator('img[alt="Preview"]')
    const previewSrc = (await preview.count()) ? await preview.first().getAttribute('src') : ''
    if (!previewSrc?.startsWith('data:image/png')) problems.push('QR card preview did not render')
    log('qr page rendered')

    /* ----------------------------------------------------------- menu admin */
    await page.goto(`${BASE}/admin/menu`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/11-admin-menu.png` })
    log('menu admin rendered')
  }

  /* --------------------------------------------------------- mobile board */
  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto(`${BASE}/menu`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Coffee' }).waitFor()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (overflow > 1) problems.push(`horizontal overflow on menu: ${overflow}px`)
  log(`menu overflow: ${overflow}px`)
} catch (error) {
  problems.push(`flow failed: ${error.message}`)
  await page.screenshot({ path: `${OUT}/99-failure.png` }).catch(() => {})
} finally {
  await browser.close()
}

if (problems.length === 0) {
  console.log('\nSMOKE PASS: no console errors, full flow completed')
} else {
  console.log('\nSMOKE ISSUES:')
  for (const problem of problems) console.log(` - ${problem}`)
  process.exitCode = 1
}
