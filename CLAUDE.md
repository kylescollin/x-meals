# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working with Kyle

- Kyle is not deeply technical. Always explain what you did and why in plain language after taking action.
- Handle technical decisions yourself rather than asking Kyle to choose between options he may not have context for. When you do need his input, give him a single clear instruction — not a list of choices.
- Confirmations before executing are welcome (they help Kyle stay informed), but not required for routine tasks.
- Never leave Kyle with a list of commands to run himself — always offer to execute them, or just run them directly.
- This is a **private, personal tool** for Kyle and his wife. Default to the simplest, most reliable solution. Flag anything that could expose personal data or break the live site.

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

This is **Fox & Bear Kitchen** — a personal meal planning and recipe site for Kyle and his wife. It's a static site (plain HTML, CSS, and JavaScript — no build tools, no frameworks, no npm). Editing a file and pushing is all it takes to update the live site.

**Live site:** Served via GitHub Pages from the `master` branch. Pushes go live within a minute or two.

**Audience:** Kyle and his wife only. Optimized for mobile (used while grocery shopping and cooking).

## File Structure

- `index.html` — The weekly meal plan and grocery list. Gets rewritten each week with new meals and ingredients. Includes a recipe detail overlay and full cooking mode (swipeable, step-by-step).
- `recipes.html` — Browsable recipe collection, pulled from the data in `recipes.md`.
- `recipes.md` — The master recipe list. This is the source of truth for all recipes Kyle has saved (originally imported from Mela). New recipes go here.
- `cooking-demo.html` — A standalone demo/prototype page. Not part of the main nav.

## Current Limitations (Known, Intentional)

These are areas Kyle wants to improve over time — don't "fix" them unless asked:

- **Grocery checkboxes are not persisted.** Checking an item off is local to that browser session. A future goal is shared real-time state so both Kyle and his wife see the same checked items.
- **No meal plan history.** `index.html` gets overwritten each week. A future goal is to archive past weekly plans so Kyle can look back at what he's cooked.
- **Recipes.md is the master list but not yet the live data source.** Recipe data in `recipes.html` and `index.html` is currently embedded inline in the HTML. Longer term, `recipes.md` should be the single source of truth that drives the UI.

## Design Conventions

- **Fonts:** Playfair Display (headings) + DM Sans (body) via Google Fonts.
- **Color palette:** Cream background (`#faf7f2`), warm accent orange (`#c8622a`), dark cooking mode background (`#131311`).
- **Style:** Warm, editorial, food-forward. Not a generic app. Keep the visual tone consistent.
- **Mobile-first:** Max content width 680px, touch targets sized for thumbs, swipe gestures in cooking mode.
