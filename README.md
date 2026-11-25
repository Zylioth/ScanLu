# Open House Drinks

A small QR drink-ordering system for a home espresso setup, built for a Hari Raya
open house. Guests scan a code, order from their phone, and get a digital ticket
that tears itself apart and rings when the drink is ready. The host runs the whole
thing from an iPad.

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

## Going live on Supabase

1. Create a Supabase project.
2. Run the SQL in order, in the SQL editor:
   - `supabase/migrations/0001_init.sql`
   - `supabase/seed.sql` (the same eleven drinks as the demo)
3. Create your admin user in Authentication, then add them to `admins`:

   ```sql
   insert into admins (user_id) values ('<your auth user uuid>');
   ```

4. Copy `.env.example` to `.env.local` and fill in the URL and anon key. Set
   `VITE_PUBLIC_APP_URL` to the address your guests will scan.
5. `npm run build` and deploy `dist` to Cloudflare Pages. `public/_redirects`
   already handles the SPA fallback.

The app picks Supabase automatically when `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are present. Nothing else changes.

Admin sign-in in Supabase mode uses email plus password from
`VITE_ADMIN_EMAIL`; in demo mode it is the passcode above.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck then production build |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | oxlint |
| `npm run icons` | Regenerate PWA icons from the script |
| `node scripts/smoke.mjs` | Real Chrome click-through of the guest and admin flows, writes `screenshots/` |

The smoke test needs the dev server running. It fails on any console error and
on horizontal overflow at phone width.

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
