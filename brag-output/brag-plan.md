# Brag Plan: FFI HR — Sick Leave

> Adapted run: `/brag` normally makes a launch video. This run makes a **tutorial**
> video for employees: *how to file a sick leave request in the FFI HR system*.
> The creative laws (15-25s, readable, specific, show the thing) still apply.

## What is this app?
FFI HR is the company's Saudi-labour-compliant HR platform; this video covers one
workflow inside it — an employee filing a **Sick Leave** request and watching it
move through the manager → HR approval chain.

## The angle
A calm, in-product walkthrough. No abstract "streamline your absence workflow"
framing — the video shows the real `Request Leave` form, the real balance panel,
the real **Document (Required)** rule that blocks a sick request without a medical
report, and the real status chain. Four steps, then the pay tiers nobody knows.

## Hook (first 2-3 seconds)
The word **"Sick Leave"** in FFI orange on the dark sidebar navy, with the one line
that makes an employee keep watching: *"120 days a year. Here's how to claim them."*
That number is the hook — it is the actual `SICK_MAX_DAYS_PER_YEAR` from the code.

## Key moments (the middle)
- The leave-type dropdown opening and settling on **Sick Leave**, with the real blue
  balance panel appearing underneath: Remaining 120 | Used 0 | Allowed 120.
- The green **Total days: 5** panel appearing the instant the date range is picked.
- The **Document (Required)** label — the field that says *optional* for every other
  leave type and flips to *required* for sick. `medical-report.pdf` attaches.
- The status chain ticking over one stage at a time: Pending Manager → Pending HR → Approved.

## Outro / punchline
The pay tiers as three cards — 100% / 50% / unpaid — landing one by one, then the
FFI logo with **"Sick leave, handled."**

## User flow worth showing
Entry → key action → result:
1. Employee opens `Request Leave` and selects Sick Leave (balance loads).
2. Picks the date range and attaches the mandatory medical report.
3. Submits — the request enters the approval chain and comes back Approved.

## Tone
- Preset: `app-store`
- Creative direction: calm in-product HR tutorial — an onboarding clip, not an ad
- Interpretation: clean feature-card reveals, title-case labels, medium weight type,
  0.35-0.45s slides, generous holds so every instruction is actually readable.
  Energy comes from crisp transitions, never from yanking text away early.

## Format: landscape — 1920x1080
## Duration: 24.0s

## Visual identity (from the project)
Source: `FrontEnd/src/index.css` (`:root` design tokens)
- Background (dark frames): `#0d1117` (`--sidebar-bg`)
- Surface (form frames): `#ffffff` / `#f8faff` (`--surface-0` / `--surface-1`)
- Accent: `#f97316` (`--brand-primary`), light `#fb923c`, dark `#ea580c`
- Silver accent: `#94a3b8` (`--brand-accent`)
- Text: `#0f172a` (`--text-primary`), secondary `#64748b`
- Display font: Rubik
- Body font: Rubik
- In-form panel colors (verbatim from `RequestLeavePage.tsx`):
  balance panel `#f0f7ff` bg / `#91caff` border; total-days panel `#f6ffed` bg / `#b7eb8f` border
- Strongest visual element: the Request Leave card (`borderRadius: 16`) with its
  blue balance strip and green total-days strip
- Logo: `output_logo_transparent.png` (596x143, transparent)

## Copy that must appear verbatim (real UI strings from `src/i18n/translations.ts`)
- "Request Leave" / "Submit a new leave request"
- "Leave Type" / "Sick Leave"
- "Leave Balance" — "Remaining" / "Used" / "Allowed" / "Days"
- "Total days"
- "Document (Required)" / "Choose File"
- "Submit Request"
- "Pending Manager" / "Pending HR" / "Approved"

## Share copy (draft)
Sick leave in FFI HR, in four steps: pick the type, pick the dates, attach the
medical report, submit. 120 days a year — 30 at full pay, 60 at half, 30 unpaid.

## Audio direction
- Role: warm corporate bed with sparse, motion-matched UI accents
- Music: `happy-beats-business-moves-vol-10-by-ende-dot-app.mp3` (109.96 BPM)
- Music treatment: start at 0.0s, sit low (~0.22) under the instructional frames,
  lift slightly for the pay-tier cards, fade out under the final logo.
- Music cue guidance: bundled preset read from
  `assets/music/cues/happy-beats-business-moves-vol-10-by-ende-dot-app.music-cues.json`.
  Strong cues to target for major moments: **15.82s**, **18.55s**, **20.19s**.
  Lock the Approved badge and the pay-tier card set to cues in that range.
  Beat grid for sequential reveals (pay-tier cards, status chain): use every other
  beat — the grid is ~0.55s apart at this tempo, too fast for readable text lines.
- Audio-reactive treatment: subtle; let the orange accent glow and the card presence
  breathe with RMS. No waveform, equalizer, or particle visuals.
