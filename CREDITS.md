# Credits and licenses

**Expert analyses.** The chord counts (`data/dictionary.json`) and the chord-to-chord step counts (`data/progression.json`)
are derived from two collections of expert harmonic analyses, both published under CC BY-NC-SA 4.0:

- Hentschel, J., Neuwirth, M., & Rohrmeier, M. (2021). The Annotated Mozart Sonatas: Score, harmony, and cadence.
  *Transactions of the International Society for Music Information Retrieval*, 4(1), 67–80.
- Neuwirth, M., Harasim, D., Moss, F. C., & Rohrmeier, M. (2018). The Annotated Beethoven Corpus (ABC): A dataset of
  harmonic analyses of all Beethoven string quartets. *Frontiers in Digital Humanities*, 5, 16.

These two derived files are shared under the same license, CC BY-NC-SA 4.0: attribution, non-commercial use, share alike.

**Example scores.**

- Bach, Prelude in C major, BWV 846, and Chopin, Prelude in C minor, Op. 28 No. 20: from *When in Rome* (Gotham, M.,
  Micchi, G., Nápoles López, N., & Sailor, M., 2023, *Transactions of the International Society for Music Information
  Retrieval*, 6(1), 150–166), CC BY-SA 4.0.
- Mozart, Piano Sonata in C major, K. 545, first movement: from the Annotated Mozart Sonatas, CC BY-NC-SA 4.0, exported
  to MusicXML with MuseScore.

**Key profiles.** Aarden, B. J. (2003). *Dynamic melodic expectancy* (PhD dissertation, The Ohio State University).

**Libraries**, hosted with this site so that no other server is contacted:

- OpenSheetMusicDisplay 1.9.0 (BSD 3-Clause), `vendor/OSMD-LICENSE.txt`.
- JSZip 3.10.1 (MIT or GPLv3), `vendor/JSZIP-LICENSE.md`.
- PDF.js 3.11.174 (Apache 2.0), `vendor/PDFJS-LICENSE.txt`: draws the pages of a PDF.
- ONNX Runtime Web 1.17.3 (MIT), `vendor/ORT-LICENSE.txt`: runs the reader's network in WebAssembly.

**Reading printed music.** The reader (`reader/`) finds the staves, follows each staff through a band of fixed size, and a
small network marks noteheads, accidentals, clefs, barlines and rests; rules then name each note from the clef, the key
signature and the accidentals earlier in the bar. The network (`reader/reader.bin`, `reader/reader.onnx`) was trained only
on pages engraved for this project with MuseScore Studio 4.5.2 (the fonts Leland, Bravura, Emmentaler, Gonville and Finale
Maestro) from the training part of the two collections above, so it is shared under the same license, CC BY-NC-SA 4.0.
It was tested on real scans from OLiMPiC 1.0 (Mayer, J., Straka, M., Hajič jr., J., & Pecina, P., 2024, Practical
end-to-end optical music recognition for pianoform music, ICDAR 2024; CC BY-SA 4.0); no OLiMPiC page was used to train
it and none is hosted here.

**Privacy.** The site has no account, no tracking and no analytics, and it calls no outside service. A score opened on
the page is read in the browser and is never uploaded.
