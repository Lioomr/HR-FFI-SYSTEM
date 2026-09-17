# Hyperframes Composition Brief: FFI HR — Sick Leave Tutorial

## Objective
Create a short, in-product **tutorial** video teaching an FFI employee how to file a
Sick Leave request. (This is a `/brag` run adapted from launch-video to tutorial; the
brag creative laws still bind: 15-25s, every line readable, specific to this project,
show real UI.)

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 24.0 seconds

## Source Material
- Project root: `/home/user/HR-FFI-SYSTEM`
- Primary files read:
  - `FrontEnd/src/pages/employee/leave/RequestLeavePage.tsx` (the form being taught)
  - `FrontEnd/src/index.css` (`:root` design tokens — palette and fonts)
  - `FrontEnd/src/i18n/translations.ts` (verbatim UI copy)
  - `Backend/leaves/utils.py` (sick-leave policy: cap, pay tiers, document rule)
  - `.agents/skills/leave_management.md` (approval chain)
- Product name: FFI HR
- Strongest claim: 120 sick days a year — 30 at full pay, 60 at half pay, 30 unpaid
- Key UI moment to recreate: the `Request Leave` card (`borderRadius: 16`) with its
  blue balance panel and green total-days panel, and the `Document (Required)` field
- Copy that must appear verbatim:
  - "Request Leave" / "Submit a new leave request"
  - "Leave Type" / "Sick Leave"
  - "Leave Balance" / "Remaining" / "Used" / "Allowed" / "Days"
  - "Total days"
  - "Document (Required)" / "Choose File"
  - "Submit Request"
  - "Pending Manager" / "Pending HR" / "Approved"

## Creative Direction
- Tone preset: `app-store`
- Creative direction: calm in-product HR tutorial — an onboarding clip, not an ad
- Interpretation: clean feature-card reveals, title-case labels, medium-weight type,
  0.35-0.45s slide transitions, generous settled holds. Pace comes from crisp cuts,
  never from pulling instructional text before it can be read.
- Angle: Show the real form doing the real thing. The video's job is that an employee
  who watches it can file a correct sick leave request without asking HR — including
  the one rule they always miss (the medical report is mandatory).
- Hook: "Sick Leave" in FFI orange + "120 days a year. Here's how to claim them."
- Outro: three pay-tier cards, then the FFI logo and "Sick leave, handled."
- Avoid:
  - Generic SaaS language ("streamline your absence workflow")
  - Abstract filler visuals
  - Redesigning the product — recreate the FFI look, don't invent a new one
  - Any medical imagery/illustration; this is a software tutorial

## Visual Identity
- Background (dark frames): `#0d1117`
- Surface (form frames): `#ffffff`, page wash `#f8faff`
- Accent: `#f97316` (light `#fb923c`, dark `#ea580c`), silver `#94a3b8`
- Text: `#0f172a` primary, `#64748b` secondary
- Display font: Rubik
- Body font: Rubik
- Panel colors verbatim from the form: balance `#f0f7ff` bg / `#91caff` border;
  total-days `#f6ffed` bg / `#b7eb8f` border
- Visual references from the project:
  - 16px-radius white card on a light wash
  - Ant Design form controls (select, range picker, upload button)
  - Status chips in the approval chain
  - Logo: copy `output_logo_transparent.png` into the composition assets

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 3.0s — "Sick Leave" + "120 days a year. Here's how to claim them."
2. Step 1: Choose the type — 4.5s — select settles on Sick Leave; blue balance panel
   shows Remaining 120 / Used 0 / Allowed 120
3. Step 2: Pick the dates — 4.0s — range fills; green "Total days: 5" panel
4. Step 3: Attach the report — 4.5s — "Document (Required)" + `medical-report.pdf` attaches
5. Step 4: Submit and track — 4.5s — "Submit Request"; Pending Manager → Pending HR → Approved
6. How it's paid + outro — 3.5s — 100% / 50% / Unpaid cards, then logo

## Audio
- Audio role: warm corporate bed with sparse, motion-matched UI accents
- Audio arc: bed enters low and holds steady under the four instructional steps, lifts
  slightly for the pay-tier cards, fades under the final logo
- Music: `happy-beats-business-moves-vol-10-by-ende-dot-app.mp3` (109.96 BPM)
- Music treatment: start 0.0s, volume ~0.22 under instruction, small lift at the outro,
  fade out over the last ~1.5s
- Music cue guidance: bundled preset at
  `assets/music/cues/happy-beats-business-moves-vol-10-by-ende-dot-app.music-cues.json`.
  Strong cues: 15.82s, 18.55s, 20.19s, 20.74s. Lock the **Approved** badge near 15.82s and
  the pay-tier card set into the 18.5-20.7s range. Beat grid ~0.55s apart — for the status
  chips and the pay-tier cards (readable text) snap to **every other** beat, not every beat.
- Audio-reactive treatment: subtle; drive the orange accent glow and card presence from
  music RMS/bass. No waveform, equalizer, notes, or particles.
- Audio-coupled moments:
  - Scene 2 — simulated dropdown selection → one quiet UI click
  - Scene 3 — green total-days panel arriving → one light tick
  - Scene 4 — "Choose File" press + file row appearing → click, then a soft confirm
    (the clearest sound in the edit; this is the rule the video teaches)
  - Scene 5 — status chips advancing → quiet tick each, one clear payoff on Approved
  - Scene 6 — three pay-tier cards arriving → card sounds; one soft hit on the logo
- SFX selection guidance: sparse and professional. Sound only on the four real
  interactions plus the outro cards. No sound on ordinary text entrances.
- SFX analysis guidance: use `/home/user/latent-spaces/brag/skills/brag/assets/sfx/sfx-analysis.md`;
  prefer low high-frequency-risk files for the repeated chip/card sounds.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, and volume after
  the animation exists.
- Audio files: copy the chosen music and SFX into `brag-output/composition/assets/`

## Hyperframes Instructions
Load `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`,
`hyperframes-keyframes`, `hyperframes-cli`. This is the `/brag` workflow — do not enter
the `hyperframes` entry-point intent interview or its generic promo workflow. Prefer
native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show real UI, real copy, real colors from FFI HR (the form card is the centerpiece).
- **Every instructional line must be readable**: short labels ~0.8s settled minimum,
  sentences ~0.3s/word. This is a tutorial — legibility outranks pace everywhere.
- Keep the video at 24.0s (15-25s bound).
- Include the music bed and the sparse SFX layer described above.
- Treat audio notes as guidance; choose SFX after the animation exists.
- Use 1-3 strong-cue locks only; ignore any cue that hurts readability.
- Consider a subtle audio-reactive treatment on the orange accent.
- Use local assets; no remote runtime dependencies.
- Run `hyperframes check` before render — brag's single gate. Fix every error,
  including WCAG contrast failures (orange `#f97316` on white fails for small text —
  use `#0f172a`/`#64748b` for body copy and reserve orange for large display type,
  chips, and accents, or use the darker `#ea580c` where orange text is needed).

## Factual accuracy (do not paraphrase these into something else)
- 120 sick days per year is the cap.
- Pay tiers, in order: days 1-30 at 100%, days 31-90 at 50%, days 91-120 unpaid.
- A medical report document is **mandatory** for sick leave (blocked client- and server-side).
- Approval chain shown: Pending Manager → Pending HR → Approved.
