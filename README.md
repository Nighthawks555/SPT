# SPT — Season Poker Tournament

Static site, live data from the published SPT databook (Google Sheets).
No build step. No dependencies. No frameworks.

## Structure

```
index.html        Dashboard — hero, The Five, all-time leaderboard
players.html      The Regulars (Phantom, Joker) + all substitutes
css/styles.css    Full design system
js/app.js         CSV fetch, parsing, rendering
images/players/   Player photos + players.json (see below)
```

## Data

Two CSV fetches on page load, from the published Sheet:
- LEADERBOARD tab (gid 232414899) — totals, games, PPG, placings
- SITE tab (gid 556175416) — per-season points, SPT1–SPT22

Add a season in the databook's CONFIG tab and the site updates itself.
Nothing here needs touching.

## Player photos & profiles

Player profile photos live in the repo at `images/players/`, named
exactly as the poker name:

```
images/players/
  Concierge.jpg
  Dyna-mite.jpg
  Mac Daddy.jpg
  players.json
```

Case and spaces matter — the filename must match the poker name as it
appears on the site. Missing photos fall back to a monogram. Photos
display greyscale until hovered.

`players.json` (already in this folder, pre-filled with every name)
holds each player's real name and an optional first-played override:

```json
{
  "Concierge": { "realName": "" },
  "Smooth": { "realName": "", "firstPlayed": "March 2015" }
}
```

Leave `realName` empty to show nothing. `firstPlayed` is optional —
without it the site derives the first season with points from the
databook (e.g. "First played SPT8").

## Game photos

Every game row has a View Pics button. Photos live in this repo under
a top-level `images/` folder, one subfolder per game named
`{season}.{game}`:

```
images/
  22.1/
    river-bluff.jpg
    final-table.jpg
    captions.json      <- optional
  22.2/
    ...
```

To add photos: create the folder in GitHub (Add file -> Upload files,
type `images/22.1/` in the filename box) and upload. That's it — the
site lists the folder live via the GitHub API, no code changes, no
redeploy.

Captions are optional. Add a `captions.json` to the folder mapping
filename to copy:

```json
{
  "river-bluff.jpg": "Smooth takes it down on the river. Scenes.",
  "final-table.jpg": "Ices, 3rd place, unimpressed."
}
```

Uncaptioned photos still display. Photos sort by filename (numeric
aware, so 2.jpg comes before 10.jpg). Setup: the `GITHUB_OWNER`
constant at the top of `js/app.js` must be set to the GitHub username
the repo lives under.

## Deploy (Vercel)

Same as Whitfords: push this folder to a GitHub repo, import in Vercel,
no framework preset, no build command, output directory = root.
`index.html` is the entry file — standard name, no config needed.
