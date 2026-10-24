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
- `explore.html` + `explore.js` — The Explore tab: a photo grid of new recipes pulled in from
  food blogs each morning, with one-tap Save into the collection. Search field and the same
  filter sheet as Recipes (`recipe-filters.js`), opening on dinners only. Reads `data/explore/`
  and Firebase `/explore`. See **Explore feed** below.
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
- `data/explore/sources.json` — The blogs the Explore feed pulls from. One line per blog.
- `data/explore/YYYY-MM.json`, `data/explore/manifest.json` — **CI-owned.** The Explore feed
  itself, one file per month. Written only by `scripts/fetch-explore.js`. See **Explore feed**.
- `data/week.json`, `data/history.json`, `data/history/*.json` — **Frozen legacy.** Kept so
  nothing is lost. Nothing reads them. Do not write them.

**Shared scripts:**
- `recipe-import.js` — turns a recipe URL (or pasted text) into form fields (`window.RecipeImport`).
  No AI and no API credits: it reads the schema.org `Recipe` block sites publish for Google.
  See **Importing a recipe from a link** below. Must load before `recipe-card.js`.
- `icons.js` — the site's line icons: a hand-copied subset of Lucide (ISC), exposed as
  `window.Icon`. Copied rather than loaded from a CDN so the icons survive offline. Must load
  before `nav.js`. Chrome uses these; recipe and grocery-section emoji are still emoji.
- `ingredient-format.js` — The little markup language an ingredient line speaks: `#` headers,
  trailing `(notes)`, fraction glyphs (`window.IngFormat`, and `require`-able from `scripts/`).
  Pure, no DOM. Must load before `recipe-import.js` and `recipe-card.js`. See **Ingredient
  Lines** below.
- `grocery-status.js` — What the browser and CI must agree on about a week's grocery list
  (`window.GroceryStatus`, and `require`-able from `scripts/`). Pure. Whether a list is **owed**
  (`isOwed`), whether it is **behind** its meals (`listBehind`), the per-meal ingredient
  fingerprint, and `groceryPlan` — the one decision that decides whether CI spends a model call.
  Must load after `ingredient-format.js`. See **Grocery Lists**.
- `week-utils.js` — All week math (`window.Week`, and `require`-able from `scripts/`). Weeks run
  **Sunday → Saturday**.
- `week-store.js` — Reading and writing weeks from the browser (`window.WeekStore`). Owns
  `groceryKey()`, the name→checkbox key everything else defers to.
- `grocery-sheet.js` — One week's grocery list, as a card that slides up over the week page
  (`window.GrocerySheet`). Self-contained like `recipe-card.js`: it injects its own styles and
  markup. This is the whole engine that used to be `groceries.html` — sections, checkbox sync,
  hand-added items, the shop buttons and the store switch. See **Grocery Lists** below.
- `recipe-filters.js` — The filter sheet behind the icon button next to the search field on
  **both** the Recipes and Explore tabs (`window.RecipeFilters`, and `require`-able from
  `scripts/`). Self-contained like `grocery-sheet.js`: it injects its own markup and styles. Reads
  dish type and cuisine from `tags`, time and equipment out of `meta`, the protein out of the
  ingredients; each page hands it an ordered list of groups and adds its own (Favorites and
  Cooked on Recipes; Course, Saved and Blog on Explore). See **Filtering** under **Explore feed**.

**Scripts & Automation:**
- `scripts/sync-firebase.js` — Syncs `data/weeks/*.json` → `/meals/weeks/*`, mirrors the
  current week to `/meals/current` for anything still reading it, and rebuilds `/meals/cooked`.
- `scripts/lib/cooked-index.js` — The "last cooked" index: recipe id → every night it was
  planned, newest first, built from the week files. Pure, unit-tested. See **Recipe cards**.
- `scripts/generate-groceries.js` — Builds a week's grocery list **when asked** (the week carries a
  `groceriesRequested` stamp CI hasn't answered yet), doing the least work the change needs. For a
  week that hasn't asked it does only free work. Takes `--force` to rebuild from scratch. See
  **Grocery Lists**.
- `scripts/lib/job-status.js`, `scripts/job-status.js` — The live progress of a build, written to
  Firebase `/grocery-jobs/{weekOf}` for the dock on the phone. Cosmetic and best-effort: nothing
  waits on it and it never fails a run. The CLI marks every owed week `started` or `failed`.
- `scripts/lib/week-merge.js` — What actually changed about a week (`weekDelta`) and how to apply
  it (`pruneRemoved`, `applyRevisions`, `relabelGroceries`), plus the whole-week reconcile
  (`mergeGroceries`) and the per-meal ingredient fingerprint (`ingsFingerprint`) that lets an
  edited recipe register as a delta. All pure, all unit-tested.
