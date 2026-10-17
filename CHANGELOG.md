# Changelog

All notable changes to ApolloCut are recorded here. This project follows [Semantic Versioning](https://semver.org).

## [1.5.0] — 2026-10-17

### Added
- **Pro Export loudness normalization** — one-tick broadcast-safe audio: FFmpeg `loudnorm` to −14 LUFS / −1.0 dBTP (YouTube's target), applied in video renders and WAV/MP3 exports.
- **In-app update checker** — Help → *Check for Updates…* compares your build against GitHub Releases; a silent check runs once at startup and only speaks when something newer exists.
- **CI quality gate** — every release build now syntax-checks all 28 JS modules and asserts About/version string sync before packaging; broken builds can no longer ship silently.

### Changed
- Help menu gains *Check for Updates…* and *Welcome & Quick Start* entries.

---

## [1.4.0] — 2026-10-17

### Added
- First-run **Welcome & Quick Start** onboarding dialog with the 4-step loop (import → cut → style → export) and the PX-proxy 4K tip.
- **docs/TUTORIAL.md** — "Your first 10 minutes with ApolloCut".
- **docs/SHORTCUTS.md** — printable keyboard reference, grouped by section.
- README now links both docs and the promo video.

### Fixed
- **Window could not be closed** until autosave state was clean (blocking `beforeunload`) — replaced by a one-shot best-effort autosave that never holds the process.
- Final Ω / OmegaCut-era branding traces removed UI-wide.

---

## [1.3.3] — 2026-10-17

### Added
- Hand-authored multi-size Windows icon (16–256px) baked into exe/installer/uninstaller/shortcuts/title-bar/favicon.
- GitHub repo with CI-driven releases and the GitHub Pages site.

### Fixed
- Title-bar/taskbar icon blending into dark UI (opague violet tile).
- Electron version pinned (`33.4.11`) for reproducible builds.

## [1.3.2] — 2026-10-16

### Fixed
- The window-close hang (root cause found in release QA).
- Version text consistency inside the About dialog.

## [1.3.0] — 2026-10-16

### Added
- Blindfolded-statue identity throughout the app and installer.
- Read-me launchers and offline build kit for Windows.

## [1.2.0]

### Added
- High-Fidelity offline render mode (`hf-run-apollocut.js` headless CI renderer).
- High-fidelity graph: full-resolution proxy-less render path.

## [1.1.0]

### Added
- Pro Export dialog with hardware encoder detection (NVENC/QSV/AMF/VideoToolbox) and software fallback.

## [1.0.0]

### Added
- Premiere-style multi-track NLE: timeline, ripple/blade/detach-audio, nested sequences, undo/redo, autosave.
- Keyframed effects with bezier easing, adjustment layers, chroma key.
- Audio fades, pan, solo/mute, live master meters.
- Bundled FFmpeg render engine: H.264 / HEVC / ProRes / WebM / WAV / MP3 / GIF.
- MIT license — free forever.

[1.5.0]: https://github.com/esoexe/ApolloCut/releases/tag/v1.5.0
[1.4.0]: https://github.com/esoexe/ApolloCut/releases/tag/v1.4.0
