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
- `index.html` — This week's grocery list and meal plan. Fetches from Firebase `/meals/current` on load. Includes recipe detail overlay and full cooking mode.
- `recipes.html` — Browsable recipe collection. Fetches `data/recipes.json` on load.
- `journal.html` — Chronological meal history. Fetches from Firebase `/meals/current` (current week) + `/meals/history` (past weeks) on load.

**Data:**
- `data/week.json` — Current week's full data. Agent X writes this each week. See schema below.
- `data/recipes.json` — All saved recipes (~37). Agent X can update this as new recipes are added.
- `data/history.json` — Array of all past weeks, newest first. Agent X prepends to this each week before writing a new `week.json`. Used as backfill source for Firebase history.
- `data/history/YYYY-MM-DD.json` — Individual per-week archive files (backup copies).
- `recipes.md` — Human-readable master recipe list. Source of truth for Agent X when suggesting meals.

**Scripts & Automation:**
- `scripts/sync-firebase.js` — Syncs `data/week.json` and `data/history.json` to Firebase. Archives the old week automatically when a new one is published.
- `scripts/package.json` — `firebase-admin` dependency for the sync script.
- `.github/workflows/sync-to-firebase.yml` — GitHub Actions workflow. Triggers automatically on push when `data/week.json` or `data/history.json` changes.

**Other:**
- `cooking-demo.html` — Standalone prototype page. Not part of the main nav.

## Architecture

The HTML pages are render-only shells — they contain no embedded meal or recipe data. All data lives in JSON files under `data/` and is mirrored to Firebase on every push.

**Firebase Realtime Database** (`fox-bear-hub` project) has two purposes:
1. **Grocery checkbox sync** — When Kyle or Josephine checks an item, the other person's screen updates instantly. Stored at `groceries/{weekOf}/{itemName}`.
2. **Meal data** — Current week and history are stored at `/meals/current` and `/meals/history/{weekOf}`. `index.html` and `journal.html` read from these nodes. The sync script keeps them up to date automatically.

Agent X does not interact with Firebase directly — it writes JSON files to git, and the GitHub Action handles the Firebase sync.

## data/week.json Schema

Agent X must write `data/week.json` in this exact format each week:

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
          "detail": "Which meal(s) it's for",
          "tag": "Meal A",
          "tagClass": "tag-chili",
          "amazon": "search term for Amazon Fresh"
        }
      ]
    }
  ]
}
```

**Tag classes:** `tag-chili` (Meal A), `tag-cauliflower` (Meal B), `tag-pasta` (Meal C), `tag-shared` (multiple meals), `tag-all` (all meals). These control the color of the tag pill. Update the tag name and class to match the actual meals for the week.

**Amazon button:** Only include `"amazon"` for produce, protein, dairy, and pantry items. Omit it for spices — those don't get an Amazon button.

**Grocery sections:** Use these five sections in this order: Produce (🥦), Protein (🥩), Dairy & Refrigerated (🧈), Pantry & Canned (🫙), Spices (🌿). The Spices section always includes `"note": "Check pantry before ordering — you likely have most of these."`

## Agent X Publish Workflow

Each week when publishing a new meal plan:

1. Prepend the current `data/week.json` content to `data/history.json` (keeps history current)
2. Write the new `data/week.json` with the meals array fully populated and `"groceries": []` (empty — the GitHub Action generates groceries automatically)
3. Commit and push to `main`

The GitHub Action runs automatically and:
- Detects the empty `groceries` array and calls the Claude API to generate the complete grocery list
- Commits the updated `week.json` (with groceries) back to the repo
- Archives the old week from Firebase `/meals/current` → `/meals/history/{weekOf}`
- Writes the new week (meals + groceries) to `/meals/current`
- Backfills any history entries not yet in Firebase

**Note:** X does not generate the groceries array. That is handled automatically by `scripts/generate-groceries.js` in the GitHub Action using `ANTHROPIC_API_KEY`. If groceries are already present in `week.json`, the generation step is skipped.

## Design Conventions

- **Fonts:** Playfair Display (headings) + DM Sans (body) via Google Fonts.
- **Color palette:** Cream background (`#faf7f2`), warm accent orange (`#c8622a`), dark cooking mode background (`#131311`).
- **Style:** Warm, editorial, food-forward. Not a generic app. Keep the visual tone consistent.
- **Mobile-first:** Max content width 680px, touch targets sized for thumbs, swipe gestures in cooking mode.

## Roadmap

See `ROADMAP.md` for what's planned next.