- `scripts/refresh-week-meals.js` (and `scripts/lib/refresh-meals.js`) — Refreshes the meal
  snapshots embedded in current/upcoming week files from the recipe collection, so a recipe edit
  reaches the weeks that plan it. Runs in CI just before `generate-groceries.js`. "The recipe
  collection" is `data/recipes.json` **reconciled with the Firebase overlays** first — see
  **Two copies of every recipe** below. Without `FIREBASE_SERVICE_ACCOUNT` (a local run) it reads
  `data/recipes.json` alone. Idempotent either way.
- `scripts/lib/recipe-overlay.js` — The reconcile itself (`reconcileRecipes`): which of the two
  copies of a recipe is newer, and what to write to make them agree. Pure, unit-tested, and the
  second pass over its own output is provably empty.
- `scripts/lib/model-json.js` — Finds the JSON in whatever the model actually said, fences and
  prose included. One reply that began "I'll work through..." took down a whole sync run; this is
  why it can't again.
- `scripts/fetch-explore.js` — Pulls the Explore feed: reads each blog's RSS, turns new posts
  into recipes with `recipe-import.js` (under Node, with `linkedom` as the DOM), writes
  `data/explore/`. Idempotent. Runs daily from `explore-feed.yml`. See **Explore feed**.
- `scripts/check-weeks.js`, `scripts/test-week-merge.js`, `scripts/test-week-store.js`,
  `scripts/test-recipe-import.js`, `scripts/test-ingredient-format.js`,
  `scripts/test-model-json.js`, `scripts/test-refresh-meals.js`,
  `scripts/test-recipe-overlay.js`, `scripts/test-explore-feed.js`,
  `scripts/test-cooked-index.js`, `scripts/test-grocery-status.js`,
  `scripts/test-recipe-filters.js` — the repo's test suite.
  All twelve run in CI before anything is written. `test-grocery-status.js` is the one that stands
  between "Kyle saved a half-planned week" and a model call. `test-recipe-import.js` covers the guessing
  rules; the ones that matter most are the tag cases, because recipe method text is full of
  words that mean something else in a title. `test-ingredient-format.js` leans the other way —
  most of its cases assert the parser does *nothing*, because "2 (14.5 oz) cans" and "1/16 tsp"
  have to come out exactly as they went in.
- `recipe-fetcher/` — a separate one-function Vercel deployment that fetches a recipe page so the
  browser can read it. Not part of the site; see its README and **Importing a recipe** below.
- `scripts/fold-legacy-week.js` — Safety net: folds a stray `data/week.json` into `data/weeks/`.
- `scripts/migrate-weeks.js` — The one-time migration. Already run; kept for reference.
- `.github/workflows/sync-to-firebase.yml` — Triggers on push to `data/weeks/**` and
  `data/recipes.json` (so a recipe edit reaches the weeks that plan it).
- `.github/workflows/tests.yml` — Runs the suite on any push touching `**.js`. Writes nothing.
  The sync workflow only fires on week data, so without this a change to a parser reached the
  live site untested.
- `.github/workflows/explore-feed.yml` — Daily at 6 am Pacific (and from the Actions tab): runs
  `fetch-explore.js` and commits `data/explore/`. No secrets. Its own concurrency group.

**Other:**
- `cooking-demo.html` — Standalone prototype page. Not part of the main nav.

## Architecture

The HTML pages are render-only shells — they contain no embedded meal or recipe data. All data lives in JSON files under `data/` and is mirrored to Firebase on every push.

**Firebase Realtime Database** (`fox-bear-hub` project) has two purposes:
1. **Grocery checkbox sync** — When Kyle or Josephine checks an item, the other person's screen updates instantly. Stored at `groceries/{weekOf}/{itemName}`.
2. **Meal data** — Every week lives at `/meals/weeks/{weekOf}`. `/meals/current` is a mirror of
   the week containing today, kept only for backward compatibility. `/meals/history` is frozen and
   never written again. `/meals/cooked` is a derived index (see **Recipe cards**), CI-written.
3. **Favorites** — `/favorites/{safeId} = true`, shared by both accounts, written one key at a
   time from the star in the recipe detail view.
4. **Grocery job progress** — `/grocery-jobs/{weekOf} = {stage, at}`, written by the phone
   (`requested`) and then by CI (`started` → `generating` → `built` → `done`, or `failed`). Purely
   for the progress bar; "done" is never decided from it. See **Grocery Lists**.

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
1. Re-reads the week from Firebase, so the `groceries` it carries through is the current one.
   **CI writes groceries without touching `updatedAt`**, so the conflict check can't see a list that
   landed while the page sat open — and writing a stale copy back would wipe the list and every tick
   on it. That re-read also catches a genuine conflict (someone editing on the other phone) earlier
   than `WeekStore.put` would.
2. Writes the updated week to Firebase via `WeekStore.put` → `/meals/weeks/{weekOf}` (meals update
   instantly), carrying that `groceries` array through untouched.
