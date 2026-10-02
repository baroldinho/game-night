# Game Night

James's board game collection and game night voting, live at
**https://baroldinho.github.io/game-night/**

- Guests scan the Game Night plate (QR or NFC) to browse the collection, filter by
  players, time, complexity and type, read a summary and a one-minute teach, and
  vote on tonight's game (up to 2 Yes and 1 No each).
- The host signs in with Google (Host sign-in, bottom of any page) to run game
  nights, see the tally, mark games as played, edit summaries, see private notes
  (sleeves, inserts, last played) and print A5 summary sheets.

## How it fits together

| Part | Where |
| --- | --- |
| Pages | `index.html`, `css/site.css`, `js/app.js` |
| Firebase connection | `js/store.js`, `js/config.js`, `js/firebase-bundle.js` (Firebase JS SDK 12.19.0, bundled) |
| Starter game list | `data/games.json` (imported into the database from Host tools) |
| Packing photos | `img/pack/<game-id>.jpg`, referenced by a game's `packPhoto` field |

Private notes are not stored in this repository. They live only in the Firestore
`private` collection, which the security rules restrict to the owner.
