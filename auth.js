// auth.js (Firebase Auth + init) — ES module, GitHub Pages friendly (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  reload,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// --- Firebase init (spostato qui) ---
const firebaseConfig = {
  apiKey: "AIzaSyCh32lo8dxpQ3u0xf6FnadGtKYo5-kNDRk",
  authDomain: "study-planner-80c7a.firebaseapp.com",
  projectId: "study-planner-80c7a",
  storageBucket: "study-planner-80c7a.firebasestorage.app",
  messagingSenderId: "551672760618",
  appId: "1:551672760618:web:b496e32ff8aea43d737653",
  measurementId: "G-VSNL2PK1KN",
};

const fbApp = initializeApp(firebaseConfig);

export const auth = getAuth(fbApp);
export const db = getFirestore(fbApp);

// Base URL robusta per GitHub Pages + path con repo
// auth.js
const PROD_ORIGIN = "https://methodo.app"; // <- il tuo dominio vero
const PROD_PATH = "/";                     // se hai repo path tipo "/methodo/" mettilo qui

export function getBaseUrl(file = "index.html") {
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.protocol === "file:";

  if (isLocal) {
    // in locale continua a funzionare
    const basePath = location.pathname.replace(/\/[^/]*$/, "/");
    return `${location.origin}${basePath}${file}`;
  }

  // in produzione FORZA methodo.app
  return `${PROD_ORIGIN}${PROD_PATH}${file}`;
}


// --- Email verification helpers ---
export async function sendVerificationOrThrow(user) {
  await sendEmailVerification(user, { url: getBaseUrl("index.html") });
}

// Se non verificato: reinvia mail (best effort), logout e blocca
export async function ensureVerifiedOrBlock(user, setError) {
  await reload(user);
  if (user.emailVerified) return true;

  try {
    await sendVerificationOrThrow(user);
  } catch (e) {
    console.error("sendEmailVerification failed", e);
  }

  await signOut(auth);
  if (typeof setError === "function") {
    setError(
      "Email non verificata. Ti ho (ri)inviato la mail di verifica. Controlla anche spam."
    );
  }
  return false;
}

// --- API Auth minimal ---
export async function loginWithEmail(email, pass) {
  return await signInWithEmailAndPassword(auth, email, pass);
}

export async function signupWithEmail(email, pass) {
  return await createUserWithEmailAndPassword(auth, email, pass);
}

export async function logout() {
  await signOut(auth);
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}
