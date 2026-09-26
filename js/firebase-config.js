// Firebase web app config: turns on live syncing between everyone's phones
// (see README.md → "Turn on live sync"). This isn't a secret; access is
// controlled by the Firestore rules. Set it to null to go device-only.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCIaf0q0NcPiCU4j8NsYWG-VG51K95gW7w',
  authDomain: 'golftrip-7cb18.firebaseapp.com',
  projectId: 'golftrip-7cb18',
  storageBucket: 'golftrip-7cb18.firebasestorage.app',
  messagingSenderId: '948925925601',
  appId: '1:948925925601:web:ddd7cf84bb5b711d648fa0',
};

// Change this to start a fresh tournament in the same database.
export const TRIP_ID = 'wa-id-2026';
