# Car models

Put a glTF binary here named after the car's id, then add that id to `"available"` in `models.json`. That car will then use the model instead of the built-in shape:

| Car | File |
| --- | --- |
| BMW M2 / M3 / M4 | `m2.glb`, `m3.glb`, `m4.glb` |
| BMW M240i / M340i | `m240i.glb`, `m340i.glb` |
| BMW X3 M / X5 M / X6 M | `x3m.glb`, `x5m.glb`, `x6m.glb` |
| Brancuck (Q50) / Q60 | `q50.glb`, `q60.glb` |
| AMG C63 / E63 | `c63.glb`, `e63.glb` |
| Audi RS3 / RS6 | `rs3.glb`, `rs6.glb` |
| Charger / Challenger | `charger.glb`, `challenger.glb` |
| Supra, GT-R, Golf R, C8, SVJ | `supra.glb`, `gtr.glb`, `golfr.glb`, `c8.glb`, `svj.glb` |

The model is scaled to the real car length and set on the ground automatically. Paint recoloring uses materials named like `paint`/`body`; taillights `tail`/`brake`; wheels are nodes named `wheel`/`tire`/`rim`. If a model faces the wrong way or names differ, add an entry to `models.json`:

```json
{ "available": ["m4"], "m4": { "front": "-z", "paint": ["CarPaint"], "wheels": ["Wheel_"], "length": 4.79 } }
```

Only use models whose license allows it (and allows sharing, if you host the game publicly).
