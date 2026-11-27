/**
 * Regression checks for three behaviours that are easy to break silently:
 *
 *   1. Options chosen in the guest drink sheet survive the menu refetching.
 *   2. The host can place an order by hand, and it lands on the board.
 *   3. Insights can be read for a day other than today.
 *
 *   node scripts/features.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173'
const ADMIN_SECRET = process.env.SMOKE_ADMIN_PASSWORD ?? '1234'
const OUT = 'screenshots'
mkdirSync(OUT, { recursive: true })

const problems = []
const log = (message) => console.log(`  ${message}`)
const check = (ok, message) => {
  if (ok) log(`ok: ${message}`)
  else {
    problems.push(message)
    log(`FAIL: ${message}`)
  }
}

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
await context.addInitScript(() => {
  try {
    localStorage.setItem('ohpos.welcome.seen', 'true')
  } catch {
    /* ignore */
  }
})
const page = await context.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

try {
  await waitForServer()

  /* ------------------------------------------- 1. the sheet keeps its choices */
  await page.goto(`${BASE}/menu`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Add Latte' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.waitFor({ timeout: 5000 })

  await sheet.getByRole('button', { name: 'Less sweet' }).click()
  await sheet.getByRole('button', { name: 'One more' }).click()
  await page.screenshot({ path: `${OUT}/20-sheet-chosen.png` })

  // The menu refetches on an 8 second timer; the old bug reset the sheet there.
  await page.waitForTimeout(10500)

  const stillChosen = await sheet.getByRole('button', { name: 'Less sweet' }).getAttribute('aria-pressed')
  check(stillChosen === 'true', 'sugar choice survives the menu refetch')
  const qtyText = (await sheet.locator('[aria-live="polite"]').first().textContent())?.trim()
  check(qtyText === '2', `quantity survives the menu refetch (saw ${qtyText})`)
  await page.screenshot({ path: `${OUT}/21-sheet-after-refetch.png` })
  await page.keyboard.press('Escape')

  /* ------------------------------------------------- 2. the host takes an order */
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await page.waitForURL('**/admin/login')
  await page.getByLabel('Passcode').fill(ADMIN_SECRET)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/admin', { timeout: 10000 })

  await page.goto(`${BASE}/admin/new-order`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'New order' }).waitFor({ timeout: 10000 })
  await page.screenshot({ path: `${OUT}/22-new-order.png` })

  await page.getByRole('button', { name: /Latte/ }).first().click()
  const picker = page.getByRole('dialog')
  await picker.waitFor({ timeout: 5000 })
  await picker.getByRole('button', { name: 'No sugar' }).click()
  await picker.getByRole('button', { name: /Add to order/ }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/23-new-order-tray.png` })

  const trayText = await page.getByText('On this order').count()
  check(trayText > 0, 'the picked drink lands in the tray')

  await page.getByRole('button', { name: 'Review' }).click()
  const review = page.getByRole('dialog')
  await review.waitFor({ timeout: 5000 })
  await review.getByLabel('Name').fill('Manual test')
  await page.screenshot({ path: `${OUT}/24-new-order-review.png` })
  await review.getByRole('button', { name: 'Place order' }).click()

  await page.getByRole('heading', { name: 'Order placed' }).waitFor({ timeout: 10000 })
  const placedNumber = (await page.getByText(/^[A-Z]-\d{3}$/).first().textContent())?.trim()
  log(`manual order placed: ${placedNumber}`)
  check(/^[A-Z]-\d{3}$/.test(placedNumber ?? ''), `manual order has a display number (${placedNumber})`)
  await page.screenshot({ path: `${OUT}/25-new-order-done.png` })

  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const onBoard = await page.getByText(placedNumber ?? '').count()
  check(onBoard > 0, 'the manual order is on the board')

  /* -------------------------------------------- 3. insights for another day */
  await page.goto(`${BASE}/admin/stats`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Today' }).waitFor({ timeout: 10000 })
  await page.screenshot({ path: `${OUT}/26-insights-today.png` })

  // A second day has to exist before it can be read, so borrow today's order,
  // move it three days back and rename its drink to something unmistakable.
  const oldDayLabel = await page.evaluate(() => {
    const raw = localStorage.getItem('ohpos.db')
    if (!raw) throw new Error('demo database missing')
    const db = JSON.parse(raw)
    const template = db.orders[db.orders.length - 1]
    const past = new Date(Date.now() - 3 * 86400000).toISOString()
    db.orders.push({
      ...template,
      id: crypto.randomUUID(),
      order_number: 777,
      display_number: 'Z-777',
      placed_at: past,
      items: template.items.map((line) => ({
        ...line,
        name_en: 'Ghost latte',
        name_ms: 'Ghost latte',
      })),
    })
    localStorage.setItem('ohpos.db', JSON.stringify(db))
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Brunei',
      day: 'numeric',
      month: 'short',
    }).format(new Date(past))
  })

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: oldDayLabel }).waitFor({ timeout: 10000 })
  check(true, `an earlier day is offered (${oldDayLabel})`)

  await page.getByRole('button', { name: oldDayLabel }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/27-insights-other-day.png` })
  check((await page.getByText('Ghost latte').count()) > 0, 'the other day shows its own drinks')

  await page.getByRole('button', { name: 'Today' }).click()
  await page.waitForTimeout(400)
  check((await page.getByText('Ghost latte').count()) === 0, 'today stays clean of the other day')

  /* --------------------------------------------- 4. the new screens reflow */
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/admin/new-order', '/admin/stats']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    if (path === '/admin/new-order') {
      await page.screenshot({ path: `${OUT}/28-new-order-phone.png` })
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    check(overflow <= 1, `${path} has no horizontal overflow (${overflow}px)`)
  }

  /* ------------------------------------- 5. signing out lands on the login screen */
  // Last, because it ends the admin session this script built up. The raw
  // location.assign that used to do this ignored the /ScanLu/ base and dropped
  // the host on the guest menu.
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL('**/admin/login', { timeout: 10000 })
  // The URL changes before React commits the new screen, so wait for the form.
  const signInButton = page.getByRole('button', { name: 'Sign in' })
  await signInButton.waitFor({ timeout: 10000 })
  check(await signInButton.isVisible(), 'signing out returns to the login screen')
} catch (error) {
  problems.push(`flow failed: ${error.message}`)
  await page.screenshot({ path: `${OUT}/98-features-failure.png` }).catch(() => {})
} finally {
  await browser.close()
}

if (problems.length === 0) {
  console.log('\nFEATURES PASS')
} else {
  console.log('\nFEATURES ISSUES:')
  for (const problem of problems) console.log(` - ${problem}`)
  process.exitCode = 1
}
