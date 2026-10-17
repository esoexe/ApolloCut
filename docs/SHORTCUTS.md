# ApolloCut keyboard shortcuts

Lean print-friendly reference. `⌘` on macOS stands in for `Ctrl`.

## Project & files
| Key | Action |
|---|---|
| `Ctrl + S` | Save project (.apollocut.json) |
| `Ctrl + Shift + S` | Save project as… |
| `Ctrl + O` | Open project |
| `Ctrl + I` | Import media |
| `Ctrl + E` | Export Fast (WebM) |
| `Ctrl + Shift + E` | **Export Pro (MP4 / MOV / WebM — FFmpeg engine)** |

## History & clipboard
| Key | Action |
|---|---|
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` / `Ctrl + Y` | Redo |
| `Ctrl + C` | Copy selected clips |
| `Ctrl + V` | Paste (under playhead) |
| `Ctrl + D` | Duplicate selected clips |
| `Delete` / `Backspace` | Delete selected |
| `Shift + Delete` | Ripple-delete (closes the gap) |

## Tools
| Key | Action |
|---|---|
| `V` | Selection tool |
| `R` | Razor tool |
| `B` | Blade (all tracks at playhead) |
| `T` | Text/title tool |

## Playback & navigation
| Key | Action |
|---|---|
| `Space` | Play / pause |
| `J` / `K` / `L` | Reverse / pause / forward (tap L/J again = faster) |
| `Home` / `End` | Go to start / end |
| `←` / `→` | Previous / next frame |
| `↑` / `↓` | Previous / next edit point |
| `Shift ←/→` | ±1 second |
| `I` / `O` | Set In / Out point |
| `M` | Add marker at playhead |

## Timeline & editing
| Key | Action |
|---|---|
| `A` | Select all clips |
| `Ctrl + K` | Cut (razor) at playhead |
| `+` / `−` | Zoom timeline in / out |
| `Shift + F` / `0` | Zoom to fit |
| `Ctrl` / `Alt` + drag | Duplicate clip / fine trim |
| `Shift` drag in bin | Link selections |

## Panels & view
| Key | Action |
|---|---|
| `~` / `Ctrl + 0` | Maximize panel under cursor |
| `F11` | Full screen |
| Program **GPU** toggle | Hardware-accelerated compositor |
| Program **PX** toggle | Proxy preview on/off |
| Program **Scopes** | Waveform + vectorscope overlay |

---

*Full walkthrough: [TUTORIAL.md](TUTORIAL.md) — source of truth for changes: `renderer/js/app.js` (`initKeys`).*
