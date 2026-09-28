# Sower — Features

> Living document: everything in **Implemented** ships today; everything in
> **To be implemented** is planned and moves up here as it lands.

## Implemented

### Score creation & layout
- **Standard notation + tab rendering** — one document, two aligned staves
  (in-house SVG engraving engine, Bravura/SMuFL). *Use:* the score is live;
  everything below edits it.
- **4 measures per line** — measure 5 automatically starts a new line, and
  every line fits the page width exactly (no horizontal scrolling).
- **Title & author editing** — *Use:* click the title or the line under it in
  the header; a small editor opens (Title / Author); press Enter to commit.
- **Autosave** — every change persists to the browser (IndexedDB) and is
  restored on reload. **Undo/redo**: Ctrl+Z / Ctrl+Y.

### Note entry
- **Fret entry** — *Use:* click a position on the tab, type 0–9. Frets 10–24:
  Ctrl+1 or Ctrl+2 then the second digit (configurable shortcut planned).
- **Chord entry** — *Use:* type frets on different strings at the same step;
  ↑/↓ after a placement returns to the placed step (3 ↓ 3 ↓ 0 builds a chord).
- **Note-value palette (duration mode)** — *Use:* pick a value (whole … 32nd)
  in the status-bar palette; add a dot with the dot button. Every note
  written from then on uses that value until you pick another. The cursor
  advances by exactly the selected value (four typed 16ths sit side by side
  and beam together). Changing the value while the caret sits on a written
  note also re-lengths that note.
- **Rest entry** — *Use:* press `B` to write a rest of the selected value at
  the caret and move on. Written rests keep their exact value (dotted rests
  stay one glyph + dot) and are editable like notes. Empty time is filled
  with standard rests automatically (Gould rules: whole rest for an empty
  measure, half rests aligned to the half bar, compound meters never break
  a dotted beat).
- **Articulations** — *Use:* with the caret on a note: `M` palm mute ("P.M."
  engraved), `S` staccato (dot), `R` let ring, `G` ghost (parenthesized
  fret), `A` accent. Toggle = press again. Playback honors all of them.

### Editing written music
- **Change a note's length** — *Use:* click the note, then pick a value in
  the palette (or right-click → "Note length…"). Only that note changes; the
  measure re-adjusts around it (shortening a note fills the freed time with
  proper rests — eighth → 16th leaves a 16th rest).
- **Delete one note** — `Backspace` deletes the note on the current string.
- **Delete a beat group** — `Del` deletes every note at the position (all
  strings of the chord/column).
- **Delete a rest** — `Backspace`/`Del` on rest time removes that rest span
  and pulls the following notes into place (the gap closes).
