// auth.js (Firebase Auth + init) — ES module, GitHub Pages friendly (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
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
// skipResend: se true, non reinvia l'email (utile subito dopo la registrazione)
export async function ensureVerifiedOrBlock(user, setError, skipResend = false) {
  await reload(user);
  if (user.emailVerified) return true;

  // Controlla se l'account è stato creato di recente (meno di 1 minuto fa)
  // Se sì, probabilmente l'email è già stata inviata durante la registrazione
  const accountCreated = user.metadata?.creationTime ? new Date(user.metadata.creationTime) : null;
  const now = new Date();
  const minutesSinceCreation = accountCreated ? (now - accountCreated) / (1000 * 60) : null;
  const isRecentAccount = minutesSinceCreation !== null && minutesSinceCreation < 1;

  // Evita di reinviare l'email se è stata appena inviata (durante la registrazione)
  // Ma solo se l'account è molto recente (meno di 1 minuto)
  if (!skipResend && !isRecentAccount) {
    try {
      await sendVerificationOrThrow(user);
    } catch (e) {
      console.error("sendEmailVerification failed", e);
    }
  }

  await signOut(auth);
  if (typeof setError === "function") {
    if (skipResend || isRecentAccount) {
      setError(
        "Email non verificata. Controlla la tua casella (anche spam) per il link di verifica."
      );
    } else {
      setError(
        "Email non verificata. Ti ho (ri)inviato la mail di verifica. Controlla anche spam."
      );
    }
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

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email, { url: getBaseUrl("index.html") });
}

export async function logout() {
  await signOut(auth);
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}
