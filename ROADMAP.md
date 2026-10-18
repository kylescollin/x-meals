# Fox & Bear Kitchen — Roadmap

## What's Been Built

- **JSON data layer** — Recipes and meals live in JSON under `data/`, not in HTML. The pages are
  render-only shells.
- **Google Sign-In** — Firebase Auth with a two-email allowlist. Everything on the site is behind it.
- **Real-time grocery sync** — Checkbox state syncs between Kyle and Josephine instantly, per week.
- **Recipe management from the site** — Add a recipe, edit one, save one from the week. No Agent X
  round trip needed.
- **Photos and the cook log** — A cover photo per recipe plus a gallery of photos and notes taken
  while cooking, stored as compressed base64 in Realtime Database. No Storage bucket, no billing.
- **Week navigation** — Every week, past present and future, is a document at
  `/meals/weeks/{weekOf}`. Chevrons walk between them, a jump-to-week sheet skips further, and
  swiping works on a phone. Planning ahead is just walking forward and hitting Edit; there is no
  publish step and nothing gets displaced.
- **Per-week grocery lists** — Each week owns its list, reachable from a progress card inside the
  week or from the Groceries tab. Last week's list is still there when you need it.
- **Grocery lists that merge** — Adding a meal no longer rebuilds the list from scratch. Anything
  already ticked off keeps its exact name, so it stays ticked.
- **Timeline view** — The old Journal, folded into the week page as a second view. Same cards and
  cook-log blocks, loading each week as you scroll to it.
- **Line icons** — A local Lucide subset (`icons.js`) drives the week header and the nav tabs.
- **Explore** — A third tab: a photo grid of new recipes pulled from nine food blogs every morning,
  read with the same parser as the import button. One tap saves one into the collection with an
  `Explore` tag; "Not for us" hides it for both of you. Static JSON in `data/explore/`, no API,
  no cost.

---

## What's Next

### Finish the icon pass
The header and nav now use line icons; the rest of the site is still emoji. Remaining:
- Grocery section headers (🥦 🥩 🧈 🫙 🌿) — worth thinking about first. The colour and food-ness
  scan fast in a shop, and flat line icons may genuinely be a downgrade there.
- Scattered controls: 🎲 Shuffle, 🛒 on the grocery card, ✕ close buttons, ⠿ drag handles.
- The 🛒 on the week page's grocery card sits right under a line-icon Groceries tab, so that one is
  the most visible mismatch.

Recipe icons (🌶️ 🥘 🍜) should stay emoji — they're content, not chrome.

### Shared CSS
Every page carries its own copy of the reset, the body rules, the header block and the bottom-sheet
styles. `theme.css` holds only the colour tokens. Pulling the shared components out would make
changes like the header rework a one-file edit instead of a four-file one.

### Explore, next
- **Picks for you** — a short strip at the top ranked by Claude from the pool, against what the
  family actually cooks. The daily job already has everything it needs; this is one scoped call.
- **Back catalogs** — the blogs that allow it publish sitemaps listing every post (Budget Bytes
  alone has ~3,000). A one-off `--backfill <sourceId>` would seed thousands into the pool.
- **Share into Explore** — point the iOS Shortcut at the feed instead of importing straight away,
  so anything spotted on Instagram or Safari lands in the grid to decide on later.
- **Blocked blogs** — Cookie and Kate, Gimme Some Oven, Two Peas, Half Baked Harvest and The Woks
  of Life refuse scripts and ship summary-only feeds. If any of them ever carries its recipe card in
  the feed again, it's one line in `data/explore/sources.json` to bring back.

### Family Hub Expansion
More pages on the same Firebase backend — home projects, trip planning, shared lists. Each is a new
page plus a new collection; the auth, nav, sync and icon layers are already there.
