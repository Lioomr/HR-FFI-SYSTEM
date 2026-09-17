# Sick Leave tutorial video

A 24.8s employee-facing walkthrough of the Sick Leave request flow, generated with
the [`/brag`](https://github.com/latent-spaces/brag) skill and rendered by
[Hyperframes](https://hyperframes.heygen.com/).

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

One deviation from `translations.ts`: it spells the unpaid leave type
`"اجازه بدون راتب"`. The video uses the correct `"إجازة بدون راتب"`. The app string looks
like a typo worth fixing.

> Note: `.agents/skills/leave_management.md` describes the sick pay tiers as
> "30/30/60", which does not match the code (30 full / 60 half / 30 unpaid). The video
> follows the code.
