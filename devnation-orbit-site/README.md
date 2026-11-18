# DevNation Orbit — interactive showcase

A standalone static website about the [DevNation Orbit](https://github.com/Ajiet-DevNation/dn-orbit) platform. No build step, account, database or access to the main Orbit application is needed.

## Run locally

From the repository root:

```sh
python -m http.server 4175 --directory devnation-orbit-site
```

Visit <http://localhost:4175>. `index.html` contains the styles, content, scoring demo and scene code. The scene uses pinned Three.js r128 from cdnjs. Fonts are requested from Google Fonts. Without WebGL or the CDN, the content, in-page links, score calculator and CSS starfield still work. Sections follow the document's natural height rather than snapping to full-screen stops.

## Private local mascot

Place the reference's `pluto-walk.png` (576 × 64) and `pluto-sit.png` (1872 × 128) in `assets/` to see the sprite animation. These files are **ignored by Git** and must be supplied separately on each machine. A fresh checkout displays a CSS guide instead. **Do not deploy a local copy of this directory with the sprites unless you intend to make those files downloadable by visitors.** The optional multi-pose `pluto-sheet.png` is not used.

## Source of truth

Copy and calculations were checked against the current `Ajiet-DevNation/dn-orbit` `main` source on 2026-11-18 (`9b5905c`), especially `prisma/schema.prisma`, `lib/leaderboard-scoring.ts`, `lib/leaderboard.ts`, `lib/sync.ts`, `lib/auth.ts`, `proxy.ts`, and the event/project API routes. The local `/home/chiaa/dn-orbit` clone is older; its README still describes a nightly cron and linear normalization, which are no longer the active implementation.

The calculator uses example cohort maxima, not live club data. It repeats the scoring function's square-root compression, zero-denominator handling, event cap, and default admin-configurable weights. It does not claim to predict a real user's rank or fetch personal stats. Sign-in links intentionally use `href="#"` until the owner approves a destination.
