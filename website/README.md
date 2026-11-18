# Pluto showcase

A responsive Next.js / React showcase for DevNation’s Discord companion. The full-screen Three.js scene follows a six-stop scroll journey, with a 3D orbital path, planet, asteroids, stars, and an optional animated local mascot.

## Develop

Use Node.js 22 or newer. From this checkout:

```bash
cd /home/chiaa/pluto/website
npm install
npm run dev
```

Open http://localhost:3000. In another checkout, use its `website/` directory.

## Community invite

The official Discord invite is pending confirmation. To enable the “Join DevNation” links, create `website/.env.local` with:

```dotenv
NEXT_PUBLIC_DISCORD_INVITE_URL=https://discord.gg/YOUR_CONFIRMED_INVITE
```

Use the actual community invite, then restart development or rebuild for production. Without a valid Discord invite, the site displays its working GitHub links. It has no bot-install buttons or placeholder destinations.

## Production

```bash
npm run lint
npm run build
```

The static export is `website/out/`. Fonts and Three.js are bundled/self-hosted; the page does not load a Three.js CDN script or require a backend. The command demo is local and clearly labelled as illustrative.

**Private local mascot:** The reference's `website/public/pluto-walk.png` and `website/public/pluto-sit.png` are ignored by Git on request. They animate in local development but are not part of a clone, commit, or push. The website falls back to the CSS starfield and character if these files are missing. The `postbuild` script removes both sprites from `website/out/` after a build, so a local static export does not include them either. Keeping the exact mascot on a public website without delivering its artwork to visitors is not possible.

## Implementation

- `app/page.tsx`: server-rendered content and six semantic sections.
- `app/orbit/page.tsx`: static `/orbit` route ported from the standalone DevNation Orbit showcase.
- `components/orbit-showcase.tsx`: `/orbit` client island for the guide, scroll-linked scene, and reduced-motion/WebGL fallbacks.
- `components/orbit-showcase-engine.ts`: `/orbit` Three.js scene, sprite sheets, scroll camera, visibility handling, and GPU cleanup.
- `components/orbit-calculator.tsx`: illustrative Orbit scoring calculator (square-root normalisation, event cap, configurable weights).
- `app/orbit/orbit.module.css`: route-scoped styles, including the 800px/420px breakpoints.
- `components/orbit-experience.tsx`: navigation, motion control, accessible mascot interaction, and lazy engine loading.
- `components/orbit-engine.ts`: Three.js scene, scroll-linked camera, optional local sprite animation, visibility handling, and GPU-resource cleanup.
- `components/command-demo.tsx`: bounded, cancellable example interactions.
- `components/community-links.tsx`: verified invite configuration and repository links.
- Reference sprites stay local and uncommitted. `/orbit` loads the same `/pluto-walk.png` and `/pluto-sit.png` files from `public/` and falls back to its CSS guide when they are missing. Other original and reference images live under ignored `website/.private-assets/` and are never served.

Reduced-motion preferences and the pause control stop continuous animation; section changes still update the composition. Hidden tabs stop rendering. WebGL or missing-sprite failures retain the CSS starfield and accessible CSS mascot fallback. All page content and navigation links render without JavaScript.

## Content source

Reviewed against `origin/main` at `227ca8e` on 2026-11-18, including `.planning/STATE.md`, `src/discord/commands.ts`, and the command implementations:

- `/ask` is removed from active v1; there is no active question-answering command.
- `/optout` is one-way in v1 and excludes/removes a member’s indexed messages.
- `/digest` is an on-demand activity snapshot, not a scheduled weekly summary or AI narrative; `/upcoming`, `/event` and `/help` are active commands.
- The meeting announcer is implemented and test-guild verified; production deployment acceptance remains pending.
- Public GitHub and five allowlisted Discord channels are indexed; Miro indexing is pending.
- Transcript workflows and `/decisions` are not active v1 capabilities.

Earlier showcase drafts in this local checkout are not imported by the page or part of the deployed build.
