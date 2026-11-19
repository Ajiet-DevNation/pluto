# Pluto website

The DevNation landing page for Pluto. Both `/` and `/orbit` render the same six-section page. HTML remains readable without WebGL; the Three.js scene follows the page while you scroll. The command preview runs locally and never connects to Discord.

## Run locally

Use Node.js 22 or newer. From `website/`:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. To build the static export:

```bash
npm run format:check
npm run lint
npm run build
```

Deploy the contents of `out/`. `npm run format` formats the active source files. The site does not need a server after export.

## Where to edit things

- `content/site.ts`: visible page copy and illustrative command replies.
- `app/globals.css`: colors, font sizes, spacing, corner radii and chat preview styles.
- `app/orbit/orbit.module.css`: page composition, responsive styles and CSS mascot fallback.
- `components/command-demo.tsx`: local interactive preview.
- `components/orbit-showcase.tsx`: client-side WebGL loader, mascot button and fallback.
- `components/orbit-showcase-engine.ts` and `components/scene/`: the camera, scroll mapping, path and rendering resources.
- `app/layout.tsx`: metadata and font preloads.

## Production notes

Set `NEXT_PUBLIC_SITE_URL=https://YOUR_SITE_DOMAIN` when building for a public domain. This supplies the canonical URL for `/` and `/orbit`, and absolute URLs for the social image. Do not set it to a localhost URL in production.

The original `pluto-walk.png` and `pluto-sit.png` sprites are local-only artwork excluded by `.gitignore`. The static export deliberately removes them with `postbuild`; visitors see the CSS mascot fallback instead. To publish the original pixel-art mascot, first secure permission to distribute its artwork, then update the asset policy, remove that export step and build with `NEXT_PUBLIC_PLUTO_SPRITES=true`. Do not commit those private local files by accident.

Pluto's current v1 commands include `/digest`, `/upcoming meetings`, `/upcoming events`, `/event add`, `/event cancel` and `/optout`. `/ask` is **not** an active command; the question-themed section on the landing page is an illustrative preview of the commands. Miro support requires configuration and the shared workspace has not been verified in production. The command replies on this site are made-up examples, never live club data.
