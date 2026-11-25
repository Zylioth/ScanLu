# Decisions

Where I had to choose, and why. `system.md` wins on conflicts; anything it left
open is recorded here.

## Architecture

**Two backends behind one interface.** `src/lib/backend.ts` picks a backend from
the environment. Demo mode (`localBackend.ts`) keeps the whole app runnable with
zero setup, which matters for a home project: you can try the ticket animation
tonight and connect Supabase later without touching a component. The Supabase
path (`supabaseBackend.ts`) is a thin adapter over tables and RPCs.

**Demo mode is same-browser only.** `localStorage` plus `BroadcastChannel` syncs
tabs, not devices. This is stated in the README and as a strip under the admin
header, so nobody relies on it at the open house by accident.

**Supabase is wired but not yet run against a live project.** No project existed
while building this, so `supabase/migrations/0001_init.sql` was written to the
exact contract the adapter calls and then validated three ways: every statement
parses against the real PostgreSQL grammar (`libpg_query`), the RPC names and
parameter names are byte-identical to the `rpc()` calls in
`supabaseBackend.ts`, and the seed reuses the demo ids through a stable slug
hash. What is *not* proven is behaviour on a live database, so treat the first
deploy as an integration test. Expected first snags are a column rename or a
Storage bucket policy, not the limit logic.

**The SQL test file avoids psql meta-commands** (`\set`, `\echo`) so it runs in
the Supabase SQL editor as well as psql. Use
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_limits.sql`.

**Business rules are duplicated on purpose.** The demo backend and the Postgres
functions each enforce the same limits. Sharing one implementation would have
meant either a fake SQL layer in the browser or no local demo. The React layer
never enforces; it displays and maps error codes.

**Rolling 60 minute window** for `max_cups_per_hour`, not clock hours
(`system.md` allowed either but asked for it to be documented).

**Order numbers reset per event per day** in `Asia/Brunei`, format `A-001`, letter
rolling every 999.

**ETA is a heuristic:** cups ahead in the queue multiplied by the slowest prep
time in the order, plus the order's own prep. Honest and cheap; it is displayed
as "about N min", never as a promise.

## Product

**Hosting is GitHub Pages, not Cloudflare Pages.** `system.md` suggested
Cloudflare, but this app is a static bundle with Supabase behind it, so any
static host works and Pages keeps code and hosting in one place. Two things had
to change for a subdirectory deploy: `BrowserRouter` takes its `basename` from
Vite's `BASE_URL` (without it, `/ScanLu/menu` matched no route), and the QR
targets the site root instead of `/ScanLu/menu`, because Pages answers every
deep link with `404.html` and a scanned code should land on a 200. The
`404.html` copy keeps deep links working on refresh.

**The app is called ScanLu; the event is data.** `APP_NAME` in `src/lib/brand.ts`
is the product (browser title, manifest, admin sign-in). The name on the guest
header, the ticket and the printed QR card comes from `events.event_name`, which
seeds as "ScanLu" but can be renamed per occasion without a code change.

**Paused orders get a card, not a banner.** A thin strip at the top is easy to
miss for someone who scans while the host is catching up, so the guest menu now
leads with a full emerald card: what happened, the host's own message, and a
line saying they can still browse. A slim bottom bar repeats the state while
they scroll, and it sits in the slot the cart bar would use, so it never covers
a control. Item cards stop rendering their add button and get a dashed border.
They are deliberately **not** dimmed: `opacity` on the card dropped body text to
about 4.2:1, under AA, so the state is carried by the missing button and the
border instead of by muting the text.

**`auto_accept` is seeded `false`.** `system.md` says the column defaults to
true. The column still defaults to true in SQL, but the seeded demo event starts
with it off so the board shows the whole lifecycle (New, Making, Ready) instead
of an always-empty New column. Flip it in Admin settings for the real event.

**No swipe gestures on order cards.** `design.md` listed swipe-to-advance as a
bonus and required buttons. Only buttons are built, with undo. Fewer ways to
mis-fire on a wet iPad.

**"Ring again" is a bell icon button next to Collected** rather than a text
button, so the primary action keeps the full width.

**Photo upload crops to a centre 4:3 with a zoom slider**, not free panning.
Acceptance was "three taps from the iPad"; drag-to-position would have added a
gesture layer for a rare fix. The original file is kept in memory, so moving the
slider re-crops from the source instead of re-compressing.

**Payment is displayed, not editable.** Payment marking is listed under Phase 2
in `system.md`, and this build stops at the Phase 1 scope agreed up front. The
chip shows method and paid state from the order.

## Visual

Reading this as: a home hospitality ordering tool for guests on phones and a host
on an iPad, in a warm Brunei open-house visual language (emerald, gold, cream,
Fraunces display serif), dial ENERGY 2 / RHYTHM 2 / MOTION 2.

One-line reasons for the main decisions:

- **Emerald plus gold on cream**: from `design.md`, and it reads as hospitality
  rather than software; emerald carries actions, gold is reserved for the ready
  moment and borders so it stays an accent.
- **Fraunces for the number and headings**: the ticket has to feel like paper at
  a café, and a serif with real character does that where Inter cannot.
- **Inter for everything else, tabular numerals in lists**: order numbers and
  timers must line up when the host glances down the board.
- **Shadows in three steps only**: elevation means "this is interactive or it is
  the ticket", not decoration.
- **Ketupat lattice only in the ticket header and the printed QR card**: it is
  the identity motif, and it would fight text if it were used as a page texture.
  `design.md` asked for exactly this restraint.
- **The ticket is the focal point of every guest screen**: it is the product.
- **Motion is rationed**: quick 120 to 220 ms transitions everywhere, and the
  entire animation budget goes to the ready tear. Nothing else bounces.
- **Chimes are synthesised with WebAudio**, not shipped as mp3. No binary asset
  to keep in sync, about 2 KB of code, and the guest chime (warm bell) is
  audibly different from the admin chime (short two-tone).

## Deliberate omissions

These are Phase 2 and 3 items from `system.md`, out of the version agreed for
this build:

- Manual order entry (`/admin/new-order`), inventory screen, limits form,
  history and CSV export.
- Low-stock chips on the board (needs the inventory screen to be useful).
- Web Push for locked phones. The ticket tells the guest to keep the page open.
- Cloudflare Turnstile on anonymous sign-in. The Supabase path signs in
  anonymously without a captcha; do not expose it publicly until that is wired.
- PNG icons for every size in the manifest are generated by
  `scripts/make-icons.mjs` from geometry, because the wordmark and logo are still
  placeholders. Replace the script's mark, or drop in real files, when the open
  house has a name.
- `supabase/tests/rls_and_limits.sql` asserts what can be asserted from a single
  session; true concurrency behaviour relies on the advisory lock and the row
  locks in `place_order`, and should be hammered with a script before the event.
