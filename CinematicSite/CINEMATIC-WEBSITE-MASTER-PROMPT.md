You are an autonomous creative director, visual researcher, motion designer, and senior frontend engineer.

Create a complete, production-ready, cinematic scroll website from scratch. There is no existing website to inspect, preserve, refactor, or upgrade.

This is a one-shot build. Handle the research, creative direction, ChatGPT image generation, Higgsfield MCP video generation, asset preparation, website design, implementation, browser testing, performance optimization, and final refinement yourself.

Use ChatGPT's native image-generation capability exclusively to create every original source still. Do not use Higgsfield, its unlimited image models, or any other provider for still-image generation. Use the connected and authorized Higgsfield MCP server exclusively to animate approved ChatGPT-generated stills through image-to-video models. Higgsfield credits are reserved for image-to-video generation only. Verify access through the MCP tools, inspect the available video models, confirm the remaining credit balance, and preflight the expected cost before submitting any video generation. Do not switch to Google Flow, Runway, Kling, Luma, or another manual service in this autonomous path. Do not install unofficial credential-harvesting packages, start a paid subscription, or make a purchase.

Build the experience using the generated image-to-video footage, original typography, CSS, SVG, Canvas, and scroll-driven animation.

Do not ask me to choose minor implementation details. However, this project has an explicit review gate: first build and obtain approval for the complete narrative scenario and section-by-section content plan; only then propose the image system; only then generate stills or image-to-video. Do not generate imagery, footage, or a final interface before the scenario and image plan are approved by the user.

Only stop for input if an unavoidable external restriction makes completion genuinely impossible.

## 0. Company source of truth, required identity, and locked scenario

This website is for **Fathi Fouad Itani Contracting Company (FFI)**, a diversified Saudi contracting company established in 2006 and restructured as a company in 2024. Treat the following company profile as the primary factual source:

`D:\FFI HR SYSTEM\HR-FFI-SYSTEM\FFi Company Profile FV 15-12-2025.pdf`

Read and visually inspect the complete profile before research, art direction, writing, image generation, or implementation. Ground all company claims, service descriptions, dates, project names, and proof points in that document. Do not invent certifications, statistics, clients, capabilities, locations, awards, or sustainability claims that are not supported by the profile.

The profile positions FFI as a general contracting and facilities-management partner working across construction, infrastructure, renovation, landscape, hardscape, MEP, civil works, utilities, and turnkey delivery. Its portfolio spans industrial, commercial, residential, medical, infrastructure, and public-realm work, with examples including factories, a data center, residential communities, hospitals, a water factory, a gas pipeline, King Salman Park, and NEOM. Use this breadth to show one integrated delivery system rather than presenting disconnected service cards.

The existing FFI About page may be inspected **only** to locate user-approved authentic leadership portraits and confirm their displayed names/titles: `https://fficontracting.com/about/`. Do not preserve, imitate, or reuse the existing website’s visual design, layouts, long biography cards, or unrelated assets.

### Required logo

Use the official user-supplied logo from:

`D:\FFI HR SYSTEM\HR-FFI-SYSTEM\Logo FFI.png`

Copy it into a repository-relative asset location before implementation. Use the real file directly in the header, opening identity moment, and final contact act. Preserve its proportions, orange and gray colors, transparency, and clear space. Never redraw, regenerate, trace, distort, recolor, crop, typeset over, or ask an image model to reproduce the logo. Generated imagery must contain no fake FFI marks or accidental text; composite the authentic logo in the website layer instead.

### Locked production scenario: From Commitment to Completion

This section is the approved creative brief and **supersedes every conflicting scenario, act order, game-like interface instruction, generic fictional-brand instruction, and generic narrative suggestion elsewhere in this prompt**. Do not implement the deprecated “Line of Certainty” scenario below.

The website must feel like a premium, credible Saudi contracting-company website: disciplined, project-led, human, and trustworthy. It must never feel like a video game, a technology dashboard, a tourism film, or an experimental art demo. Avoid gamified counters, chapter-level indicators, HUD rails, neon traces, heavy kinetic blur, aggressive scrolling effects, dashboard cards, and decorative motion without a business purpose. Motion must be calm, architectural, and useful.

#### Required bilingual system