3. Fetches a fine-grained GitHub token from Firebase `/config/githubToken` and commits the same
   object to `data/weeks/{weekOf}.json` via the GitHub Contents API, so Agent X and CI see it.

**Saving never builds a grocery list.** That was the old behaviour, and it made Kyle reluctant to
save a half-planned week because every save spent a model call. The list is built from the
**Build list / Update list** pill on the grocery dock (and the same button inside the sheet) —
see **Asking for the list** under **Grocery Lists**. `save()` carries every grocery field through
untouched, including the two request stamps. **It never empties `groceries` to force a rebuild.**

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

New recipes get an `id` that is a slug of the name, with a numeric suffix on collision.

### Deleting a recipe (⋯ menu in the detail view)

**Delete recipe** sits under Edit in the ⋯ menu, for any recipe that is in the collection or
saved — never in the Explore preview. `deleteRecipe` in `recipe-card.js` does the git copy
first (`removeRecipeFromCore`: a read-modify-write of `data/recipes.json` through the GitHub
token, same as the commit-on-edit), so a failed commit leaves everything as it was and alerts.
Only then does it clear every Firebase node that names the recipe: the `/saved-recipes` flag
and `/saved-recipe-data` copy, the `/recipe-edits` overlay, `/favorites`, and any
`/explore/saved` entry pointing at the id. **Notes and photos are kept on purpose** — past
weeks still carry their snapshot of the meal, and the Journal reads those buckets by id.
A week that plans the recipe is untouched too: CI leaves meal ids it can't find in the
collection alone. `onDelete(id)` tells the page; `recipes.html` drops the card and rebuilds
the filter panel, and the week page needs nothing.

### Two copies of every recipe — and how they're kept in step

Every recipe lives twice:

| copy | where | who reads it |
|---|---|---|
| **collection** | `data/recipes.json` | Agent X, and CI when it refreshes week snapshots and builds grocery lists |
| **overlay** | Firebase `/recipe-edits/<id>` | The site — every card, the detail view, and the week page's recipe picker apply it over the collection |

An in-app edit (`saveRecipeEdit` in `recipe-card.js`) writes the overlay instantly and then
commits the same recipe into `data/recipes.json` through the GitHub token. The overlay stores
exactly a `recipes.json` entry plus two stamps: `editedAt` (when the phone saved it) and
`committedAt` (set once the commit landed). **Until the stamps match, the edit is pending and
the grocery list cannot see it** — so a failed commit alerts, and pending edits are retried
quietly the next time either phone opens the app (`flushPendingEdits`).

CI closes the loop from both directions in `refresh-week-meals.js`, before it touches any week:
- a **pending** overlay is folded into `data/recipes.json` (and committed with the grocery lists);
- a **committed** overlay that differs from the collection means the collection moved since — a git
  edit by Agent X or a Claude session — so the overlay is rewritten from the collection.

The overlay writes wait in a file until the commit step has actually landed (`COMMIT_LANDED` in
the workflow), because stamping an overlay "committed" for a commit that got rejected would make
the next run think the collection was newer and revert the phone's edit.

This exists because the coconut curry salmon was edited on a phone before the commit-on-edit
existed (June 2026); the overlay said two cans, `recipes.json` said one, and when the week was
planned in September the refresh step "corrected" the week back to one can and shopped for it.

Rules that follow:
- **Editing `data/recipes.json` in git is fine** — CI mirrors the change into the overlay on its
  next run. There's no need to touch Firebase by hand.
- Never write `/recipe-edits` with week fields (`label`, `day`, `date`) or without stamps.
  `toCore` in `scripts/lib/recipe-overlay.js` and `toCoreRecipe` in `recipe-card.js` are the
  same shape on purpose; the two are compared through it, so they must stay identical.
- Ticked grocery lines are still never renamed (see **Grocery Lists**). A recipe edit that changes
  a quantity someone has already ticked shows up as new lines, not a rewritten one.

### Importing a recipe from a link

The add form carries a **paste-a-link bar** at the top. Paste a recipe URL, tap Import, and the
fields below fill in — name, ingredients, steps, time, servings, a guessed emoji and tags, and the
page's photo as the cover. **It only ever prefills the form.** Nothing is written until Kyle taps
Save, so a scrape that comes back slightly wrong is something to tidy, not something to undo.

