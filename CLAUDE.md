# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working with Kyle

- Kyle is not deeply technical. Always explain what you did and why in plain language after taking action.
- Handle technical decisions yourself rather than asking Kyle to choose between options he may not have context for. When you do need his input, give him a single clear instruction — not a list of choices.
- Confirmations before executing are welcome (they help Kyle stay informed), but not required for routine tasks.
- Never leave Kyle with a list of commands to run himself — always offer to execute them, or just run them directly.
- This is a **personal tool** for Kyle and his family. Default to the simplest, most reliable solution. Flag anything that could expose personal data or break the live site.

## Git Workflow

**At the start of every session**, run `git pull` to make sure the local copy is up to date. Kyle sometimes edits files directly through claude.ai, so the remote may be ahead of local.

**Push regularly** — after any meaningful change, commit and push so the live GitHub Pages site stays in sync and nothing is lost. Don't batch up lots of changes without pushing.

```bash
git pull                          # Always do this first
git add <file>                    # Stage specific files
git commit -m "description"       # Commit with a clear message
git push                          # Goes live on GitHub Pages immediately
```

## Project Overview

This is **Fox & Bear Kitchen** — a personal meal planning and recipe site for Kyle and his family. It's a static site (plain HTML, CSS, and JavaScript — no build tools, no frameworks, no npm). Editing a file and pushing is all it takes to update the live site.

**Live site:** Served via GitHub Pages from the `main` branch. Pushes go live within a minute or two.

**Audience:** Kyle, his wife Josephine, and friends. Optimized for mobile (used while grocery shopping and cooking).

