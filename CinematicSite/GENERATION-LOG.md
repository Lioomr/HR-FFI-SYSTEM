# Generation log — FFI / The Line of Certainty

Generation date: 2026-07-16  
Creative direction: **Measured Horizon** / the locked *Line of Certainty* scenario  
Source still tool: ChatGPT native image generation (`image_gen`)  
Motion tool: Higgsfield MCP image-to-video only  
Still-input policy: no FFI logo, client logo, client project photography, or profile page was given to a generative model.

## Credit and model record

- Authorized Higgsfield plan: Starter.
- Live balance before generation: **100.5 credits**.
- Model recommendation was queried for locked-frame architectural image-to-video. The catalog also identified Cinema Studio Video 3.0 as the most advanced cinema-grade option; it was selected for the hero and MEP detail where geometry stability is most visible.
- Exact no-job preflights: Cinema Studio Video 3.0, 4 seconds, 16:9, silent: `1080p = 40 credits`, `720p = 20 credits`.
- Submitted quality allocation: 01 Datum at 1080p (40), 04 Pulse at 1080p (40), 06 Life at 720p (20): **100 credits**.
- Live balance after submission: **0.5 credits**. The balance was used as a quality budget; no lower-quality alternative or unrelated generation service was substituted.
- Higgsfield MCP workflow: `media_upload` -> direct presigned upload -> `media_confirm` -> `generate_video` -> `job_display` -> local download. Provider URLs are intentionally not stored in this repository.

## Consistency lock

All seven ChatGPT-generated stills use a common architectural world: low-saturation graphite/mineral neutrals, warm Saudi side light from frame-right, stable 24-28 mm wide architectural framing, credible construction detail, restrained grain, and one construction-orange datum. The datum is a solid physical mark with consistent behavior, never a logo, liquid, electrical effect, or fake brand treatment. Generated images contain no text, watermark, client mark, FFI mark, people, vehicle, or identifiable real project.

## Source stills

| File | Website act | Source dimensions | Submitted still prompt |
| --- | --- | ---: | --- |
| `assets/images/01-datum-potential.png` | The Datum / Potential | 1672 x 941 PNG | A near-dark, untouched Saudi ground plane of compacted dry earth and mineral gravel under a graphite sky; one ultra-thin construction-orange survey datum enters from lower right and locks at a small steel marker. Stable low 24 mm camera, broad dark left/upper-left typography-safe negative space, warm right-side dawn light. No buildings, people, machinery, text, logo, city, neon, or fantasy terrain. |
| `assets/images/02-ground-infrastructure.png` | Ground / Infrastructure | 1672 x 941 PNG | A plausible civil-engineering cutaway directly beneath the same ground: compacted strata, drainage channel, concrete utility culvert, conduit sleeves, graded road base, and the datum as a control level. Wide 16:9 composition with a quiet upper-left plane; graphite, earth, concrete, steel, and no labels, diagram styling, people, machinery, or impossible geometry. |
| `assets/images/03-frame-construction.png` | Frame / Construction | 1672 x 941 PNG | A physically credible monumental building frame rising from the surveyed ground: reinforced-concrete columns, slabs, steel edge members, stable structural grid, and deeply recessed openings. The datum rises from ground level along a beam; structure lives at right with a dark left void for type. No workers, cranes, client context, signage, warped columns, generic skyline, or sci-fi form. |
| `assets/images/04-pulse-coordination.png` | Pulse / MEP coordination | 1672 x 941 PNG | An elegant buildable MEP cutaway in the completed frame: ordered ducts, cable trays, water routes, electrical containment, supports, and a small mechanical threshold. The single orange datum runs through the systems as a controlled route; concrete and steel stay grounded, with warm side light and a dark left typography field. No screens, LEDs, text, people, collisions, neon, or magical cables. |
| `assets/images/05-renew-intervention.png` | Renew / Renovation | 1672 x 941 PNG | A credible renovation intervention: sound weathered mineral wall, old matte tile, and retained structure at left; repaired concrete, flush dark metal, glass, and new floor threshold at right. Old and new coexist at one clean orange-marked seam. No demolition spectacle, rubble, labels, workers, furniture clutter, client context, or morphing materials. |
| `assets/images/06-life-public-realm.png` | Life / Landscape and public realm | 1672 x 941 PNG | A buildable Saudi public realm: long mineral path, concrete seating edges, shade structure, graded planting beds, young desert-tolerant trees, irrigation/water-management, and a calm runnel. The datum organizes the path edge toward the horizon. No literal King Salman Park/NEOM view, people, recognisable city, lush resort treatment, logos, or decorative orange elements. |
| `assets/images/07-proof-horizon.png` | Proof and Horizon / Confidence | 1672 x 941 PNG | A completed, non-identifiable Saudi horizon formed from low graphite concrete structures, precise retaining edges, muted planted terraces, and a thin orange horizon datum. Broad calm left/sky space is reserved for evidence, contact details, and the authentic implementation-layer logo. No literal project, city skyline, flag, text, logo, or speculative mega-city. |

