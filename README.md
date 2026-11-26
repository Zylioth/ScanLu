# ScanLu

A small QR drink-ordering system for a home espresso setup, built for a Hari Raya
open house. Guests scan a code, order from their phone, and get a digital ticket
that tears itself apart and rings when the drink is ready. The host runs the whole
thing from an iPad.

"ScanLu" is the app. The event name on the ticket and the printed QR card is data,
set in Admin settings, so the same install can serve a different occasion.

Built from `design.md` and `system.md` in this repo.

---

## Run it now (no accounts, no database)

```bash
npm install
npm run dev
```

Open http://localhost:5173/menu on your phone-sized window, and
http://localhost:5173/admin in a second tab. The admin passcode is **1234**.

This is demo mode: everything lives in `localStorage` and syncs between tabs of
the same browser through `BroadcastChannel`. Two tabs on one laptop behaves like
a phone plus an iPad, which is enough to see the whole flow. The seed menu is a
small home bar: espresso, americano, latte, cappuccino, iced latte, iced
americano, teh tarik, teh tarik ais, milo ais, sirap bandung, milo panas.

Demo mode limits, stated plainly:

- Data does not leave the browser and does not sync across devices.
- Menu photos become compressed data URLs in `localStorage` (small by design).
- Clearing site data resets everything to the seed.

---

## What works

**Guests** (`/menu`, `/cart`, `/ticket/:orderId`)

- Menu with categories, bilingual names, sold-out and "only N left" states,
  live wait estimate, and a pause banner.
- Modifier sheet (ice, sugar, milk, extra shot) with price deltas, quantity
  stepper capped by the event limit.
- Cart with name, optional note, friendly errors for every limit.
- Ticket with perforation notches, a number you can read across a table, status
  stepper, and a barcode drawn from the order id.
- Ready state: chime, vibration where supported, blinking title, and the
  ticket-tear animation (shake, split on the perforation, settle into the READY
  card with confetti). Reduced-motion users get a quiet cross-fade instead.
- Screen wake lock while waiting, slide-to-confirm collection, cancel while the
  order is still new, and an end state that respects the per-person limit.
- English and Bahasa Melayu, remembered per device.

**Host** (`/admin`, `/admin/menu`, `/admin/qr`)

- Live board with three columns, big numbers, age timers that go amber then red,
  payment chips, notes, and one-tap advance with a 10 second undo.
- Distinct chime and gold glow when a new order lands.
- Ring again on a ready order, cancel with a reason (stock returns).
- Pause orders from anywhere in the admin.
- Menu management: create, edit, sell out, reorder by sort order, and upload a
  photo from the iPad (native camera or library, centre-cropped to 4:3, resized
  and converted to WebP in the browser).
- QR page with a print-ready A6/A5/A4 card, and PNG or SVG download.
- Light and dark themes, follows the device by default.

---

## Backend: Supabase

The live site reads and writes a real database, so a guest's phone and the host's
iPad see the same orders. What is already set up in the project:

1. `supabase/migrations/0001_init.sql` then `supabase/seed.sql`, run in the SQL
   editor. The seed also adds the four tables to the `supabase_realtime`
   publication, which is what gives the admin board live updates.
2. `supabase/migrations/0002_admin_clear_today.sql`, which adds the admin only
   `clear_today` action behind the "Clear today's orders" button. Everything else
   on `/admin/settings` works without it, that one button needs it.
3. `supabase/migrations/0003_ingredient_packs.sql`, which adds the optional pack
   size and pack name to ingredients. Without it, stock still works but the
   ingredient screen cannot count in boxes or bags.
2. **Anonymous sign-ins enabled** under Authentication, Sign In / Providers.
   Guests cannot order without it.
3. An admin user, listed in `admins`:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = '<your admin email>'
   on conflict do nothing;
   ```

4. `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ADMIN_EMAIL` sit in
   `.github/workflows/deploy.yml` for the Pages build, and in `.env.local` for
   local development. They are public on purpose: every `VITE_*` value is baked
   into the JavaScript guests download. The RLS policies are what protect the
   data, and the `service_role` key belongs in neither file.

Captcha stays off. Turning on Turnstile makes Supabase demand a captcha token on
anonymous sign-in, and the adapter does not send one yet; the env slot
`VITE_TURNSTILE_SITE_KEY` is reserved for when it does.

The app switches to Supabase whenever `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are both present, and falls back to the browser demo
otherwise. No component changes.

