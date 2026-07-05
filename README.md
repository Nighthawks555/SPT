# SPT — Season Poker Tournament

Static site, live data from the published SPT databook (Google Sheets).
No build step. No dependencies. No frameworks.

## Structure

```
index.html        Dashboard — hero, The Five, all-time leaderboard
players.html      The Regulars (Phantom, Joker) + all substitutes
css/styles.css    Full design system
js/app.js         CSV fetch, parsing, rendering
assets/avatars/   Drop player photos here (see below)
```

## Data

Two CSV fetches on page load, from the published Sheet:
- LEADERBOARD tab (gid 232414899) — totals, games, PPG, placings
- SITE tab (gid 556175416) — per-season points, SPT1–SPT22

Add a season in the databook's CONFIG tab and the site updates itself.
Nothing here needs touching.

## Avatars

Drop a `.jpg` into `assets/avatars/` named as a lowercase slug of the
player name — spaces and punctuation become hyphens:

- Concierge   -> concierge.jpg
- Dyna-mite   -> dyna-mite.jpg
- Mac Daddy   -> mac-daddy.jpg

Missing images fall back to a monogram automatically. Avatars display
greyscale until the card is hovered.

## Deploy (Vercel)

Same as Whitfords: push this folder to a GitHub repo, import in Vercel,
no framework preset, no build command, output directory = root.
`index.html` is the entry file — standard name, no config needed.
