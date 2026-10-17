# ApolloCut Launch Kit 🚀

Everything needed for a launch that stands a chance: paste-ready copy, the right order, the right rules.
**Media assets** (use these in every post — threads with the video massively outperform text):

- 🎬 **Promo video** (12 s, square, silent-friendly): [`docs/promo.mp4`](promo.mp4) — attach this on X/Bluesky/LinkedIn/Discord
- 🖼️ **Promo GIF** (for README embeds & forums that don't take mp4): [`docs/promo.gif`](promo.gif)
- 🏛️ **Engraving plates** (avatars, thumbnails, post art): [`docs/art/`](art/)
- 📇 **Social preview card** (1280×640): [`docs/social-preview.png`](social-preview.png) → upload in repo **Settings → General → Social preview**

---

## 1. The one-liner (use everywhere)

> **ApolloCut — the free & open-source desktop video editor.** Premiere-style non-linear timeline, keyframed effects, GPU preview, and a bundled FFmpeg engine that exports real H.264/HEVC/ProRes. 100% local, MIT, free forever.

## 2. Show HN (news.ycombinator.com/submit)

**Title** *(≤80 chars, factual, no emojis — HN hates hype)*:
```
Show HN: ApolloCut – Free, open-source desktop video editor (Electron + FFmpeg)
```

**Text** (HN allows a text intro under the link — keep it maker-honest):
```
Link: https://github.com/esoexe/ApolloCut

Hi HN — I built a full Premiere-style non-linear editor that runs fully offline
and is MIT-licensed. Multi-track timeline with blade/ripple/detach-audio,
keyframed effects with bezier easing, adjustment layers, audio fades/meters,
and a bundled FFmpeg engine doing real H.264/HEVC/ProRes exports (plus a
headless CI mode: `node hf-run-apollocut.js project.json --nodes N`).

Stack: Electron 33, vanilla JS frontend with a WebGL compositor for the preview,
ffmpeg-static for render. Projects are plain JSON files.

Windows installer is built by GitHub Actions on every tag. I'd love brutal
feedback on the timeline code (renderer/js/) — what would you do differently?
```
**HN rules**: post once, never ask for upvotes, reply to every comment humbly in the first hours.

## 3. Reddit (pick per sub rules; space posts a day apart)

**r/opensource** · title:
```
ApolloCut — I open-sourced my Premiere-style desktop video editor (MIT, Electron+FFmpeg, built-in H.264/HEVC/ProRes export)
```
**r/VideoEditing** *(rules demand informative, not just link)*:
```
[FREE/OPEN-SOURCE] I got tired of paying for Premiere, so I built an editor instead — ApolloCut

Video editing cut: promo here.

Full NLE workflow: multi-track timeline, ripple/blade, nested sequences,
keyframed effects with bezier easing, audio fades & meters, chroma key,
and a bundled FFmpeg render engine (H.264 / HEVC / ProRes / WebM / GIF).
Runs 100% locally — no account, no telemetry, no watermark.

Windows installer on GitHub Releases. MIT license, contributions welcome.
Still young software — feedback wanted.
```
**r/FOSS** and **r/webdev** (talk stack & architecture there).
⚠️ Read each sub's self-promotion rules first; when in doubt, flair & disclose authorship.

## 4. X / Bluesky thread (5 posts)

1> 18 months of editing frustration ended in one blind decision ⚖️
   I built my own video editor — and it's free & open-source.
   ApolloCut v1.3.3 is out.
   🧵 [1/5]  *(attach promo.mp4)*

2> It's a REAL Premiere-style NLE not a toy:
   multi-track timeline · ripple/blade · nested sequences
   keyframed effects with bezier easing · audio fades & live meters
   chroma key · WebGL GPU preview [2/5]

3> The render engine is bundled FFmpeg:
   H.264, HEVC, ProRes, WebM, WAV, MP3, GIF.
   It can even render headless from the command line for CI pipelines.
   Everything runs locally. No account. No telemetry. No watermark. [3/5]

4> The mascot? A blindfolded Apollo bust.
   Editing tools shouldn't play favorites with your wallet.
   The entire app is MIT — fork it, ship products with it, learn from it. [4/5]

5> Windows installer on GitHub Releases.
   Source: https://github.com/esoexe/ApolloCut
   Star it if you believe video editing should be free.
   Feedback genuinely welcome — what should v1.4 do? [5/5]

## 5. Discord / Slack blurb

```
⚖️ Launched ApolloCut — a free & open-source desktop video editor (MIT).
Premiere-style timeline, keyframed effects, audio mixing, bundled FFmpeg
(H.264/HEVC/ProRes), zero cloud, zero subscription.
https://esoexe.github.io/ApolloCut/ — AMA about building the timeline engine!
```
(post only in servers' #self-promo / #showcase channels)

## 6. Product Hunt (if you launch there)

- **Name**: ApolloCut · **Tagline**: *The free, open-source desktop video editor*
- **Description**: paste Section 2 + feature bullets from the README
- **Gallery**: 1) promo.mp4 2) hero plate 3) timeline plate 4) platform plate
- **Topics**: Open Source, Video, Developer Tools

## 7. Launch order & timing 🗓️

1. **Tue/Wed/Thu, 08:00–09:00 PT** → post Show HN (peak HN traffic)
2. Same day, 15 min later → X thread (link to HN in a reply, not the main tweet)
3. Day 2 → Reddit r/VideoEditing (context-heavy post), r/FOSS next week
4. Day 3 → Product Hunt Tuesday later that week
5. **First 3 hours after every post: reply to everything.** Momentum is in the comments.
6. Update the site + README with "As seen on" badges if any post cracks front page.

## 8. North-star rules

- 📽️ Every post carries the video or a plate image. Posts with art win.
- 🚫 Never buy upvotes/bots. Instant, permanent death.
- ✅ One clear CTA everywhere: **github.com/esoexe/ApolloCut** (then let the README sell the star).
- 🔁 Every feature release = a new legitimate news cycle (v1.4, v1.5…). Plan one every 2-4 weeks.

The vase is painted; throw good. ⚖️