There is no AI involved and it costs nothing per import. Recipe sites publish a machine-readable
`schema.org/Recipe` block so Google can show them as a rich result, and that block is precisely the
ingredients, steps, time, servings and photo we want. `recipe-import.js` has five readers, tried in
order: **JSON-LD** (what most sites publish), **microdata**, **WP Recipe Maker**, **Tasty
Recipes** (the two WordPress plugins behind a huge slice of food blogs) and **Jetpack** (WordPress
.com's own block — Smitten Kitchen). The first reader with both ingredients and steps wins; short
of that, a later reader fills what an earlier one missed, because Smitten Kitchen's microdata has
the ingredients and time and only its Jetpack markup has the steps. The same parser runs in CI for
the Explore feed, so a reader added here reaches both.

**Why there's a Vercel deployment.** The Kitchen is static, so a browser can't fetch another site's
HTML directly, and the free public CORS relays are refused by most recipe sites. `recipe-fetcher/`
is a single serverless function that fetches the page like a browser and hands the HTML back. It
knows nothing about recipes — all parsing stays in `recipe-import.js`, so there is only one parser.
Its URL is the `ENDPOINT` constant at the top of `recipe-import.js`.

If it's ever down the import still works, just less often: `recipe-import.js` falls through to
public relays and then offers a **paste-the-recipe-text** box, which parses ingredients and steps
out of whatever Kyle copies. That box is also the answer for sites that block us — the Dotdash
Meredith family (**Allrecipes, Serious Eats, Simply Recipes**) and **Food Network** refuse
datacenter traffic outright and can't be imported by link. So do Cookie and Kate, Gimme Some
Oven, Two Peas & Their Pod, Half Baked Harvest and The Woks of Life (checked October 2026).

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

## Explore feed

A Pinterest-style grid of new recipes pulled from food blogs, on its own tab (`explore.html`). The
feed is **static JSON written by CI** and read straight from GitHub Pages; Firebase holds only what
the two of you do with it.

### How it's built

`scripts/fetch-explore.js` runs every morning from `.github/workflows/explore-feed.yml`. The blog
list is `data/explore/sources.json` — adding or removing a blog is one line there. For each feed it
reads every post, skips URLs it has already seen, and turns each new one into a recipe with the
**same parser the import button uses** (`recipe-import.js`, under Node with `linkedom` standing in
for `DOMParser`). Four attempts, in order, stopping at the first that yields ingredients *and*
steps:

1. **the feed body** — Budget Bytes, RecipeTin, Damn Delicious, Well Plated, Pinch of Yum and The
   Mediterranean Dish embed their whole recipe card in the feed, so the page is never fetched and
   can't block us;
2. the page, fetched directly;
3. the page, through the `recipe-fetcher` deployment;
4. none of those — the item is recorded with `recipe:false`, retried on the next two runs (a blog
   can have a bad day), then left alone for good. **The site never shows these.** Nearly all are
   roundups and meal plans, which were never recipes.

A blog whose pages refuse datacenter traffic *and* whose feed carries only a summary can't be read
at all, which is why the five named under **Importing a recipe** aren't in the list.

### Where it lives

```
data/explore/sources.json      the blogs
data/explore/YYYY-MM.json      one file per month (by publish date), items newest first
data/explore/manifest.json     months + per-month counts of readable recipes; the page reads this first
```

An item carries `key` (12 hex chars of the canonical URL — Firebase-safe), `id` (`explore-<key>`,
so it can never collide with a real recipe id), `url`, `site`, `sourceId`, `published`, `fetched`,
`image` and — when readable — a `course` (below) and the `recipes.json` fields (`name`, `icon`,
`tags`, `meta`, `ingredients`, `steps`, `note`, `source`), so it can be handed to
`RecipeCard.openDetail` and to `RecipeCard.saveRecipe` as is. Photos are links to the blog's own
image, never copied. `course` is never saved into the collection.

### Dinners first

The tab is for dinners, and the blogs post plenty that isn't: cakes, muffins, side salads, drinks.
Every readable item gets a `course` — `dinner`, `breakfast`, `dessert`, `drink`, `side` or
`other` — and the filter sheet opens with **Dinners** picked in its Course group, so the grid
shows only dinners until Kyle picks another course (see **Filtering** below). Nothing is
deleted; the manifest carries a `dinners` count per month beside `counts`.

No AI decides this. `courseOf` in `fetch-explore.js` reads three things the blog already
published, each on its own and in order of trust: the recipe card's **Course** line ("Dessert",
"Main Course" — `recipe-import.js` returns it as `category` from JSON-LD `recipeCategory`, the
WPRM/Tasty course span or microdata); the post's **categories** in the feed ("Dessert Recipes",
"Breakfast and Brunch", "Cake"); and last the **name** (cookies, blondies, lemonade). A "dinner"
word anywhere in a label wins outright, and when nothing matches the answer is `dinner` — a
wrong "dinner" costs one swipe, a wrong "dessert" hides a meal. Budget Bytes lists every
ingredient as a category, so phrases like "Baking Powder" and "Puff Pastry" are struck before
matching, and so are "Crab Cakes", "Pot Pie" and "Sweet Potato". The cases live in
`scripts/test-explore-feed.js`; add one there before touching the word lists.

Items written before this existed are labelled on the next run — from the feed while the post is
still in it, from the name alone once it has dropped out — and an item with no `course` counts as
a dinner on the page, so an older month file is never wrong, only less sorted.

