# Backlog: x-meals

Filed by Dev Inbox. Status goes `new` (open questions) → `ready` → `planned` → `done`.

## Inbox

_Empty — everything captured on 2026-11-11 has shipped._

## Done

### Replace Explore's "Save to my recipes" with a star (favorite for later)
- **Type:** feature
- **Where:** Explore tab, the tile grid and the recipe modal (`explore.js` — `open`, `save`, `markSaved`, `tile`; the external-mode Save bar in `recipe-card.js` `openDetail`; Firebase `/explore/saved`)
- **Problem:** Opening an Explore recipe offers "Not for us" or "Save to my recipes". Saving copies it straight into the collection, which is a bigger commitment than Kyle wants while browsing. There is no lightweight "keep this for later".
- **Want:** The second action becomes a favorite toggle (star) instead of a save. Starring does **not** add the recipe to the collection; it only marks it, stored in Firebase under `/explore` (for example `/explore/starred/<key>`) so both phones share it. A starred recipe shows a small star icon in the top corner of its tile in the grid and in the top corner of the full modal. Tapping again un-stars it. "Not for us" stays as it is. Recipes that are already in the collection (earlier saves, or added later from favorites) keep their existing pill so it's clear they're already in Recipes.
- **Kyle's words:** "Instead of saving it directly to my recipes, what I want to have it do is just favorite it, basically like star it, save it for later… that should just put like a little star icon in the top corner of it, both in the preview along with the like full modal." (2026-11-11_110604 @ 1:07)
- **Status:** done · 2026-11-11 · 6b82127

### Filter the Explore tab down to starred recipes
- **Type:** feature
- **Where:** Explore tab filter sheet (`explore.js` — the `saved` filter group, `facetOf`, `visible`; shared sheet in `recipe-filters.js`)
- **Problem:** Once recipes can be starred in Explore, there's no way to see just those.
- **Want:** A "★ Favorites" filter on Explore (same look as the Favorites chip on the Recipes tab) that narrows the grid to starred recipes only. It takes the place of the current Saved / Not saved yet group, which no longer matches how Explore works. Starring or un-starring while the filter is on updates the grid straight away. Depends on the star item above.
- **Kyle's words:** "I should be able to filter out based on that, which should allow me to then just see in the explore tab, the ones that I've saved." (2026-11-11_110604 @ 1:34)
- **Status:** done · 2026-11-11 · 919df03

