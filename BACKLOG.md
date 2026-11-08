# Backlog: x-meals

Filed by Dev Inbox. Status goes `new` (open questions) → `ready` → `planned` → `done`.

## Inbox

_Empty — everything captured on 2026-11-08 has shipped._

## Done

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
