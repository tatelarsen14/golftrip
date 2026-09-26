# ⛳ Washington / Idaho Golf Trip — Oct 2–6, 2026

A mobile web app for the trip's match play tournament: 8 players, 4 teams of two.

## Format

Every round:

| Holes | Format | Points |
|---|---|---|
| Front 9 | **Best ball** match play, team vs team (each player enters their own score, low score on the team counts) | 1 per match |
| Back 9 | **Singles** match play, 1 v 1 within the same group | 1 per match |

Win = 1, tie = ½, loss = 0. Each team has 3 points up for grabs per day.
Tournament rounds are Sat–Tue; Friday's round is just for fun and isn't tracked.
Sat–Mon groups rotate so every team plays every other team once. Tuesday is
seeded: once every Sat–Mon match is final, 1st plays 2nd and 3rd plays 4th
(shown as TBD until then).

### Tiebreakers

Used for Tuesday's seeding and for the final standings when teams are level on points:

1. Head-to-head points (only matches between the tied teams)
2. Most matches won
3. Holes-up margin (Won 3&2 = +3, lost 1 UP = −1, summed over every match)
4. Fewest total strokes (both players, all counted rounds)
5. Still tied: flip a coin

## Tabs

- **Leaderboard**: team standings (with any tiebreaker shown, and a champion banner once Tuesday is final), live status of every match ("2 UP thru 6", "Won 3&2", "Dormie"), individual W-L-T and points, and the Birdie Board (birdies per player, eagles count as birdies).
- **Scores**: pick the round, your group and the hole, then tap + / − for each player. The first tap sets par (from the course scorecard). Leave a score blank if you picked up.
- **Cards**: a full 18-hole scorecard for each course, marked like a paper card (circle = birdie, double circle = eagle or better, square = bogey, double square = double bogey or worse), plus a card for each match with the best ball scores that counted highlighted.
- **Trip**: the itinerary, tee times, lodging (tap to open maps), flights, crew phone numbers (tap to call) and the cost estimate.
- **Setup**: tap your name, then set team names, swap players between teams (tap one, then another), pick each day's matchups and singles pairings, and choose which days count. Every change saves for everyone instantly.

## Run it locally

```bash
npm start          # serves on http://localhost:8080
npm test           # scoring tests
```

## Turn on live sync (so everyone shares one scoreboard)

Without this, scores only save on the phone they were entered on. Firebase's
free tier is plenty for this.

1. Go to <https://console.firebase.google.com>, click **Add project** (analytics can be off).
2. **Build → Firestore Database → Create database**. Pick a US location and start in **production mode**.
3. On the **Rules** tab, paste this and **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /trips/{tripId}/{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
   There's no login, so anyone with the link can edit scores. That's fine for a trip with friends; just don't post the link publicly.
4. **Project settings (gear) → General → Your apps → Web (`</>`)**, register an app and copy the `firebaseConfig` object.
5. Paste it into `js/firebase-config.js` as `FIREBASE_CONFIG`, then commit.

The header shows **● Live** when syncing. Scores entered with no signal are
saved on the phone and upload when it reconnects.

## Host it

Any static host works. There's no build step.

- **GitHub Pages**: repo **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`. Private repos need a paid GitHub plan for Pages.
- **Firebase Hosting**: `npx firebase-tools init hosting` (public dir `.`), then `npx firebase-tools deploy`.
- **Netlify**: drag the folder onto <https://app.netlify.com/drop>.

Then have everyone open the link and use **Share → Add to Home Screen** so it works like an app.
