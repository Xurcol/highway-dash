# ARCLINE

An online superhero game set in New Meridian. Swing between towers, run along walls, explore the city, stop crimes, fight gangs, and patrol with other players. The active site is ARCLINE only.

## Run locally

Double-click `start.bat`, or run:

```bash
npm install
npm start
```

Open http://localhost:3000. Multiplayer uses public MQTT relays by default, including on static hosting. The local Node server also serves the source files and the shared WebSocket service.

## Controls

| Control | Action |
| --- | --- |
| W A S D / left stick | Move and steer in the air |
| Mouse / right stick | Look |
| Right mouse / RT | Hold to swing |
| Space / A | Jump, launch from a swing, or launch from a perch |
| Shift / left stick click | Sprint and parkour |
| E / LB | Web zip; rescue someone nearby |
| Ctrl / B | Crouch, dive, or slide |
| F / RB | Air trick |
| Left mouse / X | Attack; hold for an uppercut |
| Q / LT | Dodge |
| R / Y | Web strike |
| 1-6 / D-pad | Web gadgets |
| G | Throw an object or stunned enemy |
| Z | Finisher; hold to heal with focus |
| Middle mouse / mouse wheel | Lock on / change target |
| K | Activities |
| H | Full controls |
| Escape | Session menu |

## Source layout

The browser runs plain ES modules directly; there is no bundler or client framework.

- `public/index.html`, `public/arcline.css`: the standalone page and interface.
- `public/js/main.js`: the small ARCLINE entry point.
- `public/js/arcline-main.js`: renderer, city, online sessions, settings, and the game loop.
- `public/js/arcline-ui.js`, `arcline-profile.js`: ARCLINE menus and separate `arc_` saves.
- `public/js/hero*.js`: movement, animation, camera, controls, combat, enemies, missions, activities, progression, and multiplayer heroes.
- `public/js/city*.js`, `cars.js`, `carmesh.js`, `lights.js`, `sky.js`: the city, procedural traffic, lighting, and weather shared with the earlier game.
- `public/js/audio.js`: generated hero/city sound and local sirens. Hero initialization skips engine worklets and unused driving sound loops.
- `public/js/net.js`, `net-relay.js`: shared networking. The ARCLINE entry point controls which sessions the active interface offers.
- `scripts/build-pages.mjs`: static hosting preparation. It follows the active entry point's module dependencies, versions module/stylesheet URLs, and vendors three.js and MQTT.

The old driving source and local assets remain available for recovery. Unused driving entry points, the car viewer, recorded sound banks, loading media, and car model downloads are omitted from the normal published ARCLINE output. Some car and city helpers remain dependencies because they draw the city's traffic.

## Highway Rush backup

The driving game was preserved before the standalone conversion:

- Full local source/assets: `D:\2 TB Downloads\larptic\highway-rush-backup-20261016`.
- Tracked Git reference: `backup/highway-rush-20261016` at `e78abd0`.

To run the local backup, open that folder and double-click `start.bat`; it installs dependencies if needed. The backup omits `node_modules`, `dist`, `data`, and Git metadata. Its source/assets copy preserves the local state; the Git branch preserves the tracked commit.

To inspect the Git backup in a separate folder without replacing ARCLINE:

```bash
git worktree add ../highway-rush-restored backup/highway-rush-20261016
```

## Publishing

Double-click `deploy.bat` to save and publish the active ARCLINE site to https://xurco.xyz. A push to `main` also runs the existing GitHub Pages workflow. Players may need Ctrl+Shift+R after a deployment.

The publishing build is:

```bash
node scripts/build-pages.mjs xurco.xyz
```

It writes `dist/`, `CNAME`, and `.nojekyll`. Normal builds omit `public/models/`; optional `--with-models` inclusion still applies the model manifest's licence/credit gate. Recorded engine banks remain opt-in with `--with-sounds`. Loading-screen commercial media is always excluded. Do not commit `dist/`, `data/`, licensed recordings, or loading media.