### Start "Add recipe" with a three-way choice: link, type it in, or from Explore
- **Type:** feature
- **Where:** Recipes tab → "+ Add recipe" (`recipes.html` — `#add-recipe` click → `RecipeCard.openAddForm`; the form and its "Import from a link" panel are in `recipe-card.js` — `openAddForm`, `wireImportPanel`, `runImport`)
- **Problem:** Add recipe opens one all-purpose form: an "Import from a link" box on top of every manual field. Importing and typing are different jobs squeezed into one screen, and there is no way to bring in something found on Explore.
- **Want:** Tapping "+ Add recipe" first shows a small chooser with three options:
  1. **Import from a link**: a screen with just the link field (and the existing paste-the-text fallback when a page can't be read); after a successful import it shows the filled-in recipe to check and save, as now.
  2. **Type it in**: the manual form on its own, without the import panel.
  3. **From Explore**: a list of the recipes starred in Explore (photo, name, blog). Tapping one adds it to the collection through the same path Explore's Save used (`RecipeCard.saveRecipe` with the "Explore" tag, plus `/explore/saved/<key>`), so it appears at the top of Recipes with the "New" tag. Recipes already in the collection are shown as added and can't be added twice. With nothing starred, say so and point to the Explore tab.
  The share-target / `?url=` path that opens the form with a link pre-filled goes straight to the link screen. Depends on the star item above.
- **Kyle's words:** "right now… when you add a recipe it will take you to a one-size-fits-all modal experience to either import from a URL or fill in the details. What I want to do is actually split that up into three separate components. So when I first tap import I should get essentially like a choice from three options to either import from a link, manually type the recipe, or add it from the explore tab." (2026-11-11_110604 @ 0:00) · "in the recipes tab, I should be able to add one of those recipes from my favorites." (@ 1:48)
- **Status:** done · 2026-11-11 · b2e1cc1

### Add a meal to the week from Explore favorites
- **Type:** feature
- **Where:** Week view → Edit mode → "Add a meal" picker sheet (`index.html` — `pickerMode`, `buildModeRow`, `renderPickerList`, `mealFromLink`, `importLinkMeal`)
- **Problem:** The Add a meal sheet offers the saved collection, "From a link…" and "Something else…". Recipes starred in Explore can't be put on a day without first adding them on the Recipes tab.
- **Want:** A third mode row, "From Explore…", next to "From a link…". Choosing it lists the recipes starred in Explore (photo, name, blog); tapping one places it on the chosen day with its ingredients and steps, so groceries and cooking mode work. With nothing starred, say so. Depends on the star item above.
- **Kyle's words:** "Same thing for the week planning, when I add, um, one of the options that I should have is to add from the explore tab and be able to select from that menu as well." (2026-11-11_110604 @ 2:01)
- **Answered:**
  - [x] Also save to the collection? No. Kyle (2026-11-11): week only, like a link import (same shape as `mealFromLink`: own `ings`, `steps`, `meta`, `source`, a non-colliding id, cover from the feed photo). "Save to recipes" in the ⋯ menu remains the way to keep it.
- **Status:** done · 2026-11-11 · f332fdd

### Show a freshly imported recipe at the top with a temporary "New" tag
- **Type:** polish
- **Where:** Recipes tab, the list after an import or save (`recipes.html` — `onSaveChange` and `onReady` append a "Your Recipes" `.section-divider` and the saved cards at the bottom of the list)
- **Problem:** A recipe added from a link lands at the very bottom of the Recipes list under a separate "Your Recipes" section label. Kyle has to scroll past the whole collection to confirm it was added, and the split between "collection" and "your recipes" isn't a distinction he cares about.
- **Want:** No "Your Recipes" divider. A just-imported (or just-saved) recipe appears at the top of the list like any other card, with a small "New" / "Recently imported" tag on it. The tag is short-lived: it shows for the session in which the recipe was added and is gone the next time the page is opened. Recipes saved earlier that are still waiting to be promoted into `data/recipes.json` should simply sort in with the rest, untagged.
- **Kyle's words:** "when I add it, it adds it to the bottom of my recipes with a section label called Your Recipes… I would prefer if it actually showed up at the top, and wasn't separated by the sections, but instead just had like a little, you know, new or like recently imported tag for just maybe that one import session. I wouldn't want it to last very long" (2026-11-08_113438 @ 0:14)
- **Status:** done · captured 2026-11-08 · shipped 2026-11-08

### Add a meal to the week plan from a URL
- **Type:** feature
- **Where:** Edit mode → "Add a meal" picker sheet (`index.html` — `#picker-overlay`, `openPickerForDay`, `buildCustomRow`; the link importer is `recipe-import.js`, which today is wired only into the add form on `recipes.html`)
- **Problem:** While planning a week, the Add a meal sheet offers only search over the saved collection and the "Something else…" placeholder. There is no way to paste a recipe link and put that meal straight on a day. Kyle has to leave planning, import it on the Recipes tab, then come back.
- **Want:** A paste-a-link option in the Add a meal sheet. Pasting a recipe URL imports it (same parser as the Recipes tab) and places the meal on the chosen day in one step. The meal lives **only on that week**: it is not saved to the recipe collection and does not appear on the Recipes tab. It should still carry its own ingredients and steps on the week file, so the grocery list and cooking mode work for it like any other meal.
- **Kyle's words:** "when I plan a week, and I press to add a recipe, I don't have an option to actually add a recipe from a URL. I would actually prefer if I could put in a link to add the meal directly into my meal plan. I could even imagine that it doesn't actually save it to my recipes. It would just put it in as like a temporary recipe that exists for the time being" (2026-11-08_113438 @ 0:56)
- **Answered:**
  - [x] Save to the collection too? No. Kyle (2026-11-08): "it should only exist for that week - not added to the recipes."
- **Status:** done · captured 2026-11-08 · shipped 2026-11-08

### Keep the Add a meal sheet visible when the keyboard opens
- **Type:** bug
- **Where:** Edit mode → "Add a meal" sheet, tapping "Something else…" (`index.html` — `setCustomMode` focuses `#picker-search`; the sheet is `.sheet{position:absolute;bottom:0}` inside `.sheet-ov`)
- **Problem:** Tapping "Something else…" focuses the name field and brings up the iOS keyboard, but the sheet does not move up with it. The keyboard covers the sheet entirely (screenshot: only the keyboard accessory bar and a sliver of the sheet's grab handle are visible over the week grid). Kyle can't see what he's typing or the Add button until he dismisses the keyboard.
- **Want:** When the keyboard appears, the sheet (title, name field, Add button) stays visible above it, so Kyle can type the one-off meal's name and confirm it without closing the keyboard first.
- **Kyle's words:** "when I tap something like something else from that add recipe view, the keyboard actually covers it up. So I can't actually see that window unless I close the keyboard." (2026-11-08_113438 @ 1:51)
- **Status:** done · captured 2026-11-08 · shipped 2026-11-08

### Drop the date and meal count from the edit-mode bottom bar
- **Type:** polish
- **Where:** Edit mode bottom bar (`index.html` — `#editBar`, the `#editCount` span filled in `renderEditCards`: "Nov 8 – 14 · 0 meals")
- **Problem:** The bar between Cancel and Done repeats the week's date range (already in the header directly above) and a running meal count Kyle doesn't need.
- **Want:** Remove that text. The bar keeps just Cancel and Done.
- **Kyle's words:** "At the bottom of the window of the add and shuffle recipes list, there's a little text that says the date and how many meals have been added. I don't need that text in there." (2026-11-08_113438 @ 2:18)
- **Status:** done · captured 2026-11-08 · shipped 2026-11-08

### Make the divider between + Add and Shuffle a straight line
- **Type:** polish
- **Where:** Edit mode, empty day slots (`index.html` — `.ds-action+.ds-action{border-left:1px solid var(--border)}` on a button that also has `border-radius:8px`, so the line's ends curve)
- **Problem:** In each empty day slot the vertical line separating "+ Add" from "🎲 Shuffle" has rounded ends (it is the left border of a rounded button), so it reads as a bracket rather than a divider.
- **Want:** A plain straight vertical line between the two actions, square ends.
- **Kyle's words:** "The line dividers that separate shuffle and add also are a little bit like rounded. They should just be straight lines." (2026-11-08_113438 @ 2:34)
- **Status:** done · captured 2026-11-08 · shipped 2026-11-08

### Remove the "Shuffle meals" button from the empty-week state
- **Type:** polish
- **Where:** Week view with nothing planned (`index.html` — `buildEmptyState`, the second `.edit-toggle` button "🎲 Shuffle meals")
- **Problem:** The "Nothing planned yet" card offers two buttons, "Plan this week" and "Shuffle meals". Shuffle now lives inside the planning view (the Shuffle pill top-right, plus per-day Shuffle), so the front-facing button is redundant.
- **Want:** Only "Plan this week" (or "Add meals" on a past week) in the empty state. Shuffle stays where it is inside Edit mode.
- **Kyle's words:** "since we've put the shuffling capability inside of the plan this week view, we don't need the shuffle meals button up front… Instead it can just be within the planning view at the top right as it is right now." (2026-11-08_113438 @ 2:56)
- **Status:** done · captured 2026-11-08 · shipped 2026-11-08
