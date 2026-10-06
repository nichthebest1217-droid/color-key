# Color Key

Drop a score and see its harmony in color: a MusicXML file, a PDF, or a picture of printed music. A reference for learning musicians.

This folder is the whole site: plain files, no build step, no server code. Any static host can serve it.

- `index.html`, `style.css`, `app.js`: the page.
- `studio.js`: "Make it yours". A visitor's own colors, names and readings, kept in the visitor's browser and nowhere else.
  Without this file the page works as published.
- `engine/`: reads the score, finds the keys and chords, colors the notes (`colorkey.js`), writes the numerals under the staff
  (`overlay.js`), reads each chord a second time by rule (`second.js`), and says where each chord leads (`lean.js`).
  Without `second.js` or `lean.js` the page works without that part.
- `reader/`: reads printed music from a PDF or a picture, on the visitor's device, with the two small trained networks it
  uses. One finds the notes (`reader.js`). The other reads what each note and rest is worth (`rhythm.js`), so that the bars
  can be counted and the harmony read (`harmony.js`). A picture that leans is turned level first (`straighten.js`).
- `data/`: the chord counts, the chord-to-chord step counts, the colors (`language.json`), and the other color sets a
  visitor can choose (`palettes.json`).
- `examples/`: three short scores to try.
- `vendor/`: the four open-source libraries the page uses (OpenSheetMusicDisplay, JSZip, PDF.js, ONNX Runtime Web), with their licenses.
- `CREDITS.md`: sources and licenses.

To look at it on your own computer, serve the folder (for example `python3 -m http.server` inside it) and open
`http://localhost:8000`.

`robots.txt` and a `noindex` tag ask search engines not to list the site: it is reachable by link only. Remove both to
make it findable.