- Arabic is the default language and must use `lang="ar"` with correct RTL layout, spacing, reading order, navigation behavior, and punctuation treatment.
- English is a complete LTR alternative through a clear `العربية | EN` header switch. Do not crowd every scene by displaying duplicate long Arabic and English copy simultaneously.
- Use **Alexandria** as the Arabic display and body family. Bundle it locally (for example through `@fontsource/alexandria`) rather than relying on a live Google Fonts request.
- Use Space Grotesk for English display/body copy and IBM Plex Mono only for restrained technical metadata.
- All generated stills must contain no Arabic or English typography. Render all bilingual copy in semantic HTML/CSS so it remains accurate and accessible.
- Copy the official Saudi Riyal symbol from `D:\FFI HR SYSTEM\HR-FFI-SYSTEM\Saudi_Riyal_Symbol-2.svg` to a repository-relative brand asset. Use it precisely beside profile-verified monetary project values; never redraw or regenerate it.

#### Approved narrative: eight connected sections

1. **Opening — FFI at a glance**  
   Start on a full-screen black field with the authentic FFI logo centered. On the first deliberate scroll, the same real logo smoothly scales and settles into the navbar; it must be one continuous premium movement, not a cut. Reveal Saudi identity with a restrained tall flagpole at dawn or late afternoon, followed by a subtle distant Riyadh skyline / Kingdom Centre context. The landmark is an identity cue, never a claim that FFI built it. Use the message: Arabic `نبني ما يقف عليه التقدم`; English `We build what progress stands on.` Transition immediately into construction language so this is not a tourism sequence. Never ask an image model to render the Saudi flag's Shahada; if a readable flag is used, compose a verified non-generative official flag asset in the website layer.

2. **Founder and Leadership — Built on Responsibility**  
   Transition from the city horizon into a foundation/structural line and introduce the people behind FFI. Fathi Fouad Itani is **Founder & CEO**. The approved leadership team also includes Abdulaal Sultan, Executive Manager, and Georges A. Chebli, Operations Director. Use only approved authentic portrait files; do not generate, extend, alter faces, invent standing bodies, or create a new pose. Present Fathi first, then the wider leadership team as an editorial composition—not three staff cards or long resume biographies. Use a concise leadership principle and factual timeline: established 2006; transferred to a company in 2024. Do not invent attributed quotes.

3. **What FFI Builds — Built to Deliver**  
   Move from leadership into a structural grid and explain four connected delivery areas, not separate generic service cards: Construction; Infrastructure; MEP & Turnkey; Renewal & Place-Making. The factual scope covers industrial, commercial, residential, medical, civil works, utilities, renovation, facilities management, landscape, hardscape, and public realm. Core message: `From foundations to final handover.`

4. **How FFI Works — One Accountable Delivery Process**  
   Show one clear, calm delivery sequence: Understand; Plan & Coordinate; Build; Assure; Deliver. Explain study, engineering coordination, procurement, scheduling, cost control, site execution, quality, testing, and handover only where grounded in the profile. Headline: `Every decision must hold through delivery.` The visual language is drawings becoming coordination, coordination becoming construction, and construction becoming a completed place—never a spinning diagram or fake dashboard.

5. **Capability at Scale — Built for Complex Work**  
   Demonstrate that one delivery standard applies across industrial/factory facilities, water/gas/civil infrastructure, commercial and residential work, MEP/turnkey delivery, renovation, landscape, and public realm. Headline: `Complex work requires one clear standard.` Move from precise close-up coordination into credible project scale without inventing specific FFI project views.

6. **Project Proof — The Record of Delivery**  
   This is a calm editorial project journal, not a logo carousel or animated metrics dashboard. Headline: `Confidence is earned in the record.` Reveal selected profile-verified project records one at a time with project name, sector, location, verified scope, contract value, and factual delivery period/status where appropriate. Candidate records include Nestlé Salam Factory (Jeddah, SAR 108m), BRF Greenfield Factory (Jeddah, SAR 243.75m; explicitly label profile-listed completion Aug 2026), Al-Manhal Water Factory (Riyadh, SAR 18m), and NEOM (landscape, infrastructure, hardscape; SAR 9.25m). Localize money cleanly in Arabic and English using the supplied Saudi Riyal symbol.

   FFI remains the hero brand. Do not present client names as partnerships, joint ventures, endorsements, or `FFI × Client`. A Nestlé record may read `FFI / Project Delivery for Nestlé` only if FFI provides written approval to use the Nestlé logo. Without written logo permission, use the verified project name in typography only. Do not reuse client logos or literal project photography in generative inputs.