## Image-to-video outputs

Every selected clip was first preflighted without submitting a job. One directed candidate was created for each selected scene. All three were inspected at true start, midpoint, and end frames before being admitted to runtime.

### `01-datum-potential`

- Website role: full-screen Act 1 opening environment and survey lock.
- Source still: `assets/images/01-datum-potential.png`.
- Higgsfield model/settings: Cinema Studio Video 3.0 (`cinematic_studio_3_0`), start-image input, 4 seconds, 16:9, 1080p, `genre: drama`, native audio disabled, one output.
- Job record: `30d5efa6-4127-47fb-90a6-806df7a040dc`.
- Animation prompt: Lock the start image's marker geometry, gravel plane, horizon, dark left negative space, datum thickness/path, material texture, and right-side light. Start on the exact still. Make one silent 4-second continuous 2.5% forward survey approach; only low dust/haze move and the datum settles into a constant solid line. Keep terrain, marker, horizon, and line rigid. End stable. No cut, timelapse, jump, morphing, new structure, people, vehicle, text, logo, watermark, birds, neon, liquid/fire/electricity, or flicker.
- Final source: `assets/videos/01-datum-potential-source.mp4` — H.264, 1920 x 1080, yuv420p, 24 fps, 4.041667 seconds, video only.
- Browser scroll master: `assets/videos/01-datum-potential-scroll.mp4` — H.264, 1920 x 1080, yuv420p, 24 fps, no audio, faststart, no B-frames, 3-frame/0.125-second keyframe cadence.
- Poster: `assets/posters/01-datum-potential-poster.jpg` at 0.05 seconds.
- Inspection outcome: accepted; camera approach is coherent, marker and landscape remain stable, no text/logos/extra objects.

### `04-pulse-coordination`

- Website role: Act 4 MEP/turnkey coordination scroll sequence.
- Source still: `assets/images/04-pulse-coordination.png`.
- Higgsfield model/settings: Cinema Studio Video 3.0 (`cinematic_studio_3_0`), start-image input, 4 seconds, 16:9, 1080p, `genre: drama`, native audio disabled, one output.
- Job record: `2fd5abf5-4e1a-478b-a10c-37c289fe9fdc`.
- Animation prompt: Lock all columns, slab edges, ducts, trays, pipe spacing, supports, panels, ground section, side light, negative space, and every orange route. Start on the still and make one silent, continuous 2% forward drift. One controlled orange pulse travels once along the existing route then resolves to a constant solid line; only small dust movement and imperceptible HVAC shimmer are allowed. All systems remain aligned and buildable. End stable. No cuts, roll, speed ramp, people, text, logo, screens, blinking LEDs, electricity, new pipes, collision, bending/morphing, sci-fi additions, or flicker.
- Final source: `assets/videos/04-pulse-coordination-source.mp4` — H.264, 1920 x 1080, yuv420p, 24 fps, 4.041667 seconds, video only.
- Browser scroll master: `assets/videos/04-pulse-coordination-scroll.mp4` — H.264, 1920 x 1080, yuv420p, 24 fps, no audio, faststart, no B-frames, 3-frame/0.125-second keyframe cadence.
- Poster: `assets/posters/04-pulse-coordination-poster.jpg` at 0.05 seconds.
- Inspection outcome: accepted; the pulse is visually stronger by design but follows the existing route, and all concrete/MEP geometry remains coherent.

### `06-life-public-realm`

- Website role: Act 6 landscape/public-realm sequence.
- Source still: `assets/images/06-life-public-realm.png`.
- Higgsfield model/settings: Cinema Studio Video 3.0 (`cinematic_studio_3_0`), start-image input, 4 seconds, 16:9, 720p, `genre: drama`, native audio disabled, one output.
- Job record: `96590ae7-ef30-4335-b6fe-0144b7cfdfe1`.
- Animation prompt: Lock the path, water runnel, shade canopy, planting layout, low walls, trees, horizon, datum route, material palette, and late light. Start on the still; use one silent continuous 2% lateral-plus-forward track toward the horizon. Leaves may move gently and shallow water may ripple; the orange route remains a thin fixed solid edge. Structures, paving, and horizon remain stable. End calm and stable. No cuts, people, vehicle, text, logos, flags, changing planting, new architecture, roll, jump, morphing, tropical weather, neon, orange liquid/fire/electricity, or flicker.
- Final source: `assets/videos/06-life-public-realm-source.mp4` — H.264, 1280 x 720, yuv420p, 24 fps, 4.041667 seconds, video only.
- Browser scroll master: `assets/videos/06-life-public-realm-scroll.mp4` — H.264, 1280 x 720, yuv420p, 24 fps, no audio, faststart, no B-frames, 3-frame/0.125-second keyframe cadence.
- Poster: `assets/posters/06-life-public-realm-poster.jpg` at 0.05 seconds.
- Inspection outcome: accepted; slow camera movement, water, planting, canopy, and orange route remain visually stable.