### Filtering

The search field and the icon button beside it are the Recipes tab's, and the sheet behind the
button is the same engine (`recipe-filters.js`) — there is no chip row any more. The groups, in
order: **Course** (one chip per course, **Dinners picked by default**), **Saved** (Not saved yet /
Saved), **Blog** (one chip per entry in `sources.json`), then Type of dish, Cuisine, Total time,
How it cooks and Main protein, read from each item's `tags`, `meta` and ingredients exactly as the
Recipes page reads them. A group sitting on its defaults counts as no filter, so the button's badge
reads 0 with only Dinners picked; un-ticking Dinners shows every course. **Clear all** returns to
Dinners, not to nothing. Opening the sheet, searching, or picking anything loads every month first
so the chip counts are complete (the feed is a handful of small files). Blog recipes often carry
no time ("Oven · Serves 12"), so `parseMethods` finds the method wherever it sits — that is the
one way the shared parser differs from what `recipes.html` used to do inline.

```
/explore/hidden/<key>  = <ms>            "Not for us" — gone from both phones
/explore/saved/<key>   = "<recipe id>"   saved into the collection
```

### Saving

Tapping a tile opens the normal recipe view in its **external** mode
(`openDetail(r, null, {external:true, onSave, onHide})`): the feed photo as the hero, no ⋯ menu, no
notes, no photo bucket — nothing may write under `explore-<key>` — and a Save bar in place of the
Cook pill. Save calls `RecipeCard.saveRecipe`, which is the add form's own path factored out:
minted id, Firebase, cover from `image`, commit to `data/recipes.json` through the GitHub token.
The recipe gets a third tag, **`Explore`**, so the Recipes filter panel can show or hide them
under **Found via**.

`Explore` belongs to a tag family with `picker:false`: it has no dropdown in the add/edit form, and
`keptTags()` carries it through an in-app edit untouched. Agent X should keep it when editing such
a recipe and never add it itself.

### Rules that follow
- The run is idempotent: nothing new → no file changes → nothing to commit. `manifest.updatedAt` is
  deliberately left out of the comparison so it can't produce a commit on its own.
- Only `data/explore/**` is ever written, and only by this workflow, so it has its own concurrency
  group and no `continue-on-error`: a failed push goes red and tries again tomorrow. `GITHUB_TOKEN`
  pushes trigger no other workflow and the sync workflow's path filter excludes `data/explore`.
- Be a polite guest: one page a second, and each post read at most three times, ever. Labelling
  an older item never fetches a page.

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
- `makeCard(r, weekOf)` writes `data-week-of` on the card. The timeline
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

## Recipe cards

A card (`RecipeCard.makeCard` in `recipe-card.js`) is deliberately quiet: the thumbnail, the
name, and one small line under it — **"Last cooked Sep 14"** (with the year once it isn't this
year), or nothing at all if the recipe never has been. No tags, no cook time, no chevron, and on
the week page no day either; the day lives in Edit mode's slots. A **favorite** shows a gold
star just ahead of the name.

- **The detail view's hero subtitle** is the meta minus its cooking method ("30 min · Serves 4";
  `heroMeta` drops the second segment unless it's the servings, the same reading as
  `parseMethods` in `recipes.html`). Under it, a second line: "Last cooked Sep 15 · Cooked 3
  times in the last 6 months" (once / twice / "Not cooked in the last 6 months"); nothing when
  never cooked, and never in the Explore preview.
- **Favorites** are toggled from the star in the top-right of the detail view, beside the ⋯ menu.
  They're shared between the two accounts and live at `/favorites/{safeId}`; the star is hidden in
  the Explore preview, which may write nothing. The Recipes filter panel opens with a
  **Favorites** chip and a **Cooked in the last 6 months** group (Never / Once / Twice / 3 times /
  4+ times); both read the same `isFavorite` / `cookedRecentCount` the cards and detail view use,
  exposed on `window.RecipeCard`. (There is no longer a "Saved by us" toggle.)
- **"Last cooked"** comes from `/meals/cooked` — `{safeId: ["YYYY-MM-DD", …]}`, newest first —
  which `scripts/sync-firebase.js` rebuilds from the week files on every run via
  `scripts/lib/cooked-index.js`. A night's date is `Week.startOf(weekOf)` + the meal's day (the
  canonical Sunday, never the raw key); a meal with no day falls back to that Sunday. The index
  **includes nights still ahead**; the browser shows the newest one *before today*, so a planned
  meal turns into a cooked one as the days pass without a CI run. A skipped meal still counts —
  there's no better signal. Placeholder meals are left out.
- Because the index is CI-written, an in-app week edit reaches it about a minute later, like the
  grocery list. A `.js`-only push doesn't run the sync workflow; dispatch it from the Actions tab
  if the index ever needs rebuilding by hand.