**Agent X** (Kyle's personal AI assistant) writes to this repo directly via MCP tools. It publishes the weekly meal plan by writing JSON files — not by editing HTML. A GitHub Actions workflow automatically syncs those files to Firebase on every push.

## File Structure

**Pages:**
- `index.html` — The week view, and now effectively the whole app. Navigate between weeks with
  the chevrons, or flip to the timeline view for every week in one scroll. Includes the grocery
  dock and grocery sheet, the recipe detail overlay and full cooking mode. Reads Firebase
  `/meals/weeks/{weekOf}`. Takes `?week=`, `?view=timeline` and `?groceries=1`.
- `recipes.html` — Browsable recipe collection. Fetches `data/recipes.json` on load.
- `groceries.html` — Retired. A redirect to `index.html?week=…&groceries=1` (the `?week=` param
  is forwarded); kept because it's in the service worker shell and may be bookmarked.
- `journal.html` — Retired. A redirect to `index.html?view=timeline`; kept because it's in the
  service worker shell and may be bookmarked.

**Data:**
- `data/weeks/YYYY-MM-DD.json` — **One file per week. This is what Agent X writes.** Past,
  present and future all live here in the same shape. See schema below.
- `data/recipes.json` — All saved recipes (~45). Agent X can update this as new recipes are added.
  Each carries a `tags` array — see **Recipe Tags** below.
- `recipes.md` — Human-readable master recipe list. Source of truth for Agent X when suggesting meals.
- `data/week.json`, `data/history.json`, `data/history/*.json` — **Frozen legacy.** Kept so
  nothing is lost. Nothing reads them. Do not write them.

**Shared scripts:**
- `recipe-import.js` — turns a recipe URL (or pasted text) into form fields (`window.RecipeImport`).
  No AI and no API credits: it reads the schema.org `Recipe` block sites publish for Google.
  See **Importing a recipe from a link** below. Must load before `recipe-card.js`.
- `icons.js` — the site's line icons: a hand-copied subset of Lucide (ISC), exposed as
  `window.Icon`. Copied rather than loaded from a CDN so the icons survive offline. Must load
  before `nav.js`. Chrome uses these; recipe and grocery-section emoji are still emoji.
- `week-utils.js` — All week math (`window.Week`, and `require`-able from `scripts/`). Weeks run
  **Sunday → Saturday**.
- `week-store.js` — Reading and writing weeks from the browser (`window.WeekStore`). Owns
  `groceryKey()`, the name→checkbox key everything else defers to.
- `grocery-sheet.js` — One week's grocery list, as a card that slides up over the week page
  (`window.GrocerySheet`). Self-contained like `recipe-card.js`: it injects its own styles and
  markup. This is the whole engine that used to be `groceries.html` — sections, checkbox sync,
  hand-added items, Amazon Fresh buttons. See **Grocery Lists** below.

**Scripts & Automation:**
- `scripts/sync-firebase.js` — Syncs `data/weeks/*.json` → `/meals/weeks/*`, and mirrors the
  current week to `/meals/current` for anything still reading it.
- `scripts/generate-groceries.js` — Brings each week's grocery list in line with its meals, doing
  the least work the change needs. Takes `--force` to rebuild from scratch. See **Grocery Lists**.
- `scripts/lib/week-merge.js` — What actually changed about a week (`weekDelta`) and how to apply
  it (`pruneRemoved`, `applyRevisions`, `relabelGroceries`), plus the whole-week reconcile
  (`mergeGroceries`). All pure, all unit-tested.
- `scripts/check-weeks.js`, `scripts/test-week-merge.js`, `scripts/test-week-store.js`,
  `scripts/test-recipe-import.js` — the repo's test suite. All four run in CI before anything is
  written. `test-recipe-import.js` covers the guessing rules; the ones that matter most are the
  tag cases, because recipe method text is full of words that mean something else in a title.
- `recipe-fetcher/` — a separate one-function Vercel deployment that fetches a recipe page so the
  browser can read it. Not part of the site; see its README and **Importing a recipe** below.
- `scripts/fold-legacy-week.js` — Safety net: folds a stray `data/week.json` into `data/weeks/`.
- `scripts/migrate-weeks.js` — The one-time migration. Already run; kept for reference.
- `.github/workflows/sync-to-firebase.yml` — Triggers on push to `data/weeks/**`.

**Other:**
- `cooking-demo.html` — Standalone prototype page. Not part of the main nav.

## Architecture

The HTML pages are render-only shells — they contain no embedded meal or recipe data. All data lives in JSON files under `data/` and is mirrored to Firebase on every push.

**Firebase Realtime Database** (`fox-bear-hub` project) has two purposes:
1. **Grocery checkbox sync** — When Kyle or Josephine checks an item, the other person's screen updates instantly. Stored at `groceries/{weekOf}/{itemName}`.
2. **Meal data** — Every week lives at `/meals/weeks/{weekOf}`. `/meals/current` is a mirror of
   the week containing today, kept only for backward compatibility. `/meals/history` is frozen and
   never written again.

### Two meanings of "week" — don't conflate them

| | |
|---|---|
| **key** | The stored `weekOf`. Keys `/meals/weeks/{key}`, `/groceries/{key}`, `data/weeks/{key}.json`, and every note and photo stamp. **Immutable.** |
| **start** | The canonical **Sunday** for that key. Drives every label and all day→date math. |

The keys we inherited don't all land on Sundays — there are Mondays, a Tuesday and a Thursday in
there, because `weekOf` used to be whatever day the plan was written. Rather than re-key everything
(which would orphan every grocery checkbox and note), the client keeps a `start → key` index.

Two rules that must not be broken:
- **Day→date math computes from `Week.startOf(weekOf)`, never the raw key.**
- **Never mint a key without checking the index first** — `WeekStore.keyOrMint()` returns the
  existing key when a week already exists under a non-Sunday name. Minting blind would create a
  second document for a week that already exists.

`scripts/check-weeks.js` asserts both in CI.

Agent X does not interact with Firebase directly — it writes JSON files to git, and the GitHub Action handles the Firebase sync.

### In-browser meal editing (Edit mode on index.html)

`index.html` has an **Edit mode** that lets Kyle adjust the current week from the phone: remove
meals, add meals from the recipe collection, drag to reorder, set each meal's day, up to **7 meals**.
On **Done** it:
1. Writes the updated week to Firebase via `WeekStore.put` → `/meals/weeks/{weekOf}` (meals update
   instantly), carrying the existing `groceries` array through untouched.
2. Fetches a fine-grained GitHub token from Firebase `/config/githubToken` and commits the same
   object to `data/weeks/{weekOf}.json` via the GitHub Contents API — which triggers the sync
   Action, so the grocery list catches up ~1 min later.

**It never empties `groceries` to force a rebuild.** CI works out what changed and touches only
that. If the set of *recipes* is unchanged — you moved a night, dragged two meals around, added a
placeholder — `save()` knows nothing will change and doesn't sit waiting for it, so you get
"Meals saved." straight away instead of the "grocery list updating…" toast.

The token lives in Firebase under `/config` (read/write restricted to the two allow-listed emails,
same as all meal data); it is scoped to only this repo with Contents read/write. It is **not** in
any committed file. If grocery regeneration ever stops working, check that the token is present and
unexpired at `/config/githubToken`.

### In-browser recipe adding (Add mode on recipes.html)

`recipes.html` has a **"+ Add recipe"** button that opens a blank form (emoji, name, tags, details,
ingredients, steps, tip). On **Save** (`saveNewRecipe` in `recipe-card.js`) it does two things:
1. Saves the recipe to Firebase via the existing `toggleSave` flow — instant, syncs between the two
   accounts, and shows it immediately under the **"Your Recipes"** section.
2. Commits the recipe into `data/recipes.json` via the same GitHub token + Contents API used by meal
   editing (`commitRecipeToCore`), so it becomes a **permanent** recipe Agent X can see and suggest.
   Lands ~1 min later. The Firebase copy is the safe fallback if this commit fails.

New recipes get an `id` that is a slug of the name, with a numeric suffix on collision. This is the
only place outside Agent X that writes `data/recipes.json`.

### Importing a recipe from a link

The add form carries a **paste-a-link bar** at the top. Paste a recipe URL, tap Import, and the
fields below fill in — name, ingredients, steps, time, servings, a guessed emoji and tags, and the
page's photo as the cover. **It only ever prefills the form.** Nothing is written until Kyle taps
Save, so a scrape that comes back slightly wrong is something to tidy, not something to undo.

There is no AI involved and it costs nothing per import. Recipe sites publish a machine-readable
`schema.org/Recipe` block so Google can show them as a rich result, and that block is precisely the
ingredients, steps, time, servings and photo we want. `recipe-import.js` has four readers, tried in
order: **JSON-LD** (what most sites publish), **microdata**, **WP Recipe Maker** and **Tasty
Recipes** (the two WordPress plugins behind a huge slice of food blogs).

**Why there's a Vercel deployment.** The Kitchen is static, so a browser can't fetch another site's
HTML directly, and the free public CORS relays are refused by most recipe sites. `recipe-fetcher/`
is a single serverless function that fetches the page like a browser and hands the HTML back. It
knows nothing about recipes — all parsing stays in `recipe-import.js`, so there is only one parser.
Its URL is the `ENDPOINT` constant at the top of `recipe-import.js`.

If it's ever down the import still works, just less often: `recipe-import.js` falls through to
public relays and then offers a **paste-the-recipe-text** box, which parses ingredients and steps
out of whatever Kyle copies. That box is also the answer for sites that block us — the Dotdash
Meredith family (**Allrecipes, Serious Eats, Simply Recipes**) and **Food Network** refuse
datacenter traffic outright and can't be imported by link.

Imported recipes keep a `source` field — the page they came from — shown as a small link under the
tags. `toCoreRecipe` carries it into `data/recipes.json`.

**Guessing rules worth knowing** (in `recipe-import.js`, tested in `scripts/test-recipe-import.js`):
- Tags are guessed from the **name** first, then a deliberately narrow pass over ingredients and
  method. Ingredients are good evidence of *cuisine* (soy sauce, kalamata) and bad evidence of
  *dish* — "soy sauce" is not a Sauce, "2 eggs" is not Eggs, "chili powder" is not Chili. Only
  Pasta and Noodles are read from an ingredient list.
- Equipment is weight-of-evidence, not first-match, so a bolognese that bakes once still reads
  Stovetop. Appliances (slow cooker, Instant Pot, air fryer) are decisive on a single mention.
- Where nothing fits, a tag is left off rather than guessed — a wrong tag fragments the filter panel.

**Sharing a link into the app.** `recipes.html` opens straight into an import when given
`?import=<url>` (it also accepts the `?url=`/`?text=` a share sheet sends). The manifest declares a
`share_target`, which works on Android and desktop Chrome — **iOS Safari does not implement Web
Share Target** ([WebKit #194593](https://bugs.webkit.org/show_bug.cgi?id=194593)), so on Kyle's
iPhone the share sheet route is an iOS Shortcut that opens
`https://kylescollin.github.io/x-meals/recipes.html?import=<shared url>`.

## Photos & the Cook Log

Every recipe has **one cover photo** plus a **gallery** of photos taken while cooking. All of it is
stored as compressed base64 JPEGs in Realtime Database — there is no Firebase Storage and no billing
dependency.

```
/recipe-photos/<safeId>/src                  cover photo (data URL or remote URL)
/recipe-photos/<safeId>/by, /at              who set the cover, when
/recipe-photos/<safeId>/gallery/<photoKey>   { thumb, full, by, author, at, weekOf, commentKey }
/recipe-comments/<safeId>/<key>              { text, author, email, ts, weekOf?, photos? }
```

`safeId` is `fbSafeKey(idOf(recipe))`. `photoKey` and note `key` are both `<ms timestamp>-<4 random
chars>` — the random suffix stops two simultaneous posts from overwriting each other.

**The gallery lives under `/recipe-photos` on purpose.** That node's security rule already covers all
descendants, so no rules deploy was needed. The consequence: **never `GET /recipe-photos/<safeId>.json`
whole** — it now contains megabytes of gallery photos. Always read a child (`/src.json`,
`/gallery/<key>/thumb.json`), and use `PATCH` rather than `PUT` when writing the cover so the gallery
isn't wiped.

Each photo is stored twice: `thumb` (~360px, ~20 KB) for every list, `full` (~1600px, ~350 KB) fetched
only when the gallery viewer displays it. Both come from a single decode in `prepareCookPhoto`.

**A note is the unit of activity.** Photos always hang off a note (whose text may be empty), so
`/recipe-comments` is the one small feed the Journal reads — a single `GET /recipe-comments.json`
returns every note on the site without any image bytes.

### Week stamping

`weekOf` is what files notes and photos under the right week. It is always the **stored key**,
never the canonical Sunday.

- `RecipeCard.init({weekOf})` sets a page default; `RecipeCard.setWeekOf(key)` moves it when the
  week page navigates. `recipes.html` sets neither.
- `makeCard(r, labelOverride, metaOverride, weekOf)` writes `data-week-of` on the card. The timeline
  view passes each week's own key, so adding a note to a past week's card files it under **that**
  week. This is how a meal gets logged days after it was cooked.
- A note with no `weekOf` (added from the Recipes page) shows on the recipe but never in a week.
- Cards appended after the shared data has loaded — every lazily-loaded timeline week — need
  `RecipeCard.refresh()` or they render with no badges and no activity.

### Behaviour worth preserving

- **The cover is sticky.** Taking cook-log photos never changes it. The only ways to change it are the
  camera button on the hero (Find / Upload / Paste URL) and "Use as cover photo" in the gallery menu.
  If no cover was ever set, the hero and card thumbnail fall back to the newest gallery photo.
- **Tapping the hero opens the gallery** when photos exist, and the add-photo sheet when none do.
- The composer's file input has **no `capture` attribute** — that's what makes iOS offer
  "Take Photo / Photo Library / Choose File" instead of jumping straight to the camera.
- Deleting a note deletes its photos (with a confirm); deleting a photo drops its key from the note.

## Recipe Tags

Every recipe in `data/recipes.json` is categorised by an **ordered `tags` array** — one dish type,
then one cuisine. There is no `label` or `category` field; the vocabulary lives in `TAG_FAMILIES`
at the top of `recipe-card.js` and drives the card eyebrow, the recipe detail view, and the filter
panel on `recipes.html`.

**Type of dish** — Pasta, Noodles, Soup, Chili, Stew, Curry, Tacos, Handheld, Bowl, Rice, Salad,
Stir Fry, Bake, Roast Dinner, Skillet Dinner, Sandwich, Sauce, Eggs

**Cuisine** — Italian, Mexican, American, Asian, Indian, Mediterranean, Middle Eastern, Cajun, French

```json
"tags": ["Pasta", "Italian"]
```

Rules for Agent X when adding a recipe:
- Always set `tags` with exactly one dish type followed by one cuisine, both from the lists above.
  Don't invent new values — a new tag fragments the filter panel. If nothing fits, say so rather
  than guessing.
- Cook time is **not** a tag. It stays as the first segment of `meta`
  (`"30 min · Stovetop · Serves 4"`), which is also what the time and equipment filters parse.
- Weekly meals don't need tags — the site looks them up by recipe `id` from `data/recipes.json`.
  The `"label": "Meal A"` on a weekly meal is only used for grocery tag colors, never as a category.

## Week File Schema

Agent X writes `data/weeks/YYYY-MM-DD.json`, in this exact format. The filename must equal the
`weekOf` field — CI fails otherwise.

`weekOf` should be the **Sunday** the week starts on. (Older files use other weekdays; that's
historical and handled, but don't add to it.)

`title` and `subhead` are stored but no longer displayed — the header is built from the dates.

```json
{
  "weekOf": "YYYY-MM-DD",
  "title": "Week of Month Day",
  "subhead": "3 dinners · Serves 4–8",
  "meals": [
    {
      "id": "recipe-slug",
      "label": "Meal A",
      "day": "Tuesday",
      "date": "4/21",
      "icon": "🌶️",
      "name": "Recipe Name",
      "meta": "~30 min · One pan · Serves 4",
      "ings": ["ingredient 1", "ingredient 2"],
      "steps": ["Step 1", "Step 2"],
      "note": "💡 Optional tip"
    }
  ],
  "groceries": [
    {
      "icon": "🥦",
      "label": "Produce",
      "note": "Optional section note (e.g. for Spices: check pantry first)",
      "items": [
        {
          "name": "Item name",
          "detail": "How it's used — never names the meal; the tag pill says that",
          "tag": "Meal A",
          "tagClass": "tag-chili",
          "amazon": "search term for Amazon Fresh",
          "from": ["recipe-slug"]
        }
      ]
    }
  ]
}
```

**Tag classes:** A week can have 1–7 meals (labels `Meal A` … `Meal G`). Single-meal colors: `tag-chili` (A), `tag-cauliflower` (B), `tag-pasta` (C), `tag-d` (D), `tag-e` (E), `tag-f` (F), `tag-g` (G). Shared across multiple meals: `tag-shared`. All meals: `tag-all`. These control the color of the tag pill. Both `tag` and `tagClass` are computed automatically from each item's `from` by `scripts/lib/week-merge.js` — X doesn't need to set either.

**CI-owned fields.** `groceries`, `groceriesFor` (the meal ids the list covers) and `groceriesAt` are written only by CI. X should leave all three alone — set `"groceries": []` on a brand-new week and omit the other two.

**Amazon button:** Only include `"amazon"` for produce, protein, dairy, and pantry items. Omit it for spices — the sheet falls back to searching the item's own name, so they still get a Fresh button.

**Item subtitles (`detail`):** the tag pill next to every item already says which meal it's for, so `detail` describes only *how* the item is used ("stirred into the slaw"). `relabelGroceries` in `scripts/lib/week-merge.js` strips any meal name that slips through — it's display-only text, never the name a checkbox is keyed by.

**Grocery sections:** Use these five sections in this order: Produce (🥦), Protein (🥩), Dairy & Refrigerated (🧈), Pantry & Canned (🫙), Spices (🌿). The Spices section always includes `"note": "Check pantry before ordering — you likely have most of these."`

### Placeholder meals

A night that isn't a recipe — eating out, leftovers, a friend's place, cooking something off-plan —
is a **placeholder meal**: a name and nothing else. Kyle adds these from the top row of the recipe
picker in Edit mode. They look like this in `meals[]`:

```json
{ "id": "custom-pizza-night-m9x2k1", "custom": true, "icon": "🍽",
  "name": "Pizza night", "meta": "", "ings": [], "steps": [], "day": "Tuesday" }
```

- `id` is `custom-<slug of the name>-<base36 timestamp + random chars>` — unique per placeholder, so each one gets
  its own photo/note bucket and the same name can appear on two nights.
- `custom: true` is what the site keys off. The card renders with a "One-off" eyebrow, no chevron,
  and **no click handler** — there's no recipe to open. It still takes photos and notes in the Journal.
- `scripts/generate-groceries.js` filters these out before calling the API, so they contribute
  nothing to the grocery list. They still take a `label` letter like any other meal.

Agent X should use a placeholder when a night genuinely isn't a recipe, rather than inventing a
recipe entry for it. Never give a placeholder ingredients or steps.

## Agent X Publish Workflow

Publishing a week is now a single file write. There is no archiving step, and no week displaces
another — planning three weeks ahead is just three files.

1. Write `data/weeks/{weekOf}.json` with the meals array fully populated and `"groceries": []`.
2. Commit and push to `main`.

That's it. Don't touch `data/week.json` or `data/history.json` — they are frozen legacy.

**Important — meal IDs:** When a meal comes from the saved recipe collection (`data/recipes.json`), use the **exact `id` value** from that file. The site uses these IDs to detect whether a recipe is already saved, so a mismatch (e.g. `"teriyaki-chicken-tacos"` instead of `"teriyaki-chicken-tacos-with-sesame-cucumber-slaw"`) causes a Save button to incorrectly appear. Always look up the canonical ID in `data/recipes.json` rather than generating one from the name.

The GitHub Action then runs `check-weeks` and the tests, updates the grocery lists, and syncs
every week to Firebase.

## Grocery Lists

### Where the list lives on screen

There is no grocery page any more. Each week page carries a **dock** — a black bar pinned just
above the bottom nav, showing `checked/total` for the week you're looking at. Tapping it slides
the list up as a card (`grocery-sheet.js`), the same gesture as opening a recipe. The dock is
hidden in timeline view and while editing meals.

- The dock's counts come straight from the sheet's own item count via `GrocerySheet.onProgress`,
  so the two can never disagree.
- A week with no list yet reads **"Building your grocery list…"** while CI works; any other week
  with nothing to count reads **"Add groceries"**. Both still open the sheet.
- **An unplanned week can have a grocery list.** Hand-added items live at
  `/groceries/{weekOf}/_custom/{id}` in Firebase, which doesn't require the week document to
  exist. This is how you start a shopping list before picking any meals.

### How the list gets built

X does not write the `groceries` array — `scripts/generate-groceries.js` does, in CI.

It does **the least work the change needs**, never a fresh start. That matters because grocery
check state is keyed by the item's rendered *name*: renaming "3 medium yellow onions" to "2 yellow
onions" silently un-ticks something somebody has already put in the trolley. A line nobody had a
reason to touch is never touched.

Every list records `groceriesFor` — the meal ids it was built for. Comparing that to the week's
current meals gives the delta, and the delta picks one of four paths:

| what changed | what happens |
|---|---|
| **Nothing** — nights swapped, a placeholder added, a meal renamed | No API call. Only the `Meal A…G` letters moved, so `tag` and `tagClass` are recomputed locally from each item's `from`. |
| **A meal left** | Its exclusive items are dropped locally. An item shared with a surviving meal stays, keeps the surviving ids, and only its *quantity* goes to the model. |
| **A meal joined** | Only that meal's ingredients are considered. Something already on the list gets its quantity raised — unless it's ticked off, in which case that line is left alone and a separate line appears for the extra. |
| **No list yet** (a week X just published, or `--force`) | The one case that still generates all five sections at once, so ingredients consolidate across meals. |

- **Anything currently ticked off keeps its exact name**, on every path. It still picks up a
  corrected `detail`, `from` and `tag`.
- Hand-added items (no `from`) are never renamed or dropped.
- `tag` and `tagClass` are display only, always derived from `from` and never trusted from the
  model. That's also what makes the second CI pass provably a no-op — CI re-fires on its own
  commit, so anything less than provable is an infinite loop.
- Lists written before `from` existed can't be diffed, so they're left alone. `--force` rebuilds
  them once; after that they're on the delta path like everything else.

Never commit `"groceries": []` to force a rebuild — that was the old mechanism and it threw away
the check state along with the list. To rebuild deliberately, run the sync workflow from the
Actions tab with **force** ticked.

## Design Conventions

- **Fonts:** Playfair Display (headings) + DM Sans (body) via Google Fonts.
- **Color palette:** Cream background (`#faf7f2`), warm accent orange (`#c8622a`), dark cooking mode background (`#131311`).
- **Style:** Warm, editorial, food-forward. Not a generic app. Keep the visual tone consistent.
- **Mobile-first:** Max content width 680px, touch targets sized for thumbs, swipe gestures in cooking mode.

## Roadmap

See `ROADMAP.md` for what's planned next.
