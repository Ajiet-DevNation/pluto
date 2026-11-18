# Integrate standalone Orbit showcase as a Next.js route

## Goal
Port `devnation-orbit-site/index.html` (static showcase) into the Next.js app at `website/` as a new route (e.g. `/orbit`), preserving the six sections, CSS styling, WebGL scene, Pluto sprite animation, and interactive scoring calculator. Keep existing Pluto showcase homepage untouched.

## Affected boundaries
- `website/app/orbit/page.tsx` (new route) — server component rendering static content + client islands.
- `website/components/orbit-showcase.tsx` (new client component) — owns WebGL canvas, sprite guide, scroll logic, reduced-motion handling.
- `website/components/orbit-calculator.tsx` (new client component) — scoring inputs/results.
- `website/app/globals.css` or route-scoped CSS module — ported styles (dark theme, responsive breakpoints, reduced-motion).
- `website/public/assets/` — Pluto sprites (git-ignored, optional fallback).
- Navigation: add link from existing navbar/footer if desired (optional, out of scope unless requested).

## Data flow
- Static content hardcoded in page component (mirrors HTML).
- Calculator: client-side state for inputs; scoring function (sqrt compression, caps, weights) replicated in TS; no backend/db.
- WebGL: client-only, dynamically imported to avoid SSR; pinned Three.js r128 via npm (already `three` installed) instead of CDN.
- Sprites: fetch `/assets/pluto-walk.png` and `/pluto-sit.png`; fall back to CSS guide when missing (404 handling).

## Tasks
1. Create route `app/orbit/page.tsx` with metadata and semantic sections copied from HTML.
2. Port CSS into a scoped module or globals extension, including media queries and reduced-motion.
3. Implement calculator component with validation, breakdown, error states.
4. Implement WebGL scene + scroll-linked camera as client component with cleanup and visibility handling (reuse patterns from `orbit-engine.ts`).
5. Implement Pluto sprite guide with speech bubble and fallback.
6. Add optional sprites to `public/assets` (git-ignored) — document in README.
7. Update `next.config.ts` only if static asset/CDN changes needed (not expected).
8. Lint + typecheck + build.

## Risks
- Three.js version mismatch: standalone uses r128 via CDN; app uses `three` (check version). May need downgrade or API adjustments.
- SSR: WebGL/canvas must be client-only; use dynamic import with `ssr: false`.
- Sprite 404s must not error; handle gracefully.
- Sign-in link stays `href="#"` with TODO per source README.
- Reduced-motion and hidden-tab handling must match tested behavior.

## Validation
- `npm run lint`, `npm run typecheck` (if available), `npm run build`.
- Manual: widths 320/390/768/1440/1920, calculator validation, navigation, reduced motion, fallbacks (no sprites/WebGL).
- Confirm no browser console errors.

## Open questions
- Should `/orbit` be linked from the main navbar, or standalone URL only?
- Should the Orbit page reuse the app's existing Three.js scene or its own? (Recommended: own, to preserve standalone fidelity.)