7. **The FFI Standard — What Remains After Handover**  
   After evidence, create a quiet confidence moment with completed materials, finished spaces, light, structure, and order. Headline: `The work is complete only when it works.` Present four concise principles: clear accountability; coordinated delivery; quality in execution; handover ready for use. Treat these as delivery principles, not unverified certification or performance claims.

8. **Contact — Begin with a Clear Conversation**  
   End with the authentic FFI logo, full company name, profile-verified contact details, and a direct project-conversation invitation. The final frame must be severe, calm, bilingual, and visually compatible with returning to the opening.

#### Visual and asset rules for this scenario

- The visual archetype is refined editorial construction: graphite, mineral, concrete, steel, warm Saudi daylight, controlled natural shadow, and restrained FFI orange.
- The FFI-orange structural/survey line may remain as a subtle connective motif, but never as neon, an energy pulse, a game path, or a HUD.
- Use only coherent, credible construction, infrastructure, architectural, leadership, and completed-place imagery. No speculative skyscrapers, heroic-worker clichés, malformed site geometry, fantasy materials, or unrelated city tourism imagery.
- Prefer full-bleed editorial compositions, generous whitespace, readable bilingual typography, and minimal purposeful motion over cards, counters, or visual spectacle.
- Before image generation, present a section-by-section asset plan with the intended role, scene, composition, crop, lighting, and motion. Wait for user approval, then choose the final images together.

### Deprecated scenario — do not implement

### Archived previous scenario: The Line of Certainty — do not implement

Build the experience around one continuous **FFI-orange survey line** moving through a controlled graphite, concrete, steel, glass, earth, and vegetation world. The line is not decoration: it represents FFI's responsibility from first study to final handover. It begins as a precise mark on untouched ground, becomes a structural datum, travels through engineered systems, guides renewal, organizes landscape, and resolves into a connected Saudi horizon.

Core message: **We build what progress stands on.**

Supporting idea: from ground, to structure, to systems, to life - one accountable partner.

The emotional progression is **potential -> precision -> coordination -> transformation -> proof -> confidence**. The experience should feel assured, exact, disciplined, and quietly ambitious. Avoid a futuristic technology-company tone, generic skyscraper montages, heroic worker clichés, uncontrolled demolition, magical liquid buildings, or imagery that implies projects FFI did not deliver.

Structure the narrative as seven connected acts:

1. **The Datum - Potential**  
   Begin in near darkness over a vast, restrained Saudi ground plane. A thin orange survey line appears with exact mechanical precision and establishes the visual system. Introduce the authentic FFI logo and the statement “We build what progress stands on.” Motion is minimal: slow atmospheric drift, a measured camera approach, and the line locking into position.

2. **Ground - Infrastructure**  
   The line maps levels, routes, roads, drainage, utilities, and civil networks beneath and across the terrain. Use sectional depth, survey markers, compacted earth, concrete channels, and controlled geometric reveals. Communicate that reliable outcomes begin with what cannot always be seen.

3. **Frame - Construction**  
   The datum rises into columns, slabs, structural grids, and a complete architectural frame. Show coordination and scale without using a time-lapse cliché. Geometry must remain physically credible and visually locked; the camera may move while the structure stays stable. This act represents industrial, commercial, residential, medical, and high-rise capability.

4. **Pulse - MEP and Turnkey Coordination**  
   Move through the structure into an elegant sectional world of ducts, electrical routes, water systems, mechanical rooms, and data infrastructure. The orange line becomes a controlled pulse connecting disciplines. Avoid neon sci-fi effects. The visual language should remain material, engineered, legible, and grounded in real construction systems.

5. **Renew - Renovation**  
   Transition from an existing worn surface or incomplete space into a precise renewed environment. Express assessment, preservation, replacement, and improvement through clean material transitions rather than explosive before-and-after effects. The old and new should coexist briefly so the change reads as deliberate intervention.

6. **Life - Landscape and Public Realm**  
   The line emerges outdoors and organizes paths, hardscape, shade, planting, water management, and public space. Move from mineral gray toward restrained living green while retaining the orange identity signal. Connect this act to FFI's landscape, infrastructure, and public-realm portfolio, including the scale suggested by King Salman Park and NEOM, without fabricating a literal project view.

