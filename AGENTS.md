# Notes for AI coding agents (Codex / ChatGPT, Claude, ...)

ARCLINE / Highway Dash: a browser game in plain ES modules on three.js - no bundler, no framework,
no build step for the source. Live at https://xurco.xyz.

## Where things are

- `public/` - the whole game, served as-is.
  - `index.html`, `style.css` - the page, every menu's markup, the icon sprite, all styles.
  - `js/main.js` - the game loop, modes, cameras, driving physics hooks, HUD, networking glue.
  - `js/ui.js` - menus, garage, settings, modals. `js/profile.js` - the save (`P`), coins, accounts.
  - `js/hero*.js` - ARCLINE, the superhero mode (movement, swinging, combat, city life, multiplayer).
  - `js/city-map.js` (pure JS: map, lanes, signals, traffic, collisions) and `js/city.js` (drawing it) - City Drive.
  - `js/world.js`, `traffic.js`, `sky.js` - the highway modes. `cars.js`, `models.js`, `tuning.js`, `vehicle.js` - cars.
  - `js/audio.js`, `engine-dsp.js`, `engine-worklet.js` - sound. `js/pad.js` - wheels and gamepads.
  - `js/net.js`, `net-relay.js` - multiplayer (the public site uses an MQTT relay; `server.js` is the local server).
- `server.js` - local dev server: `npm install`, then `npm start`, then open http://localhost:3000.
- `scripts/build-pages.mjs` - builds `dist/` for GitHub Pages (copies `public/`, vendors three.js,
  cache-busts module URLs, leaves out what may not be published).
- `.github/workflows/deploy.yml` - on every push to `main`: build and publish to the `gh-pages` branch.

## Rules

- Edit files in `public/` directly. Keep imports as `import ... from "./name.js"` with plain
  `[A-Za-z0-9-]` file names - the build's cache-busting matches exactly that pattern.
- three.js is loaded through the import map (`"three"`, `"three/addons/..."`). Don't add a bundler or
  client-side npm packages.
- Never commit `public/loader-media/` or `public/sounds/` (licensed song, video and engine recordings;
  they are gitignored on purpose). Car models only reach the site if `public/models/models.json` credits
  them - leave that check alone.
- Don't commit `dist/` or `data/` (local server database).
- Match the existing style: small focused functions, comments that say *why* in full sentences, no emojis
  in the interface (icons come from the SVG sprite in `index.html`).
- Check a changed module's syntax by copying it to a `.mjs` file and running `node --check` on that
  (`node --check file.js` won't parse ES modules in this package).
- Keep every mode working: the menus offer the highway modes, City Drive and ARCLINE side by side.

## Shipping

Merging into `main` deploys automatically (the Action above), and the site updates a minute or two later.
Players may need a hard refresh (Ctrl+Shift+R). To deploy by hand instead:

```bash
node scripts/build-pages.mjs xurco.xyz
```

then push the contents of `dist/` to the `gh-pages` branch.