Admin sign-in is `VITE_ADMIN_EMAIL` plus that account's password. The demo
passcode only exists in demo mode. The publishable key is public by design and
ships inside the bundle; the RLS policies in the migration are what protect the
data. Never put the `service_role` key in a `VITE_*` variable.

To put your own name on the menu header and the printed QR card:

```sql
update public.events set event_name = 'ScanLu', host_name = 'Your name';
```


---

## Hosting on GitHub Pages

The repo already contains the whole pipeline: `.github/workflows/deploy.yml`
builds and publishes on every push to `main`.

- Live URL: **https://zylioth.github.io/ScanLu/**
- `npm run build:pages` builds with `--base=/ScanLu/` (Pages serves from a
  subpath, not the domain root) and copies `dist/index.html` to `dist/404.html`,
  because Pages has no rewrite rules and a deep link needs the app shell back.
- `VITE_PUBLIC_APP_URL` is set in the workflow so the QR code and the print card
  point at the deployed site. The QR targets the site root, which redirects to
  the menu, so a scan lands on a clean 200 rather than a 404.
- First deploy only: if the run fails on `configure-pages`, set
  Settings, Pages, Source to **GitHub Actions** and re-run the job.
- Custom domain later: add a `CNAME` file and the DNS record, then change
  `VITE_PUBLIC_APP_URL` in the workflow to match.

To test the subpath build exactly as Pages serves it before pushing:

```bash
npm run build:pages
node scripts/serve-pages.mjs 4174
SMOKE_BASE=http://localhost:4174/ScanLu SMOKE_PAGES=1 node scripts/smoke.mjs
```

Pages serves the static bundle; the data lives in Supabase. The Supabase values
come from the workflow itself, so the build has them without any repository
settings. Blanking `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` still produces
a working build, it just falls back to the browser demo, which is the confusing
way for the live site to stop showing real orders.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck then production build |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | oxlint |
| `npm run icons` | Regenerate PWA icons from the script |
| `npm run build:pages` | Build for the `/ScanLu/` subpath, with the `404.html` fallback |
| `node scripts/serve-pages.mjs` | Serve `dist` the way GitHub Pages does, for local checks |
| `node scripts/smoke.mjs` | Real Chrome click-through of the guest and admin flows, writes `screenshots/` |
| `node scripts/realtime.mjs` | Two tabs, one browser: proves orders, status changes and collection sync with no reload |
| `node scripts/checks.mjs` | Dark theme, Bahasa Melayu, 320px phone, keyboard focus, pause toggle, A5 and A4 print sizing |
| `node scripts/a11y-check.mjs` | WCAG contrast for every token pair the UI renders |

The smoke test needs the dev server running. It fails on any console error and
on horizontal overflow at phone width.

Against the live database the admin password is not available to the test, so
`SMOKE_GUEST_ONLY=1 node scripts/smoke.mjs` stops after the guest flow. That is
still enough to prove `place_order`, the display-number counters and the realtime
subscription. When you do want the admin half, pass the password in rather than
committing it: `SMOKE_ADMIN_PASSWORD=... node scripts/smoke.mjs`.

---

## Layout

```
src/
├─ app shell:        App.tsx, main.tsx
├─ features:
│  ├─ customer:      pages/MenuPage.tsx, CartPage.tsx, TicketPage.tsx
│  └─ admin:         pages/admin/*, components/AdminShell.tsx
├─ components:       Ticket, ReadyAlert, ItemSheet, SlideToConfirm, ui, Toast
├─ lib:              backend switch, local demo backend, supabase backend,
│                    audio (synthesised chimes), wakelock, image processing,
│                    theme, i18n, errors, format
├─ locales:          en.json, ms.json
└─ styles:           tokens.css (design tokens), app.css (ticket + motion)
supabase/            migrations, seed, tests
scripts/             make-icons.mjs, smoke.mjs
```

Business rules live in one place per backend: `src/lib/localBackend.ts` for the
demo, and Postgres functions in `0001_init.sql` for production. The React layer
only displays limits and maps error codes to copy.

---

## Known gaps

See `DECISIONS.md`. The short version: no manual order entry, no inventory
screen, no history export, no payment marking, no web push yet. Those are the
Phase 2 and Phase 3 items from `system.md`, deliberately left out of this build.
