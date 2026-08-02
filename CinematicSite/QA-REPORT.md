# QA report — FFI / The Line of Certainty

Test date: 2026-07-16  
Production target: local Vite production preview (`http://127.0.0.1:4173/`)  
Browser: Chromium driven through Playwright CLI

## Build, provenance, and asset checks

- `npm run lint`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev`: passed with 0 reported vulnerabilities.
- The supplied `Logo FFI.png` and `assets/brand/ffi-official-logo.png` have the same SHA-256 hash (`3C7BCE02D81A6C685E8EB4F903D1F7342BADB2020CDD4B9A6FBFDD1DE2A6B24B`); the runtime logo is unchanged from the supplied asset.
- The runtime contains exactly the seven approved ChatGPT-native stills and the three selected Higgsfield motion scenes: Datum (1080p), Pulse (1080p), and Life (720p). All runtime clips are H.264/yuv420p, 24 fps, silent, 4.041667 seconds, and below 100 MB.
- Scroll masters use faststart, no B-frames, and a three-frame (0.125-second) keyframe cadence. Their metadata is recorded in `qa/media-metadata.json`.
- Obsolete prior-scenario media, posters, screenshots, and metadata were removed. A final source scan found no runtime references to the obsolete asset set.

## Browser and visual coverage

- **Desktop, 1440 × 900:** inspected the start, middle, and end of every locked act — Datum, Ground, Frame, Pulse, Renew, Life, and Proof & Horizon. The complete contact sheet is `output/playwright/scroll-audit/contact.png`.
- **Narrow desktop, 700 × 1100:** inspected the opening composition and pinned choreography. No horizontal overflow.
- **Phone, 390 × 844:** inspected the poster-first fallback, typography, chapter index open/close state, and a chapter jump to Pulse. No horizontal overflow.
- **Reduced motion:** verified `prefers-reduced-motion: reduce`; videos are not displayed or sought, the Canvas event is disabled, and the complete still-based composition remains readable.
- **Demo mode:** with `?demo=1`, `Space` starts and pauses the 15-second forward pass, manual wheel input pauses it, and `R` returns scroll position and all video times to zero. A complete automatic pass reaches the document endpoint with all selected clips held on their final usable frame.
- **Scrubbing:** Datum, Pulse, and Life were checked at scene midpoint. The active clip seeks by its loaded metadata duration while paused; inactive clips remain paused. First and final 8% holds are present and reverse scrolling restores the same frame state.
- **Console:** 0 errors during the full interactive pass.

## Visual acceptance

- **Datum:** stable survey approach; marker, terrain, and thin orange line remain coherent.
- **Pulse:** controlled route pulse remains on the existing MEP system; concrete, ducts, and supports stay geometrically stable.
- **Life:** calm lateral/forward movement, water, shade, and planting stay credible; the path datum remains fixed.
- **Renew:** the single deterministic Canvas intervention is derived exclusively from scroll progress and reverses cleanly.
- **Proof & Horizon:** evidence, authentic logo, and profile-verified contact layer remain legible over the final still.

## Evidence files

Current QA screenshots are retained in `output/playwright/`: desktop, narrow-desktop, phone, reduced-motion, demo-complete, and the seven-act scroll audit. Source still/video prompts, preflights, Higgsfield job records, inspection decisions, and the final 0.5-credit balance are in `GENERATION-LOG.md`.
