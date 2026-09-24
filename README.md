# Highway Dash

A browser traffic-weaving racer: city streets that turn into the open highway, a synthesized engine sound for each car, a manual gearbox, sky and weather settings, and online parties with friends.

## Run it

Double-click `start.bat`, or run:

```bash
npm install
npm start
```

Then open http://localhost:3000.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake |
| Space | Look back (hold) |
| A D / ← → | Steer |
| N | Sport / Comfort: Comfort shuts the exhaust valves (quieter, no burbles or pops) and changes up early while cruising |
| M | Switch between manual and automatic |
| Q / E | Gear lever: R - N - 1 - 2 ... |
| Z / X | Left / right turn signal (flashes 3 times, then turns off) |
| H | Horn |
| C | Change camera |
| T / B / V | Change time of day / weather / sky style |
| G | Switch vehicle |
| P / R | Pause / restart |
| L | Leaderboard |
| Enter | Chat (online) |
| Tab | Player list (online) |
| Shift | Handbrake (City Drive) |
| S at a standstill | Reverse (City Drive); W drives on again |

## City Drive

A free-roam 3D mode (solo, or as a server mode): a downtown grid with signalised junctions, sidewalks, towers that get taller towards the middle, and traffic that obeys the lights, queues, zip-merges and honks at you if you sit in its way. An elevated six-lane ring expressway runs round downtown, with a diamond interchange on every side, so you can take an on-ramp, merge, and leave again by any exit. Engine sound echoes off the buildings, and booms under the ring. A heading-up minimap sits bottom right. The city's traffic runs on each player's own machine; players see each other.

## Cars, sound & tuning

The garage has 20 real cars: BMW M240i, M340i, M2, M3, M4, X3 M, X5 M and X6 M; Brancuck Red Sport (Q50); Infiniti Q60; Mercedes-AMG C63 and E63; Audi RS3 and RS6; Dodge Charger and Challenger Hellcat; Toyota Supra; Nissan GT-R; VW Golf R; and Chevrolet Corvette C8. The 8 original cars are also still there.

Every car has paint colors and a choice of engine sound. Its **TUNE** screen sets burble amount and duration, pop style, rasp, exhaust volume, turbo whistle, the turbo flutter or blow-off sound when you let off W, engine braking, and the default drive mode.

## Multiplayer

Open **MULTIPLAYER**. There is no sign-up: your name and driver code are kept in a cookie.

- **Public servers** lists every public server that is live right now, with its mode, traffic, player count and the relay ping. Press JOIN; nobody has to invite you.
- **Create server** makes a public or private (code-only) server: name, max players (2-8), game mode, traffic, and optionally a fixed time of day and weather.
- **Private & friends** keeps the original party code, friend list, invites and Quick Play.
- **Modes:** Free Drive (no rounds, no finish, join and leave any time), City Drive (the same, in the 3D city), Last One Standing, First To Score, Timed Battle.
- **In a server:** Enter opens chat, Tab lists players, G switches vehicle, Esc opens the session menu (Leave Server). Chat commands: `/players`, `/tp <player>` (also `/teleport`, `/goto`; Free Drive servers only), `/help`.
- **Switching cars** works in every mode, on the road, without leaving the run or the server. Other players see the change immediately.
- Traffic is deterministic from the server seed and time, so everyone sees the same cars with nothing streamed.

Multiplayer runs over public MQTT relays (HiveMQ, EMQX and Mosquitto at once), so the game works on static hosting. The server list is the relays' retained `public/<code>` topics: the host of a public room keeps its listing fresh and the last player out removes it. Relays are third-party brokers, so there is no authoritative server: receivers clamp and sanitize every packet and rate-limit chat themselves. The optional Node server (`npm start`, then open with `?server=1`) provides the same features over WebSockets and does validate everything server-side (room capacity, chat rate, state ranges).

Add `?root=some/test/namespace` to the URL to point a client at a private topic namespace, which is how the multiplayer tests avoid touching the real lobby.

## Hosting (GitHub Pages)

```bash
node scripts/build-pages.mjs xurco.xyz
```

This builds `dist/` (the game plus the vendored three.js and mqtt files, CNAME and .nojekyll). Publish that folder to the `gh-pages` branch. `node scripts/serve-dist.mjs` serves `dist/` locally for testing.
