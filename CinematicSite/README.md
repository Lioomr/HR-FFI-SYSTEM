# FFI — The Line of Certainty

A standalone cinematic single-page website for **Fathi Fouad Itani Contracting Company (FFI)**. It tells one authored story: a real-brand orange survey datum moves from ground to infrastructure, frame, MEP coordination, renewal, public realm, and a confident horizon.

The implementation is intentionally isolated in `CinematicSite/` and does not modify the HR product elsewhere in the repository.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite. For a production check:

```bash
npm run build
npm run preview
```

Available scripts:

- `npm run dev` — local Vite server.
- `npm run build` — production bundle in `dist/`.
- `npm run preview` — local production preview.
- `npm run lint` — static JavaScript linting.

## Interaction contract

- Native vertical scrolling is the default. Chapter navigation jumps to the corresponding authored act.
- Scroll-controlled videos remain paused; one normalized ScrollTrigger progress value writes their metadata-derived `currentTime`.
- Each video holds the true first and final frames before the scene changes. Scrolling backward restores the same deterministic state.
- `?demo=1` enables showcase mode. `Space` starts/pauses the 15-second automatic pass; `R` returns to the exact opening state. Wheel or touch input pauses the pass.
- The Renewal act includes the project’s one deterministic Canvas event. It runs only while active and is reversible through scroll progress.

## Accessibility and responsive behavior

- `prefers-reduced-motion` retains the complete visual composition as still plates, stops video seeking and Canvas work, and keeps navigation/content accessible.
- Actual phone-width layouts use a lightweight, poster-first presentation.
- Narrow portrait desktop windows retain the full choreography where performance permits.
- Videos have poster/still fallbacks and asset errors do not hide the factual content.

## Content provenance

All company copy is grounded in the supplied FFI company profile. The site uses the profile’s stated company history (established in 2006 and transferred to a company in 2024), service breadth, selected portfolio records, and listed Jeddah contact details. It deliberately avoids unsupported current-status claims, client-logo reuse, and profile date conflicts.

## Asset provenance

- `assets/brand/ffi-official-logo.png` is the authentic user-supplied FFI logo copied unchanged. It is used only as an implementation-layer identity asset.
- `assets/images/` contains seven original ChatGPT-native source stills.
- `assets/videos/` contains the three selected Higgsfield-MCP image-to-video sources and web-optimized scroll masters.
- `assets/posters/` contains representative first-frame posters for the motion scenes.
- [GENERATION-LOG.md](GENERATION-LOG.md) records prompts, model settings, preflight costs, local filenames, technical properties, inspection, and usage notes.
- [ART-DIRECTION.md](ART-DIRECTION.md) records the visual system and media map; [RESEARCH.md](RESEARCH.md) records inspiration principles only.

No third-party imagery, video, client mark, provider URL, credential, or secret is required at runtime. Generated media remains subject to the user’s applicable OpenAI and Higgsfield terms.

## Project structure

```text
assets/
  brand/       authentic FFI logo
  images/      native source stills
  posters/     video fallback posters
  videos/      source and browser scroll masters
src/
  main.js      scroll narrative, navigation, demo mode
  media.js     metadata-aware video scrubbing and fallbacks
  rupture.js   deterministic Canvas event
  styles.css   visual system and responsive layouts
```
