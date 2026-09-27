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
5. Putt-off: the tied teams settle it on the putting green and someone taps the winner in the app

When there's a tie after Monday or after Tuesday, the Leaderboard shows a
Tiebreaker card that walks down this list step by step (each team's numbers
and who won each step) until the tie is broken. It only asks for a putt-off if
the result matters: splitting 2nd/3rd for Tuesday's matchups, or 1st for the title.

## Tabs

- **Leaderboard**: a "Your match" card at the top (your live match in broadcast style with an Enter scores button on round days, otherwise a countdown to your next tee time and opponent), team standings as a Cup scoreboard with **Format** and **Tiebreakers** dropdowns that explain the rules (with a step-by-step tiebreaker card when teams are tied after Monday or Tuesday, and the winning team highlighted with a champion banner once Tuesday is final), live status of every match in a TV-broadcast style (leading side lit up in its team color, "2 UP · thru 6" / "A/S" / "2&1 Final" in the middle, and a hole-by-hole strip colored by who won each hole), and the Birdie Board: a podium for the top 3 (ties share a medal), bars for the rest, and a "still hunting" line for anyone without one yet (eagles count as birdies).
- **Scores**: pick the round, your group and the hole, then tap each player's score: one button per score from eagle to triple bogey (the max), labeled Birdie / Par / Bogey and so on. Tap the selected score again to clear it. Once all four are in, it moves to the next hole. Flip the toggle at the top to **Scorecards**: a full 18-hole scorecard for each course, marked like a paper card (circle = birdie, double circle = eagle or better, square = bogey, double square = double bogey or worse), plus a card for each match with the best ball scores that counted highlighted.
- **Feed**: the Clubhouse. Post text, photos and videos (tagged to a hole if you like), react with 🔥 😂 💀 ⛳ 👏 and comment. Birdies, eagles, birdie streaks, 3+ holes won in a row and match results post themselves automatically.
- **Trip**: the itinerary, tee times, where we're staying and flights.
- **Setup** (only on the organizer's phone, see below): set team names, swap players between teams (tap one, then another), pick each day's matchups and singles pairings, and choose which days count. Every change saves for everyone instantly.

Streaks: 🔥 next to a side that has won 2+ holes in a row in its match (🥶 for the other side), and 🐦🔥 next to a player with 2+ birdies in a row.

**Match-winning banner**: when a match is clinched, every phone with the app open gets a full-screen "TATE WINS 3&2" banner with confetti in the winner's team color (tap to dismiss). When the last match decides the tournament, a champions banner follows. Matches already final when you open the app don't replay.

**Trip recap**: once the last match is final, the champion banner and the Trip tab link to a recap page with final standings, awards (MVP, Birdie King, Low Round, Hottest Hand, Longest Run, Crowd Favorite, Paparazzi), day-by-day results, the best photos and every player's rounds. Share it with a `#recap` link.

**Names**: the first time someone opens the app it asks who they are (tap the name in the header to change it). People who aren't playing can join as a **spectator** with their own name: they can post, react and comment, but can't enter scores or record putt-offs.

**Setup is hidden** unless the name picked on that phone is Tate (the organizer). This hides the tab; it isn't a password.

## Photos and videos (Firebase Storage)

Uploads need Firebase Storage, which requires the pay-as-you-go (Blaze) plan:

1. Firebase console → **Upgrade** (bottom of the left menu) → **Blaze**, and add a billing account. Set a budget alert (e.g. $5) when it offers.
2. **Build → Storage → Get started** → production mode → a US location such as `us-west1` (the US regions include a free allowance).
3. **Storage → Rules**, paste and **Publish**:
   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /trips/{tripId}/{allPaths=**} {
         allow read: if true;
         allow create: if request.resource.size < 200 * 1024 * 1024
           && (request.resource.contentType.matches('image/.*')
               || request.resource.contentType.matches('video/.*'));
       }
     }
   }
   ```

Photos are resized to full-HD (1920px on the long side) before upload; videos go up as recorded (1080p recommended) and can be up to 200 MB.

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