7. **Proof and Horizon - Confidence**  
   Resolve the generated world into a calm, complete horizon built from the same structural language. Present verified portfolio evidence from the company profile through editorial typography, project facts, sectors, locations, budgets, and delivery periods where appropriate. End with the authentic FFI logo, the full company name, verified contact information from the profile, and a direct invitation to begin a project conversation.

Every generated still and motion clip must belong to one of these acts and preserve the same world: low-saturation graphite and mineral neutrals, FFI orange as the only strong signal, warm Saudi light, disciplined wide-angle architectural photography, believable scale, stable geometry, and carefully reserved negative space for typography. The orange line must maintain a consistent thickness, material behavior, and color across scenes so it can function as the visual handoff between sections.

Use real portfolio facts in the editorial evidence layer, but do not feed client logos, project photographs, profile layouts, or the FFI logo into generative models unless explicitly needed as a non-generative implementation reference. Generated visuals should express FFI's capabilities and standards, while verified text carries the factual proof.

## 1. Research the creative direction

Use Chrome or the available browser tools to research visual inspiration from:

- Pinterest
- MotionSites.ai
- premium hospitality websites
- cinematic architecture portfolios
- experimental editorial websites
- luxury fashion and automotive websites
- title sequences
- museum and cultural websites
- high-production GSAP websites
- award-winning interactive experiences

Pinterest and premium websites are inspiration sources only. Do not download or reuse copyrighted media from Pinterest, brand websites, Vimeo, YouTube, Instagram, or other unlicensed sources.

Study multiple references rather than copying one website. Extract reusable principles involving:

- typography
- composition
- color
- negative space
- image treatment
- pacing
- transitions
- scroll behavior
- navigation
- visual hierarchy
- responsive behavior
- cinematic storytelling

Save the strongest reference URLs in `RESEARCH.md`. For every reference, write one concise sentence explaining the principle taken from it.

Use the research to establish one original creative direction. The final result should feel like a coherent fictional brand or cultural experience, not a collage of unrelated references.

Choose a concept that works naturally with coherent generated imagery and controlled image-to-video motion. Strong candidate territories include:

- monumental architecture
- brutalist spaces
- fog, water, stone, and mineral surfaces
- industrial machinery
- macro material studies
- atmospheric landscapes
- abstract light and shadow
- scientific observation
- memory, time, pressure, weather, or transformation

Do not default to generic technology dashboards or purple AI branding.

## 2. Generate the still-image system and verify the Higgsfield MCP workflow

Create an image asset plan before generating anything. Define approximately 5–8 final stills and the role, aspect ratio, camera language, negative space, palette, materials, lighting, and intended motion for each one. Keep the final set compact enough to remain visually consistent and avoid wasting paid generation credits.

Use ChatGPT's native image generation for all stills. Generate them specifically for their website sections rather than creating generic art and forcing it into the layout. Do not call any Higgsfield image-generation model, including unlimited models; preserve the Higgsfield balance exclusively for image-to-video work after the still set has passed visual approval.

Maintain strict consistency across:

- environment and world-building
- lighting direction and time of day
- lens and camera height
- color palette
- materials and surface treatment
- grain and contrast
- architecture or product design language
- visual scale
- absence of unwanted text and logos

Inspect every generated image. Reject and regenerate images with malformed geometry, inconsistent identity, illegible text, accidental logos, weak composition, or insufficient space for interface typography.

After the stills are approved, verify the authorized Higgsfield MCP workflow:

- confirm the Higgsfield MCP server is connected and its generation tools are available
- confirm the account is authorized without exposing credentials
- inspect or query the models available for image-to-video generation
- ask the model-recommendation capability for the strongest options for the planned motion
- confirm the available credit balance
- preflight the cost of the proposed model, duration, resolution, aspect ratio, and number of outputs
- reduce or revise the plan before generation if the credit budget cannot support it

Use only the connected Higgsfield MCP server for video generation. Select the strongest suitable model based on the requested visual behavior, reference-image support, output quality, duration, and available credits. Use the MCP tools to submit jobs, monitor their status, retrieve completed outputs, and save the chosen files locally. Never expose credentials, tokens, private provider URLs, or account data in project files.

