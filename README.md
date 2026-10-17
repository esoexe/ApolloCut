<p align="center">
  <img src="docs/banner.gif" width="900" alt="ApolloCut — the free & open-source desktop video editor">
</p>

<p align="center">
  <b>The free &amp; open-source desktop video editor that gives premiere editing back to everyone.</b><br>
  Non-linear timeline · keyframed effects · audio mixing · FFmpeg render engine — 100% local, 0€ forever.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge"></a>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows-blue?style=for-the-badge">
  <img alt="Version" src="https://img.shields.io/badge/Version-1.3.3-blueviolet?style=for-the-badge">
  <img alt="Built with" src="https://img.shields.io/badge/Built%20with-Electron%20%2B%20FFmpeg-8f6bff?style=for-the-badge">
</p>

---

## Why ApolloCut?

Professional video editing has been locked behind subscriptions and fortress ecosystems for a decade. **ApolloCut is the counter-answer:** a desktop NLE shaped around the classic "timeline + program monitor + bins" workflow professionals already know — with no account, no telemetry, no cloud, and a license (MIT) that says it stays free, forever.

The blindfold in our icon isn't decoration. Editing tools shouldn't play favorites with your wallet.

## ⚡ Features

<table>
<tr>
<td valign="top" width="50%">

### Timeline & Editing
- Multi-track video **and** audio, drag & drop from OS or the project bin
- Blade, ripple-delete, detach audio, nested sequences
- Undo/redo, snapping, markers with labels, ripple trim
- J-K-L shuttle, razor, marquee select, track lock/mute/hide
- Autosave every 30 s (projects are plain JSON — no lock-in)

### Real-time Preview
- GPU-accelerated compositor (WebGL) with automatic CPU fallback
- Chroma key (green screen), transform, crop
- Text & title overlays

</td>
<td valign="top" width="50%">

### Effects & Keyframes
- Bezier easing on every keyframable property
- Adjustment layers: grade an entire stack at once
- Gaussian blur, noise, sharpen, saturation/vibrance, color wheels
- Source-panel preview before you commit a cut (3-point editing)

### Audio & Export
- Per-clip volume, pan, fades, fade-curve handles
- Solo/mute per track, master live meters
- Pro export via bundled FFmpeg engine: **H.264 / HEVC / ProRes / WebM**, plus WAV, MP3 & animated GIF
- Hardware fallback chain that never leaves you without a render

</td>
</tr>
</table>

## 📦 Download

Grab the Windows installer (99 MB, everything bundled — no dependencies needed):

> **Releases** provide the official downloads; this project builds its installer automatically on every release tag via GitHub Actions.

While the very first CI release spins up, current binaries:

- **Installer** `ApolloCut-Setup-1.3.3-x64.exe` → https://gofile.io/d/yfdbA5lG
- **Portable zip** (no install) → https://gofile.io/d/6dDdQacF

*(temporary mirrors — prefer the Releases page)*

## 🔨 Build from source

```bash
git clone https://github.com/<you>/ApolloCut.git
cd ApolloCut
npm install
npm start            # runs the app in dev mode
```

Build the Windows installer yourself:

```bash
npm run dist         # → release/ApolloCut-Setup-<version>-x64.exe
```

Requirements: Node 20+ and npm. No other system dependencies — Electron and FFmpeg binaries are fetched by npm automatically.

### CLI headless export

ApolloCut can also run inside CI as a headless renderer:

```bash
node hf-run-apollocut.js project.apollocut.json --nodes 1
```

## 🧠 Tech

| Layer | Stack |
|---|---|
| Shell | Electron 33 (single-instance, custom protocol, native menus) |
| Editor UI | Vanilla ES modules — zero framework, zero lock-in |
| Preview | WebGL compositor + CPU fallback |
| Render engine | FFmpeg (bundled, `ffmpeg-static` b6.1.1) — real H.264/H.265/ProRes |
| Projects | Readable JSON, autosave + manual `.apollocut.json` |

## 🤝 Contributing

Yes please. See [CONTRIBUTING.md](CONTRIBUTING.md) — bug reports, feature ideas and pull requests are all welcome.

## License

[MIT](LICENSE) — free forever, for everyone. Take it, remix it, ship products with it. The only thing this license forbids is claiming you invented the wheel yourself.
