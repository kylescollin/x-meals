# Recipe fetcher

A single serverless function that fetches a recipe page and hands its HTML back
to Fox & Bear Kitchen with a CORS header on it. That's all it does — it has no
idea what a recipe is. Every bit of recipe parsing lives in `recipe-import.js`
in the main site.

It exists because the Kitchen is a static site: a browser can't fetch another
site's HTML directly, and the free public CORS relays are blocked by most of
the recipe sites worth importing from.

## Deploying an update

```bash
cd recipe-fetcher
vercel --prod
```

The site finds it via `IMPORT_ENDPOINT` at the top of `../recipe-import.js`. If
the URL ever changes, change it there.

## If it goes away

Nothing breaks. `recipe-import.js` falls back to public CORS relays, and then
to the paste-the-recipe-text box. Imports just get less reliable.

## Guard rails

- Only requests from `https://kylescollin.github.io` (or localhost) are served,
  so this can't be used as a general-purpose proxy.
- Private and link-local addresses are refused, so it can't be pointed at
  internal networks or cloud metadata.
- Responses are capped at 3 MB and time out after 15 seconds.