- `RecipeCard.applyBadges()` and `RecipeCard.refresh()` repaint stars and cooked lines along with
  the saved badges, so cards appended after load (timeline weeks) just need the same call.

## Recipe Tags

Every recipe in `data/recipes.json` is categorised by an **ordered `tags` array** — one dish type,
then one cuisine, and (only on recipes saved from the Explore tab) a trailing `Explore`. There is no `label` or `category` field; the vocabulary lives in `TAG_FAMILIES`
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
- A third tag `Explore` marks a recipe saved from the Explore feed (family **Found via**). Keep it
  when editing such a recipe; never add it yourself.
- Cook time is **not** a tag. It stays as the first segment of `meta`
  (`"30 min · Stovetop · Serves 4"`), which is also what the time and equipment filters parse.
- Weekly meals don't need tags — the site looks them up by recipe `id` from `data/recipes.json`.
  The `"label": "Meal A"` on a weekly meal is only used for grocery tag colors, never as a category.

## Ingredient Lines

An ingredient list is still a flat array of strings — that never changed, and it's what keeps
every line round-tripping through the plain textarea in the add/edit form. Three conventions
give it structure. `ingredient-format.js` is the only parser, shared by the browser and the CI
scripts, and `scripts/test-ingredient-format.js` covers it.

| Written as | Renders as |
|---|---|
| `"# For the fish"` | A **section header** — bold, no bullet, in both the recipe view and cooking mode. |
| `"1 tsp cayenne (or more)"` | *or more* in grey italic. The parentheses are **dropped**. |
| `"2 eggs ((room temp))"` | *(room temp)* in grey italic, with one set of parens kept. |
| `"2 (14.5 oz) cans tomatoes"` | Unchanged. **Only a trailing parenthetical is a note** — mid-line parens are left exactly as written, because dozens of real lines use them for can sizes. |
| `"1 ½ lb tilapia"` | Fractions are stored as glyphs (`½ ⅓ ⅔ ¼ ¾ ⅛ ⅜ ⅝ ⅞`). The editor converts `1/2` as you type and imports are converted on the way in — write the glyph directly. |

Rules for Agent X:
- Use `#` for a group ("# For the sauce") instead of a bare `"Sauce:"` line. A bare label is
  indistinguishable from a quantity-less ingredient like `"Salt and pepper"`, so it renders as
  a bulleted ingredient and reads as one everywhere else.
- **`#` lines never reach the grocery generator.** `cookableMeals` in
  `scripts/generate-groceries.js` strips them before the meals are serialised into the prompt,
  the same way it already drops placeholder meals. They're also kept out of the recipe search
  index and the meal-picker haystack.
