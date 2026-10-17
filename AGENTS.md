# Notes for AI coding agents

ARCLINE is the active online superhero game at https://xurco.xyz. It uses plain ES modules and three.js, without a bundler or client framework.

The user's October 16, 2026 instruction explicitly separates this project from Highway Rush: the active site offers ARCLINE only. This replaces the earlier rule requiring highway modes, City Drive, and ARCLINE menus side by side. Preserve city/traffic helpers needed by ARCLINE, and keep the driving backup available.

## Source layout

- `public/` is served directly in development.
  - `index.html`, `arcline.css`: the standalone page and interface.
  - `js/main.js`: the ARCLINE entry point.
  - `js/arcline-main.js`: rendering, online sessions, city updates, settings, and the game loop.
  - `js/arcline-ui.js`, `arcline-profile.js`: menus and separate ARCLINE `arc_` saves.
  - `js/hero*.js`: the hero's movement, swinging, camera, animation, controls, combat, enemies, city life, missions, activities, progression, HUD, and multiplayer.
  - `js/city*.js`, `cars.js`, `carmesh.js`, `lights.js`, `sky.js`: city rendering, procedural traffic, lighting, and weather. Some helpers are shared with the driving game.
  - `js/audio.js`: generated effects/ambience and nearby sirens. `init({hero:true})` avoids engine worklets and unused driving sound loops.
  - `js/net.js`, `net-relay.js`: shared multiplayer transport. The active entry point/interface offers superhero sessions only.
- `server.js`: local static server plus the shared WebSocket service. Run `npm install`, then `npm start`, and open http://localhost:3000.
- `scripts/build-pages.mjs`: creates `dist/` for GitHub Pages from reachable local modules and referenced stylesheets; vendors three.js/MQTT and versions local URLs.
- `.github/workflows/deploy.yml`: existing deployment on a push to `main`.

## Rules

- Edit source files directly. Keep local imports in the form `import ... from "./name.js"`, with plain `[A-Za-z0-9-]` filenames.
- Use the three.js import map (`"three"`, `"three/addons/..."`). Do not add a bundler or client-side packages.
- Keep the active site focused on online ARCLINE. Do not reactivate the driving menus or restore the old startup in place of the standalone entry point.
- Avoid new per-frame allocations and unnecessary physics/render/audio work. Keep required per-frame light/glow emission when throttling city simulation.
- Follow existing styles: small focused functions, comments explaining why, and no interface emojis. Use the SVG symbols in `index.html` for icons.
- Never commit `public/loader-media/` or `public/sounds/`; they contain licensed media/recordings and are deliberately ignored.
- Normal ARCLINE publishing excludes car model downloads. If models are explicitly included, retain the `public/models/models.json` licence/credit filter; do not bypass it.
- Do not commit generated `dist/` or the local `data/` database.
- Check every changed browser module by copying it to a temporary `.mjs` file and running `node --check` on that copy. This package's `.js` files are not declared as ES modules. Check `.mjs` scripts and CommonJS server files directly; parse edited JSON files.
- The user's current verification preference is syntax checks without gameplay tests. Do not run browser/headless gameplay checks or create `dist/` unless the user requests them.
- After each change, explain it in simple words and remind the user to double-click `deploy.bat` to put it live. Do not deploy automatically without authorization.

## Driving backup

The full local source/assets backup made before conversion is `D:\2 TB Downloads\larptic\highway-rush-backup-20261016`. It excludes dependencies, generated output, the database, and Git metadata. Run its `start.bat` to install dependencies and launch it.

The tracked Git backup is branch `backup/highway-rush-20261016` at `e78abd0`. Restore it into a separate checkout/worktree if needed; do not overwrite active ARCLINE source. Local-only assets are preserved in the folder backup.

## Shipping

A push to `main` deploys through the existing GitHub workflow. `deploy.bat` commits/pushes local changes, builds with `node scripts/build-pages.mjs xurco.xyz`, and publishes `dist/` to `gh-pages`. Keep the existing deployment destination and asset safeguards. The site generally updates a minute or two later; Ctrl+Shift+R refreshes cached pages.
