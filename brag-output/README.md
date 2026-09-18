# FFI HR tutorial videos

Short employee-facing walkthroughs, generated with the
[`/brag`](https://github.com/latent-spaces/brag) skill and rendered by
[Hyperframes](https://hyperframes.heygen.com/). Each topic ships an English and an
Arabic (RTL) cut that share one timeline, so a timestamp in one lands on the same
beat in the other.

## Sick leave

| File | What it is |
|---|---|
| `brag.mp4` | English cut (1920x1080, 24.8s, music + UI sound). Its first frame is the poster, so link previews land on the closing card. |
| `brag.jpg` | English poster still — use as `poster=` on a `<video>`, or as the custom thumbnail on platforms that accept one. |
| `brag-ar.mp4` | Arabic RTL cut — same timeline and audio, mirrored layout, Readex Pro. |
| `brag-ar.jpg` | Arabic poster still. |
| `brag-plan.md` | Creative plan, storyboard, beat map, and the source references every on-screen fact came from. |
| `composition-brief.md` | The handoff brief given to Hyperframes. |
| `share-copy.txt` | One-paragraph caption for posting the video internally. |
| `composition/` | The Hyperframes project for the English cut. |
| `composition-ar/` | The Hyperframes project for the Arabic cut. |

## Loans

| File | What it is |
|---|---|
| `brag-loan.mp4` / `brag-loan.jpg` | English cut (24.8s) and its poster. |
| `brag-loan-ar.mp4` / `brag-loan-ar.jpg` | Arabic RTL cut and its poster. |
| `composition-loan-en/` | Hyperframes project for the English loan cut. |
| `composition-loan-ar/` | Hyperframes project for the Arabic loan cut. |

Covers both loan types in one video: the limits, amount and months with the monthly
deduction preview, an Open vs Installment comparison, the approval chain, and
automatic payroll repayment.

Verified against code, not the docs:

- Open loan capped at 25% of basic salary — `Backend/loans/serializers.py:203`
- Installment capped at one basic salary — `serializers.py:234`
- Installment term 1–10 months — `serializers.py:177`
- Requires 6 months of service — `serializers.py:229`
- Monthly deduction = amount ÷ months — `RequestLoanPage.tsx:75`
- HR only recommends; the CFO decides — `Backend/loans/views.py`

> **Two open questions on the loan videos.**
> 1. `.agents/skills/loan_management.md` claimed an open loan "can only be requested in
>    the last 10 days of the month". **No such check exists in the backend.** The doc now
>    records the rule as unenforced instead of asserting it, and the videos leave it out.
>    Still open: either add the check to `LoanRequestCreateSerializer.validate()`, or
>    delete the orphaned `loans.request.error.openLoanWindow` translation keys.
> 2. The CFO's `refer_to_ceo` path adds a CEO stage. It is conditional, so the videos
>    show the common four-stage chain instead.

## Re-rendering

```bash
cd brag-output/composition        # or composition-ar
npx hyperframes check                              # lint + runtime + layout + contrast
npx hyperframes render --quality high --output ../brag.mp4      # ../brag-ar.mp4 for Arabic
```

After re-rendering, re-bake the poster as frame 0 so idle thumbnails stay correct:

```bash
cd brag-output
ffmpeg -y -ss 24.4 -i brag.mp4 -frames:v 1 -q:v 2 brag.jpg
ffmpeg -y -i brag.mp4 -i brag.jpg \
  -filter_complex "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]" \
  -map "[v]" -map 0:a -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -af "afade=t=in:st=0:d=0.06" -c:a aac -b:a 192k \
  -movflags +faststart out.mp4 && mv out.mp4 brag.mp4
```

The `afade` is load-bearing: the mixer plays the music bed's first sample at its
baseline gain before the fade-in tween resolves, which leaves an audible click at
t=0 otherwise.

## What the video asserts, and where it comes from

Every on-screen claim was read out of the code rather than the docs:

- 120 sick days per year — `SICK_MAX_DAYS_PER_YEAR` (`Backend/leaves/utils.py:31`)
- Pay tiers, days 1-30 @ 100%, 31-90 @ 50%, 91-120 unpaid — `SICK_FULL_PAY_DAYS` /
  `SICK_HALF_PAY_DAYS` / `SICK_UNPAID_DAYS` (`utils.py:32-34`), applied in that order
  at `utils.py:809-831`
- Medical report mandatory — enforced in `RequestLeavePage.tsx` (the `isSickSelected`
  validator) and again server-side at `utils.py:1270-1272`
- Approval chain Pending Manager -> Pending HR -> Approved — `Backend/leaves/views.py`
- All UI strings and colors are verbatim from `FrontEnd/src/i18n/translations.ts` and
  the `:root` tokens in `FrontEnd/src/index.css` — the Arabic cut uses the `ar` half of
  that same file, with Readex Pro (the app's `--font-ar`)

## Arabic cut notes

The two cuts share one timeline, so a timestamp in one lands on the same beat in the other.
RTL differences are layout-only: the sidebar moves to the right, the approval chain reads
right-to-left with `←` arrows, the date range puts the start date on the right, and press
animations originate from the right edge.

The unpaid leave type was previously misspelled `"اجازه بدون راتب"` across the app;
the videos used the correct `"إجازة بدون راتب"` and the app strings have since been
corrected to match (frontend translations, `leaves/views.py`, `core/error_translations.py`).

> Note: `.agents/skills/leave_management.md` describes the sick pay tiers as
> "30/30/60", which does not match the code (30 full / 60 half / 30 unpaid). The video
> follows the code.
