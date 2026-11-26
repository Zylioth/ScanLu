/**
 * Cross-tab realtime test. Two tabs in one browser context (shared storage):
 * a guest phone tab and an admin board tab. Proves that an order placed in the
 * guest tab appears on the board without a reload, and that tapping Ready on the
 * board raises the alert on the guest tab without a reload.
 *
 *   node scripts/realtime.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173'
// Deep links return 404.html on GitHub Pages; the document 404 is expected there.
const pagesMode = process.env.SMOKE_PAGES === '1'
const OUT = 'screenshots'
mkdirSync(OUT, { recursive: true })

const problems = []
const log = (message) => console.log(`  ${message}`)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' })
const guest = await context.newPage()
const admin = await context.newPage()
// Skip the first-visit welcome card so it does not sit over the menu flows.
await context.addInitScript(() => {
  try {
    localStorage.setItem('ohpos.welcome.seen', 'true')
  } catch {
    /* ignore */
  }
})

for (const [name, page] of [
  ['guest', guest],
  ['admin', admin],
]) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (pagesMode && /status of 404/.test(text)) return
    problems.push(`${name} console: ${text}`)
  })
  page.on('pageerror', (error) => problems.push(`${name} pageerror: ${error.message}`))
}

async function waitForText(page, text, timeout) {
  const started = Date.now()
  await page.getByText(text, { exact: false }).first().waitFor({ timeout })
  return Date.now() - started
}

try {
  /* ---------------------------------------------------------------- board first */
  await admin.setViewportSize({ width: 1180, height: 820 })
  await admin.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await admin.waitForURL('**/admin/login')
  await admin.getByLabel('Passcode').fill('1234')
  await admin.getByRole('button', { name: 'Sign in' }).click()
  await admin.waitForURL('**/admin')
  await admin.getByRole('heading', { name: 'Order board' }).waitFor()
  log('board open in tab 2')

  /* ---------------------------------------------------------------- guest order */
  await guest.goto(`${BASE}/menu`, { waitUntil: 'networkidle' })
  await guest.getByRole('heading', { name: 'Coffee' }).waitFor()
  await guest.getByRole('button', { name: /^Add / }).first().click()
  await guest.getByRole('dialog').getByRole('button', { name: /Add to order/ }).click()
  await guest.getByRole('button', { name: /View order/ }).click()
  await guest.waitForURL('**/cart')
  await guest.getByLabel('Your name').fill('Tab Sync')
  await guest.getByRole('button', { name: 'Place order' }).click()
  await guest.waitForURL('**/ticket/**', { timeout: 10000 })
  await guest.locator('.ticket').first().waitFor()
  const number = (await guest.locator('.ticket-number').first().textContent())?.trim()
  log(`order ${number} placed in tab 1`)

  // Mark each page so a reload can be detected.
  await guest.evaluate(() => {
    window.__noReload = 'guest-still-here'
  })
  await admin.evaluate(() => {
    window.__noReload = 'admin-still-here'
  })

  /* --------------------------------------------------- order appears on the board */
  const orderLatency = await waitForText(admin, number ?? '', 8000)
  if (orderLatency > 3000) {
    problems.push(`new order took ${orderLatency}ms to reach the board (polling, not realtime)`)
  }
  log(`board showed ${number} after ${orderLatency}ms, no reload`)

  const adminMarker = await admin.evaluate(() => window.__noReload)
  if (adminMarker !== 'admin-still-here') problems.push('board page reloaded to get the order')
  await admin.screenshot({ path: `${OUT}/15-realtime-order.png` })

  /* ------------------------------------------------------- advance to making */
  const card = admin.locator('article').filter({ hasText: number ?? '' }).last()
  await card.getByRole('button', { name: 'Start' }).click()
  const makingLatency = await waitForText(guest, 'Making', 8000)
  if (makingLatency > 3000) {
    problems.push(`Making took ${makingLatency}ms to reach the guest (polling, not realtime)`)
  }
  log(`guest saw Making after ${makingLatency}ms, no reload`)

  /* --------------------------------------------------------- advance to ready */
  const movingCard = admin.locator('article').filter({ hasText: number ?? '' }).last()
  await movingCard.getByRole('button', { name: 'Ready' }).click()
  const readyLatency = await waitForText(guest, 'Your drink is ready', 8000)
  if (readyLatency > 3000) {
    problems.push(`ready alert took ${readyLatency}ms to reach the guest (polling, not realtime)`)
  }
  log(`guest alert after ${readyLatency}ms, no reload`)

  const guestMarker = await guest.evaluate(() => window.__noReload)
  if (guestMarker !== 'guest-still-here') problems.push('ticket page reloaded to get the alert')
  await guest.waitForTimeout(1400)
  await guest.screenshot({ path: `${OUT}/16-realtime-ready.png` })

  /* ------------------------------------------------- guest confirms, board sees it */
  await guest.getByRole('button', { name: /Confirm collected/ }).first().click()
  const collectedLatency = await waitForText(admin, 'Collected', 8000)
  log(`board saw Collected after ${collectedLatency}ms, no reload`)
  await admin.screenshot({ path: `${OUT}/17-realtime-collected.png` })

  /* -------------------------------------------- undo puts it back on the board */
  const recentUndo = admin.getByRole('button', { name: 'Undo' }).first()
  if (await recentUndo.count()) {
    await recentUndo.click()
    await admin.waitForTimeout(900)
    const backOnBoard = await admin.locator('article').filter({ hasText: number ?? '' }).count()
    if (backOnBoard === 0) problems.push('undo did not return the order to the board')
    log('undo returned the order to Ready')
  } else {
    problems.push('no undo control in the recent tray')
  }
} catch (error) {
  problems.push(`realtime flow failed: ${error.message}`)
  await guest.screenshot({ path: `${OUT}/97-realtime-guest-fail.png` }).catch(() => {})
  await admin.screenshot({ path: `${OUT}/97-realtime-admin-fail.png` }).catch(() => {})
} finally {
  await browser.close()
}

console.log(
  problems.length === 0
    ? '\nREALTIME PASS: both tabs stay live with no reloads'
    : `\nREALTIME ISSUES:\n${problems.map((p) => ` - ${p}`).join('\n')}`,
)
process.exitCode = problems.length === 0 ? 0 : 1
