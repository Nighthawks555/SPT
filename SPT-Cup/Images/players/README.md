# Player Portrait Photos

Each player gets their own folder named by their slug (lowercase name, spaces replaced with hyphens).

## Naming convention

`Images/players/{firstname-lastname}/portrait.jpg`

## How to derive the slug

Take the player's full name from the LEADERBOARD sheet, lowercase it, replace spaces with hyphens, remove any non-alphanumeric characters (except hyphens).

Examples:
- `Mykel Anderson` → `Images/players/mykel-anderson/portrait.jpg`
- `J.J. Smith` → `Images/players/jj-smith/portrait.jpg`
- `Chris O'Brien` → `Images/players/chris-obrien/portrait.jpg`

## Steps to add a player photo

1. Create the folder: `Images/players/mykel-anderson/`
2. Drop in `portrait.jpg` (any reasonable resolution, ideally square or portrait crop)
3. Commit and push — Vercel will auto-deploy