Treat the available Higgsfield balance as a **quality budget, not a savings target**. Prioritize the strongest model and settings for each scene whenever the improvement will be visible in geometry stability, physical realism, camera control, temporal consistency, detail, or final presentation quality. Do not select an inferior model, shorten an essential shot, lower resolution, or remove a necessary scene merely to preserve unused credits. Preflight costs to make deliberate decisions and prevent unfocused duplication, but use the approved budget confidently to achieve the best result. Begin with one carefully directed candidate per scene, inspect the complete output, and use targeted retries whenever a visible defect would weaken the finished website. Stop retrying only when the selected clip meets the defined acceptance criteria or when another model is clearly the better correction.

For every still selected for animation, write a dedicated image-to-video prompt describing:

- what must remain visually locked
- camera movement
- environmental or mechanical movement
- start and end states
- physical behavior
- duration and aspect ratio
- negative constraints
- no cuts, text, logos, morphing, or unrelated objects

Generate one strong candidate per scene first. Use a second attempt only when the first result fails a specific quality requirement. Do not repeatedly consume paid credits without a clear correction target. Select the strongest result and save the final MP4 inside the repository-relative `assets/videos/` directory. Save final source stills inside `assets/images/`. Do not leave runtime paths pointing to Downloads, Desktop, temporary folders, or provider URLs.

Create `GENERATION-LOG.md` containing:

- local still filename
- website section
- still-image prompt
- selected Higgsfield model and MCP workflow
- animation prompt
- output dimensions and duration
- generation date
- important settings
- local video filename
- any attribution or usage restriction imposed by the provider

If ChatGPT image generation is unavailable, the Higgsfield MCP server is unavailable or unauthorized, a supported login must be completed, or the available credit allowance cannot produce the planned clips, stop and report that exact blocker. Never fabricate generated files, bypass authentication, purchase credits, or silently replace the selected workflow with another video service or unrelated stock footage.

## 3. Select generated assets based on narrative roles

Do not generate isolated visuals first and invent arbitrary sections afterward.

Assign every clip a narrative purpose, such as:

1. Opening environment or impossible place
2. Approach or threshold
3. Material or object study
4. Pressure, transformation, or acceleration
5. Rupture or high-impact visual event
6. Evidence, resolution, or final reveal

Create a simple media map before implementation:

- section name
- emotional purpose
- clip filename
- source still
- animation tool
- source aspect ratio
- duration
- intended crop
- scroll range
- exact visual cue points
- foreground typography or interface layers
- transition into the following section

Design each generation with a clear opening composition, continuous transformation, and resolved final state. Use the complete successful generation from its true first frame to its true final frame whenever possible.

## 4. Prepare generated footage for browser scrubbing

Inspect every generated and downloaded video file with FFprobe or an equivalent tool.

Record:

- codec
- dimensions
- frame rate
- duration
- bitrate
- keyframe spacing
- presence of audio
- color format

Preserve the complete intended motion of every selected clip. Trim only unintended frozen padding, provider slates, or visible generation failures; any derivative must still begin on the intended opening composition and reach the intended resolved final state.

Remove audio unless it is specifically required. This website should not autoplay sound.

Create optimized browser-ready H.264 MP4 files with:

- `yuv420p`
- `faststart`
- controlled bitrate
- frequent keyframes
- no B-frames when possible
- dimensions appropriate for the intended viewport
- no unnecessary audio track

If scroll seeking appears choppy, delayed, low-frame-rate, or like a slideshow, create a dedicated scroll master.

A suitable starting FFmpeg command is:

ffmpeg -i input.mp4 \
  -vf "scale='min(1920,iw)':-2,fps=60" \
  -an \
  -c:v libx264 \
  -preset slow \
  -crf 19 \
  -pix_fmt yuv420p \
  -r 60 \
  -g 6 \
  -keyint_min 6 \
  -sc_threshold 0 \
  -bf 0 \
  -movflags +faststart \
  output-scroll.mp4

Use motion interpolation only if it materially improves the result without creating visible artifacts.

Keep every file below GitHub’s 100 MB per-file limit. Prefer substantially smaller web-ready files when possible.

Generate poster images from representative frames.

Give assets semantic filenames based on their website role, for example:

- `01-hero-environment.mp4`
- `02-threshold-approach.mp4`
- `03-material-study.mp4`
- `04-pressure-sequence.mp4`
- `05-evidence-resolution.mp4`

Never leave runtime references pointing to Downloads, Desktop, temporary folders, or attachment paths.