## Browser-optimization record

All browser masters were made from the accepted local source clips with no audio, `yuv420p`, `faststart`, controlled CRF 19 H.264 encoding, 24 fps, no B-frames, a three-frame keyframe interval, and no motion interpolation. The source clips were 24 fps; preserving native cadence avoids interpolation artifacts while the frequent keyframes make direct `currentTime` updates responsive.

```text
ffmpeg -i input.mp4 -map 0:v:0 -an -c:v libx264 -preset slow -crf 19 \
  -pix_fmt yuv420p -r 24 -g 3 -keyint_min 3 -sc_threshold 0 -bf 0 \
  -movflags +faststart output-scroll.mp4
```

All runtime media is repository-relative; no Download/Desktop/temporary/provider URL is referenced at runtime. Each individual asset is well below GitHub's 100 MB file limit.

## 2026-07-18 — From Commitment to Completion / approved source stills

Creative direction: corporate, Arabic-first construction narrative; credible,
calm, and materially grounded. This is the currently approved art direction.
Source still tool: ChatGPT native image generation (`image_gen`) only.
Image-to-video: **not started**. No generated still was supplied with the FFI
logo, a client logo, a real project photograph, an official Saudi flag, or a
leadership portrait.

| File | Approved website role | Source dimensions | Controlled content |
| --- | --- | ---: | --- |
| `assets/images/01-opening-riyadh-identity-v2.png` | Opening / Saudi identity | 1672 x 941 PNG | Riyadh atmosphere, distant Kingdom Centre, and a bare flagpole; no generated flag, text, or logo. |
| `assets/images/02-leadership-foundation-backdrop-v2.png` | Founder and leadership backdrop | 1672 x 941 PNG | Concrete colonnade and bronze threshold; no people. Authentic unaltered portraits will be composited in implementation. |
| `assets/images/03-construction-delivery-v2.png` | What FFI Builds / construction | 1672 x 941 PNG | Credible reinforced-concrete frame and open sky; no workers or project identifiers. |
| `assets/images/04-delivery-coordination-v2.png` | How FFI Works / coordination | 1672 x 941 PNG | Ordered ducts, cable containment, piping, and supports; no screens or sci-fi treatment. |
| `assets/images/05-capability-infrastructure-v2.png` | Capability at Scale / infrastructure | 1672 x 941 PNG | Buildable civil water and utility work in a dry Saudi-like landscape. |
| `assets/images/06-project-proof-industrial-v2.png` | Project Proof | 1672 x 941 PNG | Generic completed industrial facility only; not a depiction or claim about any named FFI project or client. |
| `assets/images/07-ffi-standard-completion-v2.png` | FFI Standard | 1672 x 941 PNG | Finished architectural threshold, warm night illumination, no branding. |
| `assets/images/08-contact-completed-horizon-v2.png` | Contact / completion horizon | 1672 x 941 PNG | Calm completed built environment at dusk; no text, logo, or client reference. |

### Visual QA and implementation constraints

- Every approved source image was visually inspected at full-frame before
  admission. The set has a consistent 1672 x 941 landscape master size.
- Generated images contain no readable text, brand marks, Arabic script, people,
  literal client facilities, flags, or speculative/game-like visual effects.
- The supplied authentic FFI logo and Saudi Riyal symbol are implementation
  assets, not generative inputs. A verified official Saudi flag asset must be
  used if a readable flag is shown.
- Founder and leadership imagery must use original high-resolution portraits
  without AI alteration or outpainting. The current reference page only confirms
  Fathi Fouad Itani (Founder & CEO), Abdulaal Sultan (Executive Manager), and
  Georges A. Chebli (Operations Director).
- Do not turn a generic proof image into a client association. Name project
  evidence only from verified copy, and show client logos only with written
  permission.

## Attribution and usage

- FFI logo: the original user-supplied PNG is copied unchanged to `assets/brand/ffi-official-logo.png`; it is not generated, traced, recolored, or cropped.
- Source stills: original ChatGPT native image-generation output created for this project.
- Motion clips: original output generated through the connected Higgsfield MCP account. The MCP returned no provider-specific attribution restriction. Use remains subject to the account/provider terms in force for the user.
- Inspiration references informed design principles only. No third-party image, clip, project photo, or client logo is bundled.
