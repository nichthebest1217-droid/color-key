# Color Key

Drop a MusicXML score and see its harmony in color. A reference for learning musicians.

This folder is the whole site: plain files, no build step, no server code. Any static host can serve it.

- `index.html`, `style.css`, `app.js`: the page.
- `engine/`: reads the score, finds the keys and chords, colors the notes.
- `data/`: the chord counts, the chord-to-chord step counts, the colors.
- `examples/`: three short scores to try.
- `vendor/`: the two open-source libraries the page uses, with their licenses.
- `CREDITS.md`: sources and licenses.

To look at it on your own computer, serve the folder (for example `python3 -m http.server` inside it) and open
`http://localhost:8000`.

`robots.txt` and a `noindex` tag ask search engines not to list the site: it is reachable by link only. Remove both to
make it findable.
