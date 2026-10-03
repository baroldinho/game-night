// Data layer: everything that talks to Firebase lives here, so the UI never
// touches the SDK directly.
import {
  initializeApp, getAuth, signInAnonymously, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, signOut, onAuthStateChanged, getFirestore, doc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, collection, onSnapshot, writeBatch, serverTimestamp, increment
} from "./firebase-bundle.js";
import { firebaseConfig, WEB3FORMS_KEY } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = { uid: null, isAnonymous: true, isOwner: false, name: "" };
const userListeners = new Set();
let authProblem = "";

function emitUser() { userListeners.forEach((fn) => fn(currentUser, authProblem)); }

async function checkOwner() {
  try {
    await getDoc(doc(db, "private", "_owner"));
    return true; // only the owner may read anything under /private
  } catch (e) {
    return false;
  }
}

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    currentUser = { uid: null, isAnonymous: true, isOwner: false, name: "" };
    emitUser();
    try {
      await signInAnonymously(auth);
    } catch (e) {
      authProblem = e && e.code === "auth/operation-not-allowed"
        ? "Guest sign-in isn't switched on yet (Firebase → Authentication → Anonymous)."
        : "Couldn't connect to the voting service. Check your connection and reload.";
      emitUser();
    }
    return;
  }
  authProblem = "";
  const isOwner = u.isAnonymous ? false : await checkOwner();
  currentUser = { uid: u.uid, isAnonymous: u.isAnonymous, isOwner, name: u.displayName || "", email: u.email || "" };
  emitUser();
});

export function onUser(fn) { userListeners.add(fn); fn(currentUser, authProblem); return () => userListeners.delete(fn); }
export function getUser() { return currentUser; }

export async function signInOwner() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}
export async function signOutOwner() { await signOut(auth); }

// ---------- games ----------
export async function loadStarterGames() {
  const res = await fetch("data/games.json", { cache: "no-cache" });
  const data = await res.json();
  return data.games;
}

export async function loadGames() {
  try {
    const snap = await getDocs(collection(db, "games"));
    if (!snap.empty) {
      return { source: "live", games: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
    }
  } catch (e) { /* fall back to the starter list */ }
  return { source: "starter", games: await loadStarterGames() };
}

export async function saveGame(id, fields) {
  await setDoc(doc(db, "games", id), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
}

export async function importGames(games) {
  const batch = writeBatch(db);
  games.forEach((g) => batch.set(doc(db, "games", g.id), { ...g, updatedAt: serverTimestamp() }));
  await batch.commit();
}

// ---------- owner-only notes ----------
export async function loadPrivate() {
  const snap = await getDocs(collection(db, "private"));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data(); });
  return out;
}
export async function savePrivate(id, fields) {
  await setDoc(doc(db, "private", id), fields, { merge: true });
}
export async function importPrivate(map) {
  const batch = writeBatch(db);
  Object.entries(map).forEach(([id, v]) => batch.set(doc(db, "private", id), v, { merge: true }));
  await batch.commit();
}
export async function markPlayed(gameId) {
  const today = new Date().toISOString().slice(0, 10);
  await setDoc(doc(db, "private", gameId), { lastPlayed: today, plays: increment(1) }, { merge: true });
  return today;
}

// ---------- game nights ----------
export function watchCurrentNight(cb) {
  let unNight = null;
  const unCfg = onSnapshot(doc(db, "config", "current"), (snap) => {
    if (unNight) { unNight(); unNight = null; }
    const nightId = snap.exists() ? snap.data().nightId : null;
    if (!nightId) { cb(null); return; }
    unNight = onSnapshot(doc(db, "nights", nightId),
      (n) => cb(n.exists() ? { id: n.id, ...n.data() } : null),
      () => cb(null));
  }, () => cb(null));
  return () => { unCfg(); if (unNight) unNight(); };
}

export async function startNight({ mode, shortlist }) {
  const ref = doc(collection(db, "nights"));
  await setDoc(ref, { status: "open", mode, shortlist: shortlist || [], played: [], createdAt: serverTimestamp() });
  await setDoc(doc(db, "config", "current"), { nightId: ref.id });
  return ref.id;
}
export async function updateNight(nightId, fields) { await updateDoc(doc(db, "nights", nightId), fields); }
export async function endNight() { await setDoc(doc(db, "config", "current"), { nightId: null }); }

export function watchMyBallot(nightId, cb) {
  if (!currentUser.uid) { cb(null); return () => {}; }
  return onSnapshot(doc(db, "nights", nightId, "ballots", currentUser.uid),
    (s) => cb(s.exists() ? s.data() : null), () => cb(null));
}
export async function saveBallot(nightId, { name, yes, no }) {
  await setDoc(doc(db, "nights", nightId, "ballots", currentUser.uid), { name, yes, no, updatedAt: serverTimestamp() });
}
export function watchBallots(nightId, cb) {
  return onSnapshot(collection(db, "nights", nightId, "ballots"),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
}

// ---------- saved shortlists (owner) ----------
export async function loadShortlists() {
  const s = await getDoc(doc(db, "private", "_shortlists"));
  return s.exists() ? (s.data().lists || {}) : {};
}
export async function saveShortlists(lists) {
  await setDoc(doc(db, "private", "_shortlists"), { lists });
}

// ---------- guest requests: "bring this game" and "teach me" ----------
export async function saveRequest({ type, gameId, name }) {
  await setDoc(doc(db, "requests", `${type}_${gameId}_${currentUser.uid}`),
    { type, gameId, name, uid: currentUser.uid, createdAt: serverTimestamp() });
}
export function watchRequests(cb) {
  return onSnapshot(collection(db, "requests"),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
}
export async function deleteRequest(id) { await deleteDoc(doc(db, "requests", id)); }

// Email the host about a new request. Best effort: a failed email never blocks the request.
export async function emailHost({ subject, message, name }) {
  if (!WEB3FORMS_KEY) return false;
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ access_key: WEB3FORMS_KEY, subject, from_name: "Game Night", name, message }),
    });
    return res.ok;
  } catch (e) { return false; }
}
