/**
 * WCAG contrast check for the token pairs the UI actually renders.
 * Run: node scripts/a11y-check.mjs
 */
const pairs = [
  // [label, foreground, background, minimum]
  ['body text on page', '#2B1B12', '#FFF9EE', 4.5],
  ['muted text on page', '#6B5646', '#FFF9EE', 4.5],
  ['muted text on panel', '#6B5646', '#FFFFFF', 4.5],
  ['muted text on cream card', '#6B5646', '#F8EEDB', 4.5],
  ['cream text on brand 700 (buttons)', '#FFF9EE', '#12664A', 4.5],
  ['gold 300 on brand 700 (ticket eyebrow)', '#F0D08A', '#12664A', 4.5],
  ['cream text on brand 900 (ticket head)', '#FFF9EE', '#0B3D2E', 4.5],
  ['brand 900 number on white ticket', '#0B3D2E', '#FFFFFF', 4.5],
  ['gold 300 number on brand 700 (ready)', '#F0D08A', '#12664A', 4.5],
  ['cocoa on gold 300 (chips)', '#2B1B12', '#F0D08A', 4.5],
  ['danger text on page', '#C8412B', '#FFF9EE', 4.5],
  ['success ink on panel', '#12664A', '#FFFFFF', 4.5],
  ['warning ink on panel', '#8A5A06', '#FFFFFF', 4.5],
  ['info ink on panel', '#26609C', '#FFFFFF', 4.5],
  ['focus ring on page', '#2F6FB3', '#FFF9EE', 3],
  // Dark theme
  ['dark body text', '#F6EEDC', '#101A16', 4.5],
  ['dark muted text', '#B9AE98', '#101A16', 4.5],
  ['dark muted on panel', '#B9AE98', '#17251F', 4.5],
  ['dark cream on brand 700', '#FFF9EE', '#12664A', 4.5],
  ['dark body text on panel', '#F6EEDC', '#17251F', 4.5],
  ['dark danger', '#F0806C', '#101A16', 4.5],
  ['dark success ink', '#86D9B4', '#17251F', 4.5],
  ['dark warning ink', '#F2C063', '#17251F', 4.5],
  ['dark info ink', '#9CC4EF', '#17251F', 4.5],
]

function channel(value) {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

let failures = 0
for (const [label, fg, bg, min] of pairs) {
  const value = ratio(fg, bg)
  const pass = value >= min
  if (!pass) failures++
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${value.toFixed(2).padStart(5)} (min ${min})  ${label}`,
  )
}
console.log(`\n${failures === 0 ? 'All pairs pass' : `${failures} pair(s) fail`}`)
process.exitCode = failures === 0 ? 0 : 1
