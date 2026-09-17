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
| S / ↓ / Space | Brake |
| A D / ← → | Steer |
| N | Sport / Comfort drive mode |
| M | Switch between manual and automatic |
| Q / E | Shift down / up (manual) |
| Z / X | Left / right turn signal (flashes 3 times, then turns off) |
| H | Horn |
| C | Change camera |
| T / B / V | Change time of day / weather / sky style |
| P / R | Pause / restart |
| L | Leaderboard |
| Enter | Chat (online) |

## Cars, sound & tuning

The garage has 20 real cars: BMW M240i, M340i, M2, M3, M4, X3 M, X5 M and X6 M; Brancuck Red Sport (Q50); Infiniti Q60; Mercedes-AMG C63 and E63; Audi RS3 and RS6; Dodge Charger and Challenger Hellcat; Toyota Supra; Nissan GT-R; VW Golf R; and Chevrolet Corvette C8. The 8 original cars are also still there.

Every car has paint colors and a choice of engine sound. Its **TUNE** screen sets burble amount and duration, pop style, rasp, exhaust volume, turbo whistle, the turbo flutter or blow-off sound when you let off W, engine braking, and the default drive mode.

## Playing with friends

Open **ONLINE**. There's no sign-up: your name and driver code are saved in a cookie. Share your code, or add a friend by theirs. Create a party (or quick play) and press **PLAY ONLINE**.

- Everyone in the party starts the round together after a countdown, on the same traffic.
- The first player to crash ends the round for everyone. Scores show, then the next round starts automatically.
- Cars don't collide with each other.

Multiplayer runs over a public MQTT relay (HiveMQ, with EMQX as fallback), so the game works on static hosting. The optional Node server (`npm start`, then open with `?server=1`) provides the same features over WebSockets.

## Hosting (GitHub Pages)

```bash
node scripts/build-pages.mjs xurco.xyz
```

This builds `dist/` (the game plus the vendored three.js and mqtt files, CNAME and .nojekyll). Publish that folder to the `gh-pages` branch. `node scripts/serve-dist.mjs` serves `dist/` locally for testing.
