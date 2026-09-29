// Draft night: each player's scouting line and highlight (a silent clip, or
// a photo), and the draft theme. Only loaded into a page when a pick is
// revealed, so nobody sees them before the draft starts.
export const SCOUTING = {
  tate: 'The miss is low left. Could shoot even or 90. Suicide watch if it\'s a bad one.',
  garrett: 'Opened the year with a 71 at Riverbend. Hits it a mile, works it both ways. Best Ping putter on the course. Is the kid Tuff? Did he mention he played Pebble?',
  jonah: '2.9 hcp. Shot −4 on the front 9 at Davy Jones this year. New club in the bag every round.',
  brody: 'Buckle Up CEO. Fired a 68 at SouthGate 3 weeks ago. The kid knows how to have fun. Don\'t give him an opportunity to be clutch.',
  josh: 'Currently battling a shoulder injury. Holds the record for the Crown Burger Mile. The kid is TUFF. Highest probability for most F-bombs this weekend.',
  sam: 'Man knows how to put in the work at the range. Miss is the low left, but could also hit a 300-yard bomb. Best ball partner? Elite.',
  skyler: 'Mystery pick 👀 2 handicap on GHIN. And a sleeper?',
  jp: 'Wipes the floor at the Davis Golf Course men\'s league. Wants all his money back in skins. Hits a butter fade with the driver.',
};

// Where the subject sits in each clip, so a phone-shaped crop keeps him in frame.
export const HIGHLIGHTS = {
  tate: { video: 'media/draft/tate.mp4' },
  garrett: { video: 'media/draft/garrett.mp4' },
  jonah: { video: 'media/draft/jonah.mp4' },
  brody: { video: 'media/draft/brody.mp4', focus: '8% 50%' },
  josh: { video: 'media/draft/josh.mp4', focus: '20% 50%' },
  sam: { video: 'media/draft/sam.mp4' },
  skyler: { photo: 'media/draft/skyler.jpg' },
};

export const DRAFT_THEME = 'media/draft/theme.m4a';