- **Free placement** — clicking anywhere interpolates the exact rhythmic
  position under the cursor (at the current value's resolution), so every
  part of a measure is writable — auto-rests never block editing.

### Playback
- **Play from anywhere** — *Use:* click a spot, press Space (or ▶). Sound
  starts immediately from the selection; notes already sounding at the
  selection join in. Pause resumes; Stop returns to the caret.
- **Accurate note lengths** — every note sounds its full notated length on a
  pitch-independent sustain (like sample-engine loops), then a short natural
  release; a new note on the same string ends the previous one (no smear).
- **Tempo & beat units** — *Use:* the transport BPM field, or click the
  tempo mark on the sheet ("♪ = 96") for the popover with all standard beat
  units (whole … 32nd, dotted) — e.g. ♪. = 85. Tempo marks can sit at any
  measure; tempo/meter edits apply live during playback.
- **Metronome** — *Use:* the pendulum button in the transport. It follows
  the musical sheet: every beat of every measure (accents downbeats,
  compound meters pulse on dotted beats, rests still click, tempo/meter
  changes honored). Silent when the music is stopped.
- **Playhead** — moves on the notated grid from the selection, passes each
  note while it sounds, and sweeps full measures including trailing rests.

### Meter, key & chords
- **Time signature** — *Use:* the transport meter selector, the sheet's
  time-sig digits (click), or right-click → "Time signature…" (17 presets +
  custom). A change is engraved at its measure — mid-system changes sit
  right after the barline with a thin-thin double barline (classical
  practice) — and applies until the next differing change.
- **Key signature** — *Use:* right-click → "Key signature…" → pick the mode
  (major/minor) and one of the 15 keys. The sharps/flats engrave at the
  change measure (after a double barline) at their standard staff slots —
  F♯ top line, C♯ 3rd space… per the *Essential Dictionary of Music
  Notation* — and drive the accidentals and chord spelling. Changing to C
  major / A minor cancels the old signature with naturals first (required).
- **Chord sheets** — *Use:* right-click → "Add chord…". Three dropdowns +
  Add: **Chord** (the diatonic chords of the current measure's key, with
  roman numerals — the list always follows the key signature), **Inversion /
  position** (every playable position of that chord across the neck — root,
  1st/2nd/3rd inversions on all octaves, tab pattern shown per voicing, like
  the Guitar Chords tools), and **Length** (the note length the chord
  lasts: whole … 32nd incl. dotted). The lead-sheet symbol engraves above
  the staff and the chosen voicing is written into the tab + notation
  (Berklee chord-symbol convention). Deleting the chord's notes removes its
  symbol too.

### Structure & measures
- **Measure management** — *Use:* the engine's +/− buttons after the last
  measure, or right-click → "Insert measure after" / "Delete measure".
- **Context menu** — right-click (desktop) / long-press ~550 ms (touch)
  anywhere on the sheet: Tempo…, Note length…, Time signature…, Key
  signature…, Add chord…, Insert measure after, Delete measure.

## To be implemented

> Target: MuseScore-level notation software (feature set researched from the
> **MuseScore Studio Handbook**, grouped like its chapters so parity is
> trackable). Items move up to Implemented as they land. The guitar/tab core
> (our differentiator: premium playback, chord sheets, instant entry) stays
> first-class while parity grows around it.

### Score setup & navigation (MuseScore: Getting started / Navigation)
- [ ] New-score setup dialog — instruments, key, meter, tempo, template,
      title/composer metadata at creation (today the app opens the demo score)
- [ ] Multi-instrument scores — instruments & staves management: brackets,
      staff type change (notation ↔ tab per staff), hide empty staves,
      mid-score instrument changes, staff/part properties (tuning, string
      count, offsets)
- [ ] Selection model: single / range / list selection over any elements
      (today: single caret + beat column)
- [ ] Timeline + navigator strip, zoom controls (fit width / %)

### Note input (MuseScore: Basics)
- [ ] Input by duration mode + alternative input methods (rhythm input,
      pitch input, MIDI keyboard input)
- [ ] Multiple voices per staff
- [ ] Tuplets — triplets and any n:m ratio (model + entry + engraving)
- [ ] Grace notes (incl. steal-time behavior in playback)
- [ ] Copy / cut / paste (range copy with rhythm re-flow), Insert mode
      (ripple-shift following music)
- [ ] Properties panel (inspector for the selected element — position,
      appearance, playback flags)
- [ ] Direct element manipulation (drag pitch, drag duration edge, drag
      markings) — Phase 1c flagship UX

### Rhythm, meter & measures (MuseScore: Rhythm, meter, and measures)
- [ ] Manual stem direction & stem length
- [ ] Manual beaming (break / join beams per group) — auto rules already
      follow Gould; add the override
- [ ] Regroup rhythms command
- [ ] All barline types (single, double, final, dashed, start/end repeats)
- [ ] Measure numbering options; measure & multimeasure rests (%, multi-bar)
- [ ] Pickup (anacrusis) + non-metered measures
- [ ] Measure properties dialog (width stretch, irregular barline flags,
      exclude from numbering)

### Pitch (MuseScore: Pitch)
- [ ] All clefs incl. octave-transposing clefs (8vb/8va guitar clefs)
- [ ] Transposition (selection / score / instrument transposition)
- [ ] Octave lines (8va, 8vb)
- [ ] Notehead shapes (X = dead note, diamond = harmonic…), respell
      pitches (enharmonic), ambitus range display

### Expressive markings (MuseScore: Expressive markings)
- [ ] Full articulation set (accent, staccato, tenuto, marcato, fermata,
      …) with property overrides — today: M/S/R/G/A simple set
- [ ] Dynamics + hairpins (with playback dynamics)
- [ ] Slurs & ties (incl. laissez vibrer)
- [ ] Breaths & pauses (fermata, caesura)
- [ ] Ornaments (trill, turn, mordents) + playback realizations
- [ ] Arpeggios, glissandos, guitar slides
- [ ] Tremolos & rolls
- [ ] Other lines (crescendo/diminuendo dashes, trill lines)
- [ ] Guitar techniques to parity: bends & dives (with bend curves),
      hammer-on/pull-off chains, vibrato marks, tapping, harmonics,
      rasgueado (model already carries most articulations)

### Repeats & structure (MuseScore: Repeats)
- [ ] Repeat signs + playback of repeats
- [ ] Voltas (1st / 2nd endings)
- [ ] Jumps & markers (D.C., D.S., Fine, Coda, Segno) with playback
- [ ] Multimeasure repeats (% simile)
- [ ] Courtesy accidentals at repeats / key changes (per the manual)
- [ ] Sections (multiple movements / songs in one file), pickup handling

### Text & lyrics (MuseScore: Text)
- [ ] Lyrics (verse alignment under notes)
- [ ] Fingering numbers
- [ ] Figured bass
- [ ] Rehearsal marks
- [ ] Staff / system / expression text (Allegro…, rit., accel. with
      playback tempo curves)
- [ ] Header & footer, text blocks, text formatting controls

### Layout & formatting (MuseScore: Formatting)
- [ ] Frames (title / vertical / horizontal frames), images in scores
- [ ] Score size & spacing controls (staff space scaling)
- [ ] System + horizontal spacing controls (stretch/shrink measures)
- [ ] Page layout: multi-page output, page size, vertical spacing
- [ ] Manual element positioning (drag offsets with snapping)
- [ ] Style templates & style editor

### Sound & playback (MuseScore: Sound and playback)
- [ ] Mixer — per-track volume / pan / mute / solo / reverb (model fields
      exist; the SynthEngine seam is ready)
- [ ] Premium sampled instrument sets (SoundFont/MuseSounds equivalent —
      the owner requirement; sample engine behind SynthEngine)
- [ ] Count-in, loop regions, swing playback
- [ ] Sound flags (per-passage sound choices)
- [ ] MIDI keyboard input; VST/VSTi hosting (later)
- [ ] Video export (later)

### File & interchange (MuseScore: File management)
- [ ] Export: PDF (print layout), image, audio (WAV/MP3), MIDI, MusicXML
- [ ] Import: MusicXML, MIDI, Guitar Pro (.gp3–7), (MEI later)
- [ ] Project properties, backup/recovered files

### App platform & customization (MuseScore: Customization)
- [ ] **Keyboard shortcuts configuration page** — rebind every shortcut to
      taste (e.g. Shift+digit instead of Ctrl+digit for frets 10–24); all
      future shortcuts register there (planned Phase 1c)
- [ ] Palettes (customizable symbol palettes panel — MuseScore's core UI)
- [ ] Workspaces, templates & styles, appearance (theme) & language
      settings, toolbars/windows layout
- [ ] Plugins
- [ ] Accessibility pass
- [ ] Mobile adaptation — full touch control mapping + responsive platform
      layout (see ROADMAP, final chapter; starts only after the web app is
      feature-complete)

### Product base (from the original roadmap)
- [ ] Accounts + cloud sync, free/Pro tiers
- [ ] Onboarding, sample songs, empty states
- [ ] Practice tools: loop section, tempo %, tuner (metronome shipped)
- [ ] Hum/sing/play correction input (Phase 1c)
- [ ] AI features (chord-chart autopilot, audio→notation)