- The quantity goes at the front of the line as always — the renderer bolds it by pulling the
  leading measurement off. A line with no measurement (`"Salt and pepper"`) renders plain.

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
          "amazon": "plain search term, used for every store",
          "from": ["recipe-slug"]
        }
      ]
    }
  ]
}
```

**Tag classes:** A week can have 1–7 meals (labels `Meal A` … `Meal G`). Single-meal colors: `tag-chili` (A), `tag-cauliflower` (B), `tag-pasta` (C), `tag-d` (D), `tag-e` (E), `tag-f` (F), `tag-g` (G). Shared across multiple meals: `tag-shared`. All meals: `tag-all`. These control the color of the tag pill. Both `tag` and `tagClass` are computed automatically from each item's `from` by `scripts/lib/week-merge.js` — X doesn't need to set either.

**CI-owned fields.** `groceries`, `groceriesFor` (the meal ids the list covers), `groceriesIngs` (a fingerprint of each meal's ingredients as the list last saw them — how a recipe edit gets noticed), `groceriesAt` and `groceriesServed` are written only by CI. X should leave all five alone — set `"groceries": []` on a brand-new week and omit the other four.

**The one stamp X may write: `groceriesRequested`.** An ISO timestamp. A list is **owed** while it
differs from `groceriesServed`, and CI builds a list only for an owed week. Set it on a new week to
have the list built at publish time; leave it out to let Kyle ask from the dock when he's ready to
shop. Never write `groceriesServed`, and never copy an old `groceriesRequested` onto a new week.

**Shop button:** Only include `"amazon"` for produce, protein, dairy, and pantry items. Omit it for spices — the sheet falls back to searching the item's own name, so they still get a shop button. The field is still called `amazon` for history's sake, but it is a plain search term and the sheet sends it to whichever store is chosen (see **Where the list lives on screen**).

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
   Add `"groceriesRequested": "<ISO timestamp, now>"` **only if** the list should be built right
   away; otherwise Kyle builds it from the dock. See **Week File Schema**.
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
- The right-hand side is either the `checked/total` count or an **action pill**: **Build list**
  when the week has cookable meals and no list, **Update list** when the meals have moved on since
  the list was built (title: "List is behind your meals"), **Retry** when a build failed or has
  taken more than five minutes. A week with nothing cookable reads **"Add groceries"**. Tapping the
  pill asks for the list; tapping anywhere else opens the sheet.
- While a list is being built the dock shows the job's progress instead — a message per stage and
  a percentage, with the track in the accent colour. See **Asking for the list**.
- **An unplanned week can have a grocery list.** Hand-added items live at
  `/groceries/{weekOf}/_custom/{id}` in Firebase, which doesn't require the week document to
  exist. This is how you start a shopping list before picking any meals.
- **Every item has a shop button, and a chip row under the progress bar picks the store:**
  Amazon Grocery (the default — Amazon retired the Fresh name for it in late 2025), Amazon
  Fresh, Target or Safeway. The choice is saved per phone in `localStorage` under
  `fbk-grocery-store`, deliberately not synced, so Kyle and Josephine can shop different
  stores. Switching rewrites the buttons in place; the list and its ticks are untouched. The
  store table is `STORES` at the top of `grocery-sheet.js` — adding a store is one entry there.

### Asking for the list

Saving meals never builds a list. The **Build list / Update list** pill does. `requestGroceries()`
in `index.html`:

1. Re-reads the week, stamps it `groceriesRequested = now`, writes it to Firebase via
   `WeekStore.put` — so both phones see the week as owed at once — and writes
   `/grocery-jobs/{weekOf} = {stage:'requested'}`.
2. Commits the week file through the GitHub token. The push runs the sync workflow; CI sees the
   stamp, builds (or revises) the list, copies the stamp into `groceriesServed`, commits and syncs.
   If the commit fails, the stamp is taken back and nothing is owed.

**A list is owed while `groceriesRequested !== groceriesServed`.** That pair, on the week document,
is the only truth about whether a build is pending. It is clock-skew-proof (CI copies the value, it
never compares times), it survives a reload on either phone with nothing stored, and a phone that
edits the week mid-build carries both stamps through (`save()`), so the request is never lost.

**Progress is cosmetic.** `/grocery-jobs/{weekOf}` goes `requested` → `started` (right after
`npm install`) → `generating` (before the model call) → `built` (file written) → `done` (list in
Firebase), or `failed`. The dock polls it every 3 s while the week is owed and paints a bar from a
per-stage estimate (`STAGES` in `index.html`: where the bar sits when a stage begins and how long
it usually lasts), creeping by wall-clock time since the stage's own `at` stamp — iOS freezes
timers when the app is backgrounded, and a frozen timer can't desync a clock. The bar never
reaches the next stage's floor on its own.

**"Done" is never read from the job node.** Every ~20 s — and every 6 s once the job says `built`
— the watcher re-reads the week document (`WeekStore.get(key, true)`); the list has landed when
the fresh copy is no longer owed. So a missed status write, undeployed rules, or a run that died
before `started` all degrade to "the bar creeps and the week re-read still resolves it". After
five minutes owed the dock reads "Taking longer than usual" with a **Retry** pill; Retry re-reads
first and only re-requests if the list genuinely hasn't come. `failed` shows Retry at once.

Three things follow:

- **`GrocerySheet` and `WeekStore` never refresh themselves.** The sheet renders from the
  `weekData` it was handed and only paints what `setJob` / `setStatus` tell it; its own 8 s poll
  reads only `/groceries/{key}` — the ticks and hand-added items. `WeekStore.get` caches per key
  for the whole session. A CI-written list reaches the screen **only** via `WeekStore.get(key, true)`.
- **That forced re-read runs at every moment the list could have landed while we weren't looking:**
  `visibilitychange`, tapping the dock, navigating to a week whose cached copy is owed, and the
  watcher's own ticks.
- **A message about a week lives on that week.** There is no app-level pill or per-save timer; the
  dock reads the week on screen and nothing else.

`toast()` has no `persist` option, deliberately. Every toast clears itself.

### What the dock means by "behind"

`GroceryStatus.listBehind(week, cookableMeals)`: the stored `groceriesFor` isn't exactly the
current set of cookable meal ids, or a stored ingredient fingerprint differs from the meal's
current one. The fingerprint is versioned (`"1:…"`); one from the older SHA-1 format reads as
*unknown*, never as *changed*, and CI backfills it for free. Past weeks are never judged.

### How the list gets built

X does not write the `groceries` array — `scripts/generate-groceries.js` does, in CI, and **only
for a week that is owed a list** (see **Asking for the list**). The decision is `groceryPlan` in
`grocery-status.js`, unit-tested in `scripts/test-grocery-status.js`:

| week is… | meals vs. list | CI does |
|---|---|---|
| not owed | nothing changed | `relabel` — the Meal A…G letters, locally. Free. |
| not owed | a meal joined/left, or a recipe was edited | `skip` — the file is left byte-for-byte alone, so the dock can say the list is behind. Free. |
| owed | no list yet, or a legacy list | `build` — the whole week. One model call. |
| owed | a meal joined/left, or a recipe was edited | `revise` — one scoped call. |
| owed | nothing changed | `serve` — just copy the stamp. Free. |
| `--force` | anything | `build`. |

Every served week gets `groceriesServed = groceriesRequested` and a fresh `groceriesAt`.
**Recipe edits no longer revise lists on their own** — the refresh step still carries the edit
into the week snapshot, so the fingerprint moves and the dock says the list is behind.

Once asked, it does **the least work the change needs**, never a fresh start. That matters because grocery
check state is keyed by the item's rendered *name*: renaming "3 medium yellow onions" to "2 yellow
onions" silently un-ticks something somebody has already put in the trolley. A line nobody had a
reason to touch is never touched.

Every list records `groceriesFor` — the meal ids it was built for — and `groceriesIngs`, a
fingerprint of each meal's ingredients as the list last saw them. Comparing those to the week's
current meals gives the delta, and the delta picks one of five paths:

| what changed | what happens |
|---|---|
| **Nothing** — nights swapped, a placeholder added, a meal renamed | No API call. Only the `Meal A…G` letters moved, so `tag` and `tagClass` are recomputed locally from each item's `from`. |
| **A meal left** | Its exclusive items are dropped locally. An item shared with a surviving meal stays, keeps the surviving ids, and only its *quantity* goes to the model. |
| **A meal joined** | Only that meal's ingredients are considered. Something already on the list gets its quantity raised — unless it's ticked off, in which case that line is left alone and a separate line appears for the extra. |
| **A recipe was edited** — same meals, different ingredients | The CI refresh step (`refresh-week-meals.js`) has already carried the edit into the week's snapshot, so the fingerprint no longer matches. One scoped call: new ingredients are added, unticked lines are corrected, and a line whose ingredient left the recipe is removed — but only if it's unticked, CI-owned, and needed by no other meal. Ticked lines are never touched, even stale ones. |
| **No list yet** (a week X just published, or `--force`) | The one case that still generates all five sections at once, so ingredients consolidate across meals. |

Those five paths describe what happens *once asked*; a week nobody has asked about gets only the
free rows of the table above.

- **Anything currently ticked off keeps its exact name**, on every path. It still picks up a
  corrected `detail`, `from` and `tag`.
- Hand-added items (no `from`) are never renamed or dropped.
- `tag` and `tagClass` are display only, always derived from `from` and never trusted from the
  model. That's also what makes the second CI pass provably a no-op — CI re-fires on its own
  commit, so anything less than provable is an infinite loop.
- Lists written before `from` existed can't be diffed, so they're left alone. `--force` rebuilds
  them once; after that they're on the delta path like everything else.
- **Only the current week and the ones ahead of it are ever touched.** Rebuilding the list for a week
  that has already been shopped for and cooked helps nobody. The dock never offers Build / Update
  on a past week, and a `groceriesRequested` on one is simply never served.

Never commit `"groceries": []` to force a rebuild — that was the old mechanism and it threw away
the check state along with the list. To rebuild deliberately, run the sync workflow from the
Actions tab with **force** ticked.

### The Action runs one at a time

`sync-to-firebase.yml` has a `concurrency: sync-meals` group with `cancel-in-progress: false`, so two
saves a minute apart queue instead of racing. It matters because of the step order: **the Firebase
sync runs after the commit**, so a rejected `git push` used to fail the job and take that run's
freshly built list with it. Three defences now, in order — the queue makes the collision rare, the
commit step rebases and retries, and it is `continue-on-error` so the site gets the list even when
git won't take it. A final step then fails the run loudly, because git is the source of truth the
next run reads from and a commit that never landed must not look green.

The checkout uses `ref: main`, not the push that triggered the run: a run that queued behind
another starts from the tip as it is *now*, including that run's "Update grocery lists" commit, so
it doesn't rebuild a week that was just built and then collide with it on push. Only one run can
wait in the queue — GitHub drops older pending runs in a group — which is fine, because the
request lives in the week file and the surviving run serves it.

**Known edge, accepted:** a request or save that lands while a run is mid-build can cost one extra
model call (the next run sees the stamps still differ and builds again). The stamps make it
converge; it never loses a list.

## Design Conventions

- **Fonts:** Playfair Display (headings) + DM Sans (body) via Google Fonts.
- **Color palette:** Cream background (`#faf7f2`), warm accent orange (`#c8622a`), dark cooking mode background (`#131311`).
- **Style:** Warm, editorial, food-forward. Not a generic app. Keep the visual tone consistent.
- **Mobile-first:** Max content width 680px, touch targets sized for thumbs, swipe gestures in cooking mode.

## Roadmap

See `ROADMAP.md` for what's planned next.