- SFX posture: sparse, professional. Motion-matched only.
- Audio-coupled moments: dropdown select click; file-attach confirmation; each status
  chip advancing; the three pay-tier cards arriving; one soft hit on the logo.
- Restraint rule: no sound on every text entrance. This is a tutorial — the viewer is
  reading. Audio supports the four interactions and nothing else.

## Storyboard

### Scene 1 — Hook — 3.0s
Dark `#0d1117` frame. "Sick Leave" slams in large in Rubik, FFI orange `#f97316`.
Under it, held: "120 days a year. Here's how to claim them." Small "FFI HR" mark.
Sequential/interaction: none.
Audio intent: warm bed starts, confident and unhurried.
Audio-coupled idea: none — let the music carry the open.
Music: warm corporate bed, entering at low volume.
Transition mood: clean slide → Scene 2

### Scene 2 — Step 1: Choose the type — 4.5s
White form card, `borderRadius: 16`. Header "Request Leave" / "Submit a new leave
request". Step chip "1" in orange. The "Leave Type" select opens and settles on
**Sick Leave**; the blue balance panel (`#f0f7ff` / `#91caff`) slides in beneath it:
"Leave Balance: Remaining: 120 Days | Used: 0 Days | Allowed: 120 Days".
Sequential/interaction: yes — simulate the dropdown opening and the option being
selected, then the balance panel arriving as a consequence.
Audio intent: one crisp, quiet select click on the option landing.
Audio-coupled idea: simulated selection → single UI click.
Transition mood: clean slide → Scene 3

### Scene 3 — Step 2: Pick the dates — 4.0s
Same card. Step chip "2". The date range fills in (2026-09-20 → 2026-09-24), then the
green total-days panel (`#f6ffed` / `#b7eb8f`) appears: "Total days: 5".
Sequential/interaction: yes — the range picker populates, then the green panel arrives.
Audio intent: soft confirmation on the total landing.
Audio-coupled idea: counter/panel arrival → one light tick.
Transition mood: clean slide → Scene 4

### Scene 4 — Step 3: Attach the medical report — 4.5s
Same card. Step chip "3". The field label reads **"Document (Required)"** in orange —
with a small callout: "Required for sick leave only." "Choose File" is pressed and
`medical-report.pdf` attaches with a check.
Sequential/interaction: yes — simulate the button press and the file row appearing.
Audio intent: a single satisfying attach confirmation. This is the rule the video exists
to teach, so it gets the clearest sound in the edit.
Audio-coupled idea: simulated click + attach → click, then a soft confirm.
Transition mood: clean slide → Scene 5

### Scene 5 — Step 4: Submit and track — 4.5s
Step chip "4". "Submit Request" is pressed. The card recedes and three status chips
advance one at a time, each holding long enough to read: **Pending Manager** →
**Pending HR** → **Approved** (the last in green, beat-locked to a strong cue ~15.82s).
Sequential/interaction: yes — simulate the submit press, then reveal the chain one chip
at a time on every other beat, holding the full chain on screen once complete.
Audio intent: a quiet tick per chip, then one clear payoff on Approved.
Audio-coupled idea: card-by-card sequence + a single announcement cue on Approved.
Transition mood: smooth wipe → Scene 6

### Scene 6 — How it's paid + outro — 3.5s
Dark frame. Three cards land one by one (beat-grid, every other beat, ~18.5-20.2s):
"Days 1-30 — 100% pay" / "Days 31-90 — 50% pay" / "Days 91-120 — Unpaid".
All three hold together, then the FFI logo with "Sick leave, handled."
Sequential/interaction: yes — three cards arriving one by one, then holding as a set.
Audio intent: slight lift for the cards, then the bed fades under the logo.
Audio-coupled idea: card sequence, one soft hit on the logo.
Music: lift, then fade out.
Transition mood: fade out — end

**Total: 3.0 + 4.5 + 4.0 + 4.5 + 4.5 + 3.5 = 24.0s**
**Music mood for this video:** upbeat-professional, low in the mix
**Audio summary:** A warm corporate bed holds steady under four instructional beats,
punctuated only by the four real interactions (select, date, attach, submit), lifts for
the pay-tier cards, and fades under the logo.

## Accuracy notes (verified against source, not assumed)
- 120 day/year cap: `SICK_MAX_DAYS_PER_YEAR = 120` (`Backend/leaves/utils.py:31`)
- Pay tiers: `SICK_FULL_PAY_DAYS = 30`, `SICK_HALF_PAY_DAYS = 60`, `SICK_UNPAID_DAYS = 30`
  (`utils.py:32-34`), applied in order at `utils.py:809-831` → days 1-30 @100%,
  31-90 @50%, 91-120 @0%.
- Document requirement: enforced client-side in `RequestLeavePage.tsx` (the `isSickSelected`
  validator) and server-side at `utils.py:1270-1272`.
- Status chain: employee with a manager starts at `pending_manager` → `pending_hr` →
  `approved` (`.agents/skills/leave_management.md`, `Backend/leaves/views.py`).