## 5. Create the website from scratch

Build a new cinematic single-page website.

Default stack:

- Vite
- semantic HTML
- modern CSS
- modular vanilla JavaScript
- GSAP
- GSAP ScrollTrigger
- Lenis
- Canvas only for one meaningful high-impact scene

Do not add React, Next.js, Three.js, Framer Motion, or another framework unless it provides a clear necessary advantage.

Create an original fictional identity based on the research and generated visual system.

Develop:

- a memorable brand name
- a restrained logo treatment
- concise editorial copy
- section labels
- chapter navigation
- a coherent typography system
- a small intentional color palette
- one strong accent color
- a consistent interface language
- a final contact or closing statement

Keep the copy short enough that motion and composition remain dominant.

The website should feel like one authored experience rather than several unrelated demos stacked vertically.

## 6. Build a cinematic narrative

Create approximately five to eight escalating acts.

A suitable structure is:

### Act 1 — Opening

- Immediate visual impact
- Full-screen footage
- One unforgettable headline
- Depth-separated typography
- Atmospheric interface details
- Strong hook within the first viewport

### Act 2 — Threshold

- Pinned spatial approach
- Video scrubbing begins at frame zero
- Typography and calibration elements react to exact cue points
- Perspective and masks create controlled depth

### Act 3 — Material

- Palette inversion or major compositional change
- Macro or material-focused generated footage
- Oversized kinetic typography
- A transition that makes the new footage feel native to the same world

### Act 4 — Pressure

- Increased scroll velocity and visual energy
- Faster cue rhythm
- SVG traces, frame lines, light movement, or typography impacts
- No random cards or fake dashboards

### Act 5 — Rupture

- One dedicated Canvas or DOM-based particle event
- Deterministic and reversible
- Eruption, temporary network formation, pointer attraction, or structural collapse
- This is the largest visual payoff, not an ambient background effect

### Act 6 — Evidence

- Footage and typography resolve into a calmer composition
- Horizontal movement, depth stack, or editorial plate sequence
- Clear thematic conclusion

### Act 7 — Contact

- Severe final composition
- Simple call to action
- Visually compatible with looping back to the opening frame

Adjust the number of acts to the quality of the footage. Fewer strong sections are better than many weak ones.

## 7. Non-negotiable scroll contract

The page must not scroll past a section while its animation continues off-screen.

For every scroll-controlled media section:

1. Use a tall outer section to provide scroll distance.
2. Place the visual experience inside a separate `100svh` pinned or sticky stage.
3. Keep that stage visibly fixed in the viewport for the complete authored animation.
4. Drive the entire scene from one normalized ScrollTrigger progress value.
5. Scrolling forward must advance the scene.
6. Scrolling backward must reverse it coherently.
7. Rapid and interrupted scrolling must immediately resolve to the correct deterministic state.
8. The video must remain paused; control `currentTime` directly from scroll progress.
9. Never let autoplay time compete with scroll time.
10. Stop expensive updates when the section is inactive.

For every scroll-scrubbed video:

- begin on the exact first frame
- include a short first-frame hold
- scrub from `0` to approximately `duration - 1/fps`
- reach the true final frame
- include a short final-frame hold
- transition only after that hold
- restore the correct frame when scrolling backward
- use metadata-derived duration rather than guessed timing

Every meaningful scroll interval must produce either:

- a visible intentional change
- a deliberate authored hold
- or a transition

Do not create long empty pinned sections.

Do not merely animate elements on scroll while allowing their stage to leave the viewport.

## 8. Integrate generated footage as part of the design

The generated clips must not look like ordinary embedded video players.

For every clip:

- extend its dominant edge colors into the surrounding section
- use matching gradients, overlays, grain, light, and color treatment
- remove visible player framing
- avoid generic rounded video cards
- choose `cover` or `contain` intentionally
- preserve important subjects during cropping
- synchronize page typography to real moments in the footage
- use masks, foreground layers, SVG traces, or interface rails to bind it to the design system
- grade clips toward a shared palette using CSS only when subtle adjustments are sufficient
- use FFmpeg color correction when sources need permanent normalization

If clips have dramatically different palettes, turn that difference into an intentional rhythm—dark act, pale act, dark act—rather than allowing accidental mismatches.

Do not cover mediocre footage with excessive overlays. Regenerate or replace weak clips.

