// Site settings. The Firebase values are not secret: access is controlled by the
// Firestore security rules, which only let the owner change anything.
export const firebaseConfig = {
  apiKey: "AIzaSyCF_v1arp6JWt_IrNMrwhvCekwR1vlgHsQ",
  authDomain: "game-night-baroldinho.firebaseapp.com",
  projectId: "game-night-baroldinho",
  storageBucket: "game-night-baroldinho.firebasestorage.app",
  messagingSenderId: "592531630345",
  appId: "1:592531630345:web:22286ecbd1cab3ac598bd8"
};

// Shown to guests, e.g. "James will announce the winner".
export const HOST_NAME = "James";

// Voting limits per person.
export const MAX_YES = 2;
export const MAX_NO = 1;
