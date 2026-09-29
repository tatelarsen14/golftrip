# ⛳ Washington / Idaho Golf Trip — Oct 2–6, 2026

A mobile web app for the trip's tournament: 8 players, two teams of 4 picked in a draft.

## Format

| Day | Course | Format | Points |
|---|---|---|---|
| Fri | Indian Canyon | **Captain Round**: stroke play (6 players), then the draft | – |
| Sat | Circling Raven | Best ball front 9, singles back 9 | 6 |
| Sun | Scarecrow | Best ball front 9, singles back 9 | 6 |
| Mon AM | Quicksands (14 par 3s) | **Team stroke play**: all 4 scores count | 2 |
| Mon PM | Gamble Sands | Best ball front 9, singles back 9 | 6 |
| Tue | Coeur d'Alene | **Escalating singles**: front 9 worth 1, back 9 worth 2 | 12 |

32 points in all; 16½ wins the Cup (a 16–16 tie goes to the tiebreakers, no shared Cup).
Win = 1, tie = ½, loss = 0 (Quicksands: 2 to the lower team total, 1 each for a tie;
Tuesday's back 9: 2 per match, 1 each for a tie). Triple bogey max, no handicaps.

### Friday: Captain Round and the draft

Straight stroke play. The two low scores are the captains (tie: lower back 9, then a
putt-off recorded in the app). When the last score goes in, every phone gets a captain
reveal. Then the captains draft on the Leaderboard: low score picks first, then they
alternate (A, B, A, B, A, B). Skyler and JP are in the pool. Every pick pops up on every
phone. After the last pick, each captain names their team and picks a color. Tate can
set captains by hand, undo a pick or reset the draft in Setup.

**Draft night.** Picking stays locked until Tate taps **Start the draft** (on the
Leaderboard or in Setup). Everyone taps **Enter the draft room** once so their phone can
play the draft theme. Starting it plays the **Captains Reveal** on every phone (captain
No. 2, then the medalist, then "the draft is open"), and every pick gets its own
full-screen reveal: a drumroll line, the name drop, the player's highlight clip (or
photo) and his scouting card (Friday stats plus the scouting report). Reveals stay up
until tapped; tap a drafted name on the board to rewatch one. The pool shows names only,
so nobody sees a card or clip before the player is picked. Scouting lines live in
`js/draftkit.js`, clips and the theme in `media/draft/` (edited originals in `draft-kit/`,
which isn't published).

### Sat–Mon: match play

Two groups of 4, two players from each team in each group: best ball 2 v 2 on the front,
two singles on the back. The rotation (by draft order) has everyone partner each teammate
once and play three different singles opponents. Quicksands and Gamble Sands use the same
groups.

### Tuesday: escalating singles

Once every match through Monday is final, the captain of the team in first sets all four
matchups on the Leaderboard (who plays who, and who shares a group). Front 9 singles are
worth 1; opponents swap within each group for the back 9, worth 2. 12 points.

### Tiebreakers

Used to decide who picks Tuesday and who wins the Cup when the teams are level:

1. Most matches won
2. Holes-up margin (Won 3&2 = +3, lost 1 UP = −1, summed over every match play match)
3. Fewest total strokes (every player, all counted rounds)
4. Putt-off: settle it on the putting green and tap the winner in the app

### Skins

Every par 3 at Circling Raven, Scarecrow, Gamble Sands and Coeur d'Alene, plus every hole
at Quicksands (32 in all). All 8 players on the same hole. Once everyone's in, the
outright low score wins $5 from each of the other 7; any tie and nobody wins it; nothing
carries. The Leaderboard shows everyone's net and a settle-up list; wins post to the Feed.

## Tabs

- **Leaderboard**: a "Your match" card at the top (your round today with an Enter scores button, otherwise a countdown to Circling Raven or your next tee time), then Friday's Captain Round board and the live draft, or Tuesday's matchup picker. Below: the Cup scoreboard with **Format** and **Tiebreakers** dropdowns (and a step-by-step tiebreaker card when the teams are level after Monday or at the end), every match in a TV-broadcast style, Skins (net $ and settle-up) and the Birdie Board (eagles count as birdies).
- **Scores**: pick the round, your group and the hole, then tap each player's score: one button per score from an ace (on par 3s and 4s) or eagle up to triple bogey (the max), labeled Birdie / Par / Bogey and so on. Tap the selected score again to clear it. Once everyone in the group is in, it moves to the next hole. Skin holes are tagged 💰. Flip the toggle at the top to **Scorecards**: a full 18-hole scorecard for each course, marked like a paper card (circle = birdie, double circle = eagle or better, square = bogey, double square = double bogey or worse), plus a card for each match with the best ball scores that counted highlighted.
- **Feed**: the Clubhouse. Post text, photos and videos (tagged to a hole if you like), react with 🔥 😂 💀 ⛳ 👏 and comment. Birdies, eagles, birdie streaks, 3+ holes won in a row and match results post themselves automatically.
- **Trip**: the itinerary, tee times, where we're staying and flights.
- **Setup** (only on the organizer's phone, see below): captains by hand, undo/reset the draft, team names and colors, swap players (tap one, then another), Friday groups, singles swaps, reset Tuesday's matchups, and which rounds count. Every change saves for everyone instantly.

Streaks: 🔥 next to a side that has won 2+ holes in a row in its match (🥶 for the other side), and 🐦🔥 next to a player with 2+ birdies in a row.

**Hole in one**: enter a 1 on any par 3 or par 4 and every phone gets a gold "HOLE IN ONE!" banner, plus a highlight in the Feed. It counts on the Birdie Board too.

**Banners**: the captain reveal, every draft pick, and each clinched match ("TATE WINS 3&2") pop up full-screen on every phone with the app open, with confetti in the team color (tap to dismiss). When the last match decides the Cup, a champions banner follows. Things already done when you open the app don't replay.

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
