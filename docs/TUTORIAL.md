# Your first 10 minutes with ApolloCut

From installer to your first rendered file. No video-editing experience required.

## 1 · Install (2 min)
Grab `ApolloCut-Setup-…-x64.exe` from [Releases](https://github.com/esoexe/ApolloCut/releases/latest) → run it → if Windows shows SmartScreen click **More info → Run anyway** (we're a new, unsigned open project; that's normal). Launch ApolloCut from Start Menu or Desktop.

The app opens with a **demo project already in the bin** (title card, color bars, a demo tone) and a Welcome card with the 4-step loop. Play with the demo freely — nothing can break.

## 2 · Import your own media (1 min)
Drag any video/audio/image **from Windows Explorer straight onto the app** (or press `Ctrl+I`). Files land in the **Project bin** (left panel). ApolloCut never copies files — it edits in place, non-destructively.

## 3 · Build a cut (3 min)
- Drag a clip from the bin to the **timeline** (bottom).
- Move the playhead by clicking, or with `Space` to play/pause. `J/K/L` = reverse / pause / forward shuttle.
- **Razor**: `Ctrl+K` slices at the playhead (or the 🪒 Razor tool `R`).
- **Trim**: drag clip edges. **Move**: drag clip bodies. `Ctrl+Z` undoes anything instantly.
- Right-click a clip → **Detach audio** to cut picture and sound separately.
- Double-click a clip: watch it on the Source monitor first, then drop with In/Out trimmed — 3-point editing, pro style.

## 4 · Make it look good (2 min)
- Select a clip → **Inspector** (right panel): scale, position, opacity — click the **◆** diamond to add a **keyframe**, move the playhead, change the value → instant animation with bezier easing.
- **Effects tab** (right): Chroma Key (green screen), Blur, Sharpen, Saturation/Vibrance, Color wheels. Every value keyframable.
- Speed it right: **View → Scopes** shows the waveform & vectorscope while you grade — the pro way to match shots. And **Clip → Apply LUT (.cube)** if you have a favorite color look.

## 5 · Audio (1 min)
Click a clip → set **Volume** & **Pan**, then grab the little **fade handles** on clip edges to shape fade-in/out. Loop a selection with the loop toggle to check balance. Master meters live on the Program monitor.

## 6 · Pro tips for big footage
- **4K or high-bitrate phone clips?** Click the clip's **PX** button in the bin — ApolloCut quietly builds a 540p editing proxy; preview stays buttery, export still uses the original full-quality file. Toggle with **PX** on the Program monitor.
- **GPU button** (top-right of Program monitor): WebGL-accelerated preview engine. Leave it on.
- Editing stars: **Multicam** (Clip menu) for multi-angle shoots, **Nested sequences** for complicated projects, **Markers** for notes on the ruler.

## 7 · Export (1 min)
Press **`Ctrl+Shift+E` — Pro Export**:
- Presets: **1080p YouTube**, **4K**, or custom anything
- Codecs: **H.264** (everywhere) · **HEVC** (smaller, newer) · **ProRes** (edit-grade) · WebM; audio-only WAV/MP3; animated GIF for the internet
- Hardware encoders auto-detected (`h264_nvenc` on NVIDIA etc.), software fallback always works
- A live progress ETA + Cancel button; done → filename pops in your chosen folder

Need a caption file? **Export Captions (SRT)** in File. Need a review cut list for a Premiere/Resolve editor? **Export EDL**.

## 8 · Your project is a text file
Everything you made is an open JSON project (`Ctrl+S`). Version it, email it, regenerate it — and render it head-less in CI:
```
node hf-run-apollocut.js project.apollocut.json --nodes 4
```
Free forever. Your files stay on your disk. Now go cut something worth watching. ⚖️

**All keys: [SHORTCUTS.md](SHORTCUTS.md)**