## 9. Motion system

Use motion aggressively but coherently.

Possible techniques include:

- scroll-scrubbed video
- pinned storytelling
- masked reveals
- oversized typography
- multi-plane parallax
- controlled perspective
- velocity-reactive skew
- short blur impacts
- SVG line drawing
- aperture transitions
- horizontal depth stacks
- deterministic Canvas particles
- palette inversions
- interface calibration marks
- strong chapter transitions

Use transform and opacity wherever possible.

Avoid:

- random entrance animations
- every element fading upward
- constant floating
- meaningless 3D rotation
- excessive blur
- excessive scroll smoothing
- scroll-jacking
- unrelated visual effects
- motion that damages readability
- animations that continue after their section is gone
- transitions that exist only to fill time

The full journey should feel choreographed like a title sequence.

## 10. Performance

Performance is part of the visual quality.

Implement:

- cached DOM references
- one controlled Canvas loop
- adaptive particle counts
- capped device pixel ratio
- transform/opacity animation
- poster images
- critical-media preload only
- lazy loading for later media
- asset error handling
- cleanup for listeners and ScrollTriggers
- no uncontrolled requestAnimationFrame loops
- no repeated layout reads inside animation updates
- no horizontal overflow
- correct resizing behavior

Respect `prefers-reduced-motion`.

For reduced motion:

- show poster frames
- disable video seeking
- disable expensive particles
- preserve the complete visual composition
- keep navigation and content functional

Create a lightweight fallback for actual phone widths.

Do not disable the complete choreography merely because a desktop browser window is narrow. Portrait laptop/desktop recording windows around 600–800 CSS pixels wide should retain the full animation system when performance allows.

## 11. Automatic showcase mode

Add `?demo=1`.

In demo mode:

- Space starts or pauses automatic scrolling
- R resets to the exact opening frame
- duration is controlled from one central configuration value
- default duration is 15 seconds
- manual wheel or touch input pauses the automatic pass
- repeated resets remain deterministic
- the automatic pass reaches every major impact moment
- it reaches the true bottom of the page
- it does not leave videos between frames
- simplified recording chrome may be used

Manual scrolling remains the default outside demo mode.

## 12. Browser testing

After implementation, run the production build and open the actual website in Chrome.

Do not judge the result only from source code.

Test:

- opening impact
- full forward scroll
- full reverse scroll
- rapid wheel scrolling
- interrupted scrolling
- exact video first frames
- exact final-frame holds
- section pin boundaries
- whether any animation continues off-screen
- perceived frame rate
- video seeking latency
- transition collisions
- typography cropping
- navigation and menu behavior
- asset-loading failures
- automatic demo completion
- repeated demo resets
- one large laptop viewport
- one narrow portrait recording viewport
- one phone smoke test
- reduced-motion mode
- horizontal overflow
- console errors
- production build

Capture screenshots at the beginning, midpoint, and end of every major pinned section.

If a section looks like a video rectangle, repair the background integration.

If video scrubbing looks slow or low-frame-rate, re-encode the source instead of hiding the problem with longer timing.

If the page leaves the pinned stage before the sequence finishes, repair the section and ScrollTrigger geometry.

Keep iterating until these issues are resolved.

## 13. Required deliverables

Complete all of the following:

- full working website
- production build
- generated source stills and optimized image-to-video footage
- poster images
- `RESEARCH.md`
- `GENERATION-LOG.md`
- semantic filenames
- still-image prompts, animation prompts, tool/model records, and usage restrictions
- responsive layouts
- reduced-motion fallback
- `?demo=1`
- README with setup, controls, and asset-attribution instructions
- sensible `.gitignore`
- no secrets or API keys
- no broken local file paths
- no files over GitHub’s 100 MB limit

Do not stop after research, a plan, or an initial implementation.

Finish the entire site, inspect it in the browser, fix weak scenes, replace incompatible footage, verify the build, and leave the workspace in a fully working state.

The result should feel like an original $50k+ cinematic website—not a generic AI-art template, not a generic portfolio, and not a collection of disconnected effects.

You may autonomously install any dependencies or tools required to complete the project. Use the existing package manager, prefer minimal project-local packages, update the lockfile, and avoid unnecessary frameworks. After installation, resolve conflicts, run the production build, check for vulnerabilities, and document any system requirements. Ask only if credentials, payment, or administrator access is required.
