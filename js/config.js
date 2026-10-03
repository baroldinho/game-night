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

// Shown to guests, e.g. "Luke will announce the winner".
export const HOST_NAME = "Luke";

// Voting limits per person.
export const MAX_YES = 2;
export const MAX_NO = 1;

// Email alerts for "bring it" and "teach me" requests, sent through Web3Forms
// (free). Paste the access key Web3Forms emails you between the quotes. The key
// can only send to your own address, so it's safe to keep in public code.
// Leave it empty to turn email alerts off.
export const WEB3FORMS_KEY = "";
