# Fox & Bear Kitchen — Roadmap

## What's Been Built

- **JSON data layer** — Recipe and meal data moved out of HTML into `data/week.json`, `data/recipes.json`, and `data/history.json`. HTML pages are now render-only shells. Agent X writes clean JSON instead of editing HTML.
- **Real-time grocery sync** — Firebase Realtime Database syncs checkbox state across devices instantly. Kyle and Josephine see the same checked items live.
- **Meal history & Journal page** — Every week is automatically archived to `data/history.json` when Agent X publishes a new plan. The Journal page shows all past weeks with full recipe detail and cooking mode.

---

## What's Next

### Recipe Management UI
Allow Kyle to manage recipes directly from the site without involving Agent X.
- **"Add to My Recipes"** — save a meal from the current week permanently to the recipe collection
- **Edit mode** — tap to edit a recipe's name, ingredients, or steps from the overlay
- *Requires Google Sign-In first (see below) to safely allow writes from the browser*

### Google Sign-In
Add Firebase Authentication so only authorized users can trigger write operations from the UI. Kyle and Josephine sign in once with their Google accounts. The site remains openly readable — sign-in is only required for write actions (editing recipes, etc.). Agent X bypasses auth via its service account.

### Recipe Photos
Photos tied to each recipe, shown on recipe cards.
- Agent X generates a photo via an image API and stores the URL in `recipes.json`
- Or Kyle uploads a photo via an "Add Photo" button in the recipe overlay
- Photos stored in Firebase Storage

### Family Hub Expansion
New pages beyond meal planning, all using the same Firebase backend — home projects, trip planning, shared lists. Each feature is a new page + new Firebase data collection, no re-architecting needed.
