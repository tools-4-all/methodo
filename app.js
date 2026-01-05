// app.js (single-file, GitHub Pages-friendly)
// Works with: index.html, onboarding.html, app.html, task.html, profile.html, strategies.html, settings.html
// Requires: planner.js (ES module) for generateWeeklyPlan/startOfWeekISO
// Auth moved to: auth.js

console.log("app.js loaded", location.href);

import {
  auth,
  db,
  app,
  watchAuth,
  loginWithEmail,
  signupWithEmail,
  resetPassword,
  logout,
  ensureVerifiedOrBlock,
  sendVerificationOrThrow,
} from "./auth.js";

import { reload } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

import { generateWeeklyPlan, startOfWeekISO } from "./planner.js";

// ----------------- Firebase Functions -----------------
let functions, createCheckoutSession, cancelSubscription, fixSubscriptionEndDate, activatePromoCode, getReferralCode, processReferral;
try {
  // Usa l'app Firebase inizializzata da auth.js e specifica la regione
  functions = getFunctions(app, 'us-central1');
  createCheckoutSession = httpsCallable(functions, 'createCheckoutSession');
  cancelSubscription = httpsCallable(functions, 'cancelSubscription');
  fixSubscriptionEndDate = httpsCallable(functions, 'fixSubscriptionEndDate');
  activatePromoCode = httpsCallable(functions, 'activatePromoCode');
  getReferralCode = httpsCallable(functions, 'getReferralCode');
  processReferral = httpsCallable(functions, 'processReferral');
  console.log("Firebase Functions inizializzate correttamente");
} catch (e) {
  console.error("Firebase Functions non disponibili:", e);
  console.error("Dettagli errore:", e.message, e.stack);
}

// ----------------- Utils -----------------
function qs(id) {
  return document.getElementById(id);
}
function show(el, yes) {
  if (!el) return;
  el.classList.toggle("hidden", !yes);
}
function setText(el, t) {
  if (el) el.textContent = t ?? "";
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ----------------- Debug Date System (LOCALHOST ONLY) -----------------
function isLocalhost() {
  return window.location.hostname === "localhost" || 
         window.location.hostname === "127.0.0.1" ||
         window.location.hostname === "";
}

function getVirtualDate() {
  if (!isLocalhost()) return null;
  try {
    const saved = localStorage.getItem("debug_virtual_date");
    if (saved) {
      const date = new Date(saved);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  } catch (e) {
    console.warn("[Debug] Errore lettura data virtuale:", e);
  }
  return null;
}

function setVirtualDate(date) {
  if (!isLocalhost()) return;
  try {
    if (date) {
      localStorage.setItem("debug_virtual_date", date.toISOString());
    } else {
      localStorage.removeItem("debug_virtual_date");
    }
    // Emetti evento per aggiornare l'app
    window.dispatchEvent(new CustomEvent("virtualDateChanged"));
  } catch (e) {
    console.warn("[Debug] Errore salvataggio data virtuale:", e);
  }
}

function getCurrentDate() {
  const virtual = getVirtualDate();
  return virtual || new Date();
}

function isoToday() {
  const d = getCurrentDate();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function daysTo(dateISO) {
  const now = getCurrentDate();
  const d = new Date(dateISO);
  const ms = 24 * 60 * 60 * 1000;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((b - a) / ms));
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
function z2(n) {
  return String(n).padStart(2, "0");
}
function fmtMMSS(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Toast (popup leggero)
function showToast(msg, ms = 4500) {
  const box = document.getElementById("toast");
  const text = document.getElementById("toast-msg");
  const close = document.getElementById("toast-close");
  if (!box || !text) return;

  text.textContent = msg ?? "";
  box.classList.remove("hidden");

  const hide = () => box.classList.add("hidden");

  if (close && !close.dataset.bound) {
    close.dataset.bound = "1";
    close.addEventListener("click", hide);
  }

  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(hide, ms);
}

/**
 * Mostra un popup di errore/avviso con design coerente
 */
function showVerificationEmailModal() {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("verification-email-modal")) return;
  
  const overlay = document.createElement("div");
  overlay.id = "verification-email-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.75)",
    zIndex: "10000",
    padding: "20px",
    animation: "fadeIn 0.2s ease-out",
    backdropFilter: "blur(4px)",
  });
  
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "450px";
  card.style.width = "95%";
  card.style.padding = "32px";
  card.style.position = "relative";
  card.style.animation = "slideUp 0.3s ease-out";
  card.style.background = "rgba(10, 12, 20, 0.95)";
  card.style.backdropFilter = "blur(10px)";
  card.style.border = "1px solid rgba(34, 197, 94, 0.3)";
  
  // Icona di successo
  const icon = document.createElement("div");
  icon.style.cssText = `
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    font-size: 24px;
    color: rgba(34, 197, 94, 1);
  `;
  icon.textContent = "✉";
  
  // Titolo
  const titleEl = document.createElement("h2");
  titleEl.textContent = "Email inviata!";
  titleEl.style.cssText = `
    font-size: 22px;
    font-weight: 900;
    margin: 0 0 12px 0;
    color: rgba(255,255,255,0.95);
    text-align: center;
  `;
  
  // Messaggio
  const messageEl = document.createElement("p");
  messageEl.innerHTML = `
    Ti ho inviato una email di verifica all'indirizzo che hai indicato.<br><br>
    <strong>Controlla la tua casella di posta</strong> (anche la cartella spam) e clicca sul link per verificare il tuo account.<br><br>
    Dopo la verifica, potrai effettuare il login.
  `;
  messageEl.style.cssText = `
    color: rgba(255,255,255,0.8);
    font-size: 15px;
    margin: 0 0 24px 0;
    text-align: center;
    line-height: 1.5;
  `;
  
  // Bottone OK
  const okBtn = document.createElement("button");
  okBtn.className = "btn primary";
  okBtn.textContent = "Ho capito";
  okBtn.style.cssText = "width: 100%; padding: 12px; font-size: 15px; font-weight: 600;";
  
  const closeModal = () => {
    try {
      document.body.removeChild(overlay);
    } catch {}
  };
  
  okBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  
  card.appendChild(icon);
  card.appendChild(titleEl);
  card.appendChild(messageEl);
  card.appendChild(okBtn);
  
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  
  // Chiudi con ESC
  const escHandler = (e) => {
    if (e.key === "Escape" && document.getElementById("verification-email-modal")) {
      closeModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

function showErrorModal(message, title = "Attenzione") {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("error-modal")) return;
  
  const overlay = document.createElement("div");
  overlay.id = "error-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.75)",
    zIndex: "10000",
    padding: "20px",
    animation: "fadeIn 0.2s ease-out",
    backdropFilter: "blur(4px)",
  });
  
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "450px";
  card.style.width = "95%";
  card.style.padding = "32px";
  card.style.position = "relative";
  card.style.animation = "slideUp 0.3s ease-out";
  card.style.background = "rgba(10, 12, 20, 0.95)";
  card.style.backdropFilter = "blur(10px)";
  card.style.border = "1px solid rgba(239, 68, 68, 0.3)";
  
  // Icona di errore
  const icon = document.createElement("div");
  icon.style.cssText = `
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    font-size: 24px;
    color: rgba(239, 68, 68, 1);
  `;
  icon.textContent = "⚠";
  
  // Titolo
  const titleEl = document.createElement("h2");
  titleEl.textContent = title;
  titleEl.style.cssText = `
    font-size: 22px;
    font-weight: 900;
    margin: 0 0 12px 0;
    color: rgba(255,255,255,0.95);
    text-align: center;
  `;
  
  // Messaggio
  const messageEl = document.createElement("p");
  messageEl.textContent = message;
  messageEl.style.cssText = `
    color: rgba(255,255,255,0.8);
    font-size: 15px;
    margin: 0 0 24px 0;
    text-align: center;
    line-height: 1.5;
  `;
  
  // Bottone OK
  const okBtn = document.createElement("button");
  okBtn.className = "btn primary";
  okBtn.textContent = "OK";
  okBtn.style.cssText = "width: 100%; padding: 12px; font-size: 15px; font-weight: 600;";
  
  card.appendChild(icon);
  card.appendChild(titleEl);
  card.appendChild(messageEl);
  card.appendChild(okBtn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  
  // Funzione per chiudere
  const closeModal = () => {
    try {
      document.body.removeChild(overlay);
    } catch {}
  };
  
  // Event listeners
  okBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("error-modal")) {
      closeModal();
    }
  });
}

// ----------------- Firestore helpers -----------------
async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // Genera automaticamente il referral code quando si crea il documento
    const referralCode = `REF${user.uid.substring(0, 8).toUpperCase()}`;
    await setDoc(ref, {
      email: user.email ?? "",
      referralCode: referralCode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.log(`[Referral] Codice referral generato automaticamente alla registrazione: ${referralCode}`);
  } else {
    // Se il documento esiste ma non ha referralCode, generalo
    const data = snap.data();
    if (!data.referralCode) {
      const referralCode = `REF${user.uid.substring(0, 8).toUpperCase()}`;
      await setDoc(ref, {
        referralCode: referralCode,
        updatedAt: serverTimestamp(),
      }, {merge: true});
      console.log(`[Referral] Codice referral generato per utente esistente: ${referralCode}`);
    }
  }
}

async function getProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// ----------------- Premium helpers -----------------
/**
 * Controlla se l'utente può aggiungere un esame
 * Limite free: 2 esami
 * Limite premium: illimitati
 */
async function canAddExam(uid) {
  const isPremiumUser = await isPremium(uid);
  
  // Utenti premium possono aggiungere esami illimitati
  if (isPremiumUser) {
    return {
      allowed: true,
      message: ""
    };
  }
  
  // Utenti free: limite di 2 esami
  const exams = await listExams(uid);
  const currentCount = exams?.length || 0;
  const limit = 2;
  
  if (currentCount >= limit) {
    return {
      allowed: false,
      message: `Hai raggiunto il limite di ${limit} esami nella versione gratuita. Passa a Premium per esami illimitati.`
    };
  }
  
  return {
    allowed: true,
    message: ""
  };
}

/**
 * Controlla se l'utente ha un abbonamento premium attivo
 * Include anche abbonamenti cancellati purché il periodo pagato non sia scaduto
 */
async function isPremium(uid) {
  const profile = await getProfile(uid);
  if (!profile) return false;
  
  const subscription = profile.subscription;
  if (!subscription) return false;
  
  // Accetta sia 'active' che 'cancelled'/'canceled' (se il periodo pagato non è scaduto)
  // Non accetta 'expired' che indica abbonamento scaduto
  const isActive = subscription.status === 'active';
  const isCancelled = subscription.status === 'cancelled' || subscription.status === 'canceled';
  const isExpired = subscription.status === 'expired';
  
  // Se è scaduto, ritorna false immediatamente
  if (isExpired) {
    return false;
  }
  
  if (!isActive && !isCancelled) {
    return false;
  }
  
  // PROTEZIONE: Verifica che l'abbonamento sia verificato da Stripe (solo per active)
  // In produzione, richiedi che sia verificato (non manipolato manualmente)
  if (isActive) {
    const isVerified = subscription?.verified === true;
    const isTestMode = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname.includes('github.io') ||
                       window.location.hostname.includes('127.0.0.1');
    
    // In produzione, richiedi verifica Stripe (blocca carte di test)
    if (!isTestMode && !isVerified) {
      console.warn(`Abbonamento non verificato per utente ${uid} - potrebbe essere una manipolazione`);
      return false;
    }
  }
  
  // Controlla che endDate sia nel futuro (anche se cancellato, può usare fino alla fine del periodo pagato)
  let endDate = subscription?.endDate?.toDate ? 
                subscription.endDate.toDate() : 
                (subscription?.endDate ? new Date(subscription.endDate) : null);
  
  // Se endDate è mancante ma c'è stripeSubscriptionId, prova a recuperarlo automaticamente (solo una volta)
  if ((!endDate || isNaN(endDate.getTime())) && subscription?.stripeSubscriptionId && fixSubscriptionEndDate) {
    console.warn(`[isPremium] endDate mancante per utente ${uid}, tentativo recupero da Stripe...`);
    try {
      // Chiama la funzione per recuperare endDate da Stripe (solo se non è già in corso)
      const fixKey = `fixing_endDate_${uid}`;
      if (!window[fixKey]) {
        window[fixKey] = true;
        fixSubscriptionEndDate().then(() => {
          console.log(`[isPremium] endDate recuperato da Stripe per utente ${uid}`);
          delete window[fixKey];
        }).catch(err => {
          console.error(`[isPremium] Errore recupero endDate:`, err);
          delete window[fixKey];
        });
      }
    } catch (err) {
      console.error(`[isPremium] Errore chiamata fixSubscriptionEndDate:`, err);
    }
    // Ritorna false per ora, ma la prossima chiamata dovrebbe avere endDate
    return false;
  }
  
  if (!endDate || isNaN(endDate.getTime())) {
    return false;
  }
  
  // Usa getCurrentDate() per supportare date virtuali
  const now = getCurrentDate();
  const hasExpired = endDate.getTime() <= now.getTime();
  
  // Se l'abbonamento è scaduto, aggiorna lo status nel database (solo se non è Stripe)
  // Per abbonamenti Stripe, lo status viene gestito dai webhook
  if (hasExpired && !subscription?.stripeSubscriptionId) {
    // Aggiorna lo status a 'expired' in background (non bloccare la risposta)
    updateExpiredSubscription(uid).catch(err => {
      console.error(`[isPremium] Errore aggiornamento subscription scaduta:`, err);
    });
  }
  
  return !hasExpired;
}

/**
 * Aggiorna lo status dell'abbonamento quando scade (solo per abbonamenti non Stripe)
 */
async function updateExpiredSubscription(uid) {
  try {
    const profile = await getProfile(uid);
    if (!profile?.subscription) return;
    
    const subscription = profile.subscription;
    
    // Non aggiornare abbonamenti Stripe (gestiti dai webhook)
    if (subscription.stripeSubscriptionId) return;
    
    // Verifica se è effettivamente scaduto
    let endDate = subscription?.endDate?.toDate ? 
                  subscription.endDate.toDate() : 
                  (subscription?.endDate ? new Date(subscription.endDate) : null);
    
    if (!endDate || isNaN(endDate.getTime())) return;
    
    const now = getCurrentDate();
    if (endDate.getTime() > now.getTime()) return; // Non è ancora scaduto
    
    // Aggiorna lo status a 'expired'
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, {
      'subscription.status': 'expired',
      updatedAt: serverTimestamp(),
    });
    
    console.log(`[isPremium] Abbonamento scaduto per utente ${uid}, status aggiornato a 'expired'`);
  } catch (err) {
    console.error(`[isPremium] Errore aggiornamento subscription scaduta:`, err);
  }
}

/**
 * Ottiene informazioni dettagliate sull'abbonamento
 */
async function getSubscriptionInfo(uid) {
  const profile = await getProfile(uid);
  if (!profile) return null;
  
  return {
    isPremium: await isPremium(uid),
    isTrial: false,
    trialDaysLeft: 0,
    subscription: profile.subscription || null,
    createdAt: profile.createdAt
  };
}

/**
 * Mostra modale per upgrade a premium
 */
function showUpgradeModal(onClose = null) {
  if (document.getElementById("upgrade-modal")) return;
  
  const overlay = document.createElement("div");
  overlay.id = "upgrade-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.4)",
    zIndex: "10001",
    padding: "20px",
    animation: "fadeIn 0.2s ease-out",
    backdropFilter: "blur(4px)",
  });
  
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "600px";
  card.style.width = "95%";
  card.style.padding = "32px";
  card.style.position = "relative";
  card.style.animation = "slideUp 0.3s ease-out";
  card.style.background = "rgba(10, 12, 20, 0.95)";
  card.style.backdropFilter = "blur(10px)";
  card.style.border = "1px solid rgba(255, 255, 255, 0.15)";
  
  card.innerHTML = `
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="font-size: 28px; font-weight: 900; margin: 0 0 8px 0; color: rgba(255,255,255,0.95);">
        Sblocca Premium
      </h2>
      <p style="color: rgba(255,255,255,0.7); font-size: 15px; margin: 0;">
        Accedi a tutte le funzionalità avanzate
      </p>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
      <!-- Piano Mensile -->
      <div id="plan-monthly" class="plan-card" style="background: rgba(99,102,241,0.1); border-radius: 12px; padding: 20px; border: 2px solid rgba(99,102,241,0.3); cursor: pointer; transition: all 0.2s; position: relative;">
        <div style="text-align: center; margin-bottom: 12px;">
          <div style="font-size: 24px; font-weight: 900; color: rgba(255,255,255,0.95);">€4,99</div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px;">al mese</div>
        </div>
        <div style="text-align: center; margin-top: 16px;">
          <button class="btn primary" style="width: 100%; padding: 10px; font-size: 14px; font-weight: 600;" data-plan="monthly">
            Scegli Mensile
          </button>
        </div>
      </div>
      
      <!-- Piano Annuale -->
      <div id="plan-yearly" class="plan-card" style="background: rgba(34,197,94,0.1); border-radius: 12px; padding: 20px; border: 2px solid rgba(34,197,94,0.3); cursor: pointer; transition: all 0.2s; position: relative;">
        <div style="position: absolute; top: -8px; right: -8px; background: rgba(34,197,94,1); color: white; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">
          RISPARMIA 17%
        </div>
        <div style="text-align: center; margin-bottom: 12px;">
          <div style="font-size: 24px; font-weight: 900; color: rgba(255,255,255,0.95);">€50</div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px;">all'anno</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 4px;">€4,17/mese</div>
        </div>
        <div style="text-align: center; margin-top: 16px;">
          <button class="btn primary" style="width: 100%; padding: 10px; font-size: 14px; font-weight: 600; background: rgba(34,197,94,1);" data-plan="yearly">
            Scegli Annuale
          </button>
        </div>
      </div>
    </div>
    
    <div style="background: rgba(99,102,241,0.05); border-radius: 12px; padding: 16px; margin-bottom: 20px; border: 1px solid rgba(99,102,241,0.2);">
      <div style="font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.9); margin-bottom: 12px;">Tutte le funzionalità Premium:</div>
      <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px;">
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 13px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Esami illimitati</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 13px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Simulazione appelli avanzata</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 13px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Statistiche dettagliate</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 13px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Pianificazione multi-settimana</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 13px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Esportazione piano di studio</span>
        </li>
      </ul>
    </div>
    
    <div style="margin-bottom: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 8px; font-weight: 600;">
          Hai un codice promozionale?
        </label>
        <div style="display: flex; gap: 8px;">
          <input 
            type="text" 
            id="promo-code-input" 
            placeholder="Inserisci codice" 
            style="flex: 1; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.9); font-size: 14px; text-transform: uppercase;"
            maxlength="20"
          />
          <button id="promo-code-btn" class="btn" style="padding: 12px 20px; white-space: nowrap;">
            Attiva
          </button>
        </div>
        <div id="promo-code-message" style="margin-top: 8px; font-size: 12px; min-height: 16px;"></div>
      </div>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <button id="upgrade-close-btn" class="btn ghost" style="width: 100%;">
        Forse più tardi
      </button>
    </div>
    <div id="upgrade-loading" style="display: none; text-align: center; padding: 12px; color: rgba(255,255,255,0.7); font-size: 13px;">
      Caricamento...
    </div>
  `;
  
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  
  const closeModal = () => {
    overlay.style.animation = "fadeOut 0.2s ease-out";
    card.style.animation = "slideDown 0.2s ease-out";
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = "";
      if (onClose) onClose();
    }, 200);
  };
  
  qs("upgrade-close-btn")?.addEventListener("click", closeModal);
  
  // Gestore promo code
  const promoCodeInput = qs("promo-code-input");
  const promoCodeBtn = qs("promo-code-btn");
  const promoCodeMessage = qs("promo-code-message");
  
  promoCodeBtn?.addEventListener("click", async () => {
    const code = promoCodeInput?.value?.trim().toUpperCase();
    const user = auth.currentUser;
    
    if (!user) {
      showToast("Devi essere loggato per usare un promo code", 3000);
      return;
    }
    
    if (!code) {
      if (promoCodeMessage) {
        promoCodeMessage.textContent = "Inserisci un codice promozionale";
        promoCodeMessage.style.color = "rgba(239,68,68,1)";
      }
      return;
    }
    
    if (!activatePromoCode) {
      console.error("activatePromoCode non disponibile");
      showToast("Errore: servizio non disponibile. Ricarica la pagina.", 5000);
      return;
    }
    
    try {
      // Disabilita il bottone e mostra loading
      if (promoCodeBtn) {
        promoCodeBtn.disabled = true;
        promoCodeBtn.textContent = "⏳ Attivazione...";
      }
      if (promoCodeInput) promoCodeInput.disabled = true;
      if (promoCodeMessage) {
        promoCodeMessage.textContent = "Verifica in corso...";
        promoCodeMessage.style.color = "rgba(255,255,255,0.7)";
      }
      
      // Prepara i dati da inviare, includendo la data virtuale se presente (solo in localhost)
      const requestData = { code };
      if (isLocalhost()) {
        const virtualDate = getVirtualDate();
        if (virtualDate) {
          requestData.virtualDate = virtualDate.toISOString();
          console.log("[PromoCode] [CLIENT] Data virtuale trovata:", virtualDate.toISOString());
          console.log("[PromoCode] [CLIENT] Timestamp data virtuale:", virtualDate.getTime());
          console.log("[PromoCode] [CLIENT] Data reale:", new Date().toISOString());
          console.log("[PromoCode] [CLIENT] Dati che verranno inviati:", JSON.stringify(requestData, null, 2));
        } else {
          console.log("[PromoCode] [CLIENT] Nessuna data virtuale trovata in localStorage");
        }
      } else {
        console.log("[PromoCode] [CLIENT] Non siamo in localhost, non invio data virtuale");
      }
      
      console.log("[PromoCode] [CLIENT] Chiamata activatePromoCode con:", JSON.stringify(requestData, null, 2));
      const result = await activatePromoCode(requestData);
      
      if (result?.data?.success) {
        if (promoCodeMessage) {
          promoCodeMessage.textContent = `✅ ${result.data.message || 'Premium attivato!'}`;
          promoCodeMessage.style.color = "rgba(34,197,94,1)";
        }
        showToast(result.data.message || "Premium attivato con successo!", 3000);
        
        // Chiudi la modale
        closeModal();
        
        // Aggiorna la subscription se siamo nella pagina profilo
        if (window.location.pathname.includes('profile.html')) {
          const currentUser = auth.currentUser;
          if (currentUser) {
            // Piccolo delay per assicurarsi che il database sia aggiornato
            setTimeout(async () => {
              await renderSubscription(currentUser.uid);
            }, 500);
          }
        } else {
          // Altrimenti ricarica la pagina
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        }
      }
    } catch (error) {
      console.error("Errore attivazione promo code:", error);
      
      let errorMessage = "Errore durante l'attivazione del codice";
      if (error.code === 'not-found') {
        errorMessage = "Codice promozionale non trovato";
      } else if (error.code === 'already-exists') {
        errorMessage = "Codice promozionale già utilizzato";
      } else if (error.code === 'deadline-exceeded') {
        errorMessage = "Codice promozionale scaduto";
      } else if (error.code === 'permission-denied') {
        errorMessage = "Codice promozionale disattivato";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      if (promoCodeMessage) {
        promoCodeMessage.textContent = `❌ ${errorMessage}`;
        promoCodeMessage.style.color = "rgba(239,68,68,1)";
      }
      
      // Riabilita il bottone
      if (promoCodeBtn) {
        promoCodeBtn.disabled = false;
        promoCodeBtn.textContent = "Attiva";
      }
      if (promoCodeInput) promoCodeInput.disabled = false;
    }
  });
  
  // Permetti attivazione con Enter
  promoCodeInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      promoCodeBtn?.click();
    }
  });
  
  // Gestione selezione piano e click sui bottoni
  let selectedPlan = 'monthly'; // Default
  
  // Aggiungi stile hover ai piani
  const planCards = card.querySelectorAll('.plan-card');
  planCards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = 'none';
    });
  });
  
  // Gestore click sui bottoni dei piani
  const handlePlanSelection = async (planType) => {
    const loadingEl = qs("upgrade-loading");
    const user = auth.currentUser;
    
    if (!user) {
      showToast("Devi essere loggato per passare a Premium", 3000);
      return;
    }
    
    // Verifica che createCheckoutSession sia disponibile
    if (!createCheckoutSession) {
      console.error("createCheckoutSession non disponibile");
      showToast("Errore: servizio di pagamento non disponibile. Ricarica la pagina.", 5000);
      return;
    }
    
    try {
      // Disabilita tutti i bottoni e mostra loading
      const allButtons = card.querySelectorAll('button[data-plan]');
      allButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.6";
      });
      if (loadingEl) loadingEl.style.display = "block";
      
      console.log(`Creazione sessione Stripe Checkout per piano: ${planType}...`);
      
      // Chiama Firebase Functions per creare la sessione Stripe
      const result = await createCheckoutSession({
        email: user.email,
        planType: planType, // 'monthly' o 'yearly'
        successUrl: `${window.location.origin}${window.location.pathname.includes('profile') ? '/profile.html' : '/app.html'}?premium=success`,
        cancelUrl: `${window.location.origin}${window.location.pathname.includes('profile') ? '/profile.html' : '/app.html'}?premium=canceled`
      });
      
      console.log("Risultato createCheckoutSession:", result);
      
      // Reindirizza a Stripe Checkout
      if (result?.data?.url) {
        console.log("Reindirizzamento a Stripe Checkout:", result.data.url);
        // Mostra avviso se in modalità test
        if (result.data?.mode === 'test') {
          showToast("Modalità TEST: usa carte di test (es: 4242 4242 4242 4242)", 5000);
        }
        window.location.href = result.data.url;
      } else {
        console.error("URL non presente nel risultato:", result);
        throw new Error("URL di checkout non ricevuto");
      }
    } catch (error) {
      console.error("Errore durante la creazione della sessione di pagamento:", error);
      console.error("Dettagli errore:", error.code, error.message, error.details);
      
      let errorMessage = "Errore durante l'avvio del pagamento. Riprova più tardi.";
      if (error.message) {
        errorMessage = error.message;
      } else if (error.code) {
        errorMessage = `Errore ${error.code}: ${error.message || 'Errore sconosciuto'}`;
      }
      
      showToast(errorMessage, 5000);
      
      // Riabilita i bottoni
      const allButtons = card.querySelectorAll('button[data-plan]');
      allButtons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = "1";
      });
      if (loadingEl) loadingEl.style.display = "none";
    }
  };
  
  // Aggiungi event listener ai bottoni dei piani
  card.querySelectorAll('button[data-plan]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const planType = e.target.getAttribute('data-plan');
      handlePlanSelection(planType);
    });
  });
  
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("upgrade-modal")) {
      closeModal();
    }
  });
}

async function setProfile(uid, data) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

// ----------------- Premium Testing Helper -----------------
/**
 * Funzione di test per attivare/disattivare premium manualmente
 * Usa questa funzione dalla console del browser per testare:
 * 
 * Esempio:
 *   await testPremium(true)  // Attiva premium
 *   await testPremium(false) // Disattiva premium
 */
async function testPremium(activate = true) {
  // PROTEZIONE: Disabilita testPremium in produzione
  const isTestMode = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1' ||
                     window.location.hostname.includes('github.io');
  
  if (!isTestMode) {
    console.error("testPremium è disabilitato in produzione per sicurezza");
    alert("Funzione di test disabilitata in produzione. Usa Stripe Checkout per attivare Premium.");
    return;
  }
  
  const user = auth.currentUser;
  if (!user) {
    console.error("Nessun utente loggato");
    return;
  }
  
  if (activate) {
    // Attiva premium per 30 giorni (solo in test mode)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    
    await setProfile(user.uid, {
      subscription: {
        status: 'active',
        startDate: serverTimestamp(),
        endDate: endDate.toISOString(),
        type: 'monthly',
        price: 4.99,
        verified: false, // Marca come non verificato (solo per test)
        testMode: true // Flag per indicare che è un test
      }
    });
    
    console.log("✅ Premium attivato per test (30 giorni) - SOLO IN TEST MODE");
    showToast("Premium attivato per test! Ricarica la pagina.", 5000);
  } else {
    // Disattiva premium
    await setProfile(user.uid, {
      subscription: {
        status: 'cancelled',
        endDate: new Date().toISOString()
      }
    });
    
    console.log("❌ Premium disattivato! Ricarica la pagina per vedere i cambiamenti.");
    showToast("Premium disattivato per test! Ricarica la pagina.", 5000);
  }
}

// Esponi la funzione globalmente per uso dalla console
window.testPremium = testPremium;

async function listExams(uid) {
  const col = collection(db, "users", uid, "exams");
  const snap = await getDocs(col);
  const exams = [];
  
  // Carica esami superati per filtrarli
  const passedExams = await listPassedExams(uid);
  const passedExamIds = new Set(passedExams.map(e => e.originalExamId || e.examId || e.id));
  
  snap.forEach((d) => {
    const examData = d.data();
    
    // Salta se l'esame è stato superato
    if (passedExamIds.has(d.id)) {
      return;
    }
    
    // Assicura che ogni esame abbia una category (per compatibilità con esami vecchi)
    if (!examData.category || examData.category === "auto") {
      examData.category = detectExamCategory(examData.name || "");
    }
    
    // Migrazione: se l'esame ha solo 'date' (vecchio formato), convertilo in appelli
    if (examData.date && !examData.appelli) {
      examData.appelli = [{
        date: examData.date,
        type: "esame", // default
        selected: true
      }];
      // Mantieni anche date per compatibilità
    } else if (!examData.appelli && !examData.date) {
      // Se non ha né appelli né date, crea un array vuoto
      examData.appelli = [];
    }
    
    // Filtra appelli superati
    if (examData.appelli && Array.isArray(examData.appelli)) {
      const passedAppelloDates = new Set(
        passedExams
          .filter(e => (e.originalExamId || e.examId) === d.id)
          .map(e => e.appelloDate || e.date)
      );
      
      examData.appelli = examData.appelli.map(appello => {
        // Se l'appello è stato superato, deselezionalo
        if (passedAppelloDates.has(appello.date)) {
          return { ...appello, selected: false, passed: true };
        }
        return appello;
      });
      
      // Se tutti gli appelli sono stati superati, salta l'esame
      const hasSelectedAppelli = examData.appelli.some(a => a.selected !== false && !a.passed);
      if (!hasSelectedAppelli && examData.appelli.length > 0) {
        return; // Salta questo esame
      }
    }
    
    exams.push({ id: d.id, ...examData });
  });
  // Ordina per la prima data disponibile (da appelli o date legacy)
  exams.sort((a, b) => {
    const dateA = a.appelli?.[0]?.date || a.date || "";
    const dateB = b.appelli?.[0]?.date || b.date || "";
    return String(dateA).localeCompare(String(dateB));
  });
  return exams;
}

async function addExam(uid, exam) {
  const col = collection(db, "users", uid, "exams");
  
  // Filtra i campi undefined (Firestore non li accetta)
  const cleanExam = {};
  for (const [key, value] of Object.entries(exam)) {
    if (value !== undefined) {
      cleanExam[key] = value;
    }
  }
  
  const ref = await addDoc(col, {
    ...cleanExam,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Invalida il piano per forzare la rigenerazione automatica
  await invalidateWeeklyPlan(uid);
  return ref.id;
}

async function removeExam(uid, examId) {
  const ref = doc(db, "users", uid, "exams", examId);
  await deleteDoc(ref);
  // Invalida il piano per forzare la rigenerazione automatica
  await invalidateWeeklyPlan(uid);
}

async function updateExam(uid, examId, examData) {
  const ref = doc(db, "users", uid, "exams", examId);
  
  // Filtra i campi undefined (Firestore non li accetta)
  const cleanExamData = {};
  for (const [key, value] of Object.entries(examData)) {
    if (value !== undefined) {
      cleanExamData[key] = value;
    }
  }
  
  await updateDoc(ref, { ...cleanExamData, updatedAt: serverTimestamp() });
  // Invalida il piano per forzare la rigenerazione automatica
  await invalidateWeeklyPlan(uid);
}

/**
 * Calcola e aggiorna automaticamente il livello di preparazione di un esame
 * basato su task completate e giorni passati dall'inizio della preparazione.
 * 
 * @param {string} uid - ID utente
 * @param {object} exam - Oggetto esame con id, name, date, level, createdAt
 * @returns {Promise<number|null>} Nuovo livello calcolato (0-5) o null se non aggiornato
 */
async function updateExamLevelAutomatically(uid, exam) {
  if (!exam || !exam.id) return null;
  
  const currentLevel = clamp(exam.level ?? 0, 0, 5);
  const examId = exam.id;
  const examName = exam.name;
  
  // Trova l'ID corretto (può essere l'ID originale o un ID virtuale con appello)
  const examIdsToCheck = [examId];
  if (exam.appelli && Array.isArray(exam.appelli) && exam.appelli.length > 0) {
    const selectedAppelli = exam.appelli.filter(a => a.selected !== false);
    for (const appello of selectedAppelli) {
      examIdsToCheck.push(`${examId}_${appello.date}`);
    }
  }
  
  // Conta task completate per questo esame
  let completedTasks = 0;
  let totalMinutes = 0;
  
  try {
    // Scansiona localStorage per task completate
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sp_task_done_")) {
        try {
          const taskId = key.replace("sp_task_done_", "");
          // Prova a recuperare il payload della task
          const payloadKey = `sp_task_${taskId}`;
          const payloadStr = localStorage.getItem(payloadKey) || sessionStorage.getItem(payloadKey);
          if (payloadStr) {
            const payload = JSON.parse(payloadStr);
            const task = payload?.task;
            if (task && (examIdsToCheck.includes(task.examId) || task.examName === examName)) {
              completedTasks++;
              totalMinutes += Number(task.minutes || 0);
            }
          }
        } catch (e) {
          // Ignora errori di parsing
        }
      }
    }
  } catch (e) {
    console.error("Errore scansionando localStorage:", e);
  }
  
  // Calcola giorni dall'inizio della preparazione
  // Usa createdAt se disponibile, altrimenti stima dalla data dell'esame
  let daysSinceStart = 0;
  if (exam.createdAt) {
    const createdAt = exam.createdAt.toDate ? exam.createdAt.toDate() : new Date(exam.createdAt);
    daysSinceStart = Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24));
  } else if (exam.date) {
    // Stima: assumi che la preparazione sia iniziata 30 giorni prima dell'esame
    const examDate = new Date(exam.date);
    const estimatedStart = new Date(examDate);
    estimatedStart.setDate(estimatedStart.getDate() - 30);
    daysSinceStart = Math.floor((new Date() - estimatedStart) / (1000 * 60 * 60 * 24));
  }
  
  // Determina il livello iniziale (quando l'esame è stato creato)
  // Se non è salvato, usa il livello corrente come base
  const initialLevel = clamp(Number(exam.initialLevel ?? currentLevel), 0, 5);
  
  // Calcola nuovo livello basato su:
  // 1. Task completate (ogni 3 task = +0.5 livello, max +3.0) - più veloce
  // 2. Minuti totali (ogni 200 minuti = +0.2 livello, max +1.0) - più veloce
  // 3. Giorni passati (ogni 10 giorni = +0.2 livello, max +1.0) - meno importante
  // Formula migliorata: più responsiva alle task completate
  const taskProgress = Math.min(completedTasks / 3 * 0.5, 3.0); // Max +3.0 (più veloce)
  const minutesProgress = Math.min(totalMinutes / 200 * 0.2, 1.0); // Max +1.0 (più veloce)
  const daysProgress = Math.min(daysSinceStart / 10 * 0.2, 1.0); // Max +1.0 (meno importante)
  
  // Il nuovo livello è calcolato dal livello iniziale + progresso
  // Questo evita accumuli e rende il calcolo più coerente
  const calculatedLevel = Math.min(
    Math.round((initialLevel + taskProgress + minutesProgress + daysProgress) * 10) / 10,
    5
  );
  
  const newLevel = clamp(Math.round(calculatedLevel * 2) / 2, 0, 5); // Arrotonda a 0.5
  
  // Aggiorna se il livello è aumentato di almeno 0.5 rispetto al livello corrente
  // O se ci sono state task completate (per aggiornare più frequentemente)
  // Permetti aggiornamenti più frequenti quando ci sono task completate
  const hasProgress = completedTasks > 0 || totalMinutes > 0;
  const levelIncreased = newLevel > currentLevel;
  const significantIncrease = newLevel > currentLevel + 0.4;
  
  // Aggiorna se:
  // 1. Aumento significativo (>= 0.5) O
  // 2. C'è progresso (task/minuti) e il livello è aumentato (anche di poco)
  if ((significantIncrease || (hasProgress && levelIncreased)) && newLevel >= initialLevel) {
    try {
      // Salva anche il livello iniziale se non presente
      const updateData = { level: newLevel };
      if (!exam.initialLevel) {
        updateData.initialLevel = initialLevel;
      }
      await updateExam(uid, examId, updateData);
      return newLevel;
    } catch (e) {
      console.error("Errore aggiornamento livello esame:", e);
      return null;
    }
  }
  
  return null;
}

async function addPassedExam(uid, examData) {
  const col = collection(db, "users", uid, "passedExams");
  const ref = await addDoc(col, {
    ...examData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function listPassedExams(uid) {
  const col = collection(db, "users", uid, "passedExams");
  const snap = await getDocs(col);
  const exams = [];
  snap.forEach((d) => exams.push({ id: d.id, ...d.data() }));
  exams.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))); // più recenti prima
  return exams;
}

async function removePassedExam(uid, examId) {
  const ref = doc(db, "users", uid, "passedExams", examId);
  await deleteDoc(ref);
}

// ----------------- Check and Handle Passed Appelli -----------------
/**
 * Controlla se ci sono appelli passati (ieri o oggi) e mostra un popup per gestirli
 */
async function checkAndHandlePassedAppelli(uid, exams) {
  const today = getCurrentDate();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const passedAppelli = [];
  
  // Trova tutti gli appelli passati (ieri o oggi)
  for (const exam of exams) {
    const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true }] : []);
    const selectedAppelli = appelli.filter(a => a.selected !== false);
    
    for (const appello of selectedAppelli) {
      const appelloDate = new Date(appello.date);
      appelloDate.setHours(0, 0, 0, 0);
      
      // Controlla se l'appello è ieri o oggi
      if (appelloDate.getTime() === yesterday.getTime() || appelloDate.getTime() === today.getTime()) {
        // Verifica se non è già stato gestito (non è in passedExams)
        const passedExams = await listPassedExams(uid);
        const alreadyHandled = passedExams.some(
          pe => (pe.originalExamId || pe.examId) === exam.id && 
                (pe.appelloDate || pe.date) === appello.date
        );
        
        if (!alreadyHandled) {
          passedAppelli.push({
            exam,
            appello,
            appelloDate: appello.date
          });
        }
      }
    }
  }
  
  // Se ci sono appelli passati non gestiti, mostra popup
  if (passedAppelli.length > 0) {
    for (const { exam, appello, appelloDate } of passedAppelli) {
      await showPassedAppelloModal(uid, exam, appello, appelloDate);
    }
  }
}

/**
 * Mostra un popup per gestire un appello passato
 */
async function showPassedAppelloModal(uid, exam, appello, appelloDate) {
  // Evita popup multipli
  if (document.getElementById("passed-appello-modal")) return;
  
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "passed-appello-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.75)",
      zIndex: "10000",
      padding: "20px",
    });
    
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxWidth = "450px";
    card.style.width = "95%";
    card.style.padding = "24px";
    
    const dateStr = new Date(appelloDate).toLocaleDateString("it-IT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    
    // Trova appelli successivi disponibili
    const allAppelli = exam.appelli || [];
    const futureAppelli = allAppelli
      .filter(a => {
        const aDate = new Date(a.date);
        aDate.setHours(0, 0, 0, 0);
        return aDate > new Date(appelloDate) && a.selected !== false;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    card.innerHTML = `
      <h2 style="margin: 0 0 16px 0; font-size: 20px;">Appello passato</h2>
      <p style="margin: 0 0 20px 0; color: rgba(255,255,255,0.8); line-height: 1.5;">
        L'appello di <strong>${escapeHtml(exam.name)}</strong> era previsto per il <strong>${dateStr}</strong>.
      </p>
      <p style="margin: 0 0 20px 0; color: rgba(255,255,255,0.7); font-size: 14px;">
        Hai sostenuto questo appello?
      </p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="passed-yes-btn" class="btn primary" style="width: 100%;">
          ✓ Sì, l'ho sostenuto
        </button>
        ${futureAppelli.length > 0 ? `
          <button id="passed-no-next-btn" class="btn" style="width: 100%;">
            ✗ No, preparo l'appello successivo (${futureAppelli[0].date})
          </button>
        ` : ''}
        <button id="passed-no-btn" class="btn ghost" style="width: 100%;">
          ✗ No, rimuovo questo appello
        </button>
      </div>
    `;
    
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    
    const closeModal = async () => {
      try {
        document.body.removeChild(overlay);
      } catch {}
      resolve();
    };
    
    // Handler: Esame superato
    qs("passed-yes-btn")?.addEventListener("click", async () => {
      try {
        // Rimuovi completamente l'esame quando l'utente conferma di averlo sostenuto
        await removeExam(uid, exam.id);
        
        showToast("Esame rimosso dal piano!", 3000);
        await closeModal();
        
        // Emetti evento per aggiornare la dashboard
        window.dispatchEvent(new CustomEvent('examStatusChanged', {
          detail: { type: 'passed', examId: exam.id, appelloDate }
        }));
        
        // Ricarica la pagina per aggiornare tutto (fallback)
        setTimeout(() => {
          if (window.location.pathname.includes('app.html')) {
            window.location.reload();
          }
        }, 500);
      } catch (err) {
        console.error("Errore rimozione esame:", err);
        showErrorModal("Errore durante la rimozione: " + (err?.message || err), "Errore");
      }
    });
    
    // Handler: Preparare appello successivo
    if (futureAppelli.length > 0) {
      qs("passed-no-next-btn")?.addEventListener("click", async () => {
        try {
          // Deseleziona questo appello
          const updatedAppelli = exam.appelli.map(a => 
            a.date === appelloDate ? { ...a, selected: false } : a
          );
          
          // Seleziona l'appello successivo come primary
          const nextAppello = futureAppelli[0];
          const finalAppelli = updatedAppelli.map(a => 
            a.date === nextAppello.date ? { ...a, selected: true, primary: true } : 
            a.primary ? { ...a, primary: false } : a
          );
          
          await updateExam(uid, exam.id, { appelli: finalAppelli });
          
          // Invalida il piano
          await invalidateWeeklyPlan(uid);
          
          showToast(`Appello successivo (${nextAppello.date}) selezionato!`, 3000);
          await closeModal();
          
          // Emetti evento per aggiornare la dashboard
          window.dispatchEvent(new CustomEvent('examStatusChanged', {
            detail: { type: 'appelloChanged', examId: exam.id, nextAppelloDate: nextAppello.date }
          }));
          
          // Ricarica la pagina per aggiornare tutto (fallback)
          setTimeout(() => {
            if (window.location.pathname.includes('app.html')) {
              window.location.reload();
            }
          }, 500);
        } catch (err) {
          console.error("Errore aggiornamento appello:", err);
          showErrorModal("Errore durante l'aggiornamento: " + (err?.message || err), "Errore");
        }
      });
    }
    
    // Handler: Rimuovi appello
    qs("passed-no-btn")?.addEventListener("click", async () => {
      try {
        // Deseleziona questo appello
        const updatedAppelli = exam.appelli.map(a => 
          a.date === appelloDate ? { ...a, selected: false } : a
        );
        await updateExam(uid, exam.id, { appelli: updatedAppelli });
        
        // Invalida il piano
        await invalidateWeeklyPlan(uid);
        
        showToast("Appello rimosso dal piano", 2000);
        await closeModal();
        
        // Emetti evento per aggiornare la dashboard
        window.dispatchEvent(new CustomEvent('examStatusChanged', {
          detail: { type: 'appelloRemoved', examId: exam.id, appelloDate }
        }));
        
        // Ricarica la pagina per aggiornare tutto (fallback)
        setTimeout(() => {
          if (window.location.pathname.includes('app.html')) {
            window.location.reload();
          }
        }, 500);
      } catch (err) {
        console.error("Errore rimozione appello:", err);
        showErrorModal("Errore durante la rimozione: " + (err?.message || err), "Errore");
      }
    });
    
    // Chiudi con ESC
    const escHandler = (e) => {
      if (e.key === "Escape" && document.getElementById("passed-appello-modal")) {
        closeModal();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  });
}

async function saveWeeklyPlan(uid, weekStartISO, plan) {
  const ref = doc(db, "users", uid, "plans", weekStartISO);
  await setDoc(
    ref,
    { weekStart: weekStartISO, plan, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

async function loadWeeklyPlan(uid, weekStartISO, forceRefresh = false) {
  const ref = doc(db, "users", uid, "plans", weekStartISO);
  let snap;
  try {
    if (forceRefresh) {
      // Prova a forzare il refresh dal server, ma fallback a cache se fallisce
      try {
        snap = await getDoc(ref, { source: 'server' });
      } catch (serverError) {
        // Se il refresh dal server fallisce (es. CORS), usa la cache
        console.warn("[loadWeeklyPlan] Refresh dal server fallito, uso cache:", serverError.message);
        snap = await getDoc(ref);
      }
    } else {
      snap = await getDoc(ref);
    }
  } catch (error) {
    // Gestisci errori CORS o di rete in modo silenzioso se non critici
    if (error.message && error.message.includes('access control')) {
      console.warn("[loadWeeklyPlan] Errore CORS (non critico), riprovo con cache");
      snap = await getDoc(ref);
    } else {
      throw error;
    }
  }
  return snap.exists() ? snap.data()?.plan : null;
}

/**
 * Invalida il piano settimanale corrente eliminandolo dal database.
 * Questo forza la rigenerazione automatica del piano alla prossima apertura della dashboard.
 */
async function invalidateWeeklyPlan(uid) {
  try {
    const weekStart = startOfWeekISO(getCurrentDate());
    const weekStartISO = `${weekStart.getFullYear()}-${z2(weekStart.getMonth() + 1)}-${z2(weekStart.getDate())}`;
    const ref = doc(db, "users", uid, "plans", weekStartISO);
    await deleteDoc(ref);
    console.log("[Plan] Piano invalidato per settimana:", weekStartISO);
  } catch (err) {
    console.error("[Plan] Errore invalidazione piano:", err);
  }
}

/**
 * Verifica se ci sono state modifiche che richiedono la rigenerazione del piano.
 * Confronta il profilo e gli esami attuali con quelli salvati nel piano.
 */
/**
 * Normalizza un valore per il confronto (gestisce null/undefined/string/number)
 */
function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const num = Number(val);
    return isNaN(num) ? val : num;
  }
  return val;
}

/**
 * Confronta due valori normalizzandoli prima
 */
function valuesEqual(a, b) {
  return normalizeValue(a) === normalizeValue(b);
}

function hasPlanChanges(currentProfile, currentExams, savedPlan) {
  if (!savedPlan) {
    console.log("[hasPlanChanges] Nessun piano salvato, serve rigenerare");
    return true; // Se non c'è piano salvato, serve rigenerare
  }
  
  if (!savedPlan.profileSnapshot || !savedPlan.examsSnapshot) {
    console.log("[hasPlanChanges] Piano senza snapshot, serve rigenerare");
    return true; // Se non c'è snapshot, serve rigenerare
  }
  
  const snapshot = savedPlan.profileSnapshot;
  
  // Confronta parametri chiave del profilo (normalizzando i valori)
  const profileChanged = 
    !valuesEqual(currentProfile.goalMode, snapshot.goalMode) ||
    !valuesEqual(currentProfile.weeklyHours, snapshot.weeklyHours) ||
    !valuesEqual(currentProfile.taskMinutes, snapshot.taskMinutes) ||
    !valuesEqual(currentProfile.currentHours, snapshot.currentHours) ||
    !valuesEqual(currentProfile.targetHours, snapshot.targetHours) ||
    JSON.stringify(currentProfile.dayMinutes || {}) !== JSON.stringify(snapshot.dayMinutes || {});
  
  if (profileChanged) {
    console.log("[hasPlanChanges] Profilo modificato:", {
      goalMode: { current: currentProfile.goalMode, saved: snapshot.goalMode },
      weeklyHours: { current: currentProfile.weeklyHours, saved: snapshot.weeklyHours },
      taskMinutes: { current: currentProfile.taskMinutes, saved: snapshot.taskMinutes },
    });
  }
  
  // Confronta esami: numero, ID, date, CFU, level, difficulty, category
  const savedExams = savedPlan.examsSnapshot || [];
  const savedExamIds = new Set(savedExams.map(e => e.id));
  const currentExamIds = new Set(currentExams.map(e => e.id));
  
  // Verifica se ci sono esami aggiunti o rimossi
  const examsAdded = currentExams.some(e => !savedExamIds.has(e.id));
  const examsRemoved = Array.from(savedExamIds).some(id => !currentExamIds.has(id));
  
  if (examsAdded || examsRemoved) {
    console.log("[hasPlanChanges] Esami aggiunti/rimossi:", {
      added: examsAdded,
      removed: examsRemoved,
      currentCount: currentExams.length,
      savedCount: savedExams.length
    });
  }
  
  // Verifica se ci sono modifiche agli esami esistenti
  const examsModified = currentExams.some(currentExam => {
    const savedExam = savedExams.find(e => e.id === currentExam.id);
    if (!savedExam) return false;
    
    // Normalizza topics per il confronto
    const normalizeTopics = (topics) => {
      if (!topics) return null;
      if (Array.isArray(topics)) {
        return [...topics].sort();
      }
      if (typeof topics === "string" && topics.trim()) {
        try {
          const parsed = JSON.parse(topics);
          return Array.isArray(parsed) ? parsed.sort() : null;
        } catch {
          return topics.split(/[,\n]/).map(t => t.trim()).filter(t => t).sort();
        }
      }
      return null;
    };
    
    const currentTopics = normalizeTopics(currentExam.topics);
    const savedTopics = normalizeTopics(savedExam.topics);
    
    // Confronta topics: due array sono uguali se hanno gli stessi elementi (ordinati)
    const topicsEqual = (a, b) => {
      if (a === null && b === null) return true;
      if (a === null || b === null) return false;
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      return a.every((val, idx) => val === b[idx]);
    };
    
    const modified = (
      !valuesEqual(currentExam.name, savedExam.name) ||
      !valuesEqual(currentExam.date, savedExam.date) ||
      !valuesEqual(currentExam.cfu, savedExam.cfu) ||
      !valuesEqual(currentExam.level, savedExam.level) ||
      !valuesEqual(currentExam.difficulty, savedExam.difficulty) ||
      !valuesEqual(currentExam.category || "mixed", savedExam.category || "mixed") ||
      !topicsEqual(currentTopics, savedTopics)
    );
    
    if (modified) {
      console.log("[hasPlanChanges] Esame modificato:", {
        id: currentExam.id,
        name: { current: currentExam.name, saved: savedExam.name },
        date: { current: currentExam.date, saved: savedExam.date },
        cfu: { current: currentExam.cfu, saved: savedExam.cfu },
        level: { current: currentExam.level, saved: savedExam.level },
        difficulty: { current: currentExam.difficulty, saved: savedExam.difficulty },
        category: { current: currentExam.category || "mixed", saved: savedExam.category || "mixed" },
        topics: { current: currentTopics, saved: savedTopics, changed: !topicsEqual(currentTopics, savedTopics) }
      });
    }
    
    return modified;
  });
  
  const hasChanges = profileChanged || examsAdded || examsRemoved || examsModified;
  
  if (!hasChanges) {
    console.log("[hasPlanChanges] Nessuna modifica rilevata");
  }
  
  return hasChanges;
}

/**
 * Salva uno snapshot del profilo e degli esami nel piano per future comparazioni.
 */
function addSnapshotToPlan(plan, profile, exams) {
  // Normalizza i valori del profilo per il confronto
  plan.profileSnapshot = {
    goalMode: profile.goalMode || null,
    weeklyHours: normalizeValue(profile.weeklyHours),
    taskMinutes: normalizeValue(profile.taskMinutes),
    currentHours: normalizeValue(profile.currentHours),
    targetHours: normalizeValue(profile.targetHours),
    dayMinutes: profile.dayMinutes ? { ...profile.dayMinutes } : null,
  };
  
  // Normalizza i valori degli esami per il confronto
  plan.examsSnapshot = exams.map(e => {
    // Normalizza topics: assicura che sia sempre un array o null
    let normalizedTopics = null;
    if (e.topics) {
      if (Array.isArray(e.topics)) {
        normalizedTopics = [...e.topics].sort(); // Ordina per confronto consistente
      } else if (typeof e.topics === "string" && e.topics.trim()) {
        // Se è una stringa, prova a parsare come JSON o split
        try {
          const parsed = JSON.parse(e.topics);
          normalizedTopics = Array.isArray(parsed) ? parsed.sort() : null;
        } catch {
          normalizedTopics = e.topics.split(/[,\n]/).map(t => t.trim()).filter(t => t).sort();
        }
      }
    }
    
    return {
      id: e.id || null,
      name: e.name || "",
      date: e.date || "",
      cfu: normalizeValue(e.cfu),
      level: normalizeValue(e.level),
      difficulty: normalizeValue(e.difficulty),
      category: e.category || "mixed", // Default a "mixed" se non specificato
      topics: normalizedTopics, // Aggiungi topics allo snapshot
    };
  });
  
  console.log("[addSnapshotToPlan] Snapshot salvato:", {
    profile: plan.profileSnapshot,
    examsCount: plan.examsSnapshot.length
  });
  
  return plan;
}

// ----------------- Stime prodotto -----------------
function estimateRequiredMinutes(exam, profile) {
  const cfu = clamp(Number(exam.cfu || 6), 1, 30);
  const diff = clamp(Number(exam.difficulty || 2), 1, 3);
  const level = clamp(Number(exam.level || 0), 0, 5);

  const mode = profile.goalMode || "good";
  const modeFactor = mode === "top" ? 1.15 : mode === "pass" ? 0.85 : 1.0;
  const diffFactor = 0.9 + 0.15 * (diff - 1);

  const baseHours = cfu * 7.0 * diffFactor * modeFactor;
  const remainingFrac = clamp(1.0 - (level / 5) * 0.85, 0.15, 1.0);

  return Math.round(baseHours * remainingFrac * 60);
}

function estimateCapacityUntilExamMinutes(exam, profile) {
  const daysLeft = Math.max(0, daysTo(exam.date));
  const weeklyHours = clamp(Number(profile.weeklyHours || 10), 1, 80);
  const dailyAvgMin = (weeklyHours * 60) / 7;
  const realism = 0.85;
  return Math.round(daysLeft * dailyAvgMin * realism);
}

/**
 * Ottiene il numero di task completate e i minuti totali per un esame
 * @param {object} exam - Oggetto esame con id, name, appelli
 * @returns {object} {completedTasks: number, totalMinutes: number}
 */
function getCompletedTasksForExam(exam) {
  let completedTasks = 0;
  let totalMinutes = 0;
  
  if (!exam || !exam.id) {
    return { completedTasks: 0, totalMinutes: 0 };
  }
  
  const examId = exam.id;
  const examName = exam.name;
  
  // Trova gli ID da controllare (può essere l'ID originale o un ID virtuale con appello)
  const examIdsToCheck = [examId];
  if (exam.appelli && Array.isArray(exam.appelli) && exam.appelli.length > 0) {
    const selectedAppelli = exam.appelli.filter(a => a.selected !== false);
    for (const appello of selectedAppelli) {
      examIdsToCheck.push(`${examId}_${appello.date}`);
    }
  }
  
  try {
    // Scansiona localStorage per task completate
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sp_task_done_") && localStorage.getItem(key) === "1") {
        try {
          const taskId = key.replace("sp_task_done_", "");
          // Prova a recuperare il payload della task
          const payloadKey = `sp_task_${taskId}`;
          const payloadStr = localStorage.getItem(payloadKey) || sessionStorage.getItem(payloadKey);
          if (payloadStr) {
            const payload = JSON.parse(payloadStr);
            const task = payload?.task;
            if (task && (examIdsToCheck.includes(task.examId) || task.examName === examName)) {
              completedTasks++;
              totalMinutes += Number(task.minutes || 0);
            }
          }
        } catch (e) {
          // Ignora errori di parsing
        }
      }
    }
  } catch (e) {
    console.error("Errore scansionando localStorage:", e);
  }
  
  return { completedTasks, totalMinutes };
}

/**
 * Stima la percentuale di preparazione per un esame
 * Considera: livello attuale, task completate, difficoltà, tempo rimanente, capacità disponibile
 * @param {object} exam - Oggetto esame con id, name, level, difficulty, date, cfu
 * @param {object} profile - Profilo utente con weeklyHours, goalMode
 * @param {number} allocatedThisWeekMin - Minuti allocati questa settimana
 * @returns {number} Percentuale di preparazione (0-100)
 */
function estimateReadinessPercent(exam, profile, allocatedThisWeekMin) {
  const level = clamp(Number(exam.level || 0), 0, 5);
  const difficulty = clamp(Number(exam.difficulty || 2), 1, 3);
  const cfu = clamp(Number(exam.cfu || 6), 1, 30);
  
  // Ottieni task completate
  const { completedTasks, totalMinutes } = getCompletedTasksForExam(exam);
  
  // 1. BASE: Livello attuale dell'esame (0-5) -> 0-40% della preparazione
  // Se level è 0, la preparazione base è molto bassa (max 10%)
  // Se level è 5, la preparazione base è alta (40%)
  const levelBase = level === 0 ? 0.10 : (level / 5) * 0.4;
  
  // 2. TASK COMPLETATE: Bonus basato su task completate (più importante!)
  // Ogni 3 task = +4% (max +30%) - più veloce e più peso
  // Ogni 200 minuti = +4% (max +25%) - più veloce e più peso
  const taskBonus = Math.min(completedTasks / 3 * 0.04, 0.30);
  const minutesBonus = Math.min(totalMinutes / 200 * 0.04, 0.25);
  const completedBonus = taskBonus + minutesBonus;
  
  // 3. DIFFICOLTÀ: Fattore moltiplicativo
  // Difficoltà alta (3) richiede più preparazione, quindi riduce la % percepita
  // Difficoltà bassa (1) è più facile, quindi aumenta la % percepita
  const difficultyFactor = 1.0 - (difficulty - 1) * 0.1; // 1.0 per diff=1, 0.9 per diff=2, 0.8 per diff=3
  
  // 4. CAPACITÀ FUTURA: Considera se c'è tempo sufficiente per prepararsi
  const required = estimateRequiredMinutes(exam, profile);
  const capacity = estimateCapacityUntilExamMinutes(exam, profile);
  const daysLeft = Math.max(0, daysTo(exam.date));
  
  // Se non c'è tempo sufficiente, riduci la preparazione
  // Se c'è molto tempo, aumenta leggermente la preparazione (perché c'è tempo per migliorare)
  let capacityFactor = 1.0;
  if (daysLeft > 0) {
    const capacityRatio = capacity / Math.max(1, required);
    // Se la capacità è molto maggiore della richiesta, bonus del 10%
    // Se la capacità è molto minore della richiesta, penalità del 20%
    if (capacityRatio > 1.5) {
      capacityFactor = 1.1;
    } else if (capacityRatio < 0.7) {
      capacityFactor = 0.8;
    }
  } else {
    // Esame già passato o oggi, usa solo la preparazione attuale
    capacityFactor = 1.0;
  }
  
  // 5. PIANO SETTIMANALE: Bonus se c'è un piano attivo
  const planBonus = allocatedThisWeekMin > 0 ? Math.min(allocatedThisWeekMin / Math.max(1, required * 0.35) * 0.1, 0.1) : 0;
  
  // Calcola la preparazione totale
  // Formula: (base + bonus completate) * fattore difficoltà * fattore capacità + bonus piano
  // Le task completate hanno più peso perché rappresentano lavoro reale fatto
  let readiness = (levelBase + completedBonus) * difficultyFactor * capacityFactor + planBonus;
  
  // Se il livello è 0 e non ci sono task completate, la preparazione non può superare il 20%
  // Questo evita stime irrealistiche quando non si sa nulla dell'esame
  if (level === 0 && completedTasks === 0 && totalMinutes === 0) {
    readiness = Math.min(readiness, 0.20);
  }
  
  // Se ci sono molte task completate, la preparazione può essere alta anche con livello basso
  // Questo riflette il lavoro reale fatto, non solo il livello iniziale
  if (completedTasks >= 10 || totalMinutes >= 1000) {
    // Con molte task completate, la preparazione può essere significativa
    readiness = Math.max(readiness, 0.30); // Minimo 30% se hai fatto molto lavoro
  }
  
  // Se il livello è molto basso (0-1) e ci sono pochi giorni, la preparazione è limitata
  // Ma solo se non ci sono molte task completate
  if (level <= 1 && daysLeft < 7 && completedTasks < 5 && totalMinutes < 500) {
    readiness = Math.min(readiness, 0.40);
  }
  
  return clamp(Math.round(readiness * 100), 0, 100);
}

function readinessBadge(pct) {
  if (pct >= 85) return { cls: "good", text: "on track" };
  if (pct >= 60) return { cls: "warn", text: "borderline" };
  return { cls: "bad", text: "rischio" };
}

// ----------------- Task routing helpers -----------------
function makeTaskId({ weekStartISO, dateISO, t, index }) {
  const raw = [
    weekStartISO || "",
    dateISO || "",
    t?.examId || t?.examName || "exam",
    t?.type || "type",
    t?.label || "label",
    String(t?.minutes || 0),
    String(index || 0),
  ].join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "t_" + (h >>> 0).toString(16);
}

/**
 * Genera una chiave stabile per un task (senza index e weekStartISO)
 * Usata per preservare lo stato di completamento durante la rigenerazione del piano
 */
function makeStableTaskKey({ dateISO, t }) {
  const raw = [
    dateISO || "",
    t?.examId || t?.examName || "exam",
    t?.type || "type",
    t?.label || "label",
    String(t?.minutes || 0),
  ].join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "stable_" + (h >>> 0).toString(16);
}

function openTaskPage(payload) {
  const tid = payload?.taskId;
  if (!tid) {
    console.warn("openTaskPage: missing taskId", payload);
    return;
  }

  const k = `sp_task_${tid}`;
  const raw = JSON.stringify(payload);

  try {
    sessionStorage.setItem(k, raw);
  } catch {}
  try {
    localStorage.setItem(k, raw);
  } catch {}

  try {
    localStorage.setItem("sp_last_tid", tid);
  } catch {}

  const url = new URL("task.html", location.href);
  url.searchParams.set("tid", tid);
  window.location.assign(url.toString());
}

function getStoredTaskPayload(tid) {
  const k = `sp_task_${tid}`;
  try {
    const s = sessionStorage.getItem(k);
    if (s) return JSON.parse(s);
  } catch {}
  try {
    const s = localStorage.getItem(k);
    if (s) return JSON.parse(s);
  } catch {}
  return null;
}

async function reconstructTaskPayloadFromFirestore(user, tid) {
  const weekStart = startOfWeekISO(new Date());
  const weekStartISO = `${weekStart.getFullYear()}-${z2(weekStart.getMonth() + 1)}-${z2(
    weekStart.getDate()
  )}`;

  const plan = await loadWeeklyPlan(user.uid, weekStartISO);
  if (!plan?.days) return null;

  for (const day of plan.days) {
    const tasks = day?.tasks || [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const taskId = makeTaskId({
        weekStartISO: plan.weekStart,
        dateISO: day.dateISO,
        t,
        index: i,
      });
      if (taskId === tid) {
        return { taskId, dateISO: day.dateISO, weekStartISO: plan.weekStart, task: t };
      }
    }
  }
  return null;
}

// ----------------- Redirect logic -----------------
async function routeAfterLogin(user) {
  // Cattura il referral code dall'URL se presente (utile quando l'utente arriva dal link di verifica email)
  const urlParams = new URLSearchParams(window.location.search);
  const referralCodeFromUrl = urlParams.get('ref');
  if (referralCodeFromUrl) {
    const normalizedCode = referralCodeFromUrl.toUpperCase().trim();
    localStorage.setItem('pendingReferralCode', normalizedCode);
    console.log("[Referral] ✅ Codice referral catturato dall'URL dopo verifica email:", normalizedCode);
  }
  
  await ensureUserDoc(user);
  let profile = await getProfile(user.uid);
  
  // Processa referral se presente (solo per nuovi utenti)
  const pendingReferralCode = localStorage.getItem('pendingReferralCode');
  if (pendingReferralCode && processReferral && !profile?.referralProcessed) {
    console.log("[Referral] ⚠️ Processamento referral dopo login...");
    try {
      const result = await processReferral({ referralCode: pendingReferralCode });
      console.log("[Referral] ✅ SUCCESSO - Referral processato dopo login:", result);
      showToast("🎉 Referral attivato! Hai ricevuto 7 giorni di Premium.");
      localStorage.removeItem('pendingReferralCode');
      // Ricarica il profilo per avere i dati aggiornati
      profile = await getProfile(user.uid);
    } catch (err) {
      console.error("[Referral] ❌ ERRORE durante processamento dopo login:", err);
      // Non bloccare il login, ma mostra un messaggio
      if (err.code !== 'already-exists') {
        showToast("Errore nell'attivazione del referral. Riprova più tardi.", 5000);
      }
      localStorage.removeItem('pendingReferralCode');
    }
  }
  
  // Controlla se mancano informazioni personali di base
  const needsPersonalInfo = !profile?.name || !profile?.faculty || !profile?.age;
  
  if (needsPersonalInfo) {
    // Mostra popup per informazioni personali
    showPersonalInfoModal(user, async () => {
      // Dopo aver salvato le info personali, vai a settings
      window.location.assign("./settings.html");
    });
    return;
  }
  
  // Se ha le info personali ma manca il profilo completo, vai a settings
  const needsOnboarding = !profile?.goalMode || !profile?.dayMinutes;
  window.location.assign(needsOnboarding ? "./settings.html" : "./app.html");
}

// ----------------- Personal Info Modal -----------------
function showPersonalInfoModal(user, onComplete) {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("personal-info-modal")) return;

  // Overlay oscurante
  const overlay = document.createElement("div");
  overlay.id = "personal-info-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.75)",
    zIndex: "10000",
    padding: "20px",
  });

  // Contenitore principale con stile card
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "520px";
  card.style.width = "90%";
  card.style.padding = "28px";
  card.style.maxHeight = "90vh";
  card.style.overflowY = "auto";

  // Titolo modale
  const title = document.createElement("h2");
  title.textContent = "Benvenuto in Study Planner!";
  title.style.marginBottom = "8px";
  title.style.fontSize = "24px";
  title.style.fontWeight = "950";
  card.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.textContent = "Aiutaci a conoscerti meglio per personalizzare la tua esperienza";
  subtitle.style.marginBottom = "24px";
  subtitle.style.color = "rgba(255,255,255,.72)";
  subtitle.style.fontSize = "14px";
  card.appendChild(subtitle);

  // Contenitore form
  const form = document.createElement("div");
  form.className = "form";
  form.style.gap = "16px";

  // Campo nome
  const nameLabel = document.createElement("label");
  nameLabel.innerHTML = '<span>Nome</span>';
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "pi-name";
  nameInput.placeholder = "Il tuo nome";
  nameInput.required = true;
  nameInput.autocomplete = "name";
  nameLabel.appendChild(nameInput);

  // Campo facoltà
  const facultyLabel = document.createElement("label");
  facultyLabel.innerHTML = '<span>Facoltà / Corso di studi</span>';
  const facultyInput = document.createElement("input");
  facultyInput.type = "text";
  facultyInput.id = "pi-faculty";
  facultyInput.placeholder = "Es: Ingegneria, Medicina, Economia...";
  facultyInput.required = true;
  facultyInput.autocomplete = "organization";
  facultyLabel.appendChild(facultyInput);

  // Campo età
  const ageLabel = document.createElement("label");
  ageLabel.innerHTML = '<span>Età</span>';
  const ageInput = document.createElement("input");
  ageInput.type = "number";
  ageInput.id = "pi-age";
  ageInput.min = "16";
  ageInput.max = "100";
  ageInput.placeholder = "";
  ageInput.required = true;
  ageLabel.appendChild(ageInput);

  // Campo tipo sessione
  const sessionLabel = document.createElement("label");
  sessionLabel.innerHTML = '<span>Stai preparando</span>';
  const sessionSelect = document.createElement("select");
  sessionSelect.id = "pi-session-type";
  sessionSelect.required = true;
  const sessionOptions = [
    { value: "exams", text: "Esami della sessione" },
    { value: "exemptions", text: "Esoneri" },
    { value: "both", text: "Entrambi" },
  ];
  sessionOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.text;
    sessionSelect.appendChild(option);
  });
  sessionLabel.appendChild(sessionSelect);

  // Aggiungi tutti i campi al form
  form.appendChild(nameLabel);
  form.appendChild(facultyLabel);
  form.appendChild(ageLabel);
  form.appendChild(sessionLabel);
  card.appendChild(form);

  // Messaggio di errore
  const errorMsg = document.createElement("p");
  errorMsg.id = "pi-error";
  errorMsg.className = "error";
  errorMsg.style.marginTop = "8px";
  card.appendChild(errorMsg);

  // Azioni (bottoni)
  const btnRow = document.createElement("div");
  btnRow.className = "btnRow";
  btnRow.style.marginTop = "20px";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.type = "button";
  saveBtn.textContent = "Continua";
  saveBtn.style.width = "100%";

  btnRow.appendChild(saveBtn);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Focus sul primo campo
  setTimeout(() => nameInput.focus(), 100);

  // Funzione per chiudere la modale
  function closeModal() {
    try {
      if (overlay.parentNode) {
        document.body.removeChild(overlay);
      }
    } catch {}
  }

  // Gestore Salva
  saveBtn.addEventListener("click", async () => {
    try {
      const name = nameInput.value.trim();
      const faculty = facultyInput.value.trim();
      const age = Number(ageInput.value || 0);
      const sessionType = sessionSelect.value;

      if (!name) throw new Error("Nome mancante.");
      if (!faculty) throw new Error("Facoltà mancante.");
      if (!age || age < 16 || age > 100) throw new Error("Età non valida (16-100).");

      // Salva le informazioni personali nel profilo
      await setProfile(user.uid, {
        name,
        faculty,
        age,
        sessionType,
      });

      closeModal();
      if (onComplete) {
        await onComplete();
      } else {
        // Se non c'è callback, ricarica la pagina
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
      errorMsg.textContent = err?.message ?? "Errore salvataggio informazioni";
    }
  });

  // Chiudi con ESC
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape" && document.getElementById("personal-info-modal")) {
      // Non permettere di chiudere senza completare
      e.preventDefault();
    }
  });

  // Enter per salvare
  [nameInput, facultyInput, ageInput, sessionSelect].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveBtn.click();
      }
    });
  });
}

// ----------------- INDEX (AUTH) -----------------
function mountIndex() {
  const tabLogin = qs("tab-login");
  const tabSignup = qs("tab-signup");
  const loginForm = qs("login-form");
  const signupForm = qs("signup-form");

  const loginEmail = qs("login-email");
  const loginPass = qs("login-pass");
  const signupEmail = qs("signup-email");
  const signupPass = qs("signup-pass");

  const loginErr = qs("login-error");
  const signupErr = qs("signup-error");

  const loginBtn = qs("login-submit");
  const signupBtn = qs("signup-submit"); // potrebbe non esserci, ok

  const clearErrors = () => {
    setText(loginErr, "");
    setText(signupErr, "");
  };

  const activateTab = (which) => {
    clearErrors();
    if (which === "login") {
      tabLogin?.classList.add("active");
      tabSignup?.classList.remove("active");
      show(loginForm, true);
      show(signupForm, false);
    } else {
      tabSignup?.classList.add("active");
      tabLogin?.classList.remove("active");
      show(signupForm, true);
      show(loginForm, false);
    }
  };

  tabLogin?.addEventListener("click", () => activateTab("login"));
  tabSignup?.addEventListener("click", () => activateTab("signup"));
  activateTab("login");

  async function doLogin() {
    clearErrors();

    const email = (loginEmail?.value || "").trim();
    const pass = loginPass?.value || "";
    if (!email || !pass) {
      setText(loginErr, "Inserisci email e password.");
      return;
    }

    try {
      const cred = await loginWithEmail(email, pass);
      const ok = await ensureVerifiedOrBlock(cred.user, (msg) => setText(loginErr, msg));
      if (!ok) return;
      await routeAfterLogin(cred.user);
    } catch (err) {
      console.error(err);
      
      // Gestione specifica per errore "too-many-requests"
      if (err?.code === "auth/too-many-requests" || err?.message?.includes("too-many-requests")) {
        if (loginErr) {
          loginErr.innerHTML = `
            <div style="line-height:1.6;">
              <strong style="color:rgba(245,158,11,1);">⚠️ Troppi tentativi di accesso</strong>
              <br><br>
              Firebase ha temporaneamente bloccato l'accesso per sicurezza dopo troppi tentativi falliti.
              <br><br>
              <strong>Cosa puoi fare:</strong>
              <br>• Aspetta qualche minuto e riprova
              <br>• Usa <a href="#" id="forgot-password-from-error" style="color:rgba(99,102,241,1); text-decoration:underline;">"Password dimenticata?"</a> per reimpostare la password
              <br>• Se il problema persiste, contattaci
            </div>
          `;
          
          // Aggiungi handler per il link password dimenticata
          const forgotLink = loginErr.querySelector("#forgot-password-from-error");
          if (forgotLink) {
            forgotLink.addEventListener("click", (e) => {
              e.preventDefault();
              // Chiudi modale login e apri reset password
              const loginModal = document.getElementById("login-modal");
              if (loginModal) {
                loginModal.classList.remove("active");
              }
              setTimeout(() => {
                const resetModal = document.getElementById("reset-password-modal");
                if (resetModal) {
                  resetModal.classList.add("active");
                  const resetEmail = document.getElementById("reset-email");
                  if (resetEmail && loginEmail?.value) {
                    resetEmail.value = loginEmail.value;
                  }
                }
              }, 200);
            });
          }
        }
        
        // Disabilita temporaneamente il form per 30 secondi
        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.style.opacity = "0.5";
          loginBtn.style.cursor = "not-allowed";
          
          // Disabilita anche i campi input
          if (loginEmail) {
            loginEmail.disabled = true;
            loginEmail.style.opacity = "0.5";
          }
          if (loginPass) {
            loginPass.disabled = true;
            loginPass.style.opacity = "0.5";
          }
          
          let countdown = 30;
          const originalText = loginBtn.textContent;
          loginBtn.textContent = `Attendi ${countdown}s`;
          
          const interval = setInterval(() => {
            countdown--;
            if (countdown > 0) {
              loginBtn.textContent = `Attendi ${countdown}s`;
            } else {
              clearInterval(interval);
              loginBtn.disabled = false;
              loginBtn.style.opacity = "1";
              loginBtn.style.cursor = "pointer";
              loginBtn.textContent = originalText;
              
              // Riabilita i campi input
              if (loginEmail) {
                loginEmail.disabled = false;
                loginEmail.style.opacity = "1";
              }
              if (loginPass) {
                loginPass.disabled = false;
                loginPass.style.opacity = "1";
              }
            }
          }, 1000);
        }
      } else {
        // Altri errori
        let errorMessage = err?.message ?? "Errore login";
        let useHtml = false;
        
        // Traduci errori comuni in italiano
        if (err?.code === "auth/invalid-credential" || errorMessage.includes("invalid-credential")) {
          // Firebase usa invalid-credential per email o password sbagliata
          if (loginErr) {
            loginErr.innerHTML = `
              Email o password non corretti. 
              <a href="#" id="forgot-password-from-error-2" style="color:rgba(99,102,241,1); text-decoration:underline; margin-left:4px;">Password dimenticata?</a>
            `;
            useHtml = true;
            
            // Aggiungi handler per il link
            const forgotLink = loginErr.querySelector("#forgot-password-from-error-2");
            if (forgotLink) {
              forgotLink.addEventListener("click", (e) => {
                e.preventDefault();
                const loginModal = document.getElementById("login-modal");
                if (loginModal) {
                  loginModal.classList.remove("active");
                }
                setTimeout(() => {
                  const resetModal = document.getElementById("reset-password-modal");
                  if (resetModal) {
                    resetModal.classList.add("active");
                    document.body.style.overflow = "hidden";
                    const resetEmail = document.getElementById("reset-email");
                    if (resetEmail && loginEmail?.value) {
                      resetEmail.value = loginEmail.value;
                    }
                  }
                }, 200);
              });
            }
          } else {
            errorMessage = "Email o password non corretti. Verifica le credenziali o usa 'Password dimenticata?' se non ricordi la password.";
          }
        } else if (err?.code === "auth/user-not-found" || errorMessage.includes("user-not-found")) {
          errorMessage = "Email non trovata. Verifica l'indirizzo o crea un account.";
        } else if (err?.code === "auth/wrong-password" || errorMessage.includes("wrong-password")) {
          if (loginErr) {
            loginErr.innerHTML = `
              Password errata. 
              <a href="#" id="forgot-password-from-error-3" style="color:rgba(99,102,241,1); text-decoration:underline; margin-left:4px;">Password dimenticata?</a>
            `;
            useHtml = true;
            
            // Aggiungi handler per il link
            const forgotLink = loginErr.querySelector("#forgot-password-from-error-3");
            if (forgotLink) {
              forgotLink.addEventListener("click", (e) => {
                e.preventDefault();
                const loginModal = document.getElementById("login-modal");
                if (loginModal) {
                  loginModal.classList.remove("active");
                }
                setTimeout(() => {
                  const resetModal = document.getElementById("reset-password-modal");
                  if (resetModal) {
                    resetModal.classList.add("active");
                    document.body.style.overflow = "hidden";
                    const resetEmail = document.getElementById("reset-email");
                    if (resetEmail && loginEmail?.value) {
                      resetEmail.value = loginEmail.value;
                    }
                  }
                }, 200);
              });
            }
          } else {
            errorMessage = "Password errata. Usa 'Password dimenticata?' se non la ricordi.";
          }
        } else if (err?.code === "auth/invalid-email" || errorMessage.includes("invalid-email")) {
          errorMessage = "Email non valida. Inserisci un indirizzo email corretto.";
        } else if (err?.code === "auth/user-disabled" || errorMessage.includes("user-disabled")) {
          errorMessage = "Account disabilitato. Contatta il supporto.";
        } else if (err?.code === "auth/network-request-failed" || errorMessage.includes("network")) {
          errorMessage = "Errore di connessione. Verifica la tua connessione internet e riprova.";
        } else if (err?.code === "auth/operation-not-allowed" || errorMessage.includes("operation-not-allowed")) {
          errorMessage = "Operazione non consentita. Contatta il supporto.";
        }
        
        if (!useHtml) {
          setText(loginErr, errorMessage);
        }
      }
    }
  }

  async function doSignup() {
    clearErrors();

    const email = (signupEmail?.value || "").trim();
    const pass = signupPass?.value || "";
    if (!email || !pass) {
      setText(signupErr, "Inserisci email e password.");
      return;
    }
    if (pass.length < 6) {
      setText(signupErr, "Password troppo corta (min 6 caratteri).");
      return;
    }

    // Cattura il codice referral dall'URL se presente
    const urlParams = new URLSearchParams(window.location.search);
    const referralCode = urlParams.get('ref');
    if (referralCode) {
      // Salva il codice referral in localStorage per processarlo dopo la verifica email
      const normalizedCode = referralCode.toUpperCase().trim();
      localStorage.setItem('pendingReferralCode', normalizedCode);
      console.log("[Referral] ✅ Codice referral catturato e salvato:", normalizedCode);
    } else {
      console.log("[Referral] ⚠️ Nessun codice referral nell'URL");
    }

    try {
      const cred = await signupWithEmail(email, pass);

      // Invia email di verifica (include il referral code se presente)
      const pendingReferralCode = localStorage.getItem('pendingReferralCode');
      await sendVerificationOrThrow(cred.user, pendingReferralCode || referralCode);

      // logout: niente accesso finché non verifica
      await logout();

      // Mostra modal informativo che l'email è stata inviata
      showVerificationEmailModal();

      // fallback messaggio inline
      setText(signupErr, "Email inviata. Verifica e poi fai login.");

      activateTab("login");
    } catch (err) {
      console.error(err);
      
      // Rimuovi il referral code se la registrazione fallisce
      if (referralCode) {
        localStorage.removeItem('pendingReferralCode');
      }
      
      // Traduci errori comuni in italiano
      let errorMessage = err?.message ?? "Errore creazione account";
      
      if (err?.code === "auth/email-already-in-use" || errorMessage.includes("email-already-in-use")) {
        errorMessage = "Questa email è già registrata. Usa 'Login' per accedere o 'Password dimenticata?' se non ricordi la password.";
      } else if (err?.code === "auth/invalid-email" || errorMessage.includes("invalid-email")) {
        errorMessage = "Email non valida. Inserisci un indirizzo email corretto.";
      } else if (err?.code === "auth/weak-password" || errorMessage.includes("weak-password")) {
        errorMessage = "Password troppo debole. Usa almeno 6 caratteri.";
      } else if (err?.code === "auth/operation-not-allowed" || errorMessage.includes("operation-not-allowed")) {
        errorMessage = "Operazione non consentita. Contatta il supporto.";
      } else if (err?.code === "auth/network-request-failed" || errorMessage.includes("network")) {
        errorMessage = "Errore di connessione. Verifica la tua connessione internet e riprova.";
      }
      
      setText(signupErr, errorMessage);
    }
  }

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await doLogin();
  });
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await doSignup();
  });

  loginBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await doLogin();
  });

  // Se esiste un bottone signup con id, ok; altrimenti il submit già copre
  signupBtn?.addEventListener?.("click", async (e) => {
    e.preventDefault();
    await doSignup();
  });

  // Gestione reset password (per form nel main nascosto)
  const forgotPasswordLink = qs("forgot-password-link-2");
  if (forgotPasswordLink && !forgotPasswordLink.dataset.bound) {
    forgotPasswordLink.dataset.bound = "1";
    forgotPasswordLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = (loginEmail?.value || "").trim();
      
      if (!email) {
        setText(loginErr, "Inserisci prima la tua email nel campo sopra.");
        return;
      }

      try {
        await resetPassword(email);
        setText(loginErr, "");
        if (typeof showToast === "function") {
          showToast("Email di reset inviata! Controlla la tua casella (anche spam).", 5000);
        } else {
          setText(loginErr, "✓ Email di reset inviata! Controlla la tua casella (anche spam).");
        }
      } catch (err) {
        console.error("Errore reset password:", err);
        let errorMsg = "Errore nell'invio dell'email di reset.";
        if (err?.code === "auth/user-not-found") {
          errorMsg = "Email non trovata. Verifica l'indirizzo.";
        } else if (err?.code === "auth/invalid-email") {
          errorMsg = "Email non valida.";
        } else if (err?.message) {
          errorMsg = err.message;
        }
        setText(loginErr, errorMsg);
      }
    });
  }

  // auto-route se già loggato
  watchAuth(async (user) => {
    if (!user) return;
    const ok = await ensureVerifiedOrBlock(user, (msg) => setText(loginErr, msg));
    if (!ok) return;
    await routeAfterLogin(user);
  });
}

// ----------------- TOPICS MANAGEMENT -----------------
/**
 * Gestisce l'interfaccia strutturata per gli argomenti principali degli esami.
 * Permette di aggiungere e rimuovere argomenti uno per uno.
 */

// Stato globale per gli argomenti (per il form principale)
let examTopicsList = [];

// Stato per la modale di modifica (separato)
let editExamTopicsList = [];

// ----------------- APPELLI MANAGEMENT -----------------
/**
 * Gestisce l'interfaccia per gli appelli/esoneri multipli di un esame.
 */

// Inizializza l'interfaccia degli appelli
function initAppelliInterface() {
  const container = qs("appelli-container");
  const addBtn = qs("add-appello-btn");
  
  if (!container || !addBtn) return;
  
  // Non aggiungere automaticamente un appello - l'utente deve cliccare "Aggiungi appello"
  // Rimuovi eventuali appelli iniziali presenti nell'HTML
  container.innerHTML = "";
  
  // Handler per aggiungere appello
  addBtn.addEventListener("click", () => {
    addAppelloItem(container);
  });
  
  // Gestisci rimozione appelli esistenti
  container.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-appello")) {
      const item = e.target.closest(".appelloItem");
      if (item) {
        const removedRadio = item.querySelector('input[name="primary-appello"]');
        const wasPrimary = removedRadio && removedRadio.checked;
        
        item.remove();
        updateRemoveButtons(container);
        
        // Se è stato rimosso l'appello primario e ci sono altri appelli, seleziona il primo rimanente
        if (wasPrimary && container.children.length > 0) {
          const firstRemainingRadio = container.querySelector('input[name="primary-appello"]');
          if (firstRemainingRadio) {
            firstRemainingRadio.checked = true;
          }
        }
      }
    }
  });
}

// Aggiunge un nuovo item appello
function addAppelloItem(container) {
  const index = container.children.length;
  const item = document.createElement("div");
  item.className = "appelloItem";
  
  // Controlla se è il primo appello (sarà primario di default)
  const isFirst = index === 0;
  
  item.innerHTML = `
    <div class="appelloInputRow">
      <div class="appelloDateWrapper">
        <label class="appelloDateLabel" for="appello-date-${index}">Data</label>
        <input type="date" id="appello-date-${index}" class="appelloDate" />
      </div>
      <div class="appelloPrimaryContainer">
        <label class="appelloPrimaryLabel" for="appello-primary-${index}">Appello principale</label>
        <input type="radio" name="primary-appello" value="${index}" id="appello-primary-${index}" class="primary-appello-radio" ${isFirst ? 'checked' : ''} style="cursor: pointer;" />
      </div>
      <button type="button" class="btn tiny remove-appello" style="align-self:flex-end; margin-bottom:24px;">Rimuovi</button>
    </div>
  `;
  container.appendChild(item);
  updateRemoveButtons(container);
}

// Aggiorna la visibilità dei bottoni rimuovi
function updateRemoveButtons(container) {
  const items = container.querySelectorAll(".appelloItem");
  items.forEach((item, index) => {
    const removeBtn = item.querySelector(".remove-appello");
    if (removeBtn) {
      // Mostra sempre il bottone rimuovi (permette di rimuovere anche l'ultimo appello)
      removeBtn.style.display = "block";
    }
  });
}

// Legge gli appelli dal form
function getAppelliFromForm() {
  const container = qs("appelli-container");
  if (!container) return [];
  
  const appelli = [];
  const primaryRadio = container.querySelector('input[name="primary-appello"]:checked');
  const primaryIndex = primaryRadio ? parseInt(primaryRadio.value) : 0;
  
  container.querySelectorAll(".appelloItem").forEach((item, idx) => {
    const dateInput = item.querySelector(".appelloDate");
    if (dateInput && dateInput.value) {
      appelli.push({
        date: dateInput.value,
        type: "esame", // Sempre esame
        selected: true, // Di default tutti selezionati
        primary: idx === primaryIndex // Marca come primario se è quello selezionato
      });
    }
  });
  
  return appelli;
}

// Verifica se una data è quella odierna (confronta solo giorno/mese/anno)
function isToday(dateString) {
  if (!dateString) return false;
  const today = getCurrentDate();
  const date = new Date(dateString);
  
  return date.getFullYear() === today.getFullYear() &&
         date.getMonth() === today.getMonth() &&
         date.getDate() === today.getDate();
}

// Verifica se una data è passata (prima di oggi)
function isPastDate(dateString) {
  if (!dateString) return false;
  const today = getCurrentDate();
  today.setHours(0, 0, 0, 0); // Imposta a mezzanotte per confronto corretto
  
  const date = new Date(dateString);
  date.setHours(0, 0, 0, 0);
  
  return date < today;
}

// Popola il form con gli appelli esistenti
function populateAppelliForm(appelli) {
  const container = qs("appelli-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  if (appelli && appelli.length > 0) {
    // Determina quale appello è primario (se nessuno è marcato, usa il primo)
    let hasPrimary = appelli.some(a => a.primary === true);
    if (!hasPrimary && appelli.length > 0) {
      appelli[0].primary = true;
    }
    
    appelli.forEach((appello, idx) => {
      const item = document.createElement("div");
      item.className = "appelloItem";
      item.innerHTML = `
        <div class="appelloInputRow">
          <div class="appelloDateWrapper">
            <label class="appelloDateLabel" for="appello-date-${idx}">Data</label>
            <input type="date" id="appello-date-${idx}" class="appelloDate" value="${appello.date || ""}" />
          </div>
          <div class="appelloPrimaryContainer">
            <label class="appelloPrimaryLabel" for="appello-primary-${idx}">Appello principale</label>
            <input type="radio" name="primary-appello" value="${idx}" id="appello-primary-${idx}" class="primary-appello-radio" ${appello.primary === true ? 'checked' : ''} style="cursor: pointer;" />
          </div>
          <button type="button" class="btn tiny remove-appello" style="align-self:flex-end; margin-bottom:24px;">Rimuovi</button>
        </div>
      `;
      container.appendChild(item);
    });
  } else {
    // Se non ci sono appelli, aggiungi uno vuoto
    addAppelloItem(container);
  }
  
  updateRemoveButtons(container);
}

/**
 * Inizializza l'interfaccia degli argomenti nel form principale
 */
function initTopicsInterface() {
  const input = qs("exam-topics-input");
  const addBtn = qs("add-topic-btn");
  const list = qs("topics-list");
  
  if (!input || !addBtn || !list) return;
  
  examTopicsList = [];
  renderTopicsList(list, examTopicsList, "exam");
  
  // Handler per aggiungere argomento
  const addTopic = () => {
    const value = input.value.trim();
    if (!value) return;
    
    // Evita duplicati
    if (examTopicsList.includes(value)) {
      input.value = "";
      return;
    }
    
    examTopicsList.push(value);
    input.value = "";
    renderTopicsList(list, examTopicsList, "exam");
  };
  
  addBtn.addEventListener("click", addTopic);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTopic();
    }
  });
}

/**
 * Inizializza l'interfaccia degli argomenti nella modale di modifica
 */
function initEditTopicsInterface(topics) {
  const input = qs("ee-topics-input");
  const addBtn = qs("ee-add-topic-btn");
  const list = qs("ee-topics-list");
  
  if (!input || !addBtn || !list) return;
  
  // Converti topics in array se è una stringa (compatibilità)
  if (typeof topics === "string" && topics.trim()) {
    // Prova a parsare come array JSON, altrimenti split per virgola/riga
    try {
      const parsed = JSON.parse(topics);
      editExamTopicsList = Array.isArray(parsed) ? parsed : topics.split(/[,\n]/).map(t => t.trim()).filter(t => t);
    } catch {
      editExamTopicsList = topics.split(/[,\n]/).map(t => t.trim()).filter(t => t);
    }
  } else if (Array.isArray(topics)) {
    editExamTopicsList = [...topics];
  } else {
    editExamTopicsList = [];
  }
  
  renderTopicsList(list, editExamTopicsList, "edit");
  
  // Handler per aggiungere argomento
  const addTopic = () => {
    const value = input.value.trim();
    if (!value) return;
    
    // Evita duplicati
    if (editExamTopicsList.includes(value)) {
      input.value = "";
      return;
    }
    
    editExamTopicsList.push(value);
    input.value = "";
    renderTopicsList(list, editExamTopicsList, "edit");
  };
  
  addBtn.addEventListener("click", addTopic);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTopic();
    }
  });
}

/**
 * Renderizza la lista degli argomenti
 */
function renderTopicsList(container, topics, prefix) {
  if (!container) return;
  
  container.innerHTML = "";
  
  topics.forEach((topic, index) => {
    const item = document.createElement("div");
    item.className = "topicItem";
    item.innerHTML = `
      <span class="topicItemText">${escapeHtml(topic)}</span>
      <button type="button" class="topicItemRemove" data-index="${index}">Rimuovi</button>
    `;
    
    const removeBtn = item.querySelector(".topicItemRemove");
    removeBtn.addEventListener("click", () => {
      if (prefix === "exam") {
        examTopicsList.splice(index, 1);
        renderTopicsList(container, examTopicsList, prefix);
      } else {
        editExamTopicsList.splice(index, 1);
        renderTopicsList(container, editExamTopicsList, prefix);
      }
    });
    
    container.appendChild(item);
  });
}

/**
 * Ottiene gli argomenti come array (per salvataggio)
 */
function getTopicsArray(prefix) {
  if (prefix === "exam") {
    return examTopicsList.length > 0 ? examTopicsList : null;
  } else {
    return editExamTopicsList.length > 0 ? editExamTopicsList : null;
  }
}

/**
 * Resetta la lista degli argomenti
 */
function resetTopicsList(prefix) {
  if (prefix === "exam") {
    examTopicsList = [];
    const list = qs("topics-list");
    if (list) list.innerHTML = "";
    const input = qs("exam-topics-input");
    if (input) input.value = "";
  } else {
    editExamTopicsList = [];
    const list = qs("ee-topics-list");
    if (list) list.innerHTML = "";
    const input = qs("ee-topics-input");
    if (input) input.value = "";
  }
}

// ----------------- ONBOARDING -----------------
function mountOnboarding() {
  qs("logout-btn")?.addEventListener("click", async () => {
    await logout();
    window.location.assign("./index.html");
  });

  const dayContainer = qs("day-minutes");
  const dayKeys = [
    ["mon", "Lun"],
    ["tue", "Mar"],
    ["wed", "Mer"],
    ["thu", "Gio"],
    ["fri", "Ven"],
    ["sat", "Sab"],
    ["sun", "Dom"],
  ];

  function renderDayInputs(dayMinutes) {
    dayContainer.innerHTML = "";
    for (const [k, label] of dayKeys) {
      const val = dayMinutes?.[k] ?? (k === "sun" ? 0 : 120);
      const row = document.createElement("div");
      row.className = "day-row";
      row.innerHTML = `
        <label class="day-label" for="day-${k}">${label}</label>
        <div class="day-input-wrap">
          <input class="day-input" id="day-${k}" data-day="${k}" type="number" min="0" max="600" step="5" value="${val}">
          <span class="day-suffix">min</span>
        </div>
      `;
      dayContainer.appendChild(row);
    }
  }

  function readDayInputs() {
    const out = {};
    const container = qs("day-minutes") || dayContainer;
    if (container) {
      container.querySelectorAll("input[data-day]").forEach((inp) => {
        out[inp.dataset.day] = Number(inp.value || 0);
      });
    }
    return out;
  }

  // ----------------- Task Distribution Management -----------------
  /**
   * Inizializza l'interfaccia per la distribuzione personalizzata dei task
   */
  function initTaskDistribution(isPremiumUser = true) {
    const container = qs("task-distribution-container");
    const toggleBtn = qs("toggle-task-distribution");
    const resetBtn = qs("reset-task-distribution");
    const taskDistSection = toggleBtn?.closest(".formSection");
    
    if (!container || !toggleBtn) return;
    
    if (isPremiumUser) {
      // Utente premium: abilita la sezione
      // Rimuovi overlay premium se presente
      const premiumOverlay = taskDistSection?.querySelector(".premium-overlay");
      if (premiumOverlay) premiumOverlay.remove();
      
      // Toggle mostra/nascondi
      toggleBtn.disabled = false;
      toggleBtn.style.opacity = "1";
      toggleBtn.style.cursor = "pointer";
      toggleBtn.addEventListener("click", () => {
        const isVisible = container.style.display !== "none";
        if (isVisible) {
          container.style.display = "none";
          toggleBtn.textContent = "Personalizza distribuzione task";
          resetTaskDistribution();
        } else {
          container.style.display = "block";
          toggleBtn.textContent = "Nascondi personalizzazione";
        }
      });
      
      // Reset distribuzione
      resetBtn?.addEventListener("click", () => {
        resetTaskDistribution();
      });
      
      // Aggiorna valori quando cambiano gli slider
      const types = ["theory", "practice", "exam", "review", "spaced"];
      types.forEach(type => {
        const slider = qs(`task-dist-${type}`);
        const valueSpan = qs(`task-dist-${type}-value`);
        
        if (slider && valueSpan) {
          slider.disabled = false;
          slider.style.opacity = "1";
          slider.style.cursor = "pointer";
          slider.addEventListener("input", () => {
            updateTaskDistributionDisplay();
          });
        }
      });
      
      // Inizializza display
      updateTaskDistributionDisplay();
    } else {
      // Utente non premium: disabilita la sezione
      toggleBtn.disabled = true;
      toggleBtn.style.opacity = "0.5";
      toggleBtn.style.cursor = "not-allowed";
      container.style.display = "none";
      
      // Disabilita tutti gli slider
      const types = ["theory", "practice", "exam", "review", "spaced"];
      types.forEach(type => {
        const slider = qs(`task-dist-${type}`);
        if (slider) {
          slider.disabled = true;
          slider.style.opacity = "0.5";
          slider.style.cursor = "not-allowed";
        }
      });
      
      if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.style.opacity = "0.5";
        resetBtn.style.cursor = "not-allowed";
      }
      
      // Aggiungi overlay premium se non presente
      if (taskDistSection && !taskDistSection.querySelector(".premium-overlay")) {
        const overlay = document.createElement("div");
        overlay.className = "premium-overlay";
        overlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(10, 12, 20, 0.85);
          backdrop-filter: blur(4px);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 10;
          cursor: pointer;
        `;
        overlay.innerHTML = `
          <div style="text-align: center;">
            <div style="font-size: 32px; margin-bottom: 12px;">⭐</div>
            <div style="font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.95); margin-bottom: 8px;">
              Funzionalità Premium
            </div>
            <div style="font-size: 13px; color: rgba(255,255,255,0.7); margin-bottom: 16px; line-height: 1.5;">
              La personalizzazione della distribuzione task è disponibile solo per gli utenti Premium.<br>
              Passa a Premium per personalizzare come vengono distribuiti i tuoi task di studio.
            </div>
            <button class="btn primary" style="margin-top: 8px;">
              Passa a Premium
            </button>
          </div>
        `;
        
        // Posiziona il formSection come relative se non lo è già
        if (taskDistSection) {
          const currentPosition = window.getComputedStyle(taskDistSection).position;
          if (currentPosition === "static") {
            taskDistSection.style.position = "relative";
          }
        }
        
        overlay.addEventListener("click", (e) => {
          e.stopPropagation();
          showUpgradeModal();
        });
        
        taskDistSection.appendChild(overlay);
      }
      
      // Disabilita anche il click sul bottone toggle
      toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showUpgradeModal();
      });
    }
  }
  
  /**
   * Legge la distribuzione task dal form
   * @returns {object|null} Oggetto con percentuali o null se non personalizzata
   */
  function getTaskDistribution(isPremiumUser = true) {
    // Se non è premium, non restituire distribuzione personalizzata
    if (!isPremiumUser) {
      return null;
    }
    
    const container = qs("task-distribution-container");
    if (!container || container.style.display === "none") {
      return null;
    }
    
    const theory = Number(qs("task-dist-theory")?.value || 0);
    const practice = Number(qs("task-dist-practice")?.value || 0);
    const exam = Number(qs("task-dist-exam")?.value || 0);
    const review = Number(qs("task-dist-review")?.value || 0);
    const spaced = Number(qs("task-dist-spaced")?.value || 0);
    
    const total = theory + practice + exam + review + spaced;
    
    // Se totale è 0, non è personalizzata
    if (total === 0) return null;
    
    // Normalizza le percentuali
    if (total > 0) {
      return {
        theory: Math.round((theory / total) * 100),
        practice: Math.round((practice / total) * 100),
        exam: Math.round((exam / total) * 100),
        review: Math.round((review / total) * 100),
        spaced: Math.round((spaced / total) * 100)
      };
    }
    
    return null;
  }
  
  /**
   * Resetta la distribuzione task ai valori di default
   */
  function resetTaskDistribution() {
    const types = ["theory", "practice", "exam", "review", "spaced"];
    types.forEach(type => {
      const slider = qs(`task-dist-${type}`);
      if (slider) slider.value = 0;
    });
    updateTaskDistributionDisplay();
  }
  
  /**
   * Aggiorna il display dei valori delle percentuali
   */
  function updateTaskDistributionDisplay() {
    const types = ["theory", "practice", "exam", "review", "spaced"];
    let total = 0;
    
    types.forEach(type => {
      const slider = qs(`task-dist-${type}`);
      const valueSpan = qs(`task-dist-${type}-value`);
      if (slider && valueSpan) {
        const value = Number(slider.value || 0);
        valueSpan.textContent = `${value}%`;
        total += value;
      }
    });
    
    const totalSpan = qs("task-dist-total-value");
    if (totalSpan) {
      totalSpan.textContent = `${total}%`;
      // Cambia colore se totale non è 100%
      if (total === 100) {
        totalSpan.style.color = "rgba(34,197,94,1)";
      } else if (total > 100) {
        totalSpan.style.color = "rgba(239,68,68,1)";
      } else {
        totalSpan.style.color = "rgba(245,158,11,1)";
      }
    }
  }
  

  function examCard(exam) {
    const d = document.createElement("div");
    d.className = "exam-card plain";
    
    // Mostra appelli se disponibili, altrimenti usa date legacy
    const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true, primary: true }] : []);
    const selectedAppelli = appelli.filter(a => a.selected !== false);
    const primaryAppello = selectedAppelli.find(a => a.primary === true) || selectedAppelli[0];
    
    let appelliText = selectedAppelli.length > 0 
      ? selectedAppelli.map(a => a.date).join(", ")
      : (exam.date || "Nessuna data");
    
    // Aggiungi indicazione dell'appello primario
    if (selectedAppelli.length > 1 && primaryAppello) {
        appelliText = selectedAppelli.map(a => {
        if (a.date === primaryAppello.date) {
          return `<strong>${a.date}</strong> (principale)`;
        }
        return a.date;
      }).join(", ");
    }
    
    d.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <strong>${escapeHtml(exam.name)}</strong>
        <p class="muted small">${appelliText} · CFU ${exam.cfu} · livello ${exam.level}/5 · diff ${exam.difficulty}/3</p>
        ${appelli.length > 1 ? `<p class="muted small" style="margin-top:4px;">${appelli.length} appelli totali · ${selectedAppelli.length} selezionati${primaryAppello ? ` · Appello principale: ${primaryAppello.date}` : ''}</p>` : ""}
      </div>
      <div class="examCardActions">
        <button class="btn tiny" type="button" data-edit="${exam.id}">Modifica</button>
        <button class="btn tiny" type="button" data-del="${exam.id}">Rimuovi</button>
      </div>
    `;
    return d;
  }

  async function refreshExamList(uid) {
    // Mostra badge premium e limiti
    const subscriptionInfo = await getSubscriptionInfo(uid);
    const exams = await listExams(uid);
    const isPremiumUser = await isPremium(uid);
    
    // Aggiorna badge premium se presente
    const premiumBadge = qs("premium-badge");
    if (premiumBadge) {
      if (isPremiumUser) {
        premiumBadge.textContent = "Premium";
        premiumBadge.className = "badge good";
        premiumBadge.style.display = "inline-block";
      } else {
        premiumBadge.style.display = "none";
      }
    }
    
    // Mostra limite esami se non premium
    const examLimitNotice = qs("exam-limit-notice");
    if (examLimitNotice && !isPremiumUser) {
      const remaining = Math.max(0, 2 - exams.length);
      if (remaining > 0) {
        examLimitNotice.textContent = `${remaining} esami rimasti nella versione gratuita`;
        examLimitNotice.style.display = "block";
      } else {
        examLimitNotice.textContent = "Limite raggiunto! Passa a Premium per esami illimitati";
        examLimitNotice.style.display = "block";
        examLimitNotice.style.color = "var(--warn)";
      }
    } else if (examLimitNotice) {
      examLimitNotice.style.display = "none";
    }
    
    // Continua con refresh normale
    const list = qs("exam-list");
    list.innerHTML = "";

    if (exams.length === 0) {
      const p = document.createElement("p");
      p.className = "muted small";
      p.textContent = "Nessun esame aggiunto.";
      list.appendChild(p);
      updateSimulationContainer(exams);
      return;
    }

    for (const ex of exams) list.appendChild(examCard(ex));

    list.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await removeExam(uid, btn.dataset.del);
        await refreshExamList(uid);
      });
    });

    list.querySelectorAll("button[data-edit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const examId = btn.dataset.edit;
        const exam = exams.find((e) => e.id === examId);
        if (exam) {
          openEditExamModal(uid, exam, () => refreshExamList(uid));
        }
      });
    });
    
    // Aggiorna simulazione
    updateSimulationContainer(exams, uid);
  }
  
  // Aggiorna il container della simulazione
  function updateSimulationContainer(exams, uid) {
    const container = qs("simulation-container");
    if (!container) return;
    
    if (exams.length === 0) {
      container.innerHTML = '<p class="muted small">Aggiungi esami per vedere la simulazione</p>';
      return;
    }
    
    let html = "";
    exams.forEach((exam) => {
      const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true }] : []);
      if (appelli.length === 0) return;
      
      html += `
        <div class="simulationExamItem" data-exam-id="${exam.id}">
          <div class="simulationExamName">${escapeHtml(exam.name)}</div>
      `;
      
      appelli.forEach((appello, idx) => {
        const isSelected = appello.selected !== false;
        html += `
          <div class="simulationAppelloItem">
            <input type="checkbox" class="appello-checkbox" data-exam-id="${exam.id}" data-appello-index="${idx}" ${isSelected ? "checked" : ""} />
            <div class="simulationAppelloInfo">
              <span class="simulationAppelloDate">${escapeHtml(appello.date)}</span>
            </div>
          </div>
        `;
      });
      
      html += `</div>`;
    });
    
    container.innerHTML = html || '<p class="muted small">Nessun appello disponibile</p>';
    
    // Aggiungi listener per checkbox
    container.querySelectorAll(".appello-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const examId = checkbox.dataset.examId;
        const appelloIndex = parseInt(checkbox.dataset.appelloIndex);
        const exam = exams.find(e => e.id === examId);
        if (exam && exam.appelli) {
          exam.appelli[appelloIndex].selected = checkbox.checked;
          await updateExam(uid, examId, { appelli: exam.appelli });
          await refreshExamList(uid);
        }
      });
    });
  }
  
  // Esegue la simulazione
  async function runSimulation(uid) {
    // Controllo premium per simulazione
    const premium = await isPremium(uid);
    if (!premium) {
      showUpgradeModal();
      return;
    }
    
    const resultsContainer = qs("simulation-results");
    if (!resultsContainer) return;
    
    const exams = await listExams(uid);
    const profile = await getProfile(uid);
    
    if (!profile || !profile.goalMode || !profile.dayMinutes) {
      alert("Completa prima le impostazioni del profilo");
      return;
    }
    
    // Considera TUTTI gli esami (non solo quelli con appelli selezionati)
    const examsWithAppelli = exams.filter(exam => {
      const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true }] : []);
      return appelli.length > 0;
    });
    
    if (examsWithAppelli.length === 0) {
      alert("Aggiungi almeno un esame con appelli per eseguire la simulazione");
      return;
    }
    
    // Analizza TUTTI gli appelli per TUTTI gli esami, considerando l'impatto globale
    const appelliAnalysis = [];
    const weekStart = startOfWeekISO(getCurrentDate());
    
    // Genera il piano settimanale per ottenere le allocazioni
    const normalizedExams = exams.map(e => ({
      ...e,
      category: e.category || detectExamCategory(e.name || "") || "mixed"
    }));
    const plan = generateWeeklyPlan(profile, normalizedExams, weekStart);
    const allocMap = new Map((plan.allocations || []).map((a) => [a.examId, a.targetMin]));
    
    // Per ogni esame, analizza tutti gli appelli disponibili
    examsWithAppelli.forEach(exam => {
      const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true }] : []);
      const selectedAppelli = appelli.filter(a => a.selected !== false);
      
      if (selectedAppelli.length > 1) {
        // Confronta gli appelli per questo esame
        const comparisons = selectedAppelli.map(appello => {
          const virtualExam = {
            ...exam,
            id: `${exam.id}_${appello.date}`,
            date: appello.date
          };
          
          const daysLeft = daysTo(appello.date);
          const required = estimateRequiredMinutes(virtualExam, profile);
          const capacity = estimateCapacityUntilExamMinutes(virtualExam, profile);
          const allocThisWeek = Number(allocMap.get(virtualExam.id) || 0);
          const readiness = estimateReadinessPercent(virtualExam, profile, allocThisWeek);
          
          // Fattore di convenienza (più alto = più conveniente)
          // Considera: giorni rimanenti, preparazione, tipo (esonero = bonus)
          const daysScore = Math.min(daysLeft / 30, 1) * 40; // Max 40 punti per tempo
          const readinessScore = readiness * 0.4; // 40 punti per preparazione
          const typeBonus = 0; // Nessun bonus tipo
          const capacityScore = Math.min(capacity / required, 1) * 20; // Max 20 punti per capacità
          
          const convenienceScore = daysScore + readinessScore + typeBonus + capacityScore;
          
          return {
            appello,
            daysLeft,
            required,
            capacity,
            readiness,
            convenienceScore,
            allocThisWeek
          };
        });
        
        // Ordina per convenienza (più alto = migliore)
        comparisons.sort((a, b) => b.convenienceScore - a.convenienceScore);
        const best = comparisons[0];
        const worst = comparisons[comparisons.length - 1];
        
        appelliAnalysis.push({
          exam,
          comparisons,
          best,
          worst,
          hasMultiple: comparisons.length > 1
        });
      }
    });
    
    // Calcola statistiche totali
    const totalExams = examsWithAppelli.length;
    const totalAppelli = examsWithAppelli.reduce((sum, exam) => {
      const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true }] : []);
      return sum + appelli.filter(a => a.selected !== false).length;
    }, 0);
    const avgReadiness = appelliAnalysis.length > 0 
      ? Math.round(appelliAnalysis.reduce((sum, a) => sum + (a.best.readiness || 0), 0) / appelliAnalysis.length)
      : 0;
    
    // Mostra risultati
    let html = `
      <div class="simulationSummary">
        <div class="simulationSummaryTitle">Risultati Simulazione Globale</div>
        <div class="simulationSummaryStats">
          <div class="simulationStat">
            <div class="simulationStatValue">${totalExams}</div>
            <div class="simulationStatLabel">Esami</div>
          </div>
          <div class="simulationStat">
            <div class="simulationStatValue">${totalAppelli}</div>
            <div class="simulationStatLabel">Appelli</div>
          </div>
          <div class="simulationStat">
            <div class="simulationStatValue">${avgReadiness}%</div>
            <div class="simulationStatLabel">Preparazione media</div>
          </div>
        </div>
        <div style="margin-top:20px; padding:14px; background:rgba(99,102,241,0.1); border-radius:10px; border-left:3px solid rgba(99,102,241,0.6);">
          <div style="font-size:13px; font-weight:600; color:rgba(99,102,241,1); margin-bottom:4px;">ℹ️ Analisi Completa</div>
          <div style="font-size:12px; color:rgba(255,255,255,0.8); line-height:1.5;">La simulazione considera tutti gli esami e tutti gli appelli disponibili, valutando l'impatto globale di ogni scelta.</div>
        </div>
      </div>
    `;
    
    // Aggiungi analisi comparativa degli appelli
    if (appelliAnalysis.length > 0) {
      html += `
        <div class="simulationRecommendations">
          <div class="simulationRecommendationsTitle">Consigli Appelli (Analisi Globale)</div>
          <div class="simulationRecommendationsList">
      `;
      
      appelliAnalysis.forEach(({ exam, comparisons, best, worst, alternativeAppello }) => {
        const bestDate = best.appello.date;
        const bestReadiness = best.readiness;
        
        let recommendation = "";
        let recommendationClass = "simulationRecommendationGood";
        let recommendationNote = "";
        
        if (best.recommended) {
          recommendation = `✅ Consigliato: ${bestDate}`;
          recommendationClass = "simulationRecommendationGood";
          recommendationNote = `Preparazione stimata: ${bestReadiness}% - Pronto per sostenere l'esame`;
        } else if (best.canTry) {
          recommendation = `⚠️ Puoi provare: ${bestDate}`;
          recommendationClass = "simulationRecommendationNeutral";
          recommendationNote = `Preparazione stimata: ${bestReadiness}% - Preparazione sufficiente per tentare`;
          
          if (alternativeAppello) {
            recommendationNote += `. Considera anche ${alternativeAppello.appello.date} (${alternativeAppello.readiness}% preparazione) per una preparazione migliore`;
          }
        } else {
          recommendation = `❌ Preparazione insufficiente`;
          recommendationClass = "simulationRecommendationBad";
          recommendationNote = `Preparazione stimata: ${bestReadiness}% - Rischi di non passare`;
          
          if (alternativeAppello) {
            recommendationNote += `. Suggerito: ${alternativeAppello.appello.date} (${alternativeAppello.readiness}% preparazione)`;
          } else if (comparisons.length > 1) {
            const bestAlternative = comparisons.find(c => c.readiness > best.readiness);
            if (bestAlternative) {
              recommendationNote += `. Alternativa migliore: ${bestAlternative.appello.date} (${bestAlternative.readiness}% preparazione)`;
            }
          }
        }
        
        html += `
          <div class="simulationRecommendationItem ${recommendationClass}">
            <div class="simulationRecommendationHeader">
              <strong>${escapeHtml(exam.name)}</strong>
              <span class="simulationRecommendationBadge">${recommendation}</span>
            </div>
            ${recommendationNote ? `
              <div style="margin-top:8px; padding:10px; background:rgba(255,255,255,0.05); border-radius:6px; font-size:12px; color:rgba(255,255,255,0.9); line-height:1.5;">
                ${recommendationNote}
              </div>
            ` : ''}
            <div class="simulationRecommendationDetails" style="margin-top:12px;">
        `;
        
        // Ordina per preparazione (dal migliore al peggiore) per mostrare le opzioni migliori prima
        const sortedComparisons = [...comparisons].sort((a, b) => b.readiness - a.readiness);
        
        sortedComparisons.forEach((comp, idx) => {
          const isBest = comp.appello.date === best.appello.date;
          const isAlternative = alternativeAppello && comp.appello.date === alternativeAppello.appello.date;
          const readinessBadge = comp.readiness >= 85 ? "good" : comp.readiness >= 70 ? "warn" : comp.readiness >= 50 ? "bad" : "bad";
          const readinessText = comp.readiness >= 85 ? "Pronto" : comp.readiness >= 70 ? "Quasi pronto" : comp.readiness >= 50 ? "Puoi provare" : "Rischio";
          
          html += `
            <div class="simulationAppelloComparison ${isBest ? "simulationAppelloBest" : isAlternative ? "simulationAppelloAlternative" : ""}" style="${isBest ? 'border: 2px solid rgba(34,197,94,0.5);' : isAlternative ? 'border: 2px solid rgba(99,102,241,0.5);' : ''}">
              <div class="simulationAppelloComparisonHeader">
                <span class="simulationAppelloDate">${escapeHtml(comp.appello.date)}</span>
                <div style="display:flex; gap:8px; align-items:center;">
                  ${isBest ? '<span class="simulationBestBadge">Consigliato</span>' : ''}
                  ${isAlternative ? '<span class="simulationBestBadge" style="background:rgba(99,102,241,0.2); color:rgba(99,102,241,1);">Alternativa</span>' : ''}
                </div>
              </div>
              <div class="simulationAppelloComparisonStats">
                <div class="simulationAppelloStat">
                  <span class="simulationAppelloStatLabel">Giorni rimanenti</span>
                  <span class="simulationAppelloStatValue">${comp.daysLeft}g</span>
                </div>
                <div class="simulationAppelloStat">
                  <span class="simulationAppelloStatLabel">Preparazione stimata</span>
                  <span class="simulationAppelloStatValue badge ${readinessBadge}">${comp.readiness}%</span>
                </div>
                <div class="simulationAppelloStat">
                  <span class="simulationAppelloStatLabel">Stato</span>
                  <span class="simulationAppelloStatValue" style="font-size:11px;">${readinessText}</span>
                </div>
                <div class="simulationAppelloStat">
                  <span class="simulationAppelloStatLabel">Ore necessarie</span>
                  <span class="simulationAppelloStatValue">${Math.round(comp.required / 60)}h</span>
                </div>
                <div class="simulationAppelloStat">
                  <span class="simulationAppelloStatLabel">Ore disponibili</span>
                  <span class="simulationAppelloStatValue">${Math.round(comp.capacity / 60)}h</span>
                </div>
                ${comp.avgOtherReadiness !== undefined ? `
                <div class="simulationAppelloStat">
                  <span class="simulationAppelloStatLabel">Impatto altri esami</span>
                  <span class="simulationAppelloStatValue" style="font-size:11px;">${Math.round(comp.avgOtherReadiness)}% preparazione</span>
                </div>
                ` : ''}
              </div>
            </div>
          `;
        });
        
        html += `
            </div>
          </div>
        `;
      });
      
      html += `
          </div>
        </div>
      `;
    }
    
    // Mostra risultati in un popup invece che inline
    showSimulationResultsModal(html);
  }
  
  // Mostra i risultati della simulazione in un popup
  /**
   * Mostra un popup di riepilogo della strategia di studio prima di andare alla dashboard
   */
  async function showStrategySummaryModal(data, onConfirm) {
    const { goalMode, weeklyHours, taskMinutes, dayMinutes, currentHours, targetHours, exams, profile } = data;
    
    // Calcola informazioni utili
    const totalWeeklyMinutes = Object.values(dayMinutes || {}).reduce((sum, v) => sum + (v || 0), 0);
    const totalWeeklyHours = Math.round((totalWeeklyMinutes / 60) * 10) / 10;
    const effectiveWeeklyHours = weeklyHours || totalWeeklyHours;
    
    // Mappa goalMode a label
    const goalModeLabels = {
      pass: "Leggero",
      good: "Moderato",
      top: "Intensivo"
    };
    
    // Raccogli appelli considerati
    const examsWithAppelli = [];
    for (const exam of exams || []) {
      const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true, primary: true }] : []);
      const selectedAppelli = appelli.filter(a => a.selected !== false);
      if (selectedAppelli.length > 0) {
        const primaryAppello = selectedAppelli.find(a => a.primary === true) || selectedAppelli[0];
        examsWithAppelli.push({
          name: exam.name,
          cfu: exam.cfu,
          selectedAppelli,
          primaryAppello
        });
      }
    }
    
    // Genera un piano di esempio per vedere le allocazioni
    let planInfo = null;
    try {
      const weekStart = startOfWeekISO(getCurrentDate());
      const tempProfile = {
        ...profile,
        goalMode: goalMode || profile?.goalMode || "good",
        weeklyHours: effectiveWeeklyHours,
        taskMinutes: taskMinutes || profile?.taskMinutes || 35,
        dayMinutes: dayMinutes || profile?.dayMinutes || {},
        currentHours: currentHours || profile?.currentHours,
        targetHours: targetHours || profile?.targetHours
      };
      const tempExams = exams.map(e => ({
        ...e,
        category: e.category || detectExamCategory(e.name || "") || "mixed"
      }));
      const plan = generateWeeklyPlan(tempProfile, tempExams, weekStart);
      planInfo = {
        totalTasks: plan.days.reduce((sum, d) => sum + (d.tasks?.length || 0), 0),
        totalHours: Math.round((plan.weeklyBudgetMin / 60) * 10) / 10,
        cutTasks: plan.cut?.length || 0,
        allocations: plan.allocations || []
      };
    } catch (err) {
      console.warn("Errore generazione piano per riepilogo:", err);
    }
    
    // Crea HTML del riepilogo
    let html = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <!-- Sezione Appelli Considerati -->
        <div>
          <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.95);">
            📅 Appelli Considerati
          </h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
    `;
    
    if (examsWithAppelli.length === 0) {
      html += `<p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Nessun appello selezionato</p>`;
    } else {
      for (const exam of examsWithAppelli) {
        html += `
          <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; border-left: 3px solid rgba(99,102,241,0.6);">
            <div style="font-weight: 600; color: rgba(255,255,255,0.95); margin-bottom: 8px;">
              ${escapeHtml(exam.name)} <span style="color: rgba(255,255,255,0.6); font-weight: 400;">(${exam.cfu} CFU)</span>
            </div>
            <div style="font-size: 13px; color: rgba(255,255,255,0.8); line-height: 1.6;">
        `;
        
        for (const appello of exam.selectedAppelli) {
          const isPrimary = appello.date === exam.primaryAppello?.date;
          html += `
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
              <span style="color: ${isPrimary ? 'rgba(34,197,94,1)' : 'rgba(255,255,255,0.7)'};">
                ${isPrimary ? '✓' : '○'}
              </span>
              <span style="${isPrimary ? 'font-weight: 600; color: rgba(34,197,94,1);' : 'color: rgba(255,255,255,0.7);'}">
                ${appello.date}${isPrimary ? ' <span style="font-size: 11px; color: rgba(34,197,94,0.8);">(principale)</span>' : ''}
              </span>
            </div>
          `;
        }
        
        html += `
            </div>
          </div>
        `;
      }
    }
    
    html += `
          </div>
        </div>
        
        <!-- Sezione Impostazioni Studio -->
        <div>
          <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.95);">
            ⚙️ Impostazioni Studio
          </h3>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
              <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">Impegno</div>
              <div style="font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.95);">${goalModeLabels[goalMode] || goalMode}</div>
            </div>
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
              <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">Ore settimanali</div>
              <div style="font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.95);">${effectiveWeeklyHours}h</div>
            </div>
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
              <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">Durata task</div>
              <div style="font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.95);">${taskMinutes} min</div>
            </div>
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
              <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">Disponibilità totale</div>
              <div style="font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.95);">${totalWeeklyHours}h</div>
            </div>
    `;
    
    if (currentHours && targetHours) {
      html += `
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; grid-column: 1 / -1;">
              <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">Allenatore di Studio</div>
              <div style="font-size: 14px; color: rgba(255,255,255,0.95);">
                Attuale: <strong>${currentHours}h</strong> → Obiettivo: <strong>${targetHours}h</strong>
              </div>
            </div>
      `;
    }
    
    html += `
          </div>
          
          <!-- Disponibilità giornaliera -->
          <div style="margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
            <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 8px;">Disponibilità giornaliera</div>
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; font-size: 12px;">
    `;
    
    const dayLabels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
    const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    dayKeys.forEach((key, idx) => {
      const minutes = dayMinutes[key] || 0;
      const hours = Math.round((minutes / 60) * 10) / 10;
      html += `
        <div style="text-align: center; padding: 6px; background: ${minutes > 0 ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)'}; border-radius: 6px;">
          <div style="color: rgba(255,255,255,0.6); margin-bottom: 2px;">${dayLabels[idx]}</div>
          <div style="font-weight: 600; color: rgba(255,255,255,0.95);">${hours}h</div>
        </div>
      `;
    });
    
    html += `
            </div>
          </div>
        </div>
        
        <!-- Sezione Informazioni Utili -->
        <div>
          <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.95);">
            ℹ️ Informazioni Utili
          </h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
    `;
    
    html += `
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
              <div style="font-size: 13px; color: rgba(255,255,255,0.8); line-height: 1.6;">
                <strong style="color: rgba(255,255,255,0.95);">Esami da preparare:</strong> ${exams.length}
              </div>
            </div>
    `;
    
    if (planInfo) {
      html += `
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
              <div style="font-size: 13px; color: rgba(255,255,255,0.8); line-height: 1.6;">
                <strong style="color: rgba(255,255,255,0.95);">Budget settimanale stimato:</strong> ${planInfo.totalHours}h
              </div>
            </div>
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
              <div style="font-size: 13px; color: rgba(255,255,255,0.8); line-height: 1.6;">
                <strong style="color: rgba(255,255,255,0.95);">Task generati:</strong> ${planInfo.totalTasks}
              </div>
            </div>
      `;
      
      if (planInfo.cutTasks > 0) {
        html += `
            <div style="padding: 12px; background: rgba(245,158,11,0.1); border-radius: 8px; border-left: 3px solid rgba(245,158,11,0.6);">
              <div style="font-size: 13px; color: rgba(245,158,11,1); line-height: 1.6;">
                <strong>⚠️ Attenzione:</strong> ${planInfo.cutTasks} task non possono essere completati con il budget attuale. Considera di aumentare le ore settimanali.
              </div>
            </div>
        `;
      } else {
        html += `
            <div style="padding: 12px; background: rgba(34,197,94,0.1); border-radius: 8px; border-left: 3px solid rgba(34,197,94,0.6);">
              <div style="font-size: 13px; color: rgba(34,197,94,1); line-height: 1.6;">
                ✓ Piano fattibile: tutti i task possono essere completati con il budget settimanale disponibile.
              </div>
            </div>
        `;
      }
    }
    
    html += `
          </div>
        </div>
      </div>
    `;
    
    // Crea modale
    const overlay = document.createElement("div");
    overlay.id = "strategy-summary-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.8)",
      zIndex: "10000",
      padding: "20px",
      animation: "fadeIn 0.2s ease-out",
    });
    
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxWidth = "800px";
    card.style.width = "95%";
    card.style.maxHeight = "90vh";
    card.style.overflowY = "auto";
    card.style.padding = "32px";
    card.style.position = "relative";
    card.style.animation = "slideUp 0.3s ease-out";
    
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "24px";
    header.style.paddingBottom = "20px";
    header.style.borderBottom = "1px solid rgba(255, 255, 255, 0.1)";
    
    const title = document.createElement("h2");
    title.textContent = "Riepilogo Strategia di Studio";
    title.style.margin = "0";
    title.style.fontSize = "24px";
    title.style.fontWeight = "900";
    title.style.color = "rgba(255, 255, 255, 0.95)";
    
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "✕";
    closeBtn.className = "btn ghost";
    closeBtn.style.width = "40px";
    closeBtn.style.height = "40px";
    closeBtn.style.padding = "0";
    closeBtn.style.fontSize = "20px";
    closeBtn.style.borderRadius = "50%";
    closeBtn.style.display = "flex";
    closeBtn.style.alignItems = "center";
    closeBtn.style.justifyContent = "center";
    closeBtn.style.cursor = "pointer";
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    card.appendChild(header);
    
    const content = document.createElement("div");
    content.innerHTML = html;
    card.appendChild(content);
    
    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.gap = "12px";
    footer.style.justifyContent = "flex-end";
    footer.style.marginTop = "24px";
    footer.style.paddingTop = "20px";
    footer.style.borderTop = "1px solid rgba(255, 255, 255, 0.1)";
    
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Annulla";
    cancelBtn.className = "btn";
    cancelBtn.addEventListener("click", () => {
      closeModal();
    });
    
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Vai alla Dashboard";
    confirmBtn.className = "btn primary";
    confirmBtn.addEventListener("click", () => {
      closeModal();
      if (onConfirm) onConfirm();
    });
    
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    card.appendChild(footer);
    
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    
    function closeModal() {
      overlay.style.animation = "fadeOut 0.2s ease-out";
      card.style.animation = "slideDown 0.2s ease-out";
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        document.body.style.overflow = "";
      }, 200);
    }
    
    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("strategy-summary-modal")) {
        closeModal();
      }
    });
  }

  function showSimulationResultsModal(htmlContent) {
    // Evita di aprire più modali contemporaneamente
    if (document.getElementById("simulation-results-modal")) return;
    
    // Overlay oscurante
    const overlay = document.createElement("div");
    overlay.id = "simulation-results-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.8)",
      zIndex: "10000",
      padding: "20px",
      animation: "fadeIn 0.2s ease-out",
    });
    
    // Contenitore principale con stile card
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxWidth = "900px";
    card.style.width = "95%";
    card.style.maxHeight = "90vh";
    card.style.overflowY = "auto";
    card.style.padding = "32px";
    card.style.position = "relative";
    card.style.animation = "slideUp 0.3s ease-out";
    
    // Header con titolo e bottone chiusura
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "24px";
    header.style.paddingBottom = "20px";
    header.style.borderBottom = "1px solid rgba(255, 255, 255, 0.1)";
    
    const title = document.createElement("h2");
    title.textContent = "Risultati Simulazione";
    title.style.margin = "0";
    title.style.fontSize = "28px";
    title.style.fontWeight = "900";
    title.style.color = "rgba(255, 255, 255, 0.95)";
    title.style.letterSpacing = "-0.02em";
    
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "✕";
    closeBtn.className = "btn ghost";
    closeBtn.style.width = "40px";
    closeBtn.style.height = "40px";
    closeBtn.style.padding = "0";
    closeBtn.style.fontSize = "20px";
    closeBtn.style.borderRadius = "50%";
    closeBtn.style.display = "flex";
    closeBtn.style.alignItems = "center";
    closeBtn.style.justifyContent = "center";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.flexShrink = "0";
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    card.appendChild(header);
    
    // Contenuto
    const content = document.createElement("div");
    content.innerHTML = htmlContent;
    card.appendChild(content);
    
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    
    // Funzione per chiudere la modale
    function closeModal() {
      overlay.style.animation = "fadeOut 0.2s ease-out";
      card.style.animation = "slideDown 0.2s ease-out";
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        document.body.style.overflow = "";
      }, 200);
    }
    
    // Event listeners
    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("simulation-results-modal")) {
        closeModal();
      }
    });
    
    // Previeni scroll del body
    document.body.style.overflow = "hidden";
  }
  
  watchAuth(async (user) => {
    if (!user) {
      window.location.assign("./index.html");
      return;
    }

    await reload(user);
    if (!user.emailVerified) {
      await logout();
      window.location.assign("./index.html");
      return;
    }

    setText(qs("user-line"), user.email ?? "—");
    await ensureUserDoc(user);

    const profile = await getProfile(user.uid);
    
    // Se mancano informazioni personali, mostra il popup
    if (!profile?.name || !profile?.faculty || !profile?.age) {
      showPersonalInfoModal(user, async () => {
        // Dopo aver salvato, ricarica la pagina per continuare
        window.location.reload();
      });
      return;
    }
    
    // Mostra le informazioni personali nell'header se disponibili
    if (profile.name) {
      const userLine = qs("user-line");
      if (userLine) {
        userLine.textContent = `${profile.name} · ${profile.faculty || ""}`;
      }
    }
    
    // Gestione premium badge e upgrade button
    const subscriptionInfo = await getSubscriptionInfo(user.uid);
    const isPremiumUser = await isPremium(user.uid);
    
    // Inizializza distribuzione task (con controllo premium) - DOPO aver verificato isPremiumUser
    initTaskDistribution(isPremiumUser);
    
    const premiumBadge = qs("premium-badge");
    const upgradeBtn = qs("upgrade-btn");
    
    if (premiumBadge) {
      if (isPremiumUser) {
        if (subscriptionInfo?.isTrial) {
          premiumBadge.textContent = `Prova Gratuita (${subscriptionInfo.trialDaysLeft} giorni)`;
          premiumBadge.className = "badge warn";
        } else {
          premiumBadge.textContent = "Premium";
          premiumBadge.className = "badge good";
        }
        premiumBadge.style.display = "inline-block";
        if (upgradeBtn) upgradeBtn.style.display = "none";
      } else {
        premiumBadge.style.display = "none";
        if (upgradeBtn) {
          upgradeBtn.style.display = "inline-block";
          upgradeBtn.addEventListener("click", () => showUpgradeModal());
        }
      }
    }
    
    // Mostra informazioni personali nella sezione profilo
    const personalInfoDisplay = qs("personal-info-display");
    if (personalInfoDisplay && profile.name) {
      personalInfoDisplay.innerHTML = `
        <div class="personalInfoCard">
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Nome</span>
            <span class="personalInfoValue">${escapeHtml(profile.name)}</span>
          </div>
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Facoltà</span>
            <span class="personalInfoValue">${escapeHtml(profile.faculty || "—")}</span>
          </div>
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Età</span>
            <span class="personalInfoValue">${profile.age || "—"}</span>
          </div>
          ${profile.sessionType ? `
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Preparazione</span>
            <span class="personalInfoValue">${
              profile.sessionType === "exams" ? "Esami sessione" :
              profile.sessionType === "exemptions" ? "Esoneri" :
              profile.sessionType === "both" ? "Esami ed esoneri" : "—"
            }</span>
          </div>
          ` : ""}
        </div>
      `;
    }

    renderDayInputs(profile?.dayMinutes ?? null);

    if (profile?.goalMode) qs("goal-mode").value = profile.goalMode;
    if (profile?.weeklyHours) qs("weekly-hours").value = profile.weeklyHours;
    if (profile?.taskMinutes) qs("task-minutes").value = String(profile.taskMinutes);
    
    // Per utenti non premium: se non ci sono ore settimanali ma ci sono ore attuali, usa quelle
    if (!isPremiumUser && profile?.currentHours && profile.currentHours > 0) {
      const weeklyHoursInput = qs("weekly-hours");
      if (weeklyHoursInput && (!profile?.weeklyHours || profile.weeklyHours < 1)) {
        weeklyHoursInput.value = profile.currentHours.toFixed(1);
      }
    }
    
    // Carica dati allenatore
    const currentHoursInput = qs("current-hours");
    const targetHoursInput = qs("target-hours");
    const coachSection = currentHoursInput?.closest(".formSection");
    
    // Carica "ore attuali" per tutti gli utenti (premium e non premium)
    if (profile?.currentHours && currentHoursInput) {
      currentHoursInput.value = profile.currentHours;
    }
    
    if (isPremiumUser) {
      // Utente premium: abilita la sezione completa
      if (profile?.targetHours && targetHoursInput) targetHoursInput.value = profile.targetHours;
      
      // Rimuovi overlay premium se presente
      const premiumOverlay = coachSection?.querySelector(".premium-overlay");
      if (premiumOverlay) premiumOverlay.remove();
      
      // Abilita input
      if (currentHoursInput) {
        currentHoursInput.disabled = false;
        currentHoursInput.style.opacity = "1";
        currentHoursInput.style.cursor = "text";
      }
      if (targetHoursInput) {
        targetHoursInput.disabled = false;
        targetHoursInput.style.opacity = "1";
        targetHoursInput.style.cursor = "text";
      }
      
      // Aggiorna visualizzazione allenatore (carica esami per calcolo corretto)
      (async () => {
        let exams = [];
        try {
          exams = await listExams(user.uid);
        } catch (err) {
          console.error("Errore caricamento esami:", err);
        }
        updateCoachDisplay(profile, true, exams);
        
        // Se l'allenatore è attivo, aggiorna weekly-hours con le ore suggerite e disabilita il campo
        const weeklyHoursInput = qs("weekly-hours");
        const weeklyHoursSection = weeklyHoursInput?.closest(".formSection");
        const isCoachActive = profile.currentHours > 0 && profile.targetHours > 0 && profile.targetHours > profile.currentHours;
        
        if (isCoachActive && weeklyHoursInput) {
          // Disabilita il campo quando l'allenatore è attivo
          weeklyHoursInput.disabled = true;
          weeklyHoursInput.style.opacity = "0.7";
          weeklyHoursInput.style.cursor = "not-allowed";
          weeklyHoursInput.title = "Valore suggerito dall'allenatore di studio (non modificabile)";
          
          // Aggiungi un indicatore visivo che è suggerito
          const label = weeklyHoursInput.closest(".formRow")?.querySelector("label");
          if (label && !label.querySelector(".coach-suggested-badge")) {
            const badge = document.createElement("span");
            badge.className = "coach-suggested-badge";
            badge.textContent = " (suggerito)";
            badge.style.cssText = "color: rgba(99,102,241,1); font-size: 12px; font-weight: 600; margin-left: 4px;";
            label.appendChild(badge);
          }
          
          // Verifica se il profilo è nuovo (prima settimana o coachStartDate non esiste)
          const coachStartDate = await getCoachStartDate(profile);
          // Usa getCurrentDate() per supportare date virtuali in localhost
          const now = getCurrentDate();
          now.setHours(0, 0, 0, 0);
          
          let isNewProfile = false;
          if (!coachStartDate) {
            // Profilo nuovo: non c'è ancora una data di inizio
            isNewProfile = true;
          } else {
            // Verifica se siamo nella prima settimana
            const weekStart = new Date(coachStartDate);
            weekStart.setHours(0, 0, 0, 0);
            const weeksSinceStart = Math.floor((now - weekStart) / (7 * 24 * 60 * 60 * 1000));
            isNewProfile = weeksSinceStart === 0;
          }
          
          // Recupera coachStartDate dal profilo o localStorage
          let coachStartDateValue = null;
          if (profile.coachStartDate) {
            coachStartDateValue = new Date(profile.coachStartDate);
          } else {
            try {
              const saved = localStorage.getItem('coach_start_date');
              if (saved) coachStartDateValue = new Date(saved);
            } catch {}
          }
          
          // Se il profilo è nuovo e previsto dalla strategia, usa le ore attuali
          // Altrimenti usa le ore suggerite dall'allenatore
          let hoursToUse;
          if (isNewProfile) {
            // Profilo nuovo: usa le ore attuali
            hoursToUse = profile.currentHours;
          } else {
            // Profilo esistente: usa le ore suggerite dall'allenatore
            hoursToUse = calculateSuggestedWeeklyHours(profile.currentHours, profile.targetHours, exams, coachStartDateValue);
          }
          
          weeklyHoursInput.value = hoursToUse.toFixed(1);
          
          // Aggiungi indicatore di progressione (usa coachStartDateValue anche se isNewProfile)
          updateWeeklyHoursProgressionIndicator(weeklyHoursInput, profile, exams, coachStartDateValue);
        } else if (weeklyHoursInput) {
          // Se l'allenatore non è attivo, abilita il campo
          weeklyHoursInput.disabled = false;
          weeklyHoursInput.style.opacity = "1";
          weeklyHoursInput.style.cursor = "text";
          weeklyHoursInput.title = "";
          
          // Rimuovi il badge se presente
          const label = weeklyHoursInput.closest(".formRow")?.querySelector("label");
          const badge = label?.querySelector(".coach-suggested-badge");
          if (badge) badge.remove();
        }
      })();
    } else {
      // Utente non premium: permette di inserire "ore attuali" ma nasconde "obiettivo ore a settimana"
      if (currentHoursInput) {
        // Abilita il campo "ore attuali" per utenti non premium
        currentHoursInput.disabled = false;
        currentHoursInput.style.opacity = "1";
        currentHoursInput.style.cursor = "text";
        if (profile?.currentHours) {
          currentHoursInput.value = profile.currentHours;
        }
        
        // Sincronizza le ore attuali con le ore settimanali suggerite
        const weeklyHoursInput = qs("weekly-hours");
        const syncWeeklyHours = () => {
          const currentHours = Number(currentHoursInput.value || 0);
          if (currentHours > 0 && weeklyHoursInput) {
            weeklyHoursInput.value = currentHours.toFixed(1);
          }
        };
        
        // Sincronizza al caricamento se ci sono ore attuali
        if (profile?.currentHours && profile.currentHours > 0) {
          syncWeeklyHours();
        }
        
        // Sincronizza quando l'utente modifica le ore attuali
        currentHoursInput.addEventListener("input", syncWeeklyHours);
        currentHoursInput.addEventListener("change", syncWeeklyHours);
      }
      
      // Aggiorna la descrizione della sezione "Ore settimanali suggerite" per utenti non premium
      const weeklyHoursSection = qs("weekly-hours")?.closest(".formSection");
      if (weeklyHoursSection) {
        const sectionTitle = weeklyHoursSection.querySelector(".sectionTitle");
        if (sectionTitle) {
          const meta = sectionTitle.querySelector(".meta");
          if (meta) {
            meta.textContent = "Basate sulle tue ore attuali inserite sopra (puoi modificarle manualmente)";
          }
        }
      }
      
      // Nascondi completamente il campo "obiettivo ore a settimana" per utenti non premium
      const targetHoursRow = targetHoursInput?.closest(".formRow");
      if (targetHoursRow) {
        targetHoursRow.style.display = "none";
      }
      
      // Nascondi progress bar
      const coachProgress = qs("coach-progress");
      if (coachProgress) coachProgress.style.display = "none";
      
      // Aggiungi overlay premium sulla sezione allenatore di studio
      if (coachSection && !coachSection.querySelector(".premium-overlay-modal")) {
        const currentPosition = window.getComputedStyle(coachSection).position;
        if (currentPosition === "static") {
          coachSection.style.position = "relative";
        }
        
        const overlay = document.createElement("div");
        overlay.className = "premium-overlay-modal";
        overlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(10, 12, 20, 0.85);
          backdrop-filter: blur(4px);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 10;
          cursor: pointer;
        `;
        overlay.innerHTML = `
          <div style="text-align: center;">
            <div style="font-size: 24px; margin-bottom: 8px;">⭐</div>
            <div style="font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.95); margin-bottom: 6px;">
              Funzionalità Premium
            </div>
            <div style="font-size: 12px; color: rgba(255,255,255,0.7); line-height: 1.4; margin-bottom: 12px;">
              L'Allenatore di Studio è disponibile solo per utenti Premium
            </div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.6); line-height: 1.4;">
              Puoi comunque inserire le tue ore attuali, che verranno usate come ore settimanali suggerite
            </div>
          </div>
        `;
        
        overlay.addEventListener("click", (e) => {
          e.stopPropagation();
          showUpgradeModal();
        });
        
        coachSection.appendChild(overlay);
        
        // Disabilita i campi target-hours se presenti
        if (targetHoursInput) {
          targetHoursInput.disabled = true;
          targetHoursInput.style.opacity = "0.5";
          targetHoursInput.style.cursor = "not-allowed";
        }
      }
    }

    await refreshExamList(user.uid);

    // Funzione comune per salvare le impostazioni (usata sia da save-profile che save-strategies)
    const handleSaveSettings = async () => {
      const errorEl = qs("profile-error") || qs("strategy-error");
      const savedEl = qs("profile-saved") || qs("strategy-saved");
      
      if (errorEl) setText(errorEl, "");
      if (savedEl) setText(savedEl, "");

      try {
        const goalMode = qs("goal-mode")?.value;
        let weeklyHours = Number(qs("weekly-hours")?.value || 0);
        const taskMinutes = Number(qs("task-minutes")?.value || 35);
        const dayMinutes = readDayInputs();
        const currentHours = Number(qs("current-hours")?.value || 0);
        let targetHours = Number(qs("target-hours")?.value || 0);

        if (!goalMode) throw new Error("Seleziona un obiettivo di studio.");
        
        const totalMin = Object.values(dayMinutes).reduce((a, b) => a + Number(b || 0), 0);
        if (totalMin < 60) throw new Error("Disponibilità settimanale troppo bassa (< 60 min).");
        if (weeklyHours < 1) throw new Error("Ore settimanali non valide.");
        
        // Validazione coerenza: verifica che le ore settimanali siano coerenti con la disponibilità giornaliera
        const weeklyMinutesFromDays = totalMin;
        const weeklyHoursFromDays = weeklyMinutesFromDays / 60;
        const weeklyHoursFromInput = weeklyHours;
        
        // Permetti una discrepanza massima del 20% o 2 ore (la maggiore)
        const maxDiff = Math.max(weeklyHoursFromInput * 0.2, 2);
        const diff = Math.abs(weeklyHoursFromInput - weeklyHoursFromDays);
        
        if (diff > maxDiff) {
          console.warn(`[Settings] Discrepanza tra ore settimanali inserite (${weeklyHoursFromInput}h) e somma disponibilità giornaliera (${weeklyHoursFromDays.toFixed(1)}h). Differenza: ${diff.toFixed(1)}h`);
          // Non blocchiamo il salvataggio, ma avvisiamo l'utente
        }

        // Validazione allenatore
        if (isPremiumUser) {
          // Premium: valida entrambi i campi se compilati
          if (currentHours > 0 && targetHours > 0) {
            if (targetHours <= currentHours) {
              throw new Error("L'obiettivo deve essere maggiore delle ore attuali.");
            }
            if (targetHours - currentHours > 15) {
              throw new Error("L'incremento è troppo grande (max 15h). Sii realistico.");
            }
            
            // Verifica coerenza ore settimanali con quelle suggerite dall'allenatore
            const isCoachActive = currentHours > 0 && targetHours > 0 && targetHours > currentHours;
            if (isCoachActive) {
              // Carica gli esami per calcolare le ore suggerite
              let exams = [];
              try {
                exams = await listExams(user.uid);
              } catch (err) {
                console.error("Errore caricamento esami per validazione:", err);
              }
              
              // Recupera coachStartDate per calcolare le ore suggerite corrette
              const existingCoachStartDate = await getCoachStartDate(profile);
              const suggestedHours = calculateSuggestedWeeklyHours(
                currentHours, 
                targetHours, 
                exams, 
                existingCoachStartDate
              );
              
              // Verifica che le ore settimanali inserite siano coerenti con quelle suggerite
              // Permetti una tolleranza di ±0.5h per arrotondamenti
              const diff = Math.abs(weeklyHours - suggestedHours);
              if (diff > 0.5) {
                throw new Error(
                  `Le ore settimanali (${weeklyHours}h) non corrispondono a quelle suggerite dall'allenatore (${suggestedHours.toFixed(1)}h). ` +
                  `Il campo è stato aggiornato automaticamente.`
                );
              }
            }
          }
        } else {
          // Utente non premium: può inserire solo "ore attuali", forza targetHours a null
          // currentHours può essere salvato se inserito
          targetHours = 0;
          
          // Se l'utente non premium ha inserito le ore attuali ma non le ore settimanali,
          // usa le ore attuali come ore settimanali suggerite (solo se weeklyHours è vuoto o 0)
          if (currentHours > 0 && weeklyHours < 1) {
            weeklyHours = currentHours;
            // Aggiorna anche il campo nel form
            const weeklyHoursInput = qs("weekly-hours");
            if (weeklyHoursInput) {
              weeklyHoursInput.value = currentHours.toFixed(1);
            }
          }
          // Nota: se l'utente ha modificato manualmente le ore settimanali, le rispettiamo
          // e non forziamo la sincronizzazione con le ore attuali
        }

        // Recupera coachStartDate se necessario (solo se premium e allenatore attivo)
        let coachStartDateValue = null;
        let finalWeeklyHours = weeklyHours;
        
        if (isPremiumUser && currentHours > 0 && targetHours > 0 && targetHours > currentHours) {
          const existingCoachStartDate = await getCoachStartDate(profile);
          
          // Verifica se currentHours o targetHours sono cambiati rispetto al profilo salvato
          const hasCurrentHoursChanged = profile?.currentHours !== currentHours;
          const hasTargetHoursChanged = profile?.targetHours !== targetHours;
          
          // Se le ore attuali o l'obiettivo sono cambiati, resetta la data di inizio
          // per far ripartire la progressione da capo
          if (hasCurrentHoursChanged || hasTargetHoursChanged) {
            // Resetta la data di inizio per far ripartire la progressione
            coachStartDateValue = getCurrentDate().toISOString();
            // Rimuovi anche dal localStorage se presente
            try {
              localStorage.removeItem('coach_start_date');
            } catch {}
          } else if (existingCoachStartDate) {
            // Se non sono cambiati, mantieni la data esistente
            coachStartDateValue = existingCoachStartDate.toISOString();
          } else {
            // Se non esiste, usa la data corrente
            coachStartDateValue = getCurrentDate().toISOString();
          }
          
          // Se l'allenatore è attivo, calcola e salva le ore progressive corrette
          const isCoachActive = currentHours > 0 && targetHours > 0 && targetHours > currentHours;
          if (isCoachActive) {
            // Carica gli esami per calcolare le ore suggerite
            let exams = [];
            try {
              exams = await listExams(user.uid);
            } catch (err) {
              console.error("Errore caricamento esami per calcolo ore progressive:", err);
            }
            
            // Calcola le ore progressive corrette
            const coachStartDateForCalc = coachStartDateValue ? new Date(coachStartDateValue) : null;
            const suggestedHours = calculateSuggestedWeeklyHours(
              currentHours, 
              targetHours, 
              exams, 
              coachStartDateForCalc
            );
            
            // Usa le ore progressive calcolate invece di quelle inserite manualmente
            finalWeeklyHours = suggestedHours;
            console.log("[Settings] Allenatore attivo: salvo ore progressive", {
              currentHours,
              targetHours,
              suggestedHours,
              weeklyHoursInput: weeklyHours
            });
          }
        }
        
        await setProfile(user.uid, { 
          goalMode, 
          weeklyHours: finalWeeklyHours, 
          taskMinutes, 
          dayMinutes,
          // Permetti a tutti (premium e non premium) di salvare currentHours se inserito
          currentHours: currentHours > 0 ? currentHours : null,
          // Solo premium può salvare targetHours
          targetHours: isPremiumUser && targetHours > 0 ? targetHours : null,
          coachStartDate: coachStartDateValue
        });
        
        // Invalida il piano per forzare la rigenerazione automatica
        await invalidateWeeklyPlan(user.uid);
        
        // Ricarica il profilo aggiornato per aggiornare la visualizzazione dell'allenatore
        const updatedProfile = await getProfile(user.uid);
        
        // Se l'utente è premium e l'allenatore è attivo, aggiorna le ore settimanali suggerite
        if (isPremiumUser && updatedProfile?.currentHours > 0 && updatedProfile?.targetHours > 0 && 
            updatedProfile.targetHours > updatedProfile.currentHours) {
          const weeklyHoursInput = qs("weekly-hours");
          if (weeklyHoursInput) {
            // Carica gli esami per calcolare le ore suggerite
            let exams = [];
            try {
              exams = await listExams(user.uid);
            } catch (err) {
              console.error("Errore caricamento esami:", err);
            }
            
            // Calcola le ore suggerite con la nuova coachStartDate
            const coachStartDateValue = updatedProfile.coachStartDate ? new Date(updatedProfile.coachStartDate) : null;
            const suggestedHours = calculateSuggestedWeeklyHours(
              updatedProfile.currentHours, 
              updatedProfile.targetHours, 
              exams, 
              coachStartDateValue
            );
            
            // Aggiorna il campo con le ore suggerite
            weeklyHoursInput.value = suggestedHours.toFixed(1);
            
            // Aggiorna anche la visualizzazione dell'allenatore
            updateCoachDisplay(updatedProfile, true, exams);
          }
        }
        
        if (savedEl) {
          setText(savedEl, "Impostazioni salvate con successo!");
        } else {
          showToast("Impostazioni salvate con successo!");
        }
        
        console.log("[Settings] Profilo salvato:", { goalMode, weeklyHours, taskMinutes, dayMinutes });
      } catch (err) {
        console.error(err);
        if (errorEl) {
          setText(errorEl, err?.message ?? "Errore salvataggio impostazioni");
        } else {
          alert(err?.message ?? "Errore salvataggio impostazioni");
        }
      }
    };

    // Listener per save-profile (onboarding.html)
    qs("save-profile")?.addEventListener("click", handleSaveSettings);
    
    // Listener per save-strategies (strategies.html)
    qs("save-strategies")?.addEventListener("click", handleSaveSettings);

    // Info box dinamica per tipo esame
    const categorySelect = qs("exam-category");
    const categoryInfo = qs("category-info");
    const categoryInfoTitle = qs("category-info-title");
    const categoryInfoDesc = qs("category-info-desc");
    
    const updateCategoryInfo = () => {
      if (!categorySelect || !categoryInfo) return;
      const value = categorySelect.value;
      if (value === "auto") {
        if (categoryInfo) categoryInfo.style.display = "none";
      } else {
        if (categoryInfo) categoryInfo.style.display = "block";
        if (value === "scientific") {
          if (categoryInfoTitle) categoryInfoTitle.textContent = "Scientifico";
          if (categoryInfoDesc) categoryInfoDesc.textContent = "L'algoritmo proporrà teoria ed esercizi, ma NON spaced repetition (non efficace per formule/esercizi).";
        } else if (value === "humanistic") {
          if (categoryInfoTitle) categoryInfoTitle.textContent = "Umanistico";
          if (categoryInfoDesc) categoryInfoDesc.textContent = "L'algoritmo proporrà teoria, ripasso e spaced repetition, ma NON esercizi pratici.";
        } else {
          if (categoryInfoTitle) categoryInfoTitle.textContent = "Misto";
          if (categoryInfoDesc) categoryInfoDesc.textContent = "L'algoritmo proporrà tutti i tipi di task (teoria, esercizi, ripasso, spaced repetition).";
        }
      }
    };
    
    categorySelect?.addEventListener("change", updateCategoryInfo);
    updateCategoryInfo(); // Mostra info iniziale se non è "auto"

    // Inizializza interfaccia argomenti
    initTopicsInterface();
    
    // Inizializza interfaccia appelli
    initAppelliInterface();
    
    // Collega il bottone di simulazione (dopo che uid è disponibile)
    const setupSimulationButton = () => {
      const runSimBtn = document.getElementById("run-simulation");
      if (!runSimBtn) {
        console.warn("[Strategies] Bottone run-simulation non trovato, riprovo...");
        setTimeout(setupSimulationButton, 200);
        return;
      }
      
      // Rimuovi tutti gli event listener precedenti clonando il bottone
      const newBtn = runSimBtn.cloneNode(true);
      if (runSimBtn.parentNode) {
        runSimBtn.parentNode.replaceChild(newBtn, runSimBtn);
      }
      
      // Aggiungi il nuovo listener
      const handleClick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("[Strategies] Click su Esegui Simulazione");
        try {
          await runSimulation(user.uid);
        } catch (error) {
          console.error("[Strategies] Errore nella simulazione:", error);
          alert("Errore durante l'esecuzione della simulazione: " + (error.message || error));
        }
      };
      
      newBtn.addEventListener("click", handleClick);
      newBtn.onclick = handleClick; // Fallback per compatibilità
      
      // Assicurati che il bottone sia cliccabile
      newBtn.style.pointerEvents = "auto";
      newBtn.style.cursor = "pointer";
      newBtn.disabled = false;
      newBtn.type = "button";
      newBtn.removeAttribute("disabled");
      
      console.log("[Strategies] Bottone simulazione collegato:", newBtn);
    };
    
    // Prova subito e poi dopo un breve delay
    setupSimulationButton();
    setTimeout(setupSimulationButton, 300);
    
    // Aggiorna visualizzazione allenatore quando cambiano i valori
    // Nota: currentHoursInput e targetHoursInput sono già dichiarate sopra (riga 3131-3132)
    const weeklyHoursInput = qs("weekly-hours");
    
    const updateCoachOnChange = async () => {
      // Riusa le variabili già dichiarate
      const currentHoursVal = Number(qs("current-hours")?.value || 0);
      const targetHoursVal = Number(qs("target-hours")?.value || 0);
      const profile = {
        currentHours: currentHoursVal,
        targetHours: targetHoursVal,
        weeklyHours: Number(weeklyHoursInput?.value || 0)
      };
      
      // Se l'allenatore è attivo, salva la data di inizio (se non già salvata)
      if (isPremiumUser && profile.currentHours > 0 && profile.targetHours > 0 && profile.targetHours > profile.currentHours) {
        const existingCoachStartDate = await getCoachStartDate(profile);
        if (!existingCoachStartDate) {
          saveCoachStartDate();
        }
      }
      
      // Carica gli esami per calcolare le ore suggerite
      let exams = [];
      try {
        exams = await listExams(user.uid);
      } catch (err) {
        console.error("Errore caricamento esami:", err);
      }
      
      updateCoachDisplay(profile, isPremiumUser, exams);
      
      // Se l'allenatore è attivo, aggiorna sempre weekly-hours con le ore suggerite e disabilita il campo
      const isCoachActive = isPremiumUser && profile.currentHours > 0 && profile.targetHours > 0 && profile.targetHours > profile.currentHours;
      
      if (isCoachActive && weeklyHoursInput) {
        // Disabilita il campo quando l'allenatore è attivo
        weeklyHoursInput.disabled = true;
        weeklyHoursInput.style.opacity = "0.7";
        weeklyHoursInput.style.cursor = "not-allowed";
        weeklyHoursInput.title = "Valore suggerito dall'allenatore di studio (non modificabile)";
        
        // Aggiungi un indicatore visivo che è suggerito
        const label = weeklyHoursInput.closest(".formRow")?.querySelector("label");
        if (label && !label.querySelector(".coach-suggested-badge")) {
          const badge = document.createElement("span");
          badge.className = "coach-suggested-badge";
          badge.textContent = " (suggerito)";
          badge.style.cssText = "color: rgba(99,102,241,1); font-size: 12px; font-weight: 600; margin-left: 4px;";
          label.appendChild(badge);
        }
        
        // Recupera coachStartDate dal profilo o localStorage
        let coachStartDateValue = null;
        if (profile.coachStartDate) {
          coachStartDateValue = new Date(profile.coachStartDate);
        } else {
          try {
            const saved = localStorage.getItem('coach_start_date');
            if (saved) coachStartDateValue = new Date(saved);
          } catch {}
        }
        
        // Verifica se il profilo è nuovo (prima settimana o coachStartDate non esiste)
        const coachStartDate = await getCoachStartDate(profile);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        let isNewProfile = false;
        if (!coachStartDate) {
          // Profilo nuovo: non c'è ancora una data di inizio
          isNewProfile = true;
        } else {
          // Verifica se siamo nella prima settimana
          const weekStart = new Date(coachStartDate);
          weekStart.setHours(0, 0, 0, 0);
          const weeksSinceStart = Math.floor((now - weekStart) / (7 * 24 * 60 * 60 * 1000));
          isNewProfile = weeksSinceStart === 0;
        }
        
        // Se il profilo è nuovo e previsto dalla strategia, usa le ore attuali
        // Altrimenti usa le ore suggerite dall'allenatore
        let hoursToUse;
        if (isNewProfile) {
          // Profilo nuovo: usa le ore attuali
          hoursToUse = profile.currentHours;
        } else {
          // Profilo esistente: usa le ore suggerite dall'allenatore
          hoursToUse = calculateSuggestedWeeklyHours(profile.currentHours, profile.targetHours, exams, coachStartDateValue);
        }
        
        weeklyHoursInput.value = hoursToUse.toFixed(1);
        
        // Aggiungi indicatore di progressione (usa coachStartDateValue anche se isNewProfile)
        updateWeeklyHoursProgressionIndicator(weeklyHoursInput, profile, exams, coachStartDateValue);
      } else if (weeklyHoursInput) {
        // Se l'allenatore non è attivo, abilita il campo
        weeklyHoursInput.disabled = false;
        weeklyHoursInput.style.opacity = "1";
        weeklyHoursInput.style.cursor = "text";
        weeklyHoursInput.title = "";
        
        // Rimuovi il badge se presente
        const label = weeklyHoursInput.closest(".formRow")?.querySelector("label");
        const badge = label?.querySelector(".coach-suggested-badge");
        if (badge) badge.remove();
        
        // Rimuovi indicatore di progressione se presente
        removeWeeklyHoursProgressionIndicator(weeklyHoursInput);
      }
    };
    
    // Aggiungi event listener solo se premium
    if (isPremiumUser) {
      currentHoursInput?.addEventListener("input", updateCoachOnChange);
      targetHoursInput?.addEventListener("input", updateCoachOnChange);
    }

    qs("add-exam")?.addEventListener("click", async (e) => {
      e.preventDefault();
      setText(qs("exam-error"), "");

      try {
        const name = (qs("exam-name").value || "").trim();
        const cfu = Number(qs("exam-cfu").value || 0);
        const appelli = getAppelliFromForm();
        const level = Number(qs("exam-level").value || 0);
        const difficulty = Number(qs("exam-diff").value || 2);
        const category = (qs("exam-category")?.value || "auto").trim();
        const topics = getTopicsArray("exam");

        if (!name) throw new Error("Nome esame mancante.");
        if (appelli.length === 0) throw new Error("Aggiungi almeno un appello o esonero.");
        
        // Controllo se ci sono appelli con la stessa data
        const dates = appelli.map(appello => appello.date).filter(date => date); // Filtra date vuote
        const uniqueDates = new Set(dates);
        if (dates.length !== uniqueDates.size) {
          showErrorModal("Non è possibile aggiungere più appelli con la stessa data. Ogni appello deve avere una data diversa.", "Date duplicate");
          return;
        }
        
        // Controllo se qualche appello ha la data odierna
        const hasTodayAppello = appelli.some(appello => isToday(appello.date));
        if (hasTodayAppello) {
          showErrorModal("Non è possibile aggiungere un esame con un appello nella data odierna. Scegli una data futura.", "Data non valida");
          return;
        }
        
        // Controllo se qualche appello ha una data passata
        const hasPastAppello = appelli.some(appello => isPastDate(appello.date));
        if (hasPastAppello) {
          showErrorModal("Non è possibile aggiungere un esame con un appello in una data passata. Scegli una data futura.", "Data non valida");
          return;
        }
        
        if (cfu < 1) throw new Error("CFU non validi.");
        if (cfu > 30) {
          showErrorModal("Il numero di CFU non può superare 30.", "Valore non valido");
          return;
        }
        if (level < 0 || level > 5) {
          showErrorModal("Il livello di preparazione deve essere compreso tra 0 e 5.", "Valore non valido");
          return;
        }

        // Controllo limite esami per versione free
        const canAdd = await canAddExam(user.uid);
        if (!canAdd.allowed) {
          showUpgradeModal();
          throw new Error(canAdd.message);
        }

        // Auto-rileva categoria se non specificata
        let finalCategory = category;
        if (category === "auto") {
          finalCategory = detectExamCategory(name);
        }

        // Leggi distribuzione task se personalizzata (solo se premium)
        const taskDistribution = getTaskDistribution(isPremiumUser);
        
        await addExam(user.uid, { 
          name, 
          cfu, 
          appelli: appelli,
          // Mantieni date per compatibilità (primo appello)
          date: appelli[0]?.date || "",
          level, 
          difficulty,
          category: finalCategory,
          topics: topics,
          // Includi taskDistribution solo se è definito e non null
          ...(taskDistribution ? { taskDistribution } : {})
        });
        
        // Reset form
        qs("exam-name").value = "";
        const appelliContainer = qs("appelli-container");
        if (appelliContainer) {
          appelliContainer.innerHTML = "";
          // Non aggiungere automaticamente un appello - l'utente deve cliccare "Aggiungi appello"
        }
        qs("exam-cfu").value = "6";
        qs("exam-level").value = "0";
        qs("exam-diff").value = "2";
        qs("exam-category").value = "auto";
        resetTopicsList("exam");
        resetTaskDistribution(); // Reset distribuzione task
        
        await refreshExamList(user.uid);
      } catch (err) {
        console.error(err);
        setText(qs("exam-error"), err?.message ?? "Errore aggiunta esame");
      }
    });

    // Setup bottoni esporta e condividi piano (solo in strategies.html)
    // Bottone Esporta PDF temporaneamente disabilitato
    // const exportPdfBtn = qs("export-plan-pdf-btn");
    const sharePlanBtn = qs("share-plan-btn");
    
    if (sharePlanBtn) {
      // Carica piano e dati necessari quando l'utente clicca
      const handleExportOrShare = async (action) => {
        try {
          const profile = await getProfile(user.uid);
          const exams = await listExams(user.uid);
          
          if (!profile?.goalMode || !profile?.dayMinutes) {
            alert("Completa prima le impostazioni del profilo.");
            return;
          }
          
          if (exams.length === 0) {
            alert("Aggiungi almeno un esame per generare il piano.");
            return;
          }
          
          // Genera o carica il piano
          const weekStart = startOfWeekISO(getCurrentDate());
          const weekStartISO = `${weekStart.getFullYear()}-${z2(weekStart.getMonth() + 1)}-${z2(weekStart.getDate())}`;
          
          let plan = await loadWeeklyPlan(user.uid, weekStartISO);
          if (!plan) {
            // Normalizza esami
            const normalizedExams = exams.map(e => ({
              ...e,
              category: e.category || detectExamCategory(e.name || "") || "mixed"
            }));
            plan = generateWeeklyPlan(profile, normalizedExams, weekStart);
          }
          
          // Bottone Esporta PDF temporaneamente disabilitato
          /*
          if (action === 'export') {
            await exportPlanToPDF(plan, exams, profile, weekStartISO);
            showToast("PDF generato con successo!", 2000);
          } else */
          if (action === 'share') {
            await sharePlan(plan, exams, profile, weekStartISO);
          }
        } catch (err) {
          console.error("Errore esportazione/condivisione:", err);
          alert("Errore: " + (err?.message || err));
        }
      };
      
      // Bottone Esporta PDF temporaneamente disabilitato
      /*
      if (exportPdfBtn && !exportPdfBtn.dataset.bound) {
        exportPdfBtn.dataset.bound = "1";
        exportPdfBtn.addEventListener("click", async () => {
          exportPdfBtn.disabled = true;
          exportPdfBtn.textContent = "⏳ Generazione...";
          await handleExportOrShare('export');
          exportPdfBtn.disabled = false;
          exportPdfBtn.textContent = "📄 Esporta PDF";
        });
      }
      */
      
      if (sharePlanBtn && !sharePlanBtn.dataset.bound) {
        sharePlanBtn.dataset.bound = "1";
        sharePlanBtn.addEventListener("click", async () => {
        sharePlanBtn.disabled = true;
        sharePlanBtn.textContent = "Generazione...";
        await handleExportOrShare('share');
        sharePlanBtn.disabled = false;
        sharePlanBtn.textContent = "Condividi piano";
        });
      }
    }

    // Gestore "Vai alla dashboard" (sia da onboarding che da strategies)
    const finishBtn = qs("finish-onboarding");
    const goToDashboardBtn = qs("go-to-dashboard");
    
    const handleGoToDashboard = async () => {
      try {
        // Leggi i valori attuali dal form (potrebbero non essere salvati)
        const currentGoalMode = qs("goal-mode")?.value;
        const currentWeeklyHours = Number(qs("weekly-hours")?.value || 0);
        const currentTaskMinutes = Number(qs("task-minutes")?.value || 35);
        const currentDayMinutes = readDayInputs();
        const currentCurrentHours = Number(qs("current-hours")?.value || 0);
        const currentTargetHours = Number(qs("target-hours")?.value || 0);
        
        // Ricarica i dati freschi da Firestore
        await new Promise(resolve => setTimeout(resolve, 300));
        let profile2 = await getProfile(user.uid);
        let exams2 = await listExams(user.uid);
        
        if (exams2.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 300));
          exams2 = await listExams(user.uid);
        }

        // Verifica validità
        if (!currentGoalMode || !currentDayMinutes || Object.values(currentDayMinutes).every(v => !v)) {
          const errorEl = qs("profile-error") || qs("exam-error");
          if (errorEl) {
            setText(errorEl, "Salva prima le impostazioni del profilo (impegno, ore settimanali, disponibilità).");
          } else {
            alert("Salva prima le impostazioni del profilo prima di andare alla dashboard.");
          }
          return;
        }
        if (exams2.length === 0) {
          const errorEl = qs("exam-error") || qs("profile-error");
          if (errorEl) {
            setText(errorEl, "Aggiungi almeno un esame da preparare.");
          } else {
            alert("Aggiungi almeno un esame da preparare prima di andare alla dashboard.");
          }
          return;
        }

        // Mostra popup di riepilogo
        await showStrategySummaryModal({
          goalMode: currentGoalMode,
          weeklyHours: currentWeeklyHours,
          taskMinutes: currentTaskMinutes,
          dayMinutes: currentDayMinutes,
          currentHours: currentCurrentHours,
          targetHours: currentTargetHours,
          exams: exams2,
          profile: profile2
        }, async () => {
          // Callback quando l'utente conferma
          try {
            console.log("[handleGoToDashboard] Callback conferma chiamato");
            
            // Aggiorna il profilo con le ore progressive corrette se l'allenatore è attivo
            if (isPremiumUser && currentCurrentHours > 0 && currentTargetHours > 0 && 
                currentTargetHours > currentCurrentHours) {
              console.log("[handleGoToDashboard] Aggiornamento ore progressive per premium user");
              
              // Carica gli esami per calcolare le ore suggerite
              let exams = [];
              try {
                console.log("[handleGoToDashboard] Caricamento esami...");
                exams = await listExams(user.uid);
                console.log("[handleGoToDashboard] Esami caricati:", exams.length);
              } catch (err) {
                console.error("[handleGoToDashboard] Errore caricamento esami:", err);
              }
              
              // Recupera coachStartDate
              let coachStartDateValue = null;
              if (profile2?.coachStartDate) {
                coachStartDateValue = new Date(profile2.coachStartDate);
              } else {
                try {
                  const saved = localStorage.getItem('coach_start_date');
                  if (saved) coachStartDateValue = new Date(saved);
                } catch {}
              }
              
              // Se non c'è una data di inizio, creala
              if (!coachStartDateValue) {
                coachStartDateValue = getCurrentDate();
                try {
                  localStorage.setItem('coach_start_date', coachStartDateValue.toISOString());
                } catch {}
              }
              
              // Calcola le ore progressive corrette
              console.log("[handleGoToDashboard] Calcolo ore suggerite...");
              const suggestedHours = calculateSuggestedWeeklyHours(
                currentCurrentHours,
                currentTargetHours,
                exams,
                coachStartDateValue
              );
              console.log("[handleGoToDashboard] Ore suggerite calcolate:", suggestedHours);
              
              // Aggiorna il profilo con le ore progressive corrette
              // Rimuovi subscription dai dati per evitare il blocco di sicurezza
              const { subscription, ...profileWithoutSubscription } = profile2;
              console.log("[handleGoToDashboard] Aggiornamento profilo...");
              await setProfile(user.uid, {
                ...profileWithoutSubscription,
                weeklyHours: suggestedHours,
                currentHours: currentCurrentHours,
                targetHours: currentTargetHours,
                coachStartDate: coachStartDateValue.toISOString()
              });
              console.log("[handleGoToDashboard] Profilo aggiornato");
              
              // Ricarica il profilo aggiornato
              console.log("[handleGoToDashboard] Ricaricamento profilo...");
              profile2 = await getProfile(user.uid);
              console.log("[handleGoToDashboard] Profilo ricaricato");
              
              console.log("[handleGoToDashboard] Profilo aggiornato con ore progressive:", {
                suggestedHours,
                currentHours: currentCurrentHours,
                targetHours: currentTargetHours
              });
            }
            
            // Verifica se ci sono modifiche che richiedono rigenerazione del piano
            console.log("[handleGoToDashboard] Verifica modifiche piano...");
            const weekStart = startOfWeekISO(getCurrentDate());
            const weekStartISO = `${weekStart.getFullYear()}-${z2(weekStart.getMonth() + 1)}-${z2(weekStart.getDate())}`;
            console.log("[handleGoToDashboard] WeekStartISO:", weekStartISO);
            
            console.log("[handleGoToDashboard] Caricamento piano salvato...");
            const savedPlan = await loadWeeklyPlan(user.uid, weekStartISO);
            console.log("[handleGoToDashboard] Piano caricato:", savedPlan ? "presente" : "non presente");
            
            const needsRegeneration = hasPlanChanges(profile2, exams2, savedPlan);
            console.log("[handleGoToDashboard] Necessita rigenerazione:", needsRegeneration);
            
            if (needsRegeneration) {
              console.log("[handleGoToDashboard] Rilevate modifiche, rigenero il piano...");
              const normalizedExams = exams2.map(e => ({
                ...e,
                category: e.category || detectExamCategory(e.name || "") || "mixed"
              }));
              
              console.log("[handleGoToDashboard] Generazione nuovo piano...");
              const newPlan = generateWeeklyPlan(profile2, normalizedExams, weekStart);
              console.log("[handleGoToDashboard] Piano generato");
              
              addSnapshotToPlan(newPlan, profile2, normalizedExams);
              console.log("[handleGoToDashboard] Salvataggio piano...");
              await saveWeeklyPlan(user.uid, weekStartISO, newPlan);
              console.log("[handleGoToDashboard] Piano salvato");
            }

            // Vai alla dashboard
            console.log("[handleGoToDashboard] Tutto ok, redirect a app.html");
            window.location.assign("./app.html");
          } catch (err) {
            console.error("[handleGoToDashboard] ERRORE nel callback:", err);
            console.error("[handleGoToDashboard] Stack:", err?.stack);
            console.error("[handleGoToDashboard] Dettagli:", {
              message: err?.message,
              code: err?.code,
              name: err?.name
            });
            
            // Mostra messaggio di errore più specifico
            let errorMsg = "Errore durante la verifica. Riprova.";
            if (err?.message) {
              errorMsg = `Errore: ${err.message}`;
            } else if (err?.code) {
              errorMsg = `Errore (${err.code}). Riprova.`;
            }
            alert(errorMsg);
          }
        });
      } catch (err) {
        console.error("Errore verifica dashboard:", err);
        alert("Errore durante la verifica. Riprova.");
      }
    };

    if (finishBtn) {
      finishBtn.addEventListener("click", handleGoToDashboard);
    }
    if (goToDashboardBtn) {
      goToDashboardBtn.addEventListener("click", handleGoToDashboard);
    }
  });
}

// ----------------- Allenatore di Studio -----------------
function calculateSuggestedWeeklyHours(currentHours, targetHours, exams = [], coachStartDate = null) {
  // Calcola le ore suggerite per questa settimana in base alla progressione
  if (!currentHours || !targetHours || targetHours <= currentHours) {
    return currentHours || targetHours || 0;
  }
  
  // Trova l'esame più vicino per calcolare quante settimane abbiamo
  // Usa getCurrentDate() per supportare date virtuali in localhost
  const now = getCurrentDate();
  now.setHours(0, 0, 0, 0);
  
  // Usa la data di inizio del piano come riferimento (se disponibile)
  // Altrimenti usa oggi come settimana 0
  let weekStart;
  if (coachStartDate) {
    weekStart = new Date(coachStartDate);
    weekStart.setHours(0, 0, 0, 0);
  } else {
    weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
  }
  
  // Calcola quale settimana siamo (0 = prima settimana)
  const weeksSinceStart = Math.floor((now - weekStart) / (7 * 24 * 60 * 60 * 1000));
  const currentWeek = Math.max(0, weeksSinceStart);
  
  // Trova l'esame più vicino per calcolare quante settimane totali abbiamo
  let minWeeksToExam = Infinity;
  for (const exam of exams) {
    if (!exam.date) continue;
    const examDate = new Date(exam.date);
    examDate.setHours(0, 0, 0, 0);
    const weeksToExam = Math.ceil((examDate - weekStart) / (7 * 24 * 60 * 60 * 1000));
    if (weeksToExam > 0 && weeksToExam < minWeeksToExam) {
      minWeeksToExam = weeksToExam;
    }
  }
  
  // Se non ci sono esami o sono troppo lontani, usa un default di 8 settimane
  const totalWeeks = minWeeksToExam === Infinity ? 8 : Math.min(minWeeksToExam, 12);
  
  // Calcola incremento settimanale
  // Usa totalWeeks come numero di settimane per la progressione
  // La prima settimana (currentWeek = 0) usa currentHours
  // L'ultima settimana (currentWeek = totalWeeks - 1) dovrebbe raggiungere targetHours
  const totalIncrease = targetHours - currentHours;
  const incrementPerWeek = totalIncrease / Math.max(1, totalWeeks);
  
  // Calcola ore per questa settimana (progressivo)
  // currentWeek va da 0 a totalWeeks-1
  // Se currentWeek = 0: hoursThisWeek = currentHours
  // Se currentWeek = totalWeeks-1: hoursThisWeek ≈ targetHours
  const hoursThisWeek = currentHours + (incrementPerWeek * currentWeek);
  
  // Assicurati che il risultato sia almeno currentHours e non superi targetHours
  const result = Math.max(currentHours, Math.min(hoursThisWeek, targetHours));
  
  // Debug log per verificare il calcolo
  console.log('[Coach] Calcolo ore suggerite:', {
    currentHours,
    targetHours,
    coachStartDate: coachStartDate ? new Date(coachStartDate).toISOString() : 'null',
    weekStart: weekStart.toISOString(),
    now: now.toISOString(),
    weeksSinceStart,
    currentWeek,
    totalWeeks,
    incrementPerWeek: incrementPerWeek.toFixed(2),
    hoursThisWeek: hoursThisWeek.toFixed(2),
    result: result.toFixed(2)
  });
  
  return result;
}

// Ottiene la data di inizio dell'allenatore (salvata nel profilo o localStorage)
async function getCoachStartDate(profile = null) {
  // Prima prova dal profilo (priorità)
  if (profile?.coachStartDate) {
    try {
      return new Date(profile.coachStartDate);
    } catch {}
  }
  
  // Fallback: localStorage
  try {
    const saved = localStorage.getItem('coach_start_date');
    if (saved) return new Date(saved);
  } catch {}
  return null; // Se non c'è, usa oggi come riferimento
}

// Salva la data di inizio dell'allenatore
function saveCoachStartDate() {
  try {
    localStorage.setItem('coach_start_date', new Date().toISOString());
  } catch {}
}

function calculateProgressionWeeks(currentHours, targetHours) {
  // Calcola quante settimane servono per raggiungere l'obiettivo
  // Incremento consigliato: 1-2h a settimana
  const incrementPerWeek = 1.5; // Incremento medio settimanale
  const totalIncrease = targetHours - currentHours;
  return Math.ceil(totalIncrease / incrementPerWeek);
}

// Aggiorna l'indicatore di progressione delle ore settimanali nella pagina strategie
function updateWeeklyHoursProgressionIndicator(weeklyHoursInput, profile, exams = [], coachStartDateValue = null) {
  if (!weeklyHoursInput || !profile || !profile.currentHours || !profile.targetHours || profile.targetHours <= profile.currentHours) {
    return;
  }
  
  // Rimuovi indicatore esistente se presente
  removeWeeklyHoursProgressionIndicator(weeklyHoursInput);
  
  // Calcola informazioni sulla progressione
  // Usa getCurrentDate() per supportare date virtuali in localhost
  const now = getCurrentDate();
  now.setHours(0, 0, 0, 0);
  let weekStart;
  if (coachStartDateValue) {
    weekStart = new Date(coachStartDateValue);
    weekStart.setHours(0, 0, 0, 0);
  } else {
    weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
  }
  
  const weeksSinceStart = Math.floor((now - weekStart) / (7 * 24 * 60 * 60 * 1000));
  const currentWeek = Math.max(0, weeksSinceStart);
  
  // Trova l'esame più vicino per calcolare quante settimane totali abbiamo
  let minWeeksToExam = Infinity;
  for (const exam of exams) {
    if (!exam.date) continue;
    const examDate = new Date(exam.date);
    examDate.setHours(0, 0, 0, 0);
    const weeksToExam = Math.ceil((examDate - weekStart) / (7 * 24 * 60 * 60 * 1000));
    if (weeksToExam > 0 && weeksToExam < minWeeksToExam) {
      minWeeksToExam = weeksToExam;
    }
  }
  const totalWeeks = minWeeksToExam === Infinity ? 8 : Math.min(minWeeksToExam, 12);
  
  const suggestedHours = calculateSuggestedWeeklyHours(profile.currentHours, profile.targetHours, exams, coachStartDateValue);
  const progressPct = Math.round(((suggestedHours - profile.currentHours) / (profile.targetHours - profile.currentHours)) * 100);
  
  // Crea l'indicatore
  const indicator = document.createElement("div");
  indicator.className = "weekly-hours-progression-indicator";
  indicator.style.cssText = `
    margin-top: 16px;
    padding: 16px;
    background: rgba(99, 102, 241, 0.1);
    border: 1px solid rgba(99, 102, 241, 0.3);
    border-radius: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
    line-height: 1.5;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;
  
  indicator.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <strong style="color: rgba(99, 102, 241, 1); font-size: 13px;">Progressione allenatore</strong>
      <span style="color: rgba(255, 255, 255, 0.9); font-weight: 600; font-size: 13px;">Settimana ${currentWeek + 1}/${totalWeeks}</span>
    </div>
    <div style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-bottom: 8px;">
      Ore attuali: <strong>${profile.currentHours.toFixed(1)}h</strong> → 
      Questa settimana: <strong style="color: rgba(99, 102, 241, 1);">${suggestedHours.toFixed(1)}h</strong> → 
      Obiettivo: <strong>${profile.targetHours.toFixed(1)}h</strong>
    </div>
    <div style="margin-top: 8px;">
      <div style="background: rgba(255, 255, 255, 0.1); border-radius: 4px; height: 8px; overflow: hidden;">
        <div style="background: rgba(99, 102, 241, 1); height: 100%; width: ${progressPct}%; transition: width 0.3s ease;"></div>
      </div>
      <div style="margin-top: 6px; font-size: 11px; color: rgba(255, 255, 255, 0.6);">
        Progresso: ${progressPct}% verso l'obiettivo
      </div>
    </div>
  `;
  
  // Inserisci l'indicatore dopo la formSection per renderla più larga
  const formSection = weeklyHoursInput.closest(".formSection");
  if (formSection) {
    // Rimuovi l'indicatore esistente se presente (potrebbe essere in un formRow)
    const existingIndicator = formSection.querySelector(".weekly-hours-progression-indicator");
    if (existingIndicator) {
      existingIndicator.remove();
    }
    // Inserisci dopo la formSection
    formSection.parentNode.insertBefore(indicator, formSection.nextSibling);
  } else {
    // Fallback: inserisci dopo il formRow se non troviamo la formSection
    const formRow = weeklyHoursInput.closest(".formRow");
    if (formRow) {
      formRow.appendChild(indicator);
    }
  }
}

// Rimuove l'indicatore di progressione delle ore settimanali
function removeWeeklyHoursProgressionIndicator(weeklyHoursInput) {
  if (!weeklyHoursInput) return;
  
  // Cerca nella formSection (dove viene inserito ora)
  const formSection = weeklyHoursInput.closest(".formSection");
  if (formSection) {
    // Cerca dopo la formSection
    let nextSibling = formSection.nextSibling;
    while (nextSibling) {
      if (nextSibling.classList && nextSibling.classList.contains("weekly-hours-progression-indicator")) {
        nextSibling.remove();
        return;
      }
      nextSibling = nextSibling.nextSibling;
    }
    // Cerca anche dentro la formSection (fallback per vecchie versioni)
    const indicator = formSection.querySelector(".weekly-hours-progression-indicator");
    if (indicator) {
      indicator.remove();
    }
  } else {
    // Fallback: cerca nel formRow
    const formRow = weeklyHoursInput.closest(".formRow");
    if (formRow) {
      const indicator = formRow.querySelector(".weekly-hours-progression-indicator");
      if (indicator) {
        indicator.remove();
      }
    }
  }
}

function updateCoachDisplay(profile, isPremium = true, exams = []) {
  // Se non è premium, non mostrare nulla
  if (!isPremium) {
    const coachProgress = qs("coach-progress");
    if (coachProgress) coachProgress.style.display = "none";
    return;
  }
  
  const progressContainer = qs("coach-progress");
  const progressFill = qs("coach-progress-fill");
  const currentText = qs("coach-current-text");
  const targetText = qs("coach-target-text");
  const coachInfo = qs("coach-info");
  
  if (!progressContainer || !progressFill || !currentText || !targetText || !coachInfo) return;
  
  const current = profile?.currentHours || 0;
  const target = profile?.targetHours || 0;
  
  if (current > 0 && target > 0 && target > current) {
    progressContainer.style.display = "block";
    
    // Calcola percentuale di progresso (da current a target)
    const progress = Math.min((current / target) * 100, 100);
    progressFill.style.width = `${progress}%`;
    
    currentText.textContent = `${current.toFixed(1)}h attuali`;
    targetText.textContent = `Obiettivo: ${target.toFixed(1)}h`;
    
    // Recupera coachStartDate dal profilo se disponibile
    const coachStartDateValue = profile?.coachStartDate ? new Date(profile.coachStartDate) : null;
    const suggested = calculateSuggestedWeeklyHours(current, target, exams, coachStartDateValue);
    
    // Calcola totalWeeks nello stesso modo di calculateSuggestedWeeklyHours per coerenza
    // Usa getCurrentDate() per supportare date virtuali in localhost
    const now = getCurrentDate();
    now.setHours(0, 0, 0, 0);
    let weekStart;
    if (coachStartDateValue) {
      weekStart = new Date(coachStartDateValue);
      weekStart.setHours(0, 0, 0, 0);
    } else {
      weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
    }
    
    // Trova l'esame più vicino per calcolare quante settimane totali abbiamo
    let minWeeksToExam = Infinity;
    for (const exam of exams) {
      if (!exam.date) continue;
      const examDate = new Date(exam.date);
      examDate.setHours(0, 0, 0, 0);
      const weeksToExam = Math.ceil((examDate - weekStart) / (7 * 24 * 60 * 60 * 1000));
      if (weeksToExam > 0 && weeksToExam < minWeeksToExam) {
        minWeeksToExam = weeksToExam;
      }
    }
    // Se non ci sono esami o sono troppo lontani, usa un default di 8 settimane
    const totalWeeks = minWeeksToExam === Infinity ? 8 : Math.min(minWeeksToExam, 12);
    
    coachInfo.innerHTML = `
      <div style="font-size:12px; color:rgba(255,255,255,.7); margin-top:8px; line-height:1.5;">
        <strong style="color:rgba(255,255,255,.9);">Piano progressivo:</strong><br>
        Questa settimana: <strong>${suggested.toFixed(1)}h</strong> suggerite<br>
        Tempo stimato per raggiungere l'obiettivo: <strong>${totalWeeks} settimane</strong>
      </div>
    `;
  } else {
    progressContainer.style.display = "none";
  }
}

// ----------------- Auto-rilevamento categoria esame -----------------
function detectExamCategory(examName) {
  const name = (examName || "").toLowerCase();
  
  // Parole chiave scientifiche
  const scientificKeywords = [
    "matematica", "analisi", "algebra", "geometria", "calcolo", "statistica",
    "fisica", "meccanica", "elettromagnetismo", "termodinamica", "quantistica",
    "chimica", "organica", "inorganica", "fisica",
    "informatica", "programmazione", "algoritmi", "database", "software",
    "ingegneria", "elettronica", "meccanica", "civile", "aerospaziale",
    "biologia", "anatomia", "fisiologia", "genetica",
    "economia quantitativa", "econometria", "finanza matematica"
  ];
  
  // Parole chiave umanistiche
  const humanisticKeywords = [
    "lettere", "letteratura", "storia", "filosofia", "storia dell'arte",
    "lingua", "linguistica", "filologia", "critica letteraria",
    "antropologia", "sociologia", "psicologia sociale",
    "diritto", "giurisprudenza", "storia del diritto",
    "pedagogia", "scienze dell'educazione"
  ];
  
  // Controlla match
  for (const keyword of scientificKeywords) {
    if (name.includes(keyword)) return "scientific";
  }
  
  for (const keyword of humanisticKeywords) {
    if (name.includes(keyword)) return "humanistic";
  }
  
  // Default: misto se non si riesce a determinare
  return "mixed";
}

/**
 * Legge la distribuzione task dalla modale di modifica
 */
function getTaskDistributionFromModal(isPremiumUser = true) {
  // Se non premium, restituisci null
  if (!isPremiumUser) {
    return null;
  }
  
  const container = document.getElementById("ee-task-distribution-container");
  if (!container || container.style.display === "none") {
    return null;
  }
  
  const types = ["theory", "practice", "exam", "review", "spaced"];
  const values = {};
  let total = 0;
  
  types.forEach(type => {
    const slider = document.getElementById(`ee-task-dist-${type}`);
    if (slider) {
      values[type] = Number(slider.value || 0);
      total += values[type];
    }
  });
  
  if (total === 0) return null;
  
  // Normalizza
  const normalized = {};
  types.forEach(type => {
    normalized[type] = Math.round((values[type] / total) * 100);
  });
  
  return normalized;
}

/**
 * Aggiorna il display nella modale
 */
function updateTaskDistributionDisplayInModal() {
  const types = ["theory", "practice", "exam", "review", "spaced"];
  let total = 0;
  
  types.forEach(type => {
    const slider = document.getElementById(`ee-task-dist-${type}`);
    const valueSpan = document.getElementById(`ee-task-dist-${type}-value`);
    if (slider && valueSpan) {
      const value = Number(slider.value || 0);
      valueSpan.textContent = `${value}%`;
      total += value;
    }
  });
  
  const totalSpan = document.getElementById("ee-task-dist-total-value");
  if (totalSpan) {
    totalSpan.textContent = `${total}%`;
    if (total === 100) {
      totalSpan.style.color = "rgba(34,197,94,1)";
    } else if (total > 100) {
      totalSpan.style.color = "rgba(239,68,68,1)";
    } else {
      totalSpan.style.color = "rgba(245,158,11,1)";
    }
  }
}

/**
 * Resetta la distribuzione nella modale
 */
function resetTaskDistributionInModal() {
  const types = ["theory", "practice", "exam", "review", "spaced"];
  types.forEach(type => {
    const slider = document.getElementById(`ee-task-dist-${type}`);
    if (slider) slider.value = 0;
  });
  updateTaskDistributionDisplayInModal();
}

// ----------------- Modale modifica esame -----------------
async function openEditExamModal(uid, exam, onSuccess) {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("exam-edit-modal")) return;
  
  // Verifica se l'utente è premium
  const isPremiumUser = await isPremium(uid);

  // Overlay oscurante
  const overlay = document.createElement("div");
  overlay.id = "exam-edit-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.6)",
    zIndex: "9999",
    padding: "20px",
    overflowY: "auto",
  });

  // Contenitore principale con stile card
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "480px";
  card.style.width = "90%";
  card.style.padding = "20px";
  card.style.maxHeight = "90vh";
  card.style.overflowY = "auto";
  card.style.overflowX = "hidden";

  // Titolo modale
  const title = document.createElement("h3");
  title.textContent = "Modifica esame";
  title.style.marginBottom = "16px";
  title.style.fontSize = "18px";
  card.appendChild(title);

  // Contenitore form
  const form = document.createElement("div");
  form.className = "form";

  // Campo nome
  const nameLabel = document.createElement("label");
  nameLabel.innerHTML = '<span>Nome</span>';
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "ee-name";
  nameInput.value = exam.name || "";
  nameInput.required = true;
  nameLabel.appendChild(nameInput);

  // Campo appelli
  const appelliLabel = document.createElement("label");
  appelliLabel.innerHTML = '<span>Appelli / Esoneri</span>';
  const appelliContainer = document.createElement("div");
  appelliContainer.id = "ee-appelli-container";
  appelliContainer.className = "appelliContainer";
  
  // Popola con appelli esistenti o crea uno vuoto
  const examAppelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true, primary: true }] : []);
  
  // Determina quale appello è primario (se nessuno è marcato, usa il primo o quello più prossimo)
  let hasPrimary = examAppelli.some(a => a.primary === true);
  if (!hasPrimary && examAppelli.length > 0) {
    // Se nessuno è primario, marca il più prossimo come primario
    const sortedByDate = [...examAppelli].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateA - dateB;
    });
    sortedByDate[0].primary = true;
  }
  
  if (examAppelli.length === 0) {
    const item = document.createElement("div");
    item.className = "appelloItem";
    item.innerHTML = `
      <div class="appelloInputRow">
        <div class="appelloDateWrapper">
          <label class="appelloDateLabel" for="ee-appello-date-0">Data</label>
          <input type="date" id="ee-appello-date-0" class="appelloDate" />
        </div>
        <div class="appelloPrimaryContainer">
          <label class="appelloPrimaryLabel" for="ee-appello-primary-0">Appello principale</label>
          <input type="radio" name="ee-primary-appello" value="0" id="ee-appello-primary-0" class="primary-appello-radio" checked style="cursor: pointer;" />
        </div>
        <button type="button" class="btn tiny remove-appello" style="display:none; align-self:flex-end; margin-bottom:24px;">Rimuovi</button>
      </div>
    `;
    appelliContainer.appendChild(item);
  } else {
    examAppelli.forEach((appello, idx) => {
      const item = document.createElement("div");
      item.className = "appelloItem";
      item.innerHTML = `
        <div class="appelloInputRow">
          <div class="appelloDateWrapper">
            <label class="appelloDateLabel" for="ee-appello-date-${idx}">Data</label>
            <input type="date" id="ee-appello-date-${idx}" class="appelloDate" value="${appello.date || ""}" />
          </div>
          <div class="appelloPrimaryContainer">
            <label class="appelloPrimaryLabel" for="ee-appello-primary-${idx}">Appello principale</label>
            <input type="radio" name="ee-primary-appello" value="${idx}" id="ee-appello-primary-${idx}" class="primary-appello-radio" ${appello.primary === true ? 'checked' : ''} style="cursor: pointer;" />
          </div>
          <button type="button" class="btn tiny remove-appello" style="align-self:flex-end; margin-bottom:24px;">Rimuovi</button>
        </div>
      `;
      appelliContainer.appendChild(item);
    });
  }
  
  // Aggiorna la visibilità dei bottoni rimuovi dopo aver popolato gli appelli
  updateRemoveButtons(appelliContainer);
  
  const addAppelloBtn = document.createElement("button");
  addAppelloBtn.type = "button";
  addAppelloBtn.className = "btn tiny";
  addAppelloBtn.textContent = "+ Aggiungi appello";
  addAppelloBtn.style.marginTop = "8px";
  addAppelloBtn.addEventListener("click", () => {
    const index = appelliContainer.children.length;
    const item = document.createElement("div");
    item.className = "appelloItem";
    item.innerHTML = `
      <div class="appelloInputRow">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
          <label class="appelloDateLabel" for="ee-appello-date-${index}">Data</label>
          <input type="date" id="ee-appello-date-${index}" class="appelloDate" />
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; align-items: center; margin-right: 8px;">
          <label style="font-size: 11px; color: rgba(255,255,255,0.7); white-space: nowrap;">Appello principale</label>
          <input type="radio" name="ee-primary-appello" value="${index}" class="primary-appello-radio" style="cursor: pointer;" />
        </div>
        <button type="button" class="btn tiny remove-appello" style="align-self:flex-end; margin-bottom:24px;">Rimuovi</button>
      </div>
    `;
    appelliContainer.appendChild(item);
    updateRemoveButtons(appelliContainer);
  });
  
  // Gestisci rimozione
  appelliContainer.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-appello")) {
      const item = e.target.closest(".appelloItem");
      if (item && appelliContainer.children.length > 1) {
        const removedRadio = item.querySelector('input[name="ee-primary-appello"]');
        const wasPrimary = removedRadio && removedRadio.checked;
        
        item.remove();
        updateRemoveButtons(appelliContainer);
        
        // Se è stato rimosso l'appello primario, seleziona il primo rimanente
        if (wasPrimary) {
          const firstRemainingRadio = appelliContainer.querySelector('input[name="ee-primary-appello"]');
          if (firstRemainingRadio) {
            firstRemainingRadio.checked = true;
          }
        }
      }
    }
  });
  
  appelliLabel.appendChild(appelliContainer);
  appelliLabel.appendChild(addAppelloBtn);
  
  // Funzione helper per leggere appelli dalla modale
  const getAppelliFromModal = () => {
    const appelli = [];
    const primaryRadio = appelliContainer.querySelector('input[name="ee-primary-appello"]:checked');
    const primaryIndex = primaryRadio ? parseInt(primaryRadio.value) : 0;
    
    appelliContainer.querySelectorAll(".appelloItem").forEach((item, idx) => {
      const dateInput = item.querySelector(".appelloDate");
      if (dateInput && dateInput.value) {
        appelli.push({
          date: dateInput.value,
          type: "esame", // Sempre esame
          selected: true,
          primary: idx === primaryIndex // Marca come primario se è quello selezionato
        });
      }
    });
    return appelli;
  };

  // Campo CFU
  const cfuLabel = document.createElement("label");
  cfuLabel.innerHTML = '<span>CFU</span>';
  const cfuInput = document.createElement("input");
  cfuInput.type = "number";
  cfuInput.id = "ee-cfu";
  cfuInput.min = "1";
  cfuInput.max = "30";
  cfuInput.value = exam.cfu || 6;
  cfuInput.required = true;
  cfuLabel.appendChild(cfuInput);

  // Campo livello
  const levelLabel = document.createElement("label");
  levelLabel.innerHTML = '<span>Livello (0-5)</span>';
  const levelInput = document.createElement("input");
  levelInput.type = "number";
  levelInput.id = "ee-level";
  levelInput.min = "0";
  levelInput.max = "5";
  levelInput.value = exam.level || 0;
  levelInput.required = true;
  levelLabel.appendChild(levelInput);

  // Campo difficoltà
  const diffLabel = document.createElement("label");
  diffLabel.innerHTML = '<span>Difficoltà</span>';
  const diffSelect = document.createElement("select");
  diffSelect.id = "ee-diff";
  diffSelect.required = true;
  const diffOptions = [
    { value: "1", text: "1 (facile)" },
    { value: "2", text: "2 (media)" },
    { value: "3", text: "3 (difficile)" },
  ];
  diffOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.text;
    if (opt.value === String(exam.difficulty || 2)) option.selected = true;
    diffSelect.appendChild(option);
  });
  diffLabel.appendChild(diffSelect);

  // Campo categoria
  const catLabel = document.createElement("label");
  catLabel.innerHTML = '<span>Tipo esame</span>';
  const catSelect = document.createElement("select");
  catSelect.id = "ee-category";
  catSelect.required = true;
  const catOptions = [
    { value: "auto", text: "Auto-rileva (consigliato)" },
    { value: "scientific", text: "Scientifico" },
    { value: "humanistic", text: "Umanistico" },
    { value: "mixed", text: "Misto" },
  ];
  const examCategory = exam.category || "auto";
  catOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.text;
    if (opt.value === examCategory) option.selected = true;
    catSelect.appendChild(option);
  });
  catLabel.appendChild(catSelect);

  // Campo argomenti principali
  const topicsLabel = document.createElement("label");
  topicsLabel.innerHTML = '<span>Argomenti principali <span style="font-size:11px;color:rgba(255,255,255,.5);">(opzionale)</span></span>';
  
  const topicsContainer = document.createElement("div");
  topicsContainer.className = "topicsInputContainer";
  
  const topicsInputRow = document.createElement("div");
  topicsInputRow.className = "topicsInputRow";
  
  const topicsInput = document.createElement("input");
  topicsInput.id = "ee-topics-input";
  topicsInput.type = "text";
  topicsInput.className = "topicsInput";
  topicsInput.placeholder = "Es: Funzioni, Derivate, Integrali...";
  
  const addTopicBtn = document.createElement("button");
  addTopicBtn.type = "button";
  addTopicBtn.id = "ee-add-topic-btn";
  addTopicBtn.className = "btn tiny";
  addTopicBtn.textContent = "Aggiungi";
  
  topicsInputRow.appendChild(topicsInput);
  topicsInputRow.appendChild(addTopicBtn);
  
  const topicsList = document.createElement("div");
  topicsList.id = "ee-topics-list";
  topicsList.className = "topicsList";
  
  topicsContainer.appendChild(topicsInputRow);
  topicsContainer.appendChild(topicsList);
  topicsLabel.appendChild(topicsContainer);
  
  // Campo distribuzione task (opzionale)
  const taskDistSection = document.createElement("div");
  taskDistSection.style.cssText = "margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); position: relative;";
  
  const taskDistTitle = document.createElement("div");
  taskDistTitle.style.cssText = "margin-bottom: 16px;";
  taskDistTitle.innerHTML = `
    <h3 style="font-size: 16px; margin: 0 0 8px 0;">Distribuzione Task <span style="font-size: 11px; color: rgba(255,255,255,0.5);">(opzionale)</span></h3>
    <p class="meta" style="margin: 0;">Personalizza la percentuale di ogni tipo di attività</p>
  `;
  
  const taskDistContainer = document.createElement("div");
  taskDistContainer.id = "ee-task-distribution-container";
  taskDistContainer.style.display = "none";
  
  const types = [
    { key: "theory", label: "Teoria" },
    { key: "practice", label: "Esercizi" },
    { key: "exam", label: "Prove d'esame" },
    { key: "review", label: "Ripasso" },
    { key: "spaced", label: "Flashcard/Spaced" }
  ];
  
  types.forEach(type => {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 12px;";
    row.innerHTML = `
      <label style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 4px;">
        <span style="font-size: 13px; color: rgba(255,255,255,0.9);">${type.label}</span>
        <span id="ee-task-dist-${type.key}-value" style="font-size: 13px; font-weight: 600; color: rgba(99,102,241,1); min-width: 40px; text-align: right;">0%</span>
      </label>
      <input type="range" id="ee-task-dist-${type.key}" min="0" max="100" value="0" step="5" style="width: 100%;" />
    `;
    taskDistContainer.appendChild(row);
  });
  
  const taskDistTotal = document.createElement("div");
  taskDistTotal.style.cssText = "margin-top: 12px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; font-size: 12px; text-align: center;";
  taskDistTotal.innerHTML = `
    <span style="color: rgba(255,255,255,0.7);">Totale: </span>
    <span id="ee-task-dist-total-value" style="font-weight: 600; color: rgba(255,255,255,0.9);">0%</span>
  `;
  taskDistContainer.appendChild(taskDistTotal);
  
  const taskDistResetBtn = document.createElement("button");
  taskDistResetBtn.type = "button";
  taskDistResetBtn.className = "btn tiny";
  taskDistResetBtn.textContent = "Usa distribuzione automatica";
  taskDistResetBtn.style.cssText = "width: 100%; margin-top: 12px;";
  taskDistContainer.appendChild(taskDistResetBtn);
  
  const taskDistToggleBtn = document.createElement("button");
  taskDistToggleBtn.type = "button";
  taskDistToggleBtn.className = "btn tiny";
  taskDistToggleBtn.textContent = "Personalizza distribuzione task";
  taskDistToggleBtn.style.cssText = "width: 100%; margin-top: 12px;";
  
  taskDistSection.appendChild(taskDistTitle);
  taskDistSection.appendChild(taskDistContainer);
  taskDistSection.appendChild(taskDistToggleBtn);
  
  // Controllo premium per distribuzione task
  if (!isPremiumUser) {
    // Assicurati che la sezione abbia position relative per contenere l'overlay
    taskDistSection.style.position = "relative";
    
    taskDistToggleBtn.disabled = true;
    taskDistToggleBtn.style.opacity = "0.5";
    taskDistToggleBtn.style.cursor = "not-allowed";
    taskDistContainer.style.display = "none";
    
    // Aggiungi overlay premium sulla sezione distribuzione task DOPO che tutti gli elementi sono stati aggiunti
    // Usa setTimeout per assicurarsi che il DOM sia completamente renderizzato
    setTimeout(() => {
      // Rimuovi overlay esistente se presente
      const existingOverlay = taskDistSection.querySelector(".premium-overlay-modal");
      if (existingOverlay) {
        existingOverlay.remove();
      }
      
      const overlay = document.createElement("div");
      overlay.className = "premium-overlay-modal";
      overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        min-height: 100%;
        background: rgba(10, 12, 20, 0.85);
        backdrop-filter: blur(4px);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
        z-index: 1000;
        cursor: pointer;
        box-sizing: border-box;
        pointer-events: auto;
      `;
      overlay.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 24px; margin-bottom: 8px;">⭐</div>
          <div style="font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.95); margin-bottom: 6px;">
            Funzionalità Premium
          </div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.7); line-height: 1.4;">
            Personalizzazione distribuzione task disponibile solo per Premium
          </div>
        </div>
      `;
      
      overlay.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        showUpgradeModal();
      });
      
      // Inserisci l'overlay come ultimo figlio della sezione per assicurarsi che copra tutto
      taskDistSection.appendChild(overlay);
    }, 0);
    
    taskDistToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showUpgradeModal();
    });
    
    // Utente non premium: disabilita anche gli slider
    types.forEach(type => {
      const slider = document.getElementById(`ee-task-dist-${type.key}`);
      if (slider) {
        slider.disabled = true;
        slider.style.opacity = "0.5";
        slider.style.cursor = "not-allowed";
      }
    });
    
    if (taskDistResetBtn) {
      taskDistResetBtn.disabled = true;
      taskDistResetBtn.style.opacity = "0.5";
      taskDistResetBtn.style.cursor = "not-allowed";
    }
  } else {
    // Funzione helper per aggiungere i listener agli slider
    const attachSliderListeners = () => {
      types.forEach(type => {
        const slider = document.getElementById(`ee-task-dist-${type.key}`);
        if (slider) {
          // Salva il valore corrente prima di clonare
          const currentValue = slider.value;
          
          slider.disabled = false;
          slider.style.opacity = "1";
          slider.style.cursor = "pointer";
          
          // Rimuovi eventuali listener precedenti clonando l'elemento
          const newSlider = slider.cloneNode(true);
          // Ripristina il valore dopo il clone
          newSlider.value = currentValue;
          
          if (slider.parentNode) {
            slider.parentNode.replaceChild(newSlider, slider);
          }
          
          // Aggiungi il nuovo listener
          newSlider.addEventListener("input", () => {
            updateTaskDistributionDisplayInModal();
          });
          // Aggiungi anche listener per change (per compatibilità)
          newSlider.addEventListener("change", () => {
            updateTaskDistributionDisplayInModal();
          });
        }
      });
    };
    
    // Inizializza distribuzione task nella modale (solo se premium)
    const taskDist = exam.taskDistribution || null;
    
    // Attacca i listener e carica i valori
    // Usa setTimeout per assicurarsi che gli elementi siano completamente nel DOM
    setTimeout(() => {
      // Se c'è una distribuzione salvata, caricala
      if (taskDist) {
        // Carica i valori dagli slider
        types.forEach(type => {
          const slider = document.getElementById(`ee-task-dist-${type.key}`);
          if (slider) {
            slider.value = taskDist[type.key] || 0;
          }
        });
        // Mostra il container e aggiorna il bottone
        taskDistContainer.style.display = "block";
        taskDistToggleBtn.textContent = "Nascondi personalizzazione";
      }
      
      // Attacca i listener
      attachSliderListeners();
      // Aggiorna sempre il display per mostrare i valori corretti
      updateTaskDistributionDisplayInModal();
    }, 50);
    
    // Event listeners per modale (solo se premium) - UNIFICA I DUE HANDLER
    taskDistToggleBtn.addEventListener("click", () => {
      const isVisible = taskDistContainer.style.display !== "none";
      if (isVisible) {
        taskDistContainer.style.display = "none";
        taskDistToggleBtn.textContent = "Personalizza distribuzione task";
        resetTaskDistributionInModal();
      } else {
        taskDistContainer.style.display = "block";
        taskDistToggleBtn.textContent = "Nascondi personalizzazione";
        // Quando si apre, riattacca i listener e aggiorna il display
        // Se c'è una distribuzione salvata, ricarica i valori
        const savedTaskDist = exam.taskDistribution || null;
        if (savedTaskDist) {
          types.forEach(type => {
            const slider = document.getElementById(`ee-task-dist-${type.key}`);
            if (slider) {
              slider.value = savedTaskDist[type.key] || 0;
            }
          });
        }
        setTimeout(() => {
          attachSliderListeners();
          updateTaskDistributionDisplayInModal();
        }, 10);
      }
    });
    
    // Event listener per reset (solo se premium)
    // Aggiungi un flag per tracciare se l'utente ha resettato la distribuzione
    let distributionWasReset = false;
    taskDistResetBtn.addEventListener("click", () => {
      resetTaskDistributionInModal();
      distributionWasReset = true; // Marca che è stato resettato
    });
    
    // Salva il flag nello scope per usarlo nel salvataggio
    window._taskDistributionWasReset = () => distributionWasReset;
    window._clearTaskDistributionReset = () => { distributionWasReset = false; };
  }
  
  // Aggiungi tutti i campi al form
  form.appendChild(nameLabel);
  form.appendChild(appelliLabel);
  form.appendChild(cfuLabel);
  form.appendChild(levelLabel);
  form.appendChild(diffLabel);
  form.appendChild(catLabel);
  form.appendChild(topicsLabel);
  form.appendChild(taskDistSection);
  card.appendChild(form);

  // Azioni (bottoni)
  const btnRow = document.createElement("div");
  btnRow.className = "btnRow";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.type = "button";
  saveBtn.textContent = "Salva";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Annulla";

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  
  // Inizializza l'interfaccia argomenti con i dati esistenti (dopo che è stata aggiunta al DOM)
  setTimeout(() => {
    initEditTopicsInterface(exam.topics);
  }, 0);

  // Funzione per chiudere la modale
  function closeModal() {
    try {
      document.body.removeChild(overlay);
    } catch {}
  }

  // Gestore Annulla
  cancelBtn.addEventListener("click", () => {
    closeModal();
  });

  // Gestore Salva
  saveBtn.addEventListener("click", async () => {
    try {
      const name = nameInput.value.trim();
      const appelli = getAppelliFromModal();
      const cfu = Number(cfuInput.value || 0);
      const level = Number(levelInput.value || 0);
      const difficulty = Number(diffSelect.value || 2);
      const category = (catSelect.value || "auto").trim();
      const topics = getTopicsArray("edit");

      if (!name) throw new Error("Nome esame mancante.");
      if (appelli.length === 0) throw new Error("Aggiungi almeno un appello o esonero.");
      
      // Controllo se ci sono appelli con la stessa data
      const dates = appelli.map(appello => appello.date).filter(date => date); // Filtra date vuote
      const uniqueDates = new Set(dates);
      if (dates.length !== uniqueDates.size) {
        showErrorModal("Non è possibile aggiungere più appelli con la stessa data. Ogni appello deve avere una data diversa.", "Date duplicate");
        return;
      }
      
      // Controllo se qualche appello ha la data odierna
      const hasTodayAppello = appelli.some(appello => isToday(appello.date));
      if (hasTodayAppello) {
        showErrorModal("Non è possibile aggiungere un esame con un appello nella data odierna. Scegli una data futura.", "Data non valida");
        return;
      }
      
      // Controllo se qualche appello ha una data passata
      const hasPastAppello = appelli.some(appello => isPastDate(appello.date));
      if (hasPastAppello) {
        showErrorModal("Non è possibile aggiungere un esame con un appello in una data passata. Scegli una data futura.", "Data non valida");
        return;
      }
      
      if (cfu < 1) throw new Error("CFU non validi.");
      if (cfu > 30) {
        showErrorModal("Il numero di CFU non può superare 30.", "Valore non valido");
        return;
      }
      if (level < 0 || level > 5) {
        showErrorModal("Il livello di preparazione deve essere compreso tra 0 e 5.", "Valore non valido");
        return;
      }

      // Auto-rileva categoria se necessario
      let finalCategory = category;
      if (category === "auto") {
        finalCategory = detectExamCategory(name);
      }

      // Leggi distribuzione task se personalizzata (dalla modale) - solo se premium
      // isPremiumUser è già disponibile nello scope (definito all'inizio della funzione)
      const taskDistribution = getTaskDistributionFromModal(isPremiumUser);
      
      // Se l'utente ha cliccato su "Usa distribuzione automatica", salva null
      // altrimenti usa la distribuzione personalizzata o mantieni quella esistente
      let finalTaskDistribution;
      if (!isPremiumUser) {
        // Utente non premium: non può modificare la distribuzione task
        // Mantieni quella esistente se presente, altrimenti null (distribuzione automatica)
        finalTaskDistribution = exam.taskDistribution || null;
      } else if (window._taskDistributionWasReset && window._taskDistributionWasReset()) {
        // L'utente ha resettato, quindi usa distribuzione automatica (null)
        finalTaskDistribution = null;
        // Pulisci il flag
        if (window._clearTaskDistributionReset) window._clearTaskDistributionReset();
      } else if (taskDistribution) {
        // C'è una distribuzione personalizzata
        finalTaskDistribution = taskDistribution;
      } else {
        // Nessuna distribuzione personalizzata, mantieni quella esistente o null
        finalTaskDistribution = exam.taskDistribution || null;
      }
      
      // Prepara i dati per l'aggiornamento
      // Mantieni date per compatibilità (primo appello)
      const firstAppello = appelli.length > 0 ? appelli[0] : null;
      const updateData = {
        name, 
        cfu, 
        date: firstAppello ? firstAppello.date : null,
        appelli,
        level, 
        difficulty,
        category: finalCategory,
        topics
      };
      
      // Aggiungi taskDistribution solo se non è null (Firestore non accetta undefined)
      // Per utenti non premium: mantieni la distribuzione esistente se presente, altrimenti non includere il campo
      // Per utenti premium: gestisci come prima
      if (!isPremiumUser) {
        // Utente non premium: mantieni la distribuzione esistente se presente
        if (exam.taskDistribution) {
          updateData.taskDistribution = exam.taskDistribution;
        }
        // Se non c'era una distribuzione, semplicemente non includiamo il campo
      } else {
        // Utente premium: gestisci normalmente
        if (finalTaskDistribution !== null) {
          updateData.taskDistribution = finalTaskDistribution;
        } else if (exam.taskDistribution) {
          // Se è null e c'era un valore precedente, rimuovilo usando deleteField
          updateData.taskDistribution = deleteField();
        }
        // Se è null e non c'era un valore precedente, semplicemente non includiamo il campo
      }

      console.log("[EditExam] Salvataggio esame:", {
        uid,
        examId: exam.id,
        isPremiumUser,
        updateData,
        hasTaskDistribution: !!updateData.taskDistribution
      });
      
      await updateExam(uid, exam.id, updateData);
      console.log("[EditExam] Esame salvato con successo");
      closeModal();
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("[EditExam] Errore modifica esame:", err);
      alert("Errore modifica esame: " + (err?.message || err));
    }
  });
}

// ----------------- Edit Personal Info Modal -----------------
function openEditPersonalInfoModal(user, profile, onSuccess) {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("edit-personal-info-modal")) return;

  // Overlay oscurante
  const overlay = document.createElement("div");
  overlay.id = "edit-personal-info-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.75)",
    zIndex: "10000",
    padding: "20px",
  });

  // Contenitore principale con stile card
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "520px";
  card.style.width = "90%";
  card.style.padding = "28px";
  card.style.maxHeight = "90vh";
  card.style.overflowY = "auto";

  // Titolo modale
  const title = document.createElement("h2");
  title.textContent = "Modifica informazioni personali";
  title.style.marginBottom = "8px";
  title.style.fontSize = "24px";
  title.style.fontWeight = "950";
  card.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.textContent = "Aggiorna i tuoi dati personali";
  subtitle.style.marginBottom = "24px";
  subtitle.style.color = "rgba(255,255,255,.72)";
  subtitle.style.fontSize = "14px";
  card.appendChild(subtitle);

  // Contenitore form
  const form = document.createElement("div");
  form.className = "form";
  form.style.gap = "16px";

  // Campo nome
  const nameLabel = document.createElement("label");
  nameLabel.innerHTML = '<span>Nome</span>';
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "epi-name";
  nameInput.value = profile.name || "";
  nameInput.required = true;
  nameInput.autocomplete = "name";
  nameLabel.appendChild(nameInput);

  // Campo facoltà
  const facultyLabel = document.createElement("label");
  facultyLabel.innerHTML = '<span>Facoltà / Corso di studi</span>';
  const facultyInput = document.createElement("input");
  facultyInput.type = "text";
  facultyInput.id = "epi-faculty";
  facultyInput.value = profile.faculty || "";
  facultyInput.required = true;
  facultyInput.autocomplete = "organization";
  facultyLabel.appendChild(facultyInput);

  // Campo età
  const ageLabel = document.createElement("label");
  ageLabel.innerHTML = '<span>Età</span>';
  const ageInput = document.createElement("input");
  ageInput.type = "number";
  ageInput.id = "epi-age";
  ageInput.min = "16";
  ageInput.max = "100";
  ageInput.value = profile.age || "";
  ageInput.required = true;
  ageLabel.appendChild(ageInput);

  // Campo tipo sessione
  const sessionLabel = document.createElement("label");
  sessionLabel.innerHTML = '<span>Stai preparando</span>';
  const sessionSelect = document.createElement("select");
  sessionSelect.id = "epi-session-type";
  sessionSelect.required = true;
  const sessionOptions = [
    { value: "exams", text: "Esami della sessione" },
    { value: "exemptions", text: "Esoneri" },
    { value: "both", text: "Entrambi" },
  ];
  sessionOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.text;
    if (opt.value === (profile.sessionType || "exams")) option.selected = true;
    sessionSelect.appendChild(option);
  });
  sessionLabel.appendChild(sessionSelect);

  // Aggiungi tutti i campi al form
  form.appendChild(nameLabel);
  form.appendChild(facultyLabel);
  form.appendChild(ageLabel);
  form.appendChild(sessionLabel);
  card.appendChild(form);

  // Messaggio di errore
  const errorMsg = document.createElement("p");
  errorMsg.id = "epi-error";
  errorMsg.className = "error";
  errorMsg.style.marginTop = "8px";
  card.appendChild(errorMsg);

  // Azioni (bottoni)
  const btnRow = document.createElement("div");
  btnRow.className = "btnRow";
  btnRow.style.marginTop = "20px";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.type = "button";
  saveBtn.textContent = "Salva modifiche";
  saveBtn.style.width = "100%";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Annulla";
  cancelBtn.style.width = "100%";
  cancelBtn.style.marginTop = "8px";

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Focus sul primo campo
  setTimeout(() => nameInput.focus(), 100);

  // Funzione per chiudere la modale
  function closeModal() {
    try {
      if (overlay.parentNode) {
        document.body.removeChild(overlay);
      }
    } catch {}
  }

  // Gestore Annulla
  cancelBtn.addEventListener("click", () => {
    closeModal();
  });

  // Gestore Salva
  saveBtn.addEventListener("click", async () => {
    try {
      const name = nameInput.value.trim();
      const faculty = facultyInput.value.trim();
      const age = Number(ageInput.value || 0);
      const sessionType = sessionSelect.value;

      if (!name) throw new Error("Nome mancante.");
      if (!faculty) throw new Error("Facoltà mancante.");
      if (!age || age < 16 || age > 100) throw new Error("Età non valida (16-100).");

      // Salva le informazioni personali nel profilo
      await setProfile(user.uid, {
        name,
        faculty,
        age,
        sessionType,
      });

      closeModal();
      if (onSuccess) await onSuccess();
    } catch (err) {
      console.error(err);
      errorMsg.textContent = err?.message ?? "Errore salvataggio informazioni";
    }
  });

  // Chiudi con ESC
  const escHandler = (e) => {
    if (e.key === "Escape" && document.getElementById("edit-personal-info-modal")) {
      closeModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  // Enter per salvare
  [nameInput, facultyInput, ageInput, sessionSelect].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveBtn.click();
      }
    });
  });
}

// ----------------- PROFILE PAGE -----------------
function mountProfile() {
  setupMenu();

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await logout();
    window.location.assign("./index.html");
  });

  watchAuth(async (user) => {
    if (!user) {
      window.location.assign("./index.html");
      return;
    }

    await reload(user);
    if (!user.emailVerified) {
      await logout();
      window.location.assign("./index.html");
      return;
    }

    setText(qs("user-line"), user.email ?? "—");
    await ensureUserDoc(user);

    const profile = await getProfile(user.uid);
    
    // Se mancano informazioni personali, mostra il popup
    if (!profile?.name || !profile?.faculty || !profile?.age) {
      showPersonalInfoModal(user, async () => {
        window.location.reload();
      });
      return;
    }
    
    // Mostra le informazioni personali nell'header
    if (profile.name) {
      const userLine = qs("user-line");
      if (userLine) {
        userLine.textContent = `${profile.name} · ${profile.faculty || ""}`;
      }
    }
    
    // Gestione premium badge e upgrade button
    const subscriptionInfo = await getSubscriptionInfo(user.uid);
    const isPremiumUser = await isPremium(user.uid);
    
    const premiumBadge = qs("premium-badge");
    const upgradeBtn = qs("upgrade-btn");
    
    if (premiumBadge) {
      if (isPremiumUser) {
        premiumBadge.textContent = "Premium";
        premiumBadge.className = "badge good";
        premiumBadge.style.display = "inline-block";
        if (upgradeBtn) upgradeBtn.style.display = "none";
      } else {
        premiumBadge.style.display = "none";
        if (upgradeBtn) {
          upgradeBtn.style.display = "inline-block";
          upgradeBtn.addEventListener("click", () => showUpgradeModal());
        }
      }
    }
    
    // Mostra informazioni personali nella sezione profilo
    const personalInfoDisplay = qs("personal-info-display");
    if (personalInfoDisplay && profile.name) {
      personalInfoDisplay.innerHTML = `
        <div class="personalInfoCard">
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Nome</span>
            <span class="personalInfoValue">${escapeHtml(profile.name)}</span>
          </div>
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Facoltà</span>
            <span class="personalInfoValue">${escapeHtml(profile.faculty || "—")}</span>
          </div>
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Età</span>
            <span class="personalInfoValue">${profile.age || "—"}</span>
          </div>
          ${profile.sessionType ? `
          <div class="personalInfoRow">
            <span class="personalInfoLabel">Preparazione</span>
            <span class="personalInfoValue">${
              profile.sessionType === "exams" ? "Esami sessione" :
              profile.sessionType === "exemptions" ? "Esoneri" :
              profile.sessionType === "both" ? "Esami ed esoneri" : "—"
            }</span>
          </div>
          ` : ""}
        </div>
      `;
    }

    // Carica e mostra esami sostenuti
    await refreshPassedExamsList(user.uid);

    // Calcola e mostra statistiche
    await updateStats(user.uid);

    // Setup bottone condividi statistiche
    setupShareStatsButton(user.uid);

    // Mostra e gestisci abbonamento (renderReferralButton viene chiamato dentro renderSubscription)
    await renderSubscription(user.uid);
    
    // Aggiorna la subscription quando cambia la data virtuale (solo in localhost)
    window.addEventListener("virtualDateChanged", async () => {
      console.log("[Profile] Data virtuale cambiata, aggiorno subscription...");
      await renderSubscription(user.uid);
    });

    // Gestore modifica informazioni personali
    const editBtn = qs("edit-personal-info");
    if (editBtn && !editBtn.dataset.bound) {
      editBtn.dataset.bound = "1";
      editBtn.addEventListener("click", () => {
        openEditPersonalInfoModal(user, profile, async () => {
          // Ricarica dopo modifica
          const updatedProfile = await getProfile(user.uid);
          // Aggiorna visualizzazione
          if (updatedProfile.name) {
            const userLine = qs("user-line");
            if (userLine) {
              userLine.textContent = `${updatedProfile.name} · ${updatedProfile.faculty || ""}`;
            }
          }
          // Ricarica la pagina per aggiornare tutto
          window.location.reload();
        });
      });
    }

    // Gestore aggiunta esame sostenuto (solo una volta)
    const addBtn = qs("add-passed-exam");
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = "1";
      addBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        setText(qs("passed-exam-error"), "");

        try {
          const name = (qs("passed-exam-name")?.value || "").trim();
          const grade = Number(qs("passed-exam-grade")?.value || 0);
          const cfu = Number(qs("passed-exam-cfu")?.value || 0);
          const date = qs("passed-exam-date")?.value;
          const notes = (qs("passed-exam-notes")?.value || "").trim();

          if (!name) throw new Error("Nome esame mancante.");
          if (!grade || grade < 18 || grade > 30) throw new Error("Voto non valido (18-30).");
          if (!cfu || cfu < 1) throw new Error("CFU non validi.");
          if (!date) throw new Error("Data superamento mancante.");

          await addPassedExam(user.uid, { name, grade, cfu, date, notes });
          
          // Reset form
          if (qs("passed-exam-name")) qs("passed-exam-name").value = "";
          if (qs("passed-exam-grade")) qs("passed-exam-grade").value = "";
          if (qs("passed-exam-cfu")) qs("passed-exam-cfu").value = "6";
          if (qs("passed-exam-date")) qs("passed-exam-date").value = "";
          if (qs("passed-exam-notes")) qs("passed-exam-notes").value = "";

          await refreshPassedExamsList(user.uid);
          await updateStats(user.uid);
        } catch (err) {
          console.error(err);
          setText(qs("passed-exam-error"), err?.message ?? "Errore aggiunta esame");
        }
      });
    }
  });
}

/**
 * Renderizza la sezione abbonamento nel profilo
 */
async function renderSubscription(uid) {
  const container = qs("subscription-display");
  if (!container) {
    console.warn("[Premium] Container subscription-display non trovato nella pagina profilo");
    return;
  }
  
  console.log("[Premium] Rendering sezione abbonamento per utente:", uid);
  
  const subscriptionInfo = await getSubscriptionInfo(uid);
  const isPremiumUser = await isPremium(uid);
  const profile = await getProfile(uid);
  const subscription = profile?.subscription || null;
  
  if (isPremiumUser && subscription) {
    // Utente premium attivo (anche se cancellato, può usare fino alla scadenza)
    const isCancelled = subscription.status === 'cancelled' || subscription.status === 'canceled';
    
    let endDate, startDate;
    
    // Gestisci endDate (può essere Timestamp, stringa ISO, o null)
    if (subscription.endDate) {
      if (subscription.endDate.toDate && typeof subscription.endDate.toDate === 'function') {
        endDate = subscription.endDate.toDate();
      } else if (typeof subscription.endDate === 'string') {
        endDate = new Date(subscription.endDate);
      } else {
        endDate = new Date(subscription.endDate);
      }
    } else {
      endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default: 30 giorni da ora
    }
    
    // Gestisci startDate (può essere Timestamp, stringa ISO, o null)
    if (subscription.startDate) {
      if (subscription.startDate.toDate && typeof subscription.startDate.toDate === 'function') {
        startDate = subscription.startDate.toDate();
      } else if (typeof subscription.startDate === 'string') {
        startDate = new Date(subscription.startDate);
      } else {
        startDate = new Date(subscription.startDate);
      }
    } else {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: 7 giorni fa
    }
    
    // Usa getCurrentDate() per supportare date virtuali
    const now = getCurrentDate();
    const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
    const formattedEndDate = endDate.toLocaleDateString('it-IT', { 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric' 
    });
    const formattedStartDate = startDate.toLocaleDateString('it-IT', { 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric' 
    });
    
    container.innerHTML = `
      <div class="subscriptionCard active">
        <div class="subscriptionHeader">
          <div>
            <div class="subscriptionStatus">
              ${isCancelled 
                ? '<span class="badge warn">Premium in Scadenza</span>' 
                : '<span class="badge good">Premium Attivo</span>'}
            </div>
            <div class="subscriptionTitle">Abbonamento Premium</div>
            <div class="subscriptionPrice">€${subscription.price || 4.99}${subscription.type === 'yearly' ? '/anno' : '/mese'}</div>
          </div>
        </div>
        
        ${isCancelled ? `
        <div style="background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.3); border-radius:8px; padding:12px; margin-bottom:16px;">
          <p style="margin:0; font-size:13px; color:rgba(251,191,36,1);">
            ⚠️ L'abbonamento è stato annullato. Rimarrà attivo fino al ${formattedEndDate}.
          </p>
        </div>
        ` : ''}
        
        <div class="subscriptionDetails">
          <div class="subscriptionDetailRow">
            <span class="subscriptionDetailLabel">Data inizio</span>
            <span class="subscriptionDetailValue">${formattedStartDate}</span>
          </div>
          <div class="subscriptionDetailRow">
            <span class="subscriptionDetailLabel">Data scadenza</span>
            <span class="subscriptionDetailValue">${formattedEndDate}</span>
          </div>
          <div class="subscriptionDetailRow">
            <span class="subscriptionDetailLabel">Giorni rimanenti</span>
            <span class="subscriptionDetailValue ${daysLeft <= 7 ? 'warn' : ''}">${daysLeft} giorni</span>
          </div>
          <div class="subscriptionDetailRow">
            <span class="subscriptionDetailLabel">Tipo</span>
            <span class="subscriptionDetailValue">${subscription.type === 'yearly' ? 'Annuale' : subscription.type === 'monthly' ? 'Mensile' : subscription.type || 'Mensile'}</span>
          </div>
        </div>
        
        <div class="subscriptionActions">
          ${!isCancelled ? `
          <button class="btn" id="cancel-subscription-btn" type="button" style="width: 100%;">Annulla abbonamento</button>
          ` : `
          <button class="btn primary" id="reactivate-subscription-btn" type="button" style="width: 100%;">Riattiva abbonamento</button>
          `}
        </div>
      </div>
    `;
    
    // Gestore annullamento
    qs("cancel-subscription-btn")?.addEventListener("click", async () => {
      if (confirm("Sei sicuro di voler annullare l'abbonamento? Rimarrà attivo fino alla scadenza (" + formattedEndDate + "), poi perderai l'accesso a Premium.")) {
        try {
          const btn = qs("cancel-subscription-btn");
          if (btn) {
            btn.disabled = true;
            btn.textContent = "⏳ Annullamento...";
          }
          
          // Chiama la Cloud Function per cancellare l'abbonamento su Stripe
          if (cancelSubscription) {
            const result = await cancelSubscription();
            showToast(result.data?.message || "Abbonamento annullato. Rimarrà attivo fino alla scadenza.");
          } else {
            // Fallback: aggiorna solo il database (non cancella su Stripe)
            await setProfile(uid, {
              subscription: {
                ...subscription,
                status: 'cancelled',
                cancelledAt: new Date().toISOString()
              }
            });
            showToast("Abbonamento annullato. Rimarrà attivo fino alla scadenza.");
          }
          
          setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
          console.error(err);
          const errorMsg = err?.message || err?.code || "Errore sconosciuto";
          alert("Errore durante l'annullamento: " + errorMsg);
          
          const btn = qs("cancel-subscription-btn");
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Annulla abbonamento";
          }
        }
      }
    });
    
    // Gestore riattivazione (se cancellato)
    qs("reactivate-subscription-btn")?.addEventListener("click", async () => {
      if (confirm("Vuoi riattivare l'abbonamento? Verrà rinnovato automaticamente ogni mese.")) {
        try {
          // Mantieni la data di scadenza originale, non aggiungere giorni
          // La riattivazione cambia solo lo status, non la data di scadenza
          await setProfile(uid, {
            subscription: {
              ...subscription,
              status: 'active',
              // Mantieni endDate originale - non modificarla
              reactivatedAt: new Date().toISOString()
            }
          });
          showToast("Abbonamento riattivato con successo!");
          setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
          console.error(err);
          alert("Errore durante la riattivazione: " + (err?.message || err));
        }
      }
    });
    
  } else {
    // Utente non premium
    container.innerHTML = `
      <div class="subscriptionCard inactive">
        <div class="subscriptionHeader">
          <div>
            <div class="subscriptionStatus">
              <span class="badge warn">Non Premium</span>
            </div>
            <div class="subscriptionTitle">Versione Gratuita</div>
            <div class="subscriptionPrice">€0/mese</div>
          </div>
        </div>
        
        <div class="subscriptionDetails">
          <div class="subscriptionDetailRow">
            <span class="subscriptionDetailLabel">Limite esami</span>
            <span class="subscriptionDetailValue">3 esami</span>
          </div>
          <div class="subscriptionDetailRow">
            <span class="subscriptionDetailLabel">Funzionalità</span>
            <span class="subscriptionDetailValue">Base</span>
          </div>
        </div>
        
        <div class="subscriptionBenefits">
          <div class="subscriptionBenefitsTitle">Passa a Premium per:</div>
          <ul class="subscriptionBenefitsList">
            <li>✓ Esami illimitati</li>
            <li>✓ Simulazione appelli avanzata</li>
            <li>✓ Simulazioni avanzate</li>
            <li>✓ Timer di studio</li>
            <li>✓ Statistiche dettagliate</li>
            <li>✓ Pianificazione multi-settimana</li>
          </ul>
        </div>
        
        <div class="subscriptionActions">
          <button class="btn primary" id="upgrade-subscription-btn" type="button" style="width: 100%;">
            Passa a Premium
          </button>
        </div>
        
        <div id="referral-button-container" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,.1);">
          <!-- Il bottone referral verrà aggiunto qui -->
        </div>
      </div>
    `;
    
    qs("upgrade-subscription-btn")?.addEventListener("click", () => {
      showUpgradeModal();
    });
    
    // Aggiungi il bottone referral dopo aver renderizzato la subscription
    await renderReferralButton(uid);
  }
}

/**
 * Renderizza il bottone referral (solo per utenti non premium)
 * Viene chiamato da renderSubscription dopo aver renderizzato la subscription
 */
async function renderReferralButton(uid) {
  const container = qs("referral-button-container");
  if (!container) {
    return;
  }

  try {
    // Verifica se l'utente è premium
    const isPremiumUser = await isPremium(uid);
    
    // Se è premium, nascondi completamente la sezione
    if (isPremiumUser) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    // Mostra il container solo se non è premium
    container.style.display = 'block';

    if (!getReferralCode) {
      container.style.display = 'none';
      return;
    }

    // Recupera il codice referral
    let referralUrl;
    try {
      const result = await getReferralCode();
      referralUrl = result.data.referralUrl;
    } catch (error) {
      // Fallback: genera un URL referral basato sull'UID
      // Questo permette di mostrare il bottone anche se la funzione Firebase non è disponibile
      const profile = await getProfile(uid);
      const referralCode = profile?.referralCode || `REF${uid.substring(0, 8).toUpperCase()}`;
      referralUrl = `https://methodo.app/index.html?ref=${referralCode}`;
    }

    // Mostra solo un bottone semplice
    container.innerHTML = `
      <button class="btn" id="invite-friend-btn" type="button" style="width: 100%;">
        Invita un amico e ricevi 7 giorni Premium gratis
      </button>
    `;

    // Crea una modale per mostrare il link quando si clicca
    const inviteBtn = qs("invite-friend-btn");
    if (inviteBtn) {
      inviteBtn.addEventListener("click", () => {
        showReferralModal(referralUrl);
      });
    }

  } catch (error) {
    console.error("Errore rendering referral:", error);
    // Non nascondere completamente, mostra un messaggio di errore
    container.innerHTML = `
      <div class="error" style="padding: 12px; text-align: center; color: rgba(251,113,133,1);">
        Errore nel caricamento del link di invito. Riprova più tardi.
      </div>
    `;
  }
}


/**
 * Mostra una modale con il link di referral e opzioni di condivisione
 */
function showReferralModal(referralUrl) {
  // Rimuovi modale esistente se presente
  const existingModal = document.getElementById("referral-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Crea la modale
  const modal = document.createElement("div");
  modal.id = "referral-modal";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,.75);
    z-index: 10000;
    padding: 20px;
  `;

  modal.innerHTML = `
    <div style="
      background: var(--bg1);
      border: 1px solid var(--border);
      border-radius: var(--r);
      box-shadow: 0 24px 80px rgba(0,0,0,.6);
      width: 100%;
      max-width: 480px;
      padding: 28px;
      position: relative;
      max-height: 90vh;
      overflow-y: auto;
    ">
      <button id="referral-modal-close" style="
        position: absolute;
        top: 16px;
        right: 16px;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.05);
        color: var(--text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
      ">✕</button>

      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 24px; margin-bottom: 8px;">Invita un amico</h2>
        <p style="color: rgba(255,255,255,.7); font-size: 14px; line-height: 1.6;">
          Condividi il tuo link di invito. Quando un amico si registra, entrambi ricevete <strong>7 giorni di Premium gratis</strong>!
        </p>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-size: 13px; color: rgba(255,255,255,.7);">Il tuo link di invito:</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input 
            type="text" 
            id="referral-link-input-modal" 
            readonly 
            value="${referralUrl}" 
            style="flex: 1; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.2); background: rgba(0,0,0,.3); color: rgba(255,255,255,.9); font-size: 14px; font-family: monospace;"
          />
          <button 
            class="btn" 
            id="copy-referral-link-modal" 
            type="button"
            style="white-space: nowrap;"
          >
            📋 Copia
          </button>
        </div>
      </div>

      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px;">
        <button class="btn" id="share-whatsapp-modal" type="button" style="flex: 1; min-width: 120px;">
          📱 WhatsApp
        </button>
        <button class="btn" id="share-email-modal" type="button" style="flex: 1; min-width: 120px;">
          ✉️ Email
        </button>
      </div>

      <div style="padding: 16px; background: rgba(249,115,22,.1); border: 1px solid rgba(249,115,22,.2); border-radius: 12px;">
        <div style="font-size: 13px; font-weight: 600; color: var(--orange); margin-bottom: 8px;">📋 Come funziona:</div>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: rgba(255,255,255,.7); line-height: 1.6;">
          <li>Condividi il link con un amico</li>
          <li>L'amico si registra usando il tuo link</li>
          <li>Entrambi ricevete 7 giorni Premium gratis</li>
        </ul>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Gestori eventi
  const closeBtn = document.getElementById("referral-modal-close");
  const copyBtn = document.getElementById("copy-referral-link-modal");
  const shareWhatsApp = document.getElementById("share-whatsapp-modal");
  const shareEmail = document.getElementById("share-email-modal");
  const referralInput = document.getElementById("referral-link-input-modal");

  const closeModal = () => {
    modal.remove();
  };

  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("referral-modal")) {
      closeModal();
    }
  });

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      showToast("Link copiato negli appunti! 🎉");
      if (copyBtn) copyBtn.textContent = "✓ Copiato";
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = "📋 Copia";
      }, 2000);
    } catch (err) {
      console.error("Errore copia:", err);
      if (referralInput) {
        referralInput.select();
        referralInput.setSelectionRange(0, 99999);
        showToast("Seleziona e copia manualmente il link");
      }
    }
  };

  copyBtn?.addEventListener("click", copyToClipboard);

  shareWhatsApp?.addEventListener("click", () => {
    const message = encodeURIComponent(`Ciao! Ho trovato questo app fantastico per pianificare lo studio universitario. Se ti registri con questo link, entrambi riceviamo 7 giorni Premium gratis! 🎓\n\n${referralUrl}`);
    window.open(`https://wa.me/?text=${message}`, '_blank');
  });

  shareEmail?.addEventListener("click", () => {
    const subject = encodeURIComponent("Invito a Methodo - Study Planner");
    const body = encodeURIComponent(`Ciao!\n\nHo trovato questo app fantastico per pianificare lo studio universitario: Methodo.\n\nSe ti registri con questo link, entrambi riceviamo 7 giorni Premium gratis! 🎓\n\n${referralUrl}\n\nA presto!`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  });
}

async function refreshPassedExamsList(uid) {
  const list = qs("passed-exams-list");
  if (!list) return;

  const exams = await listPassedExams(uid);
  list.innerHTML = "";

  if (exams.length === 0) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "Nessun esame sostenuto aggiunto.";
    list.appendChild(p);
    return;
  }

  for (const ex of exams) {
    const card = document.createElement("div");
    card.className = "passedExamCard";
    card.innerHTML = `
      <div class="passedExamInfo">
        <div class="passedExamName">${escapeHtml(ex.name)}</div>
        <div class="passedExamMeta">
          ${escapeHtml(ex.date || "—")} · ${ex.cfu} CFU
          ${ex.notes ? ` · ${escapeHtml(ex.notes)}` : ""}
        </div>
      </div>
      <div class="passedExamGrade">${ex.grade}</div>
      <div class="examCardActions">
        <button class="btn tiny" type="button" data-del="${ex.id}">Rimuovi</button>
      </div>
    `;

    const delBtn = card.querySelector("button[data-del]");
    delBtn?.addEventListener("click", async () => {
      if (confirm("Vuoi rimuovere questo esame?")) {
        await removePassedExam(uid, ex.id);
        await refreshPassedExamsList(uid);
        await updateStats(uid);
      }
    });

    list.appendChild(card);
  }
}

async function updateStats(uid) {
  const exams = await listPassedExams(uid);
  
  if (exams.length === 0) {
    setText(qs("grade-average"), "—");
    setText(qs("grade-count"), "0 esami");
    setText(qs("total-cfu"), "0");
    setText(qs("max-grade"), "—");
    setText(qs("max-grade-exam"), "—");
    setText(qs("weighted-average"), "—");
    setText(qs("weighted-average-sub"), "—");
    drawGradesChart([]);
    generatePersonalizedTips([], 0, 0);
    return;
  }

  // Calcola media semplice
  const totalGrade = exams.reduce((sum, e) => sum + (e.grade || 0), 0);
  const avg = Math.round((totalGrade / exams.length) * 10) / 10;
  setText(qs("grade-average"), avg.toFixed(1));
  setText(qs("grade-count"), `${exams.length} ${exams.length === 1 ? "esame" : "esami"}`);

  // Calcola media ponderata (per CFU)
  const totalWeighted = exams.reduce((sum, e) => sum + ((e.grade || 0) * (e.cfu || 0)), 0);
  const totalCfu = exams.reduce((sum, e) => sum + (e.cfu || 0), 0);
  const weightedAvg = totalCfu > 0 ? Math.round((totalWeighted / totalCfu) * 10) / 10 : 0;
  if (weightedAvg > 0) {
    setText(qs("weighted-average"), weightedAvg.toFixed(2));
    setText(qs("weighted-average-sub"), `su ${totalCfu} CFU`);
  } else {
    setText(qs("weighted-average"), "—");
    setText(qs("weighted-average-sub"), "—");
  }

  // CFU totali
  setText(qs("total-cfu"), totalCfu.toString());

  // Voto più alto
  const maxExam = exams.reduce((max, e) => (!max || (e.grade || 0) > (max.grade || 0)) ? e : max, null);
  if (maxExam) {
    setText(qs("max-grade"), maxExam.grade.toString());
    setText(qs("max-grade-exam"), escapeHtml(maxExam.name));
  } else {
    setText(qs("max-grade"), "—");
    setText(qs("max-grade-exam"), "—");
  }

  // Genera grafico voti
  drawGradesChart(exams);

  // Genera consigli personalizzati
  generatePersonalizedTips(exams, avg, weightedAvg);

  // Mostra/nascondi bottone condividi
  updateShareButtonVisibility();
}

/**
 * Aggiorna la visibilità del bottone condividi statistiche
 */
function updateShareButtonVisibility() {
  const shareBtn = qs("share-stats-btn");
  if (!shareBtn) return;

  const gradeAverage = qs("grade-average");
  const hasStats = gradeAverage && gradeAverage.textContent !== "—" && gradeAverage.textContent.trim() !== "";

  if (hasStats) {
    shareBtn.style.display = "block";
  } else {
    shareBtn.style.display = "none";
  }
}

function drawGradesChart(exams) {
  const chartContainer = document.getElementById("grades-chart");
  if (!chartContainer) return;
  
  if (exams.length === 0) {
    chartContainer.innerHTML = '<p class="muted small" style="text-align:center; padding:40px;">Aggiungi esami per vedere il grafico</p>';
    return;
  }

  // Crea o ripristina canvas
  let canvas = document.getElementById("grades-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "grades-canvas";
    chartContainer.innerHTML = "";
    chartContainer.appendChild(canvas);
  }

  const ctx = canvas.getContext("2d");
  const containerWidth = chartContainer.offsetWidth || 400;
  const width = 400;
  const height = 200;
  
  // Set display size
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  canvas.width = width;
  canvas.height = height;
  
  // Ordina esami per data (più vecchi prima)
  const sortedExams = [...exams].sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateA - dateB;
  });

  // Calcola range date
  const dates = sortedExams.map(e => new Date(e.date || 0)).filter(d => !isNaN(d.getTime()));
  if (dates.length === 0) {
    chartContainer.innerHTML = '<p class="muted small" style="text-align:center; padding:40px;">Aggiungi esami con date valide per vedere il grafico</p>';
    return;
  }

  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
  const dateRange = maxDate - minDate || 1; // Evita divisione per zero

  // Margini
  const marginLeft = 50;
  const marginRight = 20;
  const marginTop = 20;
  const marginBottom = 40;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;

  // Sfondo
  ctx.fillStyle = "rgba(10, 12, 20, 0.5)";
  ctx.fillRect(0, 0, width, height);

  // Griglia orizzontale (voti)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.font = "10px system-ui";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.textAlign = "right";
  
  for (let grade = 18; grade <= 30; grade += 3) {
    const y = marginTop + chartHeight - ((grade - 18) / 12) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(marginLeft, y);
    ctx.lineTo(width - marginRight, y);
    ctx.stroke();
    
    // Label voti
    ctx.fillText(grade.toString(), marginLeft - 8, y + 3);
  }

  // Griglia verticale (date) - mostra alcune date chiave
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.textAlign = "center";
  ctx.font = "9px system-ui";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  
  const numDateLabels = Math.min(5, sortedExams.length);
  for (let i = 0; i < numDateLabels; i++) {
    const index = Math.floor((i / (numDateLabels - 1)) * (sortedExams.length - 1));
    const exam = sortedExams[index];
    if (!exam || !exam.date) continue;
    
    const examDate = new Date(exam.date);
    const x = marginLeft + ((examDate - minDate) / dateRange) * chartWidth;
    
    ctx.beginPath();
    ctx.moveTo(x, marginTop);
    ctx.lineTo(x, height - marginBottom);
    ctx.stroke();
    
    // Formatta data (GG/MM/AA)
    const day = String(examDate.getDate()).padStart(2, "0");
    const month = String(examDate.getMonth() + 1).padStart(2, "0");
    const year = String(examDate.getFullYear()).slice(-2);
    ctx.fillText(`${day}/${month}/${year}`, x, height - marginBottom + 15);
  }

  // Disegna linea dei voti
  if (sortedExams.length > 0) {
    ctx.strokeStyle = "rgba(99, 102, 241, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    let firstPoint = true;
    sortedExams.forEach((exam, index) => {
      if (!exam.date || !exam.grade) return;
      
      const examDate = new Date(exam.date);
      const x = marginLeft + ((examDate - minDate) / dateRange) * chartWidth;
      const y = marginTop + chartHeight - ((exam.grade - 18) / 12) * chartHeight;
      
      if (firstPoint) {
        ctx.moveTo(x, y);
        firstPoint = false;
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();

    // Disegna punti
    ctx.fillStyle = "rgba(99, 102, 241, 1)";
    sortedExams.forEach((exam) => {
      if (!exam.date || !exam.grade) return;
      
      const examDate = new Date(exam.date);
      const x = marginLeft + ((examDate - minDate) / dateRange) * chartWidth;
      const y = marginTop + chartHeight - ((exam.grade - 18) / 12) * chartHeight;
      
      // Punto
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      
      // Colore punto in base al voto
      if (exam.grade >= 27) ctx.fillStyle = "rgba(34, 197, 94, 1)"; // Verde
      else if (exam.grade >= 24) ctx.fillStyle = "rgba(99, 102, 241, 1)"; // Blu
      else if (exam.grade >= 21) ctx.fillStyle = "rgba(245, 158, 11, 1)"; // Arancione
      else ctx.fillStyle = "rgba(251, 113, 133, 1)"; // Rosso
      
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      
      // Reset colore per prossimo punto
      ctx.fillStyle = "rgba(99, 102, 241, 1)";
    });
  }

  // Assi
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  
  // Asse Y (voti)
  ctx.beginPath();
  ctx.moveTo(marginLeft, marginTop);
  ctx.lineTo(marginLeft, height - marginBottom);
  ctx.stroke();
  
  // Asse X (tempo)
  ctx.beginPath();
  ctx.moveTo(marginLeft, height - marginBottom);
  ctx.lineTo(width - marginRight, height - marginBottom);
  ctx.stroke();
}

function generatePersonalizedTips(exams, avg, weightedAvg) {
  const tipsContainer = document.getElementById("personalized-tips");
  if (!tipsContainer) return;

  tipsContainer.innerHTML = "";

  if (exams.length === 0) {
    tipsContainer.innerHTML = `
      <div class="tipCard">
        <div class="tipIcon">ℹ</div>
        <div class="tipContent">
          <div class="tipTitle">Aggiungi i tuoi esami</div>
          <div class="tipDesc">Inizia aggiungendo gli esami che hai già sostenuto per vedere statistiche e consigli personalizzati.</div>
        </div>
      </div>
    `;
    return;
  }

  const tips = [];

  // Tip basato su media
  if (avg < 22) {
    tips.push({
      icon: "📚",
      title: "Media sotto la sufficienza",
      desc: `La tua media è ${avg.toFixed(1)}. Considera di dedicare più tempo allo studio e seguire un piano più strutturato. Usa la sezione Strategie per configurare un piano di studio ottimizzato.`
    });
  } else if (avg >= 22 && avg < 26) {
    tips.push({
      icon: "✅",
      title: "Buona media",
      desc: `Ottima media di ${avg.toFixed(1)}! Continua così. Potresti provare a puntare a voti più alti concentrandoti sugli esami più importanti.`
    });
  } else if (avg >= 26) {
    tips.push({
      icon: "🌟",
      title: "Eccellente media",
      desc: `Eccellente! La tua media di ${avg.toFixed(1)} è molto alta. Continua a mantenere questo livello di preparazione.`
    });
  }

  // Tip su media ponderata vs semplice
  if (weightedAvg > 0 && Math.abs(weightedAvg - avg) > 0.5) {
    if (weightedAvg > avg) {
      tips.push({
        icon: "🎯",
        title: "Ottima distribuzione",
        desc: `La tua media ponderata (${weightedAvg.toFixed(2)}) è superiore alla media semplice. Significa che ottieni voti più alti negli esami con più CFU. Ottimo lavoro!`
      });
    } else {
      tips.push({
        icon: "⚠️",
        title: "Attenzione ai CFU",
        desc: `La tua media ponderata (${weightedAvg.toFixed(2)}) è inferiore alla media semplice. Considera di concentrarti di più sugli esami con più CFU per migliorare la media complessiva.`
      });
    }
  }

  // Tip su trend
  if (exams.length >= 3) {
    const recent = exams.slice(0, 3);
    const older = exams.slice(3, 6);
    if (older.length > 0) {
      const recentAvg = recent.reduce((s, e) => s + (e.grade || 0), 0) / recent.length;
      const olderAvg = older.reduce((s, e) => s + (e.grade || 0), 0) / older.length;
      if (recentAvg < olderAvg - 1) {
        tips.push({
          icon: "📉",
          title: "Trend negativo",
          desc: "Hai avuto un calo recente nei voti. Potrebbe essere utile rivedere il tuo metodo di studio o ridurre il carico di lavoro."
        });
      } else if (recentAvg > olderAvg + 1) {
        tips.push({
          icon: "📈",
          title: "Trend positivo",
          desc: "Ottimo! I tuoi voti recenti sono migliori. Continua con questo approccio di studio."
        });
      }
    }
  }

  // Tip su distribuzione
  const excellent = exams.filter(e => (e.grade || 0) >= 27).length;
  if (excellent > 0 && excellent / exams.length > 0.3) {
    tips.push({
      icon: "🏆",
      title: "Molti voti eccellenti",
      desc: `Hai ${excellent} esami con voto 27 o superiore. Ottimo lavoro! Mantieni questo livello.`
    });
  }

  // Mostra i tips
  if (tips.length === 0) {
    tips.push({
      icon: "👍",
      title: "Continua così",
      desc: "I tuoi risultati sono buoni. Continua a seguire il tuo piano di studio."
    });
  }

  tips.forEach(tip => {
    const tipCard = document.createElement("div");
    tipCard.className = "tipCard";
    tipCard.innerHTML = `
      <div class="tipIcon">${tip.icon}</div>
      <div class="tipContent">
        <div class="tipTitle">${escapeHtml(tip.title)}</div>
        <div class="tipDesc">${escapeHtml(tip.desc)}</div>
      </div>
    `;
    tipsContainer.appendChild(tipCard);
  });
}

// ----------------- SHARE STATS -----------------
/**
 * Setup del bottone per condividere le statistiche
 */
function setupShareStatsButton(uid) {
  const shareBtn = qs("share-stats-btn");
  if (!shareBtn) return;

  // Evita di aggiungere listener multipli
  if (shareBtn.dataset.bound) return;
  shareBtn.dataset.bound = "1";

  // Aggiorna visibilità iniziale
  updateShareButtonVisibility();

  shareBtn.addEventListener("click", async () => {
    try {
      shareBtn.disabled = true;
      shareBtn.textContent = "⏳ Generazione...";
      
      await shareStats();
      
      shareBtn.disabled = false;
      shareBtn.textContent = "Condividi statistiche";
    } catch (err) {
      console.error("Errore condivisione:", err);
      alert("Errore durante la condivisione: " + (err?.message || err));
      shareBtn.disabled = false;
      shareBtn.textContent = "Condividi statistiche";
    }
  });
}

/**
 * Funzione principale per condividere le statistiche
 */
async function shareStats() {
  // Verifica se html2canvas è disponibile
  if (typeof html2canvas === "undefined") {
    // Fallback: condivisione testo
    shareStatsAsText();
    return;
  }

  // Crea un contenitore per l'immagine da condividere
  const statsSection = document.querySelector("#stats-summary").closest("section");
  if (!statsSection) {
    throw new Error("Sezione statistiche non trovata");
  }

  // Prepara il contenuto da catturare (statistiche + grafico)
  const statsSummary = qs("stats-summary");
  const gradesChart = qs("grades-chart");
  
  if (!statsSummary) {
    throw new Error("Statistiche non trovate");
  }

  // Crea un contenitore temporaneo per l'immagine
  const shareContainer = document.createElement("div");
  shareContainer.style.position = "absolute";
  shareContainer.style.left = "-9999px";
  shareContainer.style.width = "600px";
  shareContainer.style.padding = "32px";
  shareContainer.style.background = "linear-gradient(180deg, #070a12, #0b0f1a)";
  shareContainer.style.color = "rgba(255,255,255,.93)";
  shareContainer.style.fontFamily = "system-ui, -apple-system, sans-serif";
  shareContainer.style.borderRadius = "12px";

  // Aggiungi header
  const header = document.createElement("div");
  header.style.marginBottom = "24px";
  header.style.textAlign = "center";
  header.innerHTML = `
    <h2 style="margin:0 0 8px 0; font-size:24px; font-weight:900;">Le Mie Statistiche</h2>
    <p style="margin:0; font-size:14px; color:rgba(255,255,255,.6);">Study Planner</p>
  `;
  shareContainer.appendChild(header);

  // Clona le statistiche
  const statsClone = statsSummary.cloneNode(true);
  statsClone.style.display = "grid";
  statsClone.style.gridTemplateColumns = "repeat(2, 1fr)";
  statsClone.style.gap = "16px";
  statsClone.style.marginBottom = "24px";
  shareContainer.appendChild(statsClone);

  // Aggiungi grafico se disponibile
  const gradesCanvas = gradesChart?.querySelector("#grades-canvas");
  if (gradesCanvas) {
    const chartWrapper = document.createElement("div");
    chartWrapper.style.marginTop = "24px";
    chartWrapper.style.textAlign = "center";
    
    // Crea un nuovo canvas e copia il contenuto
    const newCanvas = document.createElement("canvas");
    newCanvas.width = gradesCanvas.width;
    newCanvas.height = gradesCanvas.height;
    const ctx = newCanvas.getContext("2d");
    ctx.drawImage(gradesCanvas, 0, 0);
    
    chartWrapper.appendChild(newCanvas);
    shareContainer.appendChild(chartWrapper);
  }

  // Aggiungi footer
  const footer = document.createElement("div");
  footer.style.marginTop = "24px";
  footer.style.textAlign = "center";
  footer.style.fontSize = "12px";
  footer.style.color = "rgba(255,255,255,.5)";
  footer.textContent = "Generato con Study Planner";
  shareContainer.appendChild(footer);

  document.body.appendChild(shareContainer);

  try {
    // Genera immagine
    const shareCanvas = await html2canvas(shareContainer, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true,
    });

    // Rimuovi contenitore temporaneo
    document.body.removeChild(shareContainer);

    // Converti canvas in blob
    shareCanvas.toBlob(async (blob) => {
      if (!blob) {
        throw new Error("Errore nella generazione dell'immagine");
      }

      const file = new File([blob], "statistiche-study-planner.png", { type: "image/png" });
      const url = URL.createObjectURL(blob);

      // Prova Web Share API
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "Le mie statistiche - Study Planner",
            text: "Guarda le mie statistiche accademiche! 📊",
            files: [file],
          });
          URL.revokeObjectURL(url);
          return;
        } catch (shareErr) {
          if (shareErr.name !== "AbortError") {
            console.error("Errore Web Share:", shareErr);
          }
        }
      }

      // Fallback: download + link WhatsApp
      downloadImage(url, "statistiche-study-planner.png");
      
      // Mostra opzioni di condivisione
      showShareOptions(url);
    }, "image/png");
  } catch (err) {
    document.body.removeChild(shareContainer);
    throw err;
  }
}

/**
 * Condivisione come testo (fallback se html2canvas non disponibile)
 */
function shareStatsAsText() {
  const gradeAverage = qs("grade-average")?.textContent || "—";
  const gradeCount = qs("grade-count")?.textContent || "0 esami";
  const weightedAverage = qs("weighted-average")?.textContent || "—";
  const totalCfu = qs("total-cfu")?.textContent || "0";
  const maxGrade = qs("max-grade")?.textContent || "—";
  const maxGradeExam = qs("max-grade-exam")?.textContent || "—";

  const text = `📊 Le Mie Statistiche - Study Planner

Media voti: ${gradeAverage}
${gradeCount}
Media ponderata: ${weightedAverage}
CFU totali: ${totalCfu}
Voto più alto: ${maxGrade} (${maxGradeExam})

Generato con Study Planner`;

  // Prova Web Share API per testo
  if (navigator.share) {
    navigator.share({
      title: "Le mie statistiche",
      text: text,
    }).catch(() => {
      // Fallback: copia negli appunti o WhatsApp
      copyToClipboard(text);
      showWhatsAppLink(text);
    });
  } else {
    copyToClipboard(text);
    showWhatsAppLink(text);
  }
}

/**
 * Download dell'immagine
 */
function downloadImage(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Mostra opzioni di condivisione
 */
function showShareOptions(imageUrl) {
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    background: #0b0f1a;
    padding: 24px;
    border-radius: 12px;
    max-width: 400px;
    width: 90%;
    border: 1px solid rgba(255,255,255,.12);
  `;

  card.innerHTML = `
    <h3 style="margin:0 0 16px 0; font-size:18px;">Immagine scaricata! 📥</h3>
    <p style="margin:0 0 20px 0; color:rgba(255,255,255,.7); font-size:14px;">
      L'immagine è stata scaricata. Puoi condividerla su Instagram, WhatsApp o altre app.
    </p>
    <div style="display:flex; gap:12px;">
      <button id="share-whatsapp" class="btn primary" style="flex:1;">📱 WhatsApp</button>
      <button id="share-close" class="btn" style="flex:1;">Chiudi</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const closeModal = () => {
    document.body.removeChild(modal);
    URL.revokeObjectURL(imageUrl);
  };

  card.querySelector("#share-close").addEventListener("click", closeModal);
  
  card.querySelector("#share-whatsapp")?.addEventListener("click", () => {
    const text = encodeURIComponent("Guarda le mie statistiche! 📊\n\nGenerato con Study Planner");
    const whatsappUrl = `https://wa.me/?text=${text}`;
    window.open(whatsappUrl, "_blank");
    closeModal();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}

/**
 * Copia testo negli appunti
 */
function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      alert("Testo copiato negli appunti!");
    });
  } else {
    // Fallback per browser vecchi
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    alert("Testo copiato negli appunti!");
  }
}

/**
 * Mostra link WhatsApp
 */
function showWhatsAppLink(text) {
  const encodedText = encodeURIComponent(text);
  const whatsappUrl = `https://wa.me/?text=${encodedText}`;
  
  if (confirm("Vuoi aprire WhatsApp per condividere?")) {
    window.open(whatsappUrl, "_blank");
  }
}

/**
 * Esporta il piano di studio in PDF
 */
async function exportPlanToPDF(plan, exams, profile, weekStartISO) {
  // Verifica se jsPDF è disponibile
  if (typeof window.jspdf === "undefined") {
    throw new Error("Libreria PDF non disponibile. Ricarica la pagina.");
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Colori tema scuro - Arancione e Nero (definiti prima dell'uso)
  const primaryColor = [249, 115, 22]; // Arancione
  const primaryDark = [200, 80, 10]; // Arancione scuro
  const bgDark = [20, 20, 20]; // Nero scuro
  const bgCard = [30, 30, 30]; // Grigio scuro per card
  const bgAlt = [40, 40, 40]; // Grigio medio per alternanza
  const textColor = [255, 255, 255]; // Bianco per testo principale
  const textSecondary = [180, 180, 180]; // Grigio chiaro per testo secondario
  const borderColor = [249, 115, 22]; // Arancione per bordi
  const borderDark = [60, 60, 60]; // Grigio scuro per bordi secondari

  // Imposta sfondo scuro per tutte le pagine
  doc.setFillColor(...bgDark);
  doc.rect(0, 0, 210, 297, 'F');

  // Helper per disegnare box con bordo
  const drawBox = (x, y, w, h, fillColor = null, borderColor = null) => {
    if (fillColor) {
      doc.setFillColor(...fillColor);
      doc.rect(x, y, w, h, 'F');
    }
    if (borderColor) {
      doc.setDrawColor(...borderColor);
      doc.rect(x, y, w, h, 'S');
    }
  };

  // Helper per disegnare linea
  const drawLine = (x1, y1, x2, y2, color = borderColor) => {
    doc.setDrawColor(...color);
    doc.line(x1, y1, x2, y2);
  };

  // Header arancione
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 210, 40, 'F');
  
  // Linea decorativa nera sotto header
  doc.setFillColor(...bgDark);
  doc.rect(0, 37, 210, 3, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont(undefined, 'bold');
  doc.text('PIANO DI STUDIO SETTIMANALE', 105, 20, { align: 'center' });
  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  doc.text(`Settimana: ${plan.weekStart}`, 105, 28, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(220, 220, 220);
  doc.text('Generato con Methodo', 105, 34, { align: 'center' });

  let yPos = 50;

  // Sezione Informazioni Generali con box scuro
  drawBox(10, yPos - 5, 190, 28, bgCard, borderColor);
  
  // Titolo sezione con bordo arancione
  doc.setFillColor(...primaryColor);
  doc.rect(10, yPos - 5, 190, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('INFORMAZIONI GENERALI', 15, yPos - 0.5);
  yPos += 8;

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  
  // Box per ogni informazione con tema scuro
  const infoItems = [
    { prefix: 'B', label: 'Budget settimanale', value: `${Math.round(plan.weeklyBudgetMin / 60)} ore` },
    { prefix: 'T', label: 'Durata task', value: `${plan.taskMinutes} minuti` },
    { prefix: 'E', label: 'Esami', value: `${exams.length}` }
  ];

  const boxWidth = 58;
  const boxHeight = 14;
  let xStart = 15;
  
  for (let i = 0; i < infoItems.length; i++) {
    const item = infoItems[i];
    const x = xStart + (i * (boxWidth + 3));
    
    // Box con sfondo scuro e bordo arancione
    drawBox(x, yPos, boxWidth, boxHeight, bgAlt, borderColor);
    
    // Badge arancione per prefisso
    doc.setFillColor(...primaryColor);
    doc.rect(x + 2, yPos + 1, 6, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text(item.prefix, x + 4.5, yPos + 5, { align: 'center' });
    
    // Label
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...textSecondary);
    doc.text(item.label, x + 10, yPos + 5);
    
    // Valore in grassetto
    doc.setFontSize(10);
    doc.setTextColor(...textColor);
    doc.setFont(undefined, 'bold');
    doc.text(item.value, x + 2, yPos + 11);
  }
  
  yPos += 22;

  // Allocazioni per esame con tabella
  if (plan.allocations && plan.allocations.length > 0) {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    // Titolo sezione
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...textColor);
    doc.text('DISTRIBUZIONE TEMPO PER ESAME', 10, yPos);
    yPos += 8;

    // Tabella con header
    const tableX = 10;
    const tableY = yPos;
    const colWidth = [120, 70];
    const rowHeight = 8;
    
    // Header della tabella arancione
    drawBox(tableX, tableY, 190, rowHeight, primaryColor, borderColor);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('ESAME', tableX + 3, tableY + 5.5);
    doc.text('TEMPO ALLOCATO', tableX + colWidth[0] + 3, tableY + 5.5);
    
    yPos += rowHeight;
    
    // Righe della tabella
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    
    for (let i = 0; i < plan.allocations.length; i++) {
      const alloc = plan.allocations[i];
      const hours = Math.round(alloc.targetMin / 60);
      const minutes = alloc.targetMin % 60;
      const timeStr = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
      
      if (yPos > 270) {
        doc.addPage();
        // Sfondo scuro per nuova pagina
        doc.setFillColor(...bgDark);
        doc.rect(0, 0, 210, 297, 'F');
        yPos = 20;
        // Ridisegna header su nuova pagina
        drawBox(tableX, yPos, 190, rowHeight, primaryColor, borderColor);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('ESAME', tableX + 3, yPos + 5.5);
        doc.text('TEMPO ALLOCATO', tableX + colWidth[0] + 3, yPos + 5.5);
        yPos += rowHeight;
      }
      
      // Alterna colore di sfondo scuro
      const rowBg = i % 2 === 0 ? bgCard : bgAlt;
      drawBox(tableX, yPos, 190, rowHeight, rowBg, borderDark);
      
      doc.setTextColor(...textColor);
      doc.text(alloc.name.length > 30 ? alloc.name.substring(0, 27) + '...' : alloc.name, tableX + 3, yPos + 5.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...primaryColor);
      doc.text(timeStr, tableX + colWidth[0] + 3, yPos + 5.5);
      doc.setFont(undefined, 'normal');
      
      yPos += rowHeight;
    }
    
    yPos += 5;
  }

  // Task per giorno con design migliorato
  if (plan.days && plan.days.length > 0) {
    for (const day of plan.days) {
      if (yPos > 240) {
        doc.addPage();
        // Sfondo scuro per nuova pagina
        doc.setFillColor(...bgDark);
        doc.rect(0, 0, 210, 297, 'F');
        yPos = 20;
      }

      // Box per il giorno con tema scuro
      const dayBoxHeight = 50; // Altezza iniziale, verrà estesa
      drawBox(10, yPos - 3, 190, dayBoxHeight, bgCard, borderColor);
      
      // Header del giorno arancione
      doc.setFillColor(...primaryColor);
      doc.rect(10, yPos - 3, 190, 9, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.setFont(undefined, 'bold');
      doc.text(`${day.label.toUpperCase()}`, 15, yPos + 3);
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.text(day.dateISO, 195, yPos + 3, { align: 'right' });
      
      yPos += 12;

      const dayTotal = (day.tasks || []).reduce((sum, t) => sum + (t.minutes || 0), 0);
      const dayHours = Math.round(dayTotal / 60 * 10) / 10;
      
      // Badge totale arancione
      doc.setFillColor(...primaryColor);
      doc.rect(15, yPos, 55, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.text(`TOTALE: ${Math.round(dayTotal)}m (${dayHours}h)`, 18, yPos + 5);
      doc.setTextColor(...textColor);
      
      yPos += 11;

      if (day.tasks && day.tasks.length > 0) {
        // Raggruppa per periodo
        const morningTasks = day.tasks.filter(t => (t.period || 'morning') === 'morning');
        const afternoonTasks = day.tasks.filter(t => (t.period || 'morning') === 'afternoon');

        // Mattina
        if (morningTasks.length > 0) {
          doc.setFontSize(11);
          doc.setFont(undefined, 'bold');
          doc.setTextColor(...primaryColor);
          doc.text('MATTINA', 15, yPos);
          yPos += 7;
          
          doc.setFontSize(9);
          doc.setFont(undefined, 'normal');
          
          for (const task of morningTasks) {
            if (yPos > 270) {
              doc.addPage();
              // Sfondo scuro per nuova pagina
              doc.setFillColor(...bgDark);
              doc.rect(0, 0, 210, 297, 'F');
              yPos = 20;
            }
            
            // Box per ogni task con tema scuro
            const taskBoxHeight = 9;
            drawBox(20, yPos - 2, 170, taskBoxHeight, bgAlt, borderDark);
            
            // Indicatore arancione a sinistra
            doc.setFillColor(...primaryColor);
            doc.rect(20, yPos - 2, 2, taskBoxHeight, 'F');
            
            // Nome esame in grassetto
            doc.setFont(undefined, 'bold');
            doc.setTextColor(...textColor);
            const examName = task.examName.length > 25 ? task.examName.substring(0, 22) + '...' : task.examName;
            doc.text(examName, 25, yPos + 2.5);
            
            // Tipo task
            doc.setFont(undefined, 'normal');
            doc.setTextColor(...textSecondary);
            const taskLabel = task.label.length > 30 ? task.label.substring(0, 27) + '...' : task.label;
            doc.text(taskLabel, 25, yPos + 6);
            
            // Durata a destra in arancione
            doc.setFont(undefined, 'bold');
            doc.setTextColor(...primaryColor);
            doc.text(`${task.minutes}m`, 185, yPos + 4, { align: 'right' });
            
            yPos += taskBoxHeight + 3;
          }
          yPos += 3;
        }

        // Pomeriggio
        if (afternoonTasks.length > 0) {
          if (yPos > 250) {
            doc.addPage();
            // Sfondo scuro per nuova pagina
            doc.setFillColor(...bgDark);
            doc.rect(0, 0, 210, 297, 'F');
            yPos = 20;
          }
          
          doc.setFontSize(11);
          doc.setFont(undefined, 'bold');
          doc.setTextColor(...primaryColor);
          doc.text('POMERIGGIO', 15, yPos);
          yPos += 7;
          
          doc.setFontSize(9);
          doc.setFont(undefined, 'normal');
          
          for (const task of afternoonTasks) {
            if (yPos > 270) {
              doc.addPage();
              // Sfondo scuro per nuova pagina
              doc.setFillColor(...bgDark);
              doc.rect(0, 0, 210, 297, 'F');
              yPos = 20;
            }
            
            // Box per ogni task con tema scuro
            const taskBoxHeight = 9;
            drawBox(20, yPos - 2, 170, taskBoxHeight, bgAlt, borderDark);
            
            // Indicatore arancione a sinistra
            doc.setFillColor(...primaryColor);
            doc.rect(20, yPos - 2, 2, taskBoxHeight, 'F');
            
            // Nome esame in grassetto
            doc.setFont(undefined, 'bold');
            doc.setTextColor(...textColor);
            const examName = task.examName.length > 25 ? task.examName.substring(0, 22) + '...' : task.examName;
            doc.text(examName, 25, yPos + 2.5);
            
            // Tipo task
            doc.setFont(undefined, 'normal');
            doc.setTextColor(...textSecondary);
            const taskLabel = task.label.length > 30 ? task.label.substring(0, 27) + '...' : task.label;
            doc.text(taskLabel, 25, yPos + 6);
            
            // Durata a destra in arancione
            doc.setFont(undefined, 'bold');
            doc.setTextColor(...primaryColor);
            doc.text(`${task.minutes}m`, 185, yPos + 4, { align: 'right' });
            
            yPos += taskBoxHeight + 3;
          }
          yPos += 3;
        }
      } else {
        doc.setFontSize(9);
        doc.setFont(undefined, 'italic');
        doc.setTextColor(...textSecondary);
        doc.text('Nessun task pianificato per questo giorno', 20, yPos);
        yPos += 6;
      }
      
      // Aggiusta altezza box giorno
      const actualDayHeight = yPos - (day.dateISO ? 47 : 45);
      // Non possiamo modificare il box già disegnato, ma va bene così
      
      yPos += 5;
    }
  }

  // Footer migliorato con tema scuro
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    
    // Linea arancione sopra footer
    doc.setDrawColor(...primaryColor);
    doc.line(10, 280, 200, 280);
    
    // Box footer scuro
    doc.setFillColor(...bgCard);
    doc.rect(10, 281, 190, 10, 'F');
    
    doc.setFontSize(8);
    doc.setTextColor(...textSecondary);
    doc.text(
      `Methodo - Piano di Studio | Pagina ${i} di ${pageCount} | ${new Date().toLocaleDateString('it-IT')}`,
      105,
      287,
      { align: 'center' }
    );
  }

  // Salva PDF
  const filename = `piano-studio-${plan.weekStart}.pdf`;
  doc.save(filename);
}

/**
 * Condividi il piano di studio come immagine
 */
async function sharePlan(plan, exams, profile, weekStartISO) {
  // Verifica se html2canvas è disponibile
  if (typeof html2canvas === "undefined") {
    sharePlanAsText(plan, exams);
    return;
  }

  // Crea un contenitore temporaneo per l'immagine
  const shareContainer = document.createElement("div");
  shareContainer.style.position = "absolute";
  shareContainer.style.left = "-9999px";
  shareContainer.style.width = "800px";
  shareContainer.style.padding = "32px";
  shareContainer.style.background = "linear-gradient(180deg, #070a12, #0b0f1a)";
  shareContainer.style.color = "rgba(255,255,255,.93)";
  shareContainer.style.fontFamily = "system-ui, -apple-system, sans-serif";
  shareContainer.style.borderRadius = "12px";

  // Header
  const header = document.createElement("div");
  header.style.marginBottom = "24px";
  header.style.textAlign = "center";
  header.innerHTML = `
    <h2 style="margin:0 0 8px 0; font-size:28px; font-weight:900;">Piano di Studio Settimanale</h2>
    <p style="margin:0; font-size:16px; color:rgba(255,255,255,.6);">Settimana: ${plan.weekStart}</p>
    <p style="margin:4px 0 0 0; font-size:14px; color:rgba(255,255,255,.5);">Budget: ${Math.round(plan.weeklyBudgetMin / 60)}h · Task: ${plan.taskMinutes}m</p>
  `;
  shareContainer.appendChild(header);

  // Allocazioni
  if (plan.allocations && plan.allocations.length > 0) {
    const allocDiv = document.createElement("div");
    allocDiv.style.marginBottom = "24px";
    allocDiv.style.padding = "20px";
    allocDiv.style.background = "rgba(255,255,255,.05)";
    allocDiv.style.borderRadius = "8px";
    allocDiv.innerHTML = `
      <h3 style="margin:0 0 12px 0; font-size:18px; font-weight:700;">Distribuzione Tempo</h3>
      ${plan.allocations.map(a => {
        const hours = Math.round(a.targetMin / 60);
        const minutes = a.targetMin % 60;
        return `<div style="margin-bottom:8px; font-size:14px;">
          <strong>${escapeHtml(a.name)}</strong>: ${hours}h ${minutes > 0 ? minutes + 'm' : ''}
        </div>`;
      }).join('')}
    `;
    shareContainer.appendChild(allocDiv);
  }

  // Task per giorno
  const daysDiv = document.createElement("div");
  daysDiv.style.display = "grid";
  daysDiv.style.gridTemplateColumns = "repeat(2, 1fr)";
  daysDiv.style.gap = "16px";
  
  for (const day of plan.days || []) {
    const dayCard = document.createElement("div");
    dayCard.style.padding = "16px";
    dayCard.style.background = "rgba(255,255,255,.03)";
    dayCard.style.borderRadius = "8px";
    dayCard.style.border = "1px solid rgba(255,255,255,.1)";
    
    const dayTotal = (day.tasks || []).reduce((sum, t) => sum + (t.minutes || 0), 0);
    
    dayCard.innerHTML = `
      <h4 style="margin:0 0 8px 0; font-size:16px; font-weight:700;">${day.label} - ${day.dateISO}</h4>
      <p style="margin:0 0 12px 0; font-size:12px; color:rgba(255,255,255,.6);">Totale: ${Math.round(dayTotal)}m</p>
      <div style="font-size:12px; line-height:1.6;">
        ${(day.tasks || []).length > 0 ? 
          day.tasks.map(t => `
            <div style="margin-bottom:6px;">
              <span style="color:rgba(249,115,22,1);">•</span> 
              <strong>${escapeHtml(t.examName)}</strong> - ${escapeHtml(t.label)} (${t.minutes}m)
            </div>
          `).join('') :
          '<div style="color:rgba(255,255,255,.4); font-style:italic;">Nessun task</div>'
        }
      </div>
    `;
    daysDiv.appendChild(dayCard);
  }
  
  shareContainer.appendChild(daysDiv);

  // Footer
  const footer = document.createElement("div");
  footer.style.marginTop = "24px";
  footer.style.textAlign = "center";
  footer.style.fontSize = "12px";
  footer.style.color = "rgba(255,255,255,.5)";
  footer.textContent = "Generato con Methodo";
  shareContainer.appendChild(footer);

  document.body.appendChild(shareContainer);

  try {
    // Genera immagine
    const shareCanvas = await html2canvas(shareContainer, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true,
    });

    // Rimuovi contenitore temporaneo
    document.body.removeChild(shareContainer);

    // Converti canvas in blob
    shareCanvas.toBlob(async (blob) => {
      if (!blob) {
        throw new Error("Errore nella generazione dell'immagine");
      }

      const file = new File([blob], `piano-studio-${plan.weekStart}.png`, { type: "image/png" });
      const url = URL.createObjectURL(blob);

      // Prova Web Share API
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: `Piano di Studio - ${plan.weekStart}`,
            text: "Guarda il mio piano di studio settimanale!",
            files: [file],
          });
          URL.revokeObjectURL(url);
          return;
        } catch (shareErr) {
          if (shareErr.name !== "AbortError") {
            console.error("Errore Web Share:", shareErr);
          }
        }
      }

      // Fallback: download + link WhatsApp
      downloadImage(url, `piano-studio-${plan.weekStart}.png`);
      
      // Mostra opzioni di condivisione
      showShareOptions(url);
    }, "image/png");
  } catch (err) {
    document.body.removeChild(shareContainer);
    throw err;
  }
}

/**
 * Condivisione piano come testo (fallback)
 */
function sharePlanAsText(plan, exams) {
  let text = `Piano di Studio Settimanale - ${plan.weekStart}\n\n`;
  text += `Budget: ${Math.round(plan.weeklyBudgetMin / 60)}h\n`;
  text += `Durata task: ${plan.taskMinutes}m\n\n`;

  if (plan.allocations && plan.allocations.length > 0) {
    text += "Distribuzione:\n";
    for (const alloc of plan.allocations) {
      const hours = Math.round(alloc.targetMin / 60);
      text += `• ${alloc.name}: ${hours}h\n`;
    }
    text += "\n";
  }

  if (plan.days && plan.days.length > 0) {
    text += "Task per giorno:\n";
    for (const day of plan.days) {
      const dayTotal = (day.tasks || []).reduce((sum, t) => sum + (t.minutes || 0), 0);
      text += `\n${day.label} (${day.dateISO}) - ${Math.round(dayTotal)}m:\n`;
      for (const task of day.tasks || []) {
        text += `  • ${task.examName} - ${task.label} (${task.minutes}m)\n`;
      }
    }
  }

  text += "\nGenerato con Methodo";

  // Prova Web Share API per testo
  if (navigator.share) {
    navigator.share({
      title: `Piano di Studio - ${plan.weekStart}`,
      text: text,
    }).catch(() => {
      copyToClipboard(text);
      showWhatsAppLink(text);
    });
  } else {
    copyToClipboard(text);
    showWhatsAppLink(text);
  }
}

// ----------------- MENU -----------------
function setupMenu() {
  const btn = document.getElementById("menu-btn");
  const panel = document.getElementById("menu-panel");
  if (!btn || !panel) return;

  const open = () => {
    panel.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    panel.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };
  const toggle = () => (panel.classList.contains("hidden") ? open() : close());

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    toggle();
  });

  document.addEventListener("click", (e) => {
    if (panel.classList.contains("hidden")) return;
    if (btn.contains(e.target) || panel.contains(e.target)) return;
    close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });


  document.getElementById("go-today")?.addEventListener("click", () => {
    close();
    const todayCard = document.querySelector(".card");
    todayCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "m" || e.key === "M") toggle();
  });
}

// ----------------- Debug Date Panel (LOCALHOST ONLY) -----------------
function setupDebugDatePanel() {
  if (!isLocalhost()) return;
  
  const panel = qs("debug-date-panel");
  if (!panel) return;
  
  const dateInput = qs("debug-date-input");
  const prevBtn = qs("debug-date-prev");
  const nextBtn = qs("debug-date-next");
  const resetBtn = qs("debug-date-reset");
  const closeBtn = qs("debug-close-btn");
  const realDateSpan = qs("debug-real-date");
  const virtualDateSpan = qs("debug-virtual-date");
  
  if (!dateInput || !prevBtn || !nextBtn || !resetBtn) return;
  
  function updateDisplay() {
    const realDate = new Date();
    const virtual = getVirtualDate();
    const current = virtual || realDate;
    
    if (realDateSpan) {
      realDateSpan.textContent = realDate.toLocaleDateString("it-IT");
    }
    if (virtualDateSpan) {
      virtualDateSpan.textContent = virtual 
        ? virtual.toLocaleDateString("it-IT") + " (virtuale)"
        : "Nessuna (reale)";
      virtualDateSpan.style.color = virtual ? "var(--orange)" : "rgba(255,255,255,0.5)";
    }
    if (dateInput) {
      const z = (n) => String(n).padStart(2, "0");
      dateInput.value = `${current.getFullYear()}-${z(current.getMonth() + 1)}-${z(current.getDate())}`;
    }
  }
  
  function changeDate(days) {
    const current = getVirtualDate() || new Date();
    const newDate = new Date(current);
    newDate.setDate(newDate.getDate() + days);
    setVirtualDate(newDate);
    updateDisplay();
    // Ricarica la dashboard
    window.dispatchEvent(new CustomEvent("virtualDateChanged"));
  }
  
  prevBtn.addEventListener("click", () => changeDate(-1));
  nextBtn.addEventListener("click", () => changeDate(1));
  
  resetBtn.addEventListener("click", () => {
    setVirtualDate(null);
    updateDisplay();
    window.dispatchEvent(new CustomEvent("virtualDateChanged"));
  });
  
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });
  }
  
  dateInput.addEventListener("change", (e) => {
    const date = new Date(e.target.value);
    if (!isNaN(date.getTime())) {
      setVirtualDate(date);
      updateDisplay();
      window.dispatchEvent(new CustomEvent("virtualDateChanged"));
    }
  });
  
  // Mostra il pannello
  panel.style.display = "block";
  updateDisplay();
  
  // Aggiorna quando cambia la data virtuale
  window.addEventListener("virtualDateChanged", updateDisplay);
}

// ----------------- DASHBOARD -----------------
function updateTodayProgress(plan, todayDay) {
  const $ = (id) => document.getElementById(id);
  const safeHTML = (id, html) => {
    const el = $(id);
    if (el) el.innerHTML = html ?? "";
    return el;
  };

  const todayTotal = (todayDay?.tasks || []).reduce((a, t) => a + Number(t.minutes || 0), 0);
  const totalTasks = todayDay?.tasks?.length || 0;
  
  let completedTasks = 0;
  let completedMinutes = 0;
  
  if (todayDay?.tasks) {
    for (let i = 0; i < todayDay.tasks.length; i++) {
      const t = todayDay.tasks[i];
      const taskId = makeTaskId({
        weekStartISO: plan.weekStart,
        dateISO: todayDay.dateISO,
        t,
        index: i,
      });
      const doneKey = `sp_task_done_${taskId}`;
      try {
        if (localStorage.getItem(doneKey) === "1") {
          completedTasks++;
          completedMinutes += Number(t.minutes || 0);
        }
      } catch {}
    }
  }

  const progressWrap = safeHTML("today-progress", "");
  if (progressWrap && totalTasks > 0) {
    const taskPct = Math.round((completedTasks / totalTasks) * 100);
    const minutesPct = todayTotal > 0 ? Math.round((completedMinutes / todayTotal) * 100) : 0;
    
    progressWrap.innerHTML = `
      <div class="progressCard">
        <div class="progressHeader">
          <h3>Completamento</h3>
        </div>
        <div class="progressContent">
          <div class="progressDonut">
            <div class="donutLarge" style="--p:${taskPct}">
              <div class="donutLabelLarge">
                <div class="donutPct">${taskPct}%</div>
                <div class="donutSub">${completedTasks}/${totalTasks} task</div>
              </div>
            </div>
          </div>
          <div class="progressStats">
            <div class="progressStat">
              <div class="statLabel">Task</div>
              <div class="statValue">${completedTasks} / ${totalTasks}</div>
            </div>
            <div class="progressStat">
              <div class="statLabel">Minuti</div>
              <div class="statValue">${Math.round(completedMinutes)} / ${Math.round(todayTotal)}</div>
            </div>
            <div class="progressBarWrap">
              <div class="progressBarLabel">Progresso minuti</div>
              <div class="progressBar">
                <div class="progressBarFill" style="width: ${minutesPct}%"></div>
              </div>
              <div class="progressBarText">${minutesPct}%</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (progressWrap) {
    progressWrap.innerHTML = "";
  }
}

function mountApp() {
  const dbg = (msg) => {
    console.log("[APP]", msg);
    const el = document.getElementById("dbg");
    if (el) el.textContent = msg;
  };

  setupMenu();
  setupDebugDatePanel(); // Setup debug date panel (localhost only)

  // Listener per aggiornare quando cambia la data virtuale
  window.addEventListener("virtualDateChanged", async () => {
    // Ricarica la dashboard se l'utente è autenticato
    const currentUser = auth.currentUser;
    if (currentUser && window.location.pathname.includes('app.html')) {
      console.log("[Debug] Data virtuale cambiata, ricarico dashboard...");
      // Forza il reload della pagina per aggiornare tutto
      window.location.reload();
    }
  });

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await logout();
    window.location.assign("./index.html");
  });

  watchAuth(async (user) => {
    try {
      if (!user) {
        dbg("NO USER -> redirect index");
        window.location.assign("./index.html");
        return;
      }

      await reload(user);
      if (!user.emailVerified) {
        try {
          await sendVerificationOrThrow(user);
        } catch (e) {
          console.error("sendEmailVerification failed", e);
        }
        await logout();
        window.location.assign("./index.html");
        return;
      }

      // Imposta temporaneamente l'email, verrà aggiornato con il nome dopo il caricamento del profilo
      document.getElementById("user-line").textContent = user.email ?? "—";

      await ensureUserDoc(user);

      // Processa referral se presente (solo per nuovi utenti)
      const pendingReferralCode = localStorage.getItem('pendingReferralCode');
      console.log("[Referral] ⚠️ DEBUG mountApp - Controllo referral:", {
        hasCode: !!pendingReferralCode,
        code: pendingReferralCode,
        hasFunction: !!processReferral,
        functionType: typeof processReferral,
        uid: user.uid,
        timestamp: new Date().toISOString()
      });
      
      if (pendingReferralCode) {
        if (!processReferral) {
          console.error("[Referral] ❌ ERRORE CRITICO - processReferral non è definito!");
          console.error("[Referral] Verifica che Firebase Functions sia inizializzato correttamente");
          console.error("[Referral] Functions disponibili:", {
            functions: !!functions,
            createCheckoutSession: !!createCheckoutSession,
            getReferralCode: !!getReferralCode
          });
          localStorage.removeItem('pendingReferralCode');
          return;
        }
        
        const profile = await getProfile(user.uid);
        console.log("[Referral] ⚠️ DEBUG mountApp - Profilo utente:", {
          referralProcessed: profile?.referralProcessed,
          hasSubscription: !!profile?.subscription,
          subscriptionStatus: profile?.subscription?.status,
          referralCodeUsed: profile?.referralCodeUsed
        });
        
        // Processa solo se non è già stato processato
        if (!profile?.referralProcessed) {
          console.log("[Referral] ⚠️ DEBUG mountApp - Tentativo di processare referral...");
          console.log("[Referral] Chiamata processReferral con codice:", pendingReferralCode);
          
          try {
            // Processa il referral in background senza bloccare il rendering
            const referralPromise = processReferral({ referralCode: pendingReferralCode });
            console.log("[Referral] Promise creata, in attesa di risposta...");
            
            referralPromise
              .then((result) => {
                console.log("[Referral] ✅ SUCCESSO mountApp - Referral processato:", result);
                console.log("[Referral] Dettagli risultato:", JSON.stringify(result, null, 2));
                showToast("🎉 Referral attivato! Hai ricevuto 7 giorni di Premium.");
                localStorage.removeItem('pendingReferralCode');
                
                // Ricarica la pagina per aggiornare lo stato Premium
                setTimeout(() => {
                  window.location.reload();
                }, 1500);
              })
              .catch((err) => {
                console.error("[Referral] ❌ ERRORE mountApp - Dettagli completi:", {
                  code: err.code,
                  message: err.message,
                  details: err.details,
                  stack: err.stack,
                  name: err.name,
                  toString: err.toString()
                });
                
                // Mostra un messaggio di errore più dettagliato
                let errorMsg = "Errore nell'attivazione del referral.";
                if (err.code === 'not-found') {
                  errorMsg = "Codice referral non trovato. Verifica che il link sia corretto e che l'utente che ha generato il link esista.";
                } else if (err.code === 'already-exists') {
                  errorMsg = "Hai già utilizzato un codice referral.";
                } else if (err.code === 'deadline-exceeded') {
                  errorMsg = "Il codice referral può essere utilizzato solo entro 48 ore dalla registrazione.";
                } else if (err.code === 'permission-denied') {
                  errorMsg = "Non puoi usare il tuo stesso codice referral.";
                } else if (err.message) {
                  errorMsg = err.message;
                }
                
                console.error("[Referral] Messaggio errore mostrato all'utente:", errorMsg);
                showToast(errorMsg, 5000);
                localStorage.removeItem('pendingReferralCode');
              });
          } catch (err) {
            console.error("[Referral] ❌ ERRORE SINCRONO mountApp:", err);
            console.error("[Referral] Stack trace:", err.stack);
            localStorage.removeItem('pendingReferralCode');
          }
        } else {
          console.log("[Referral] ⚠️ DEBUG mountApp - Referral già processato, rimuovo codice");
          console.log("[Referral] Dettagli referral processato:", {
            referralCodeUsed: profile?.referralCodeUsed,
            referralProcessedAt: profile?.referralProcessedAt
          });
          localStorage.removeItem('pendingReferralCode');
        }
      } else {
        console.log("[Referral] ⚠️ DEBUG mountApp - Nessun referral da processare");
      }

      const profile = await getProfile(user.uid);
      
      // Aggiorna il nome nell'header se disponibile
      if (profile?.name) {
        const userLine = document.getElementById("user-line");
        if (userLine) {
          userLine.textContent = `${profile.name} · ${profile.faculty || ""}`;
        }
      }
      
      if (!profile?.goalMode || !profile?.dayMinutes) {
        console.log("[App] Profilo incompleto, redirect a settings:", {
          hasGoalMode: !!profile?.goalMode,
          hasDayMinutes: !!profile?.dayMinutes,
          profileKeys: profile ? Object.keys(profile) : []
        });
        window.location.assign("./settings.html");
        return;
      }
      
      // Gestione premium badge e upgrade button
      const subscriptionInfo = await getSubscriptionInfo(user.uid);
      const isPremiumUser = await isPremium(user.uid);
      
      const premiumBadge = qs("premium-badge");
      const upgradeBtn = qs("upgrade-btn");
      
      if (premiumBadge) {
        if (isPremiumUser) {
          premiumBadge.textContent = "Premium";
          premiumBadge.className = "badge good";
          premiumBadge.style.display = "inline-block";
          if (upgradeBtn) upgradeBtn.style.display = "none";
        } else {
          premiumBadge.style.display = "none";
          if (upgradeBtn) {
            upgradeBtn.style.display = "inline-block";
            upgradeBtn.addEventListener("click", () => showUpgradeModal());
          }
        }
      }
      
      // Aggiungi bottone di test premium (solo in localhost)
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.href.includes('localhost')) {
        const testBtn = document.createElement("button");
        testBtn.className = "btn";
        testBtn.style.cssText = "margin-right: 12px; font-size: 11px; padding: 6px 12px; background: rgba(245,158,11,0.2); border-color: rgba(245,158,11,0.4); color: rgba(245,158,11,1);";
        testBtn.textContent = isPremiumUser ? "🧪 Test: Disattiva Premium" : "🧪 Test: Attiva Premium";
        testBtn.addEventListener("click", async () => {
          await testPremium(!isPremiumUser);
          setTimeout(() => window.location.reload(), 1000);
        });
        const toolbar = document.querySelector(".toolbar");
        if (toolbar && !toolbar.querySelector(".test-premium-btn")) {
          testBtn.classList.add("test-premium-btn");
          toolbar.insertBefore(testBtn, toolbar.firstChild);
        }
      }

      let exams = await listExams(user.uid);
      
      // Controlla appelli passati e mostra popup se necessario
      await checkAndHandlePassedAppelli(user.uid, exams);
      
      // Ricarica esami dopo eventuali modifiche dal popup
      exams = await listExams(user.uid);
      
      if (exams.length === 0) {
        console.log("[App] Nessun esame trovato, redirect a settings. Esami:", exams);
        window.location.assign("./settings.html");
        return;
      }
      
      console.log("[App] Tutto ok, carico dashboard. Esami:", exams.length);

      const weekStart = startOfWeekISO(getCurrentDate());
      const weekStartISO = `${weekStart.getFullYear()}-${z2(weekStart.getMonth() + 1)}-${z2(
        weekStart.getDate()
      )}`;

      // Assicura che tutti gli esami abbiano una category valida
      const normalizedExams = exams.map(e => ({
        ...e,
        category: e.category || detectExamCategory(e.name || "") || "mixed"
      }));
      
      let plan = await loadWeeklyPlan(user.uid, weekStartISO);
      if (!plan) {
        console.log("[App] Nessun piano salvato, genero nuovo piano...");
        plan = generateWeeklyPlan(profile, normalizedExams, weekStart);
        // Aggiungi snapshot per future comparazioni
        addSnapshotToPlan(plan, profile, normalizedExams);
        await saveWeeklyPlan(user.uid, weekStartISO, plan);
        console.log("[App] Nuovo piano generato e salvato:", {
          weekStart: plan.weekStart,
          allocations: plan.allocations.length,
          totalTasks: plan.days.reduce((sum, d) => sum + (d.tasks?.length || 0), 0)
        });
      } else {
        // Verifica se ci sono modifiche e rigenera se necessario
        const needsRegeneration = hasPlanChanges(profile, normalizedExams, plan);
        if (needsRegeneration) {
          console.log("[App] Rilevate modifiche, rigenero il piano...");
          
          // Salva le modifiche manuali ai task prima di rigenerare
          // Crea una mappa delle modifiche manuali usando una chiave composta: dateISO_examId_index
          // Questo permette di preservare le modifiche anche se gli ID cambiano
          const manualTaskModifications = new Map();
          if (plan.days) {
            for (const day of plan.days) {
              if (day.tasks) {
                for (let i = 0; i < day.tasks.length; i++) {
                  const task = day.tasks[i];
                  // Crea una chiave univoca basata su dateISO, examId e posizione
                  const key = `${day.dateISO}_${task.examId}_${i}`;
                  manualTaskModifications.set(key, {
                    label: task.label,
                    type: task.type,
                    minutes: task.minutes,
                    examId: task.examId,
                    examName: task.examName,
                    dateISO: day.dateISO,
                    index: i
                  });
                }
              }
            }
          }
          
          // Salva lo stato di completamento dei task prima di rigenerare
          // Usa una chiave stabile (senza index e weekStartISO) per preservare lo stato
          const completedTasksMap = new Map(); // stableKey -> true
          const skippedTasksMap = new Map(); // stableKey -> true
          if (plan.days) {
            for (const day of plan.days) {
              if (day.tasks) {
                for (let i = 0; i < day.tasks.length; i++) {
                  const task = day.tasks[i];
                  const oldTaskId = makeTaskId({
                    weekStartISO: plan.weekStart,
                    dateISO: day.dateISO,
                    t: task,
                    index: i,
                  });
                  const stableKey = makeStableTaskKey({
                    dateISO: day.dateISO,
                    t: task,
                  });
                  
                  // Controlla se il task era completato
                  try {
                    const doneKey = `sp_task_done_${oldTaskId}`;
                    if (localStorage.getItem(doneKey) === "1") {
                      completedTasksMap.set(stableKey, true);
                      console.log("[App] Task completato salvato per ripristino:", {
                        stableKey,
                        dateISO: day.dateISO,
                        examId: task.examId,
                        label: task.label
                      });
                    }
                  } catch (e) {
                    console.warn("[App] Errore lettura stato completamento:", e);
                  }
                  
                  // Controlla se il task era saltato
                  try {
                    const skippedKey = `sp_task_skipped_${oldTaskId}`;
                    if (localStorage.getItem(skippedKey) === "1") {
                      skippedTasksMap.set(stableKey, true);
                    }
                  } catch (e) {
                    // Ignora errori
                  }
                }
              }
            }
          }
          
          console.log("[App] Task completati da preservare:", completedTasksMap.size);
          console.log("[App] Task saltati da preservare:", skippedTasksMap.size);
          
          // Salva i task aggiunti manualmente prima della rigenerazione
          const manualTasks = plan.manualTasks || [];
          
          // Rigenera il piano
          const newPlan = generateWeeklyPlan(profile, normalizedExams, weekStart);
          
          // Ripristina le modifiche manuali ai task dopo la rigenerazione
          if (manualTaskModifications.size > 0) {
            console.log("[App] Ripristino modifiche manuali ai task:", manualTaskModifications.size);
            for (const day of newPlan.days || []) {
              if (day.tasks) {
                for (let i = 0; i < day.tasks.length; i++) {
                  const task = day.tasks[i];
                  const key = `${day.dateISO}_${task.examId}_${i}`;
                  const manualMod = manualTaskModifications.get(key);
                  if (manualMod && manualMod.examId === task.examId) {
                    // Ripristina le modifiche manuali solo se il task corrisponde
                    task.label = manualMod.label;
                    task.type = manualMod.type;
                    task.minutes = manualMod.minutes;
                    console.log("[App] Task ripristinato:", {
                      key,
                      label: task.label,
                      type: task.type,
                      minutes: task.minutes
                    });
                  }
                }
              }
            }
          }
          
          // Ripristina i task aggiunti manualmente
          if (manualTasks.length > 0) {
            console.log("[App] Ripristino task aggiunti manualmente:", manualTasks.length);
            for (const manualTask of manualTasks) {
              const day = newPlan.days?.find(d => d.dateISO === manualTask.dateISO);
              if (day) {
                // Verifica che il task non esista già (per evitare duplicati)
                const exists = day.tasks?.some(t => t.id === manualTask.task.id);
                if (!exists) {
                  if (!day.tasks) day.tasks = [];
                  day.tasks.push({ ...manualTask.task });
                  console.log("[App] Task manuale ripristinato:", {
                    dateISO: manualTask.dateISO,
                    taskId: manualTask.task.id,
                    label: manualTask.task.label
                  });
                }
              }
            }
            // Ripristina anche l'array manualTasks nel nuovo piano
            newPlan.manualTasks = manualTasks;
          }
          
          // Ripristina lo stato di completamento dei task
          if (completedTasksMap.size > 0 || skippedTasksMap.size > 0) {
            console.log("[App] Ripristino stato completamento task...");
            let restoredCount = 0;
            let skippedRestoredCount = 0;
            
            for (const day of newPlan.days || []) {
              if (day.tasks) {
                for (let i = 0; i < day.tasks.length; i++) {
                  const task = day.tasks[i];
                  const stableKey = makeStableTaskKey({
                    dateISO: day.dateISO,
                    t: task,
                  });
                  
                  // Ripristina stato completato
                  if (completedTasksMap.has(stableKey)) {
                    const newTaskId = makeTaskId({
                      weekStartISO: newPlan.weekStart,
                      dateISO: day.dateISO,
                      t: task,
                      index: i,
                    });
                    try {
                      localStorage.setItem(`sp_task_done_${newTaskId}`, "1");
                      restoredCount++;
                      console.log("[App] ✓ Stato completato ripristinato:", {
                        stableKey,
                        newTaskId,
                        dateISO: day.dateISO,
                        examId: task.examId,
                        label: task.label
                      });
                    } catch (e) {
                      console.warn("[App] Errore ripristino stato completato:", e);
                    }
                  }
                  
                  // Ripristina stato saltato
                  if (skippedTasksMap.has(stableKey)) {
                    const newTaskId = makeTaskId({
                      weekStartISO: newPlan.weekStart,
                      dateISO: day.dateISO,
                      t: task,
                      index: i,
                    });
                    try {
                      localStorage.setItem(`sp_task_skipped_${newTaskId}`, "1");
                      skippedRestoredCount++;
                    } catch (e) {
                      console.warn("[App] Errore ripristino stato saltato:", e);
                    }
                  }
                }
              }
            }
            
            console.log("[App] Stato completamento ripristinato:", {
              completati: restoredCount,
              saltati: skippedRestoredCount
            });
          }
          
          plan = newPlan;
          addSnapshotToPlan(plan, profile, normalizedExams);
          await saveWeeklyPlan(user.uid, weekStartISO, plan);
          console.log("[App] Piano rigenerato e salvato:", {
            weekStart: plan.weekStart,
            allocations: plan.allocations.length,
            totalTasks: plan.days.reduce((sum, d) => sum + (d.tasks?.length || 0), 0)
          });
        } else {
          console.log("[App] Nessuna modifica rilevata, uso piano esistente.");
          // Controlla se ci sono aggiornamenti manuali al piano (es. task modificati)
          // Ricarica il piano dal server per assicurarsi di avere la versione più recente
          const latestPlan = await loadWeeklyPlan(user.uid, weekStartISO, true);
          if (latestPlan) {
            console.log("[App] Piano ricaricato dal server per verificare aggiornamenti manuali");
            plan = latestPlan;
          }
        }
      }

      await renderDashboard(plan, normalizedExams, profile, user, weekStartISO);
      // Associa il bottone per aggiungere task manuali dopo il primo render
      bindAddTaskButton(plan, normalizedExams, profile, user, weekStartISO);
      
      // Setup bottoni esporta e condividi piano
      setupPlanExportButtons(plan, normalizedExams, profile, user, weekStartISO);

      // Listener per aggiornare la dashboard quando un task viene modificato
      // Solo se siamo nella pagina app.html
      if (window.location.pathname.includes('app.html')) {
        const planUpdateKey = `plan_updated_${user.uid}_${weekStartISO}`;
        let lastPlanUpdate = null;
        try {
          lastPlanUpdate = localStorage.getItem(planUpdateKey);
          console.log("[Dashboard] Listener aggiornamento piano inizializzato:", { planUpdateKey, lastPlanUpdate });
        } catch (e) {
          console.warn("[Dashboard] Errore lettura localStorage:", e);
        }

        const refreshDashboard = async () => {
          try {
            console.log("[Dashboard] Aggiornamento dashboard richiesto...");
            
            // Ricarica esami (potrebbero essere cambiati se un esame è stato superato)
            const updatedExams = await listExams(user.uid);
            
            if (updatedExams.length === 0) {
              console.log("[Dashboard] Nessun esame disponibile dopo aggiornamento, redirect a settings");
              window.location.assign("./settings.html");
              return;
            }
            
            // Normalizza esami aggiornati
            const updatedNormalizedExams = updatedExams.map(e => ({
              ...e,
              category: e.category || detectExamCategory(e.name || "") || "mixed"
            }));
            
            // Forza il refresh del piano dal server
            const updatedPlan = await loadWeeklyPlan(user.uid, weekStartISO, true);
            
            if (updatedPlan) {
              const todayISO = isoToday();
              const todayDay = updatedPlan.days?.find((d) => d.dateISO === todayISO) || updatedPlan.days?.[0] || null;
              
              console.log("[Dashboard] Piano e esami ricaricati:", {
                weekStart: updatedPlan.weekStart,
                daysCount: updatedPlan.days?.length,
                totalTasks: updatedPlan.days?.reduce((sum, d) => sum + (d.tasks?.length || 0), 0),
                examsCount: updatedNormalizedExams.length,
                todayISO,
                todayTasks: todayDay?.tasks?.length || 0
              });
              
              // Ri-renderizza la dashboard completa con esami aggiornati
              await renderDashboard(updatedPlan, updatedNormalizedExams, profile, user, weekStartISO);
              bindAddTaskButton(updatedPlan, updatedNormalizedExams, profile, user, weekStartISO);
              updateTodayProgress(updatedPlan, todayDay);
              
              console.log("[Dashboard] Dashboard aggiornata con successo");
            } else {
              console.warn("[Dashboard] Piano non trovato dopo aggiornamento, potrebbe essere stato invalidato");
              // Se il piano non esiste, potrebbe essere stato invalidato, ricarica la pagina
              window.location.reload();
            }
          } catch (err) {
            console.error("[Dashboard] Errore ricaricamento dashboard:", err);
          }
        };

        // Handler per eventi planUpdated (stessa scheda)
        const handlePlanUpdated = async (e) => {
          console.log("[Dashboard] Evento planUpdated ricevuto:", e.detail);
          if (e.detail?.weekStartISO === weekStartISO) {
            console.log("[Dashboard] weekStartISO corrisponde, aggiorno dashboard");
            await refreshDashboard();
          } else {
            console.log("[Dashboard] weekStartISO non corrisponde:", {
              received: e.detail?.weekStartISO,
              expected: weekStartISO
            });
          }
        };

        // Handler per eventi storage (altre schede)
        const handleStorageChange = async (e) => {
          console.log("[Dashboard] Evento storage ricevuto:", { key: e.key, newValue: e.newValue, oldValue: e.oldValue });
          if (e.key === planUpdateKey && e.newValue !== lastPlanUpdate) {
            console.log("[Dashboard] Storage change rilevato, aggiorno dashboard");
            lastPlanUpdate = e.newValue;
            await refreshDashboard();
          }
        };

        // Aggiungi listener (rimuovi quelli precedenti se esistono)
        window.removeEventListener('planUpdated', handlePlanUpdated);
        window.removeEventListener('storage', handleStorageChange);
        window.addEventListener('planUpdated', handlePlanUpdated);
        window.addEventListener('storage', handleStorageChange);
        console.log("[Dashboard] Listener aggiunti per aggiornamento piano:", {
          planUpdateKey,
          weekStartISO,
          hasHandlePlanUpdated: typeof handlePlanUpdated === 'function',
          hasHandleStorageChange: typeof handleStorageChange === 'function'
        });

        // Polling periodico come fallback (controlla ogni 1 secondo per essere più reattivo)
        let pollInterval = null;
        const startPolling = () => {
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = setInterval(async () => {
            try {
              const currentUpdate = localStorage.getItem(planUpdateKey);
              if (currentUpdate && currentUpdate !== lastPlanUpdate) {
                console.log("[Dashboard] Polling: rilevato aggiornamento piano", {
                  old: lastPlanUpdate,
                  new: currentUpdate
                });
                lastPlanUpdate = currentUpdate;
                await refreshDashboard();
              }
            } catch (e) {
              // Ignora errori di localStorage
            }
          }, 1000); // Ridotto a 1 secondo per essere più reattivo
        };
        startPolling();
        console.log("[Dashboard] Polling avviato (controllo ogni 1 secondo)");
        
        // Test immediato: verifica se c'è già un aggiornamento pendente
        try {
          const currentUpdate = localStorage.getItem(planUpdateKey);
          if (currentUpdate && currentUpdate !== lastPlanUpdate) {
            console.log("[Dashboard] Aggiornamento pendente rilevato all'avvio, aggiorno immediatamente");
            lastPlanUpdate = currentUpdate;
            await refreshDashboard();
          }
        } catch (e) {
          console.warn("[Dashboard] Errore verifica aggiornamento pendente:", e);
        }
        
        // Listener per quando cambia lo stato di un esame (superato, appello cambiato, ecc.)
        const handleExamStatusChanged = async (e) => {
          console.log("[Dashboard] Evento examStatusChanged ricevuto:", e.detail);
          await refreshDashboard();
        };
        window.addEventListener('examStatusChanged', handleExamStatusChanged);
        
        // Listener per quando la pagina diventa visibile (utente torna sulla scheda)
        const handleVisibilityChange = async () => {
          if (!document.hidden) {
            console.log("[Dashboard] Pagina diventata visibile, verifico aggiornamenti");
            try {
              const currentUpdate = localStorage.getItem(planUpdateKey);
              if (currentUpdate && currentUpdate !== lastPlanUpdate) {
                console.log("[Dashboard] Aggiornamento rilevato quando pagina diventa visibile");
                lastPlanUpdate = currentUpdate;
                await refreshDashboard();
              }
            } catch (e) {
              console.warn("[Dashboard] Errore verifica aggiornamento su visibility change:", e);
            }
          }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        console.log("[Dashboard] Listener visibilitychange aggiunto");

        // Pulisci l'intervallo quando la pagina viene chiusa
        window.addEventListener('beforeunload', () => {
          if (pollInterval) clearInterval(pollInterval);
          window.removeEventListener('planUpdated', handlePlanUpdated);
          window.removeEventListener('storage', handleStorageChange);
        });
      }

      document.getElementById("mark-today-done")?.addEventListener("click", async () => {
        document.getElementById("status-line").textContent = "Segnato: oggi completato (MVP).";
      });

      document.getElementById("mark-today-less")?.addEventListener("click", async () => {
        document.getElementById("status-line").textContent = "Segnato: oggi sotto target (MVP).";
      });
    } catch (e) {
      console.error(e);
      dbg("CRASH: " + (e?.message || e));
    }
  });
}

async function renderDashboard(plan, exams, profile, user = null, weekStartISO = null) {
  const $ = (id) => document.getElementById(id);

  const safeText = (id, txt) => {
    const el = $(id);
    if (el) el.textContent = txt ?? "";
  };
  const safeHTML = (id, html) => {
    const el = $(id);
    if (el) el.innerHTML = html ?? "";
    return el;
  };

  const todayISO = isoToday();

  // Calcola le ore settimanali progressive se l'allenatore è attivo (solo per utenti premium)
  let weeklyHoursDisplay = Math.round(plan.weeklyBudgetMin / 60);
  let weeklyHoursProgression = null;
  
  // Verifica se l'utente è premium
  let isPremiumUser = false;
  if (user) {
    try {
      isPremiumUser = await isPremium(user.uid);
    } catch (err) {
      console.error("Errore verifica premium:", err);
    }
  }
  
  if (isPremiumUser && profile && profile.currentHours && profile.targetHours && profile.targetHours > profile.currentHours) {
    // Allenatore attivo: calcola le ore progressive
    // Usa coachStartDate dal profilo o localStorage (sincrono)
    let coachStartDateValue = null;
    if (profile.coachStartDate) {
      try {
        coachStartDateValue = new Date(profile.coachStartDate);
      } catch {}
    }
    if (!coachStartDateValue) {
      try {
        const saved = localStorage.getItem('coach_start_date');
        if (saved) coachStartDateValue = new Date(saved);
      } catch {}
    }
    
    const suggestedHours = calculateSuggestedWeeklyHours(
      profile.currentHours,
      profile.targetHours,
      exams,
      coachStartDateValue
    );
    
    weeklyHoursDisplay = Math.round(suggestedHours * 10) / 10;
    
    // Calcola informazioni sulla progressione
    // Usa getCurrentDate() per supportare date virtuali in localhost
    const now = getCurrentDate();
    now.setHours(0, 0, 0, 0);
    let weekStart;
    if (coachStartDateValue) {
      weekStart = new Date(coachStartDateValue);
      weekStart.setHours(0, 0, 0, 0);
    } else {
      weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
    }
    
    const weeksSinceStart = Math.floor((now - weekStart) / (7 * 24 * 60 * 60 * 1000));
    const currentWeek = Math.max(0, weeksSinceStart);
    
    // Trova l'esame più vicino per calcolare quante settimane totali abbiamo
    let minWeeksToExam = Infinity;
    for (const exam of exams) {
      if (!exam.date) continue;
      const examDate = new Date(exam.date);
      examDate.setHours(0, 0, 0, 0);
      const weeksToExam = Math.ceil((examDate - weekStart) / (7 * 24 * 60 * 60 * 1000));
      if (weeksToExam > 0 && weeksToExam < minWeeksToExam) {
        minWeeksToExam = weeksToExam;
      }
    }
    const totalWeeks = minWeeksToExam === Infinity ? 8 : Math.min(minWeeksToExam, 12);
    
    weeklyHoursProgression = {
      current: suggestedHours,
      start: profile.currentHours,
      target: profile.targetHours,
      week: currentWeek + 1,
      totalWeeks: totalWeeks
    };
  }
  
  // Aggiorna la visualizzazione
  let metaText = `dal ${plan.weekStart} · budget ${weeklyHoursDisplay}h · task ${plan.taskMinutes}m`;
  
  if (weeklyHoursProgression) {
    // Aggiungi indicatore di progressione
    const progressPct = Math.round(((weeklyHoursProgression.current - weeklyHoursProgression.start) / (weeklyHoursProgression.target - weeklyHoursProgression.start)) * 100);
    metaText += ` · settimana ${weeklyHoursProgression.week}/${weeklyHoursProgression.totalWeeks} (${progressPct}%)`;
  }
  
  safeText("week-meta", metaText);
  safeText("today-meta", todayISO);

  const todayDay = plan.days?.find((d) => d.dateISO === todayISO) || plan.days?.[0] || null;

  const todayTotal = (todayDay?.tasks || []).reduce((a, t) => a + Number(t.minutes || 0), 0);
  safeText(
    "today-pill",
    `Target oggi: ${Math.round(todayTotal)} min · ${Math.round((todayTotal / 60) * 10) / 10}h`
  );

  // Calcola statistiche di completamento
  let completedTasks = 0;
  let completedMinutes = 0;
  const totalTasks = todayDay?.tasks?.length || 0;
  
  if (todayDay?.tasks) {
    for (let i = 0; i < todayDay.tasks.length; i++) {
      const t = todayDay.tasks[i];
      const taskId = makeTaskId({
        weekStartISO: plan.weekStart,
        dateISO: todayDay.dateISO,
        t,
        index: i,
      });
      const doneKey = `sp_task_done_${taskId}`;
      try {
        if (localStorage.getItem(doneKey) === "1") {
          completedTasks++;
          completedMinutes += Number(t.minutes || 0);
        }
      } catch {}
    }
  }

  // Renderizza grafico di completamento
  const progressWrap = safeHTML("today-progress", "");
  if (progressWrap && totalTasks > 0) {
    const taskPct = Math.round((completedTasks / totalTasks) * 100);
    const minutesPct = todayTotal > 0 ? Math.round((completedMinutes / todayTotal) * 100) : 0;
    
    progressWrap.innerHTML = `
      <div class="progressCard">
        <div class="progressHeader">
          <h3>Completamento</h3>
        </div>
        <div class="progressContent">
          <div class="progressDonut">
            <div class="donutLarge" style="--p:${taskPct}">
              <div class="donutLabelLarge">
                <div class="donutPct">${taskPct}%</div>
                <div class="donutSub">${completedTasks}/${totalTasks} task</div>
              </div>
            </div>
          </div>
          <div class="progressStats">
            <div class="progressStat">
              <div class="statLabel">Task</div>
              <div class="statValue">${completedTasks} / ${totalTasks}</div>
            </div>
            <div class="progressStat">
              <div class="statLabel">Minuti</div>
              <div class="statValue">${Math.round(completedMinutes)} / ${Math.round(todayTotal)}</div>
            </div>
            <div class="progressBarWrap">
              <div class="progressBarLabel">Progresso minuti</div>
              <div class="progressBar">
                <div class="progressBarFill" style="width: ${minutesPct}%"></div>
              </div>
              <div class="progressBarText">${minutesPct}%</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (progressWrap) {
    progressWrap.innerHTML = "";
  }

  const todayWrap = safeHTML("today-tasks", "");
  if (!todayWrap) {
    safeText("status-line", "Dashboard HTML incompleta: manca #today-tasks.");
    return;
  }

  console.log("[renderDashboard] Rendering dashboard:", {
    todayISO,
    todayDayExists: !!todayDay,
    todayTasksCount: todayDay?.tasks?.length || 0,
    todayTasks: todayDay?.tasks?.map(t => ({
      id: t.id,
      label: t.label,
      type: t.type,
      minutes: t.minutes
    })) || []
  });

  if (!todayDay || !todayDay.tasks || todayDay.tasks.length === 0) {
    todayWrap.innerHTML = `<div class="callout"><h3>Vuoto</h3><p>Nessun task oggi. Controlla disponibilità o rigenera.</p></div>`;
  } else {
    // Raggruppa task per periodo
    const morningTasks = [];
    const afternoonTasks = [];
    
    for (let i = 0; i < todayDay.tasks.length; i++) {
      const t = todayDay.tasks[i];
      const period = t.period || "morning"; // default a morning se non specificato
      if (period === "morning") {
        morningTasks.push({ task: t, index: i });
      } else {
        afternoonTasks.push({ task: t, index: i });
      }
    }

    // Funzione helper per renderizzare una task compatta
    const renderCompactTask = (t, i, period) => {
      const taskId = makeTaskId({
        weekStartISO: plan.weekStart,
        dateISO: todayDay.dateISO,
        t,
        index: i,
      });

      const doneKey = `sp_task_done_${taskId}`;
      const skippedKey = `sp_task_skipped_${taskId}`;
      const isDone = (() => {
        try {
          return localStorage.getItem(doneKey) === "1";
        } catch {
          return false;
        }
      })();
      const isSkipped = (() => {
        try {
          return localStorage.getItem(skippedKey) === "1";
        } catch {
          return false;
        }
      })();

      const row = document.createElement("div");
      row.className = `task taskClickable taskCompact ${isDone ? "taskDone" : ""} ${isSkipped ? "taskSkipped" : ""}`;
      row.dataset.taskid = taskId;
      row.draggable = true;
      row.dataset.originalIndex = i;
      row.dataset.period = period;

      row.innerHTML = `
        <div class="taskDragHandle" title="Trascina per riordinare">⋮⋮</div>
        <input type="checkbox" class="taskChk" ${isDone ? "checked" : ""} ${isSkipped ? "disabled" : ""} />
        <div class="taskCompactContent">
          <div class="taskCompactTitle">${escapeHtml(t.examName)}${isSkipped ? ' <span class="taskSkippedBadge">⏭ Saltato</span>' : ''}</div>
          <div class="taskCompactMeta">
            <span class="tag tagSmall">${escapeHtml(t.type)}</span>
            <span class="taskMinutes">${t.minutes}m</span>
          </div>
        </div>
      `;

      const chk = row.querySelector(".taskChk");
      chk?.addEventListener("click", (e) => {
        e.stopPropagation();
        // Se il task è saltato, impedisci il toggle
        if (isSkipped) {
          e.preventDefault();
          chk.checked = false;
        }
      });
      chk?.addEventListener("change", async (e) => {
        // Se il task è saltato, non permettere di segnarlo come fatto
        if (isSkipped) {
          chk.checked = false;
          return;
        }
        const checked = chk.checked;
        try {
          if (checked) {
            localStorage.setItem(doneKey, "1");
            localStorage.removeItem(skippedKey); // Rimuovi skipped se viene segnato come fatto
          } else {
            localStorage.removeItem(doneKey);
          }
        } catch {}
        row.classList.toggle("taskDone", checked);
        // Aggiorna il grafico di completamento
        updateTodayProgress(plan, todayDay);
        
        // Aggiorna automaticamente il livello dell'esame se la task è stata completata
        if (checked && user && t?.examId) {
          try {
            const exams = await listExams(user.uid);
            // Trova l'esame (può essere con appelli)
            let exam = exams.find(e => {
              if (e.id === t.examId) return true;
              if (e.appelli && Array.isArray(e.appelli)) {
                const selectedAppelli = e.appelli.filter(a => a.selected !== false);
                for (const appello of selectedAppelli) {
                  if (`${e.id}_${appello.date}` === t.examId) return true;
                }
              }
              return false;
            });
            
            // Se non trovato per ID, prova per nome
            if (!exam && t.examName) {
              exam = exams.find(e => e.name === t.examName);
            }
            
            if (exam) {
              await updateExamLevelAutomatically(user.uid, exam);
            }
          } catch (err) {
            console.error("Errore aggiornamento livello esame:", err);
            // Non bloccare l'utente se c'è un errore
          }
        }
      });

      // Click handler (solo se non è un drag)
      let dragStartTime = 0;
      row.addEventListener("mousedown", () => {
        dragStartTime = Date.now();
      });
      row.addEventListener("click", (e) => {
        // Se il click è avvenuto subito dopo il mousedown (non è un drag), apri la pagina
        if (Date.now() - dragStartTime < 200) {
          openTaskPage({
            taskId,
            dateISO: todayDay.dateISO,
            weekStartISO: plan.weekStart,
            task: t,
          });
        }
      });

      // Drag handlers - solo sull'handle
      const dragHandle = row.querySelector(".taskDragHandle");
      if (dragHandle) {
        dragHandle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
        });
      }

      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", taskId);
        row.classList.add("dragging");
        // Crea un'immagine personalizzata per il drag
        const dragImage = row.cloneNode(true);
        dragImage.style.opacity = "0.8";
        dragImage.style.transform = "rotate(2deg)";
        document.body.appendChild(dragImage);
        dragImage.style.position = "absolute";
        dragImage.style.top = "-1000px";
        e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);
        setTimeout(() => document.body.removeChild(dragImage), 0);
      });

      row.addEventListener("dragend", (e) => {
        row.classList.remove("dragging");
        document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      });

      return row;
    };

    // Funzione per setup drag & drop su una lista
    const setupDragAndDrop = (listElement, targetPeriod) => {
      let dropIndicator = null;
      let lastInsertPosition = -1;
      let throttleTimeout = null;
      
      listElement.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        listElement.classList.add("drag-over");
        
        // Throttle per evitare troppi aggiornamenti
        if (throttleTimeout) return;
        throttleTimeout = setTimeout(() => {
          throttleTimeout = null;
        }, 50);
        
        // Trova l'elemento dopo il cursore (senza spostare nulla)
        const afterElement = getDragAfterElement(listElement, e.clientY);
        
        // Calcola la posizione di inserimento
        const allTasks = Array.from(listElement.querySelectorAll(".taskCompact:not(.dragging)"));
        let insertPosition;
        if (afterElement) {
          insertPosition = allTasks.indexOf(afterElement);
        } else {
          insertPosition = allTasks.length;
        }
        
        // Solo aggiorna se la posizione è cambiata
        if (insertPosition !== lastInsertPosition) {
          lastInsertPosition = insertPosition;
          
          // Rimuovi indicatore precedente se esiste
          if (dropIndicator && dropIndicator.parentNode) {
            dropIndicator.remove();
          }
          
          // Crea nuovo indicatore
          dropIndicator = document.createElement("div");
          dropIndicator.className = "drop-indicator";
          
          if (afterElement == null || insertPosition >= allTasks.length) {
            listElement.appendChild(dropIndicator);
          } else {
            listElement.insertBefore(dropIndicator, afterElement);
          }
        }
      });

      listElement.addEventListener("dragleave", (e) => {
        // Controlla se stiamo realmente uscendo dalla lista
        const rect = listElement.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        
        // Se il mouse è fuori dai bordi della lista
        if (x < rect.left - 10 || x > rect.right + 10 || y < rect.top - 10 || y > rect.bottom + 10) {
          listElement.classList.remove("drag-over");
          if (dropIndicator && dropIndicator.parentNode) {
            dropIndicator.remove();
            dropIndicator = null;
          }
          lastInsertPosition = -1;
        }
      });

      listElement.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        listElement.classList.remove("drag-over");
        lastInsertPosition = -1;
        if (throttleTimeout) {
          clearTimeout(throttleTimeout);
          throttleTimeout = null;
        }
        
        const taskId = e.dataTransfer.getData("text/plain");
        const draggedElement = document.querySelector(`[data-taskid="${taskId}"]`);
        if (!draggedElement || !user || !weekStartISO) {
          if (dropIndicator && dropIndicator.parentNode) {
            dropIndicator.remove();
            dropIndicator = null;
          }
          return;
        }

        // Calcola la posizione di drop usando l'indicatore
        const allTasksInList = Array.from(listElement.querySelectorAll(".taskCompact:not(.dragging)"));
        let dropIndex = allTasksInList.length;
        
        if (dropIndicator && dropIndicator.parentNode) {
          // Trova la posizione dell'indicatore
          const allChildren = Array.from(listElement.children);
          const indicatorPos = allChildren.indexOf(dropIndicator);
          
          // Conta le task prima dell'indicatore
          dropIndex = 0;
          for (let i = 0; i < indicatorPos; i++) {
            if (allChildren[i].classList.contains("taskCompact")) {
              dropIndex++;
            }
          }
          
          dropIndicator.remove();
          dropIndicator = null;
        }
        
        // Aggiorna il piano
        const originalIndex = parseInt(draggedElement.dataset.originalIndex);
        const originalPeriod = draggedElement.dataset.period;
        const newPeriod = targetPeriod;
        
        // Rimuovi la task dalla posizione originale
        const taskToMove = todayDay.tasks[originalIndex];
        todayDay.tasks.splice(originalIndex, 1);
        
        // Raggruppa le task rimanenti per periodo
        const remainingMorning = [];
        const remainingAfternoon = [];
        todayDay.tasks.forEach((t) => {
          const p = t.period || "morning";
          if (p === "morning") remainingMorning.push(t);
          else remainingAfternoon.push(t);
        });
        
        // Aggiorna il periodo
        taskToMove.period = newPeriod;
        
        // Calcola l'indice corretto considerando se stiamo cambiando periodo
        let insertIndex;
        if (newPeriod === "morning") {
          if (originalPeriod === "afternoon") {
            // Viene da pomeriggio, inserisci alla posizione dropIndex
            insertIndex = Math.min(dropIndex, remainingMorning.length);
          } else {
            // Stesso periodo, aggiusta per la rimozione
            const adjustedIndex = originalIndex < dropIndex ? dropIndex - 1 : dropIndex;
            insertIndex = Math.max(0, Math.min(adjustedIndex, remainingMorning.length));
          }
          remainingMorning.splice(insertIndex, 0, taskToMove);
        } else {
          if (originalPeriod === "morning") {
            // Viene da mattina, inserisci alla posizione dropIndex
            insertIndex = Math.min(dropIndex, remainingAfternoon.length);
          } else {
            // Stesso periodo, aggiusta per la rimozione
            const morningCount = remainingMorning.length;
            const adjustedIndex = (originalIndex - morningCount) < dropIndex ? dropIndex - 1 : dropIndex;
            insertIndex = Math.max(0, Math.min(adjustedIndex, remainingAfternoon.length));
          }
          remainingAfternoon.splice(insertIndex, 0, taskToMove);
        }
        
        // Ricostruisci l'array tasks
        todayDay.tasks = [...remainingMorning, ...remainingAfternoon];
        
        // Salva il piano aggiornato
        try {
          await saveWeeklyPlan(user.uid, weekStartISO, plan);
          // Ri-renderizza per aggiornare gli indici
          await renderDashboard(plan, exams, profile, user, weekStartISO);
          bindAddTaskButton(plan, exams, profile, user, weekStartISO);
        } catch (err) {
          console.error("Errore salvataggio dopo drag:", err);
          alert("Errore durante lo spostamento. Riprova.");
        }
      });
    };

    // Funzione helper per trovare l'elemento dopo il cursore
    const getDragAfterElement = (container, y) => {
      const draggableElements = [...container.querySelectorAll(".taskCompact:not(.dragging)")];
      
      if (draggableElements.length === 0) return null;
      
      return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    };

    // Renderizza sempre entrambe le sezioni (anche se vuote) per permettere il drop
    const morningSection = document.createElement("div");
    morningSection.className = "taskPeriodSection";
    morningSection.innerHTML = `
      <div class="taskPeriodHeader">
        <span class="taskPeriodLabel">Mattina</span>
        <span class="taskPeriodCount">${morningTasks.length}</span>
      </div>
      <div class="taskPeriodList" data-period="morning"></div>
    `;
    const morningList = morningSection.querySelector(".taskPeriodList");
    morningTasks.forEach(({ task, index }) => {
      morningList.appendChild(renderCompactTask(task, index, "morning"));
    });
    setupDragAndDrop(morningList, "morning");
    todayWrap.appendChild(morningSection);

    // Renderizza sezione pomeriggio
    const afternoonSection = document.createElement("div");
    afternoonSection.className = "taskPeriodSection";
    afternoonSection.innerHTML = `
      <div class="taskPeriodHeader">
        <span class="taskPeriodLabel">Pomeriggio</span>
        <span class="taskPeriodCount">${afternoonTasks.length}</span>
      </div>
      <div class="taskPeriodList" data-period="afternoon"></div>
    `;
    const afternoonList = afternoonSection.querySelector(".taskPeriodList");
    afternoonTasks.forEach(({ task, index }) => {
      afternoonList.appendChild(renderCompactTask(task, index, "afternoon"));
    });
    setupDragAndDrop(afternoonList, "afternoon");
    todayWrap.appendChild(afternoonSection);
  }

  const ws = safeHTML("week-summary", "");
  if (ws) {
    const allocSorted = [...(plan.allocations || [])].sort(
      (a, b) => (b.targetMin || 0) - (a.targetMin || 0)
    );
    
    // Raggruppa per esame originale (per evitare duplicati quando ci sono più appelli)
    const examGroups = new Map();
    for (const a of allocSorted) {
      // Estrai l'ID originale dell'esame (rimuovi il suffisso della data se presente)
      const originalId = a.examId.includes('_') ? a.examId.split('_').slice(0, -1).join('_') : a.examId;
      
      if (!examGroups.has(originalId)) {
        examGroups.set(originalId, {
          name: a.name,
          totalMin: 0,
          examId: a.examId,
          date: a.date
        });
      }
      // Somma le ore se ci sono più appelli (dovrebbe essere raro ora, ma per sicurezza)
      examGroups.get(originalId).totalMin += a.targetMin || 0;
    }
    
    // Mostra ogni esame una sola volta con le ore totali
    for (const [originalId, group] of examGroups) {
      const div = document.createElement("div");
      div.className = "weekItem";
      
      // Se l'esame ha più appelli, mostra anche la data dell'appello considerato
      const exam = exams.find(e => e.id === originalId || e.id === group.examId);
      let dateInfo = "";
      if (exam && exam.appelli && exam.appelli.length > 1) {
        const selectedAppelli = exam.appelli.filter(a => a.selected !== false);
        if (selectedAppelli.length > 1) {
          // Trova l'appello primario (quello usato nel piano)
          const primaryAppello = selectedAppelli.find(a => a.primary === true);
          const appelloToShow = primaryAppello || selectedAppelli.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA - dateB;
          })[0];
          dateInfo = ` <span style="font-size:11px; color:rgba(255,255,255,0.6);">Appello principale: ${appelloToShow.date}</span>`;
        }
      }
      
      div.innerHTML = `
        <strong>${escapeHtml(group.name)}</strong>${dateInfo}
        <span>${Math.round((group.totalMin / 60) * 10) / 10}h</span>
      `;
      ws.appendChild(div);
    }
    if (plan.cut && plan.cut.length) {
      // Calcola statistiche sui task tagliati
      const totalCutMinutes = plan.cut.reduce((sum, t) => sum + (t.minutes || 0), 0);
      const totalCutHours = Math.round((totalCutMinutes / 60) * 10) / 10;
      const totalCutTasks = plan.cut.length;
      
      // Raggruppa per esame
      const byExam = {};
      for (const t of plan.cut) {
        const examName = t.examName || "Sconosciuto";
        if (!byExam[examName]) {
          byExam[examName] = { tasks: [], minutes: 0 };
        }
        byExam[examName].tasks.push(t);
        byExam[examName].minutes += t.minutes || 0;
      }
      
      // Calcola percentuale tagliata rispetto al budget settimanale
      const weeklyBudget = plan.weeklyBudgetMin || 1;
      const cutPercentage = Math.round((totalCutMinutes / weeklyBudget) * 100);
      
      // Determina suggerimenti specifici
      const suggestions = [];
      if (cutPercentage > 30) {
        suggestions.push({
          icon: "⏰",
          text: "Tagliato più del 30%: considera di aumentare significativamente le ore settimanali",
          priority: "high"
        });
      } else if (cutPercentage > 15) {
        suggestions.push({
          icon: "⏰",
          text: "Tagliato più del 15%: aumenta le ore settimanali o riduci gli esami attivi",
          priority: "medium"
        });
      }
      
      if (Object.keys(byExam).length > 3) {
        suggestions.push({
          icon: "📚",
          text: `Hai ${Object.keys(byExam).length} esami con task tagliati: considera di concentrarti su meno esami alla volta`,
          priority: "medium"
        });
      }
      
      if (totalCutHours > 10) {
        suggestions.push({
          icon: "🎯",
          text: `Tagliati ${totalCutHours}h: priorizza gli esami più urgenti nel profilo`,
          priority: "high"
        });
      }
      
      // Crea la sezione Realismo migliorata
      const cut = document.createElement("div");
      cut.className = "callout realismCallout";
      
      let html = `
        <div class="realismHeader">
          <h3>⚠️ Realismo</h3>
          <div class="realismStats">
            <div class="realismStat">
              <span class="realismStatValue">${totalCutHours}h</span>
              <span class="realismStatLabel">tagliati</span>
            </div>
            <div class="realismStat">
              <span class="realismStatValue">${totalCutTasks}</span>
              <span class="realismStatLabel">task</span>
            </div>
            <div class="realismStat">
              <span class="realismStatValue">${cutPercentage}%</span>
              <span class="realismStatLabel">del budget</span>
            </div>
          </div>
        </div>
        
        <div class="realismMessage">
          <p>La tua disponibilità settimanale non copre tutti i task pianificati. Alcuni contenuti sono stati esclusi per mantenere il piano realistico.</p>
        </div>
      `;
      
      // Dettaglio per esame
      if (Object.keys(byExam).length > 0) {
        html += `<div class="realismDetails">
          <div class="realismDetailsTitle">Dettaglio per esame:</div>
          <div class="realismExamList">`;
        
        const sortedExams = Object.entries(byExam).sort((a, b) => b[1].minutes - a[1].minutes);
        for (const [examName, data] of sortedExams) {
          const examHours = Math.round((data.minutes / 60) * 10) / 10;
          html += `
            <div class="realismExamItem">
              <div class="realismExamName">${escapeHtml(examName)}</div>
              <div class="realismExamInfo">
                <span>${data.tasks.length} task</span>
                <span>·</span>
                <span>${examHours}h</span>
              </div>
            </div>
          `;
        }
        
        html += `</div></div>`;
      }
      
      // Suggerimenti
      if (suggestions.length > 0) {
        html += `<div class="realismSuggestions">
          <div class="realismSuggestionsTitle">Suggerimenti:</div>
          <ul class="realismSuggestionsList">`;
        
        for (const sug of suggestions) {
          const priorityClass = sug.priority === "high" ? "realismSuggestionHigh" : "";
          html += `
            <li class="realismSuggestion ${priorityClass}">
              <span class="realismSuggestionIcon">${sug.icon}</span>
              <span class="realismSuggestionText">${escapeHtml(sug.text)}</span>
            </li>
          `;
        }
        
        html += `</ul></div>`;
      }
      
      // Azioni
      html += `
        <div class="realismActions">
          <a href="./settings.html" class="btn tiny">Modifica Profilo</a>
          <a href="./profile.html" class="btn tiny ghost">Gestisci Esami</a>
        </div>
      `;
      
      cut.innerHTML = html;
      ws.appendChild(cut);
    }
  }

  const ec = safeHTML("exam-cards", "");
  if (!ec) {
    safeText("status-line", "Dashboard HTML incompleta: manca #exam-cards.");
    return;
  }

  const allocMap = new Map((plan.allocations || []).map((a) => [a.examId, a.targetMin]));
  
  // Crea una mappa degli esami originali
  const originalExamsMap = new Map();
  for (const e of exams || []) {
    originalExamsMap.set(e.id, e);
  }
  
  // Costruisci gli esami da mostrare usando sempre l'appello primary corrente dagli esami aggiornati
  // Non usare quelli dal piano perché potrebbero essere obsoleti
  const uniqueExams = [];
  
  for (const exam of exams || []) {
    // Trova l'appello primary o il più prossimo
    const appelli = exam.appelli || (exam.date ? [{ date: exam.date, type: "esame", selected: true, primary: true }] : []);
    const selectedAppelli = appelli.filter(a => a.selected !== false);
    
    if (selectedAppelli.length === 0) continue; // Salta se nessun appello selezionato
    
    // Cerca l'appello marcato come "primary"
    let primaryAppello = selectedAppelli.find(a => a.primary === true);
    
    // Se nessuno è marcato come primary, usa il più prossimo
    if (!primaryAppello) {
      const sortedAppelli = [...selectedAppelli].sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA - dateB;
      });
      primaryAppello = sortedAppelli[0];
    }
    
    // Crea un esame virtuale per l'appello primary corrente
    const virtualExamId = `${exam.id}_${primaryAppello.date}`;
    const virtualExam = {
      ...exam,
      id: virtualExamId,
      date: primaryAppello.date,
      appelloType: primaryAppello.type
    };
    
    uniqueExams.push(virtualExam);
  }
  
  const sortedExams = uniqueExams.sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  for (const e of sortedExams) {
    // Trova l'esame originale
    const examIdParts = e.id.split('_');
    const originalId = examIdParts.length > 1 
      ? examIdParts.slice(0, -1).join('_') 
      : e.id;
    const originalExam = originalExamsMap.get(originalId);
    
    const dleft = daysTo(e.date);
    // Cerca l'allocazione usando l'ID virtuale (potrebbe non esistere se il piano non è stato rigenerato)
    // Se non esiste, cerca usando l'ID originale come fallback
    let allocThisWeek = Number(allocMap.get(e.id) || 0);
    if (allocThisWeek === 0 && originalId !== e.id) {
      // Fallback: cerca allocazioni per questo esame originale (potrebbe essere un altro appello)
      for (const [allocExamId, allocMin] of allocMap.entries()) {
        if (allocExamId.startsWith(originalId + '_')) {
          allocThisWeek = Number(allocMin);
          break;
        }
      }
    }

    const pct = estimateReadinessPercent(e, profile, allocThisWeek);
    const badge = readinessBadge(pct);

    const required = estimateRequiredMinutes(e, profile);
    const cap = estimateCapacityUntilExamMinutes(e, profile);
    
    // Mostra info su appelli multipli se presenti
    let appelliInfo = "";
    if (originalExam && originalExam.appelli && originalExam.appelli.length > 1) {
      const selectedAppelli = originalExam.appelli.filter(a => a.selected !== false);
      const primaryAppello = selectedAppelli.find(a => a.primary === true);
      if (selectedAppelli.length > 1) {
        if (primaryAppello && primaryAppello.date === e.date) {
          appelliInfo = ` · ${selectedAppelli.length} appelli selezionati · Questo è l'appello principale`;
        } else {
          appelliInfo = ` · ${selectedAppelli.length} appelli selezionati · Appello principale: ${primaryAppello?.date || e.date}`;
        }
      }
    }

    const card = document.createElement("div");
    card.className = "examCard";
    card.innerHTML = `
      <div class="examLeft">
        <div class="donut" style="--p:${pct}">
          <div class="donutLabel">${pct}%</div>
        </div>
        <div style="min-width:0">
          <div class="examName">${escapeHtml(e.name)}</div>
          <div class="examMeta">
            ${escapeHtml(e.date)} · tra ${dleft}g · CFU ${e.cfu} · livello ${e.level}/5 · diff ${e.difficulty}/3${appelliInfo}
          </div>
          <div class="examMeta">
            Piano settimanale: <b>${Math.round((allocThisWeek / 60) * 10) / 10}h</b> ·
            Necessario stimato: <b>${Math.round(required / 60)}h</b> ·
            Capacità fino all'esame: <b>${Math.round(cap / 60)}h</b>
          </div>
        </div>
      </div>
      <span class="badge ${badge.cls}">${badge.text}</span>
    `;
    ec.appendChild(card);
  }

  const next = sortedExams[0];
  if (next) {
    const alloc = Number(allocMap.get(next.id) || 0);
    const pct = estimateReadinessPercent(next, profile, alloc);
    const badge = readinessBadge(pct);
    safeText(
      "status-line",
      `Prossimo: ${next.name}. Preparazione stimata ${pct}% (${badge.text}). Se vuoi salire: aumenta ore o riduci esami attivi.`
    );
  }
}

// ----------------- Aggiunta task manuale -----------------
/**
 * Collega il bottone "+" per permettere all'utente di aggiungere manualmente un nuovo task
 * nella giornata corrente. Richiede il piano, l'elenco esami, il profilo, l'utente
 * e la data di inizio settimana per salvare correttamente il piano aggiornato.
 */
function bindAddTaskButton(plan, exams, profile, user, weekStartISO) {
  const btn = document.getElementById("add-task-btn");
  if (!btn) return;
  // Evita di collegare più volte lo stesso bottone (dopo ri-render)
  if (btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    // Apri una finestra di dialogo personalizzata per la creazione del task.
    openAddTaskModal(plan, exams, profile, user, weekStartISO);
  });
}

/**
 * Setup bottoni per esportare PDF e condividere il piano
 */
function setupPlanExportButtons(plan, exams, profile, user, weekStartISO) {
  // Bottoni esporta e condividi piano rimossi dalla dashboard
  // Funzione mantenuta per compatibilità ma non fa nulla
  /*
  const exportPdfBtn = document.getElementById("export-plan-pdf-btn");
  if (exportPdfBtn && !exportPdfBtn.dataset.bound) {
    exportPdfBtn.dataset.bound = "1";
    exportPdfBtn.addEventListener("click", async () => {
      try {
        exportPdfBtn.disabled = true;
        exportPdfBtn.textContent = "⏳ Generazione...";
        await exportPlanToPDF(plan, exams, profile, weekStartISO);
        exportPdfBtn.disabled = false;
        exportPdfBtn.textContent = "📄 Esporta PDF";
        showToast("PDF generato con successo!", 2000);
      } catch (err) {
        console.error("Errore esportazione PDF:", err);
        exportPdfBtn.disabled = false;
        exportPdfBtn.textContent = "📄 Esporta PDF";
        alert("Errore durante l'esportazione del PDF: " + (err?.message || err));
      }
    });
  }

  const sharePlanBtn = document.getElementById("share-plan-btn");
  if (sharePlanBtn && !sharePlanBtn.dataset.bound) {
    sharePlanBtn.dataset.bound = "1";
    sharePlanBtn.addEventListener("click", async () => {
      try {
        sharePlanBtn.disabled = true;
        sharePlanBtn.textContent = "Generazione...";
        await sharePlan(plan, exams, profile, weekStartISO);
        sharePlanBtn.disabled = false;
        sharePlanBtn.textContent = "Condividi piano";
      } catch (err) {
        console.error("Errore condivisione piano:", err);
        sharePlanBtn.disabled = false;
        sharePlanBtn.textContent = "Condividi piano";
        alert("Errore durante la condivisione: " + (err?.message || err));
      }
    });
  }
  */
}

/**
 * Mostra un popup modale per creare un nuovo task.
 * L'overlay è creato dinamicamente e usa gli stili esistenti (card, form, btn)
 * per mantenere coerenza con il resto del sito. Gli esami sono proposti in un menu a tendina.
 *
 * @param {Object} plan     Piano corrente da aggiornare
 * @param {Array} exams     Elenco esami disponibili
 * @param {Object} profile  Profilo utente (non usato qui ma mantenuto per coerenza API)
 * @param {Object} user     Utente autenticato (serve per salvare su Firestore)
 * @param {String} weekStartISO ISO della data di inizio settimana
 */
function openAddTaskModal(plan, exams, profile, user, weekStartISO) {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("task-modal")) return;

  // Overlay oscurante
  const overlay = document.createElement("div");
  overlay.id = "task-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.6)",
    zIndex: "9999",
  });

  // Contenitore principale con stile card
  const card = document.createElement("div");
  card.className = "card";
  // Regola dimensioni e padding per la modale
  card.style.maxWidth = "420px";
  card.style.width = "90%";
  card.style.padding = "20px";

  // Titolo modale
  const title = document.createElement("h3");
  title.textContent = "Nuovo task";
  title.style.marginBottom = "12px";
  title.style.fontSize = "18px";
  card.appendChild(title);

  // Contenitore form
  const form = document.createElement("div");
  form.className = "form";

  // Campo selezione esame
  const examLabel = document.createElement("label");
  examLabel.innerHTML = '<span>Esame</span>';
  const examSelect = document.createElement("select");
  examSelect.id = "nt-exam";
  examSelect.required = true;
  // Popola select con esami
  exams.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.name;
    examSelect.appendChild(opt);
  });
  examLabel.appendChild(examSelect);

  // Campo descrizione
  const labelLabel = document.createElement("label");
  labelLabel.innerHTML = '<span>Descrizione</span>';
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.id = "nt-label";
  labelInput.placeholder = "Descrizione";
  labelInput.required = true;
  labelLabel.appendChild(labelInput);

  // Campo tipo (select con opzioni disponibili)
  const typeLabel = document.createElement("label");
  typeLabel.innerHTML = '<span>Tipo</span>';
  const typeSelect = document.createElement("select");
  typeSelect.id = "nt-type";
  typeSelect.required = true;
  
  // Opzioni disponibili per il tipo di task
  const taskTypes = [
    { value: "theory", label: "Teoria" },
    { value: "practice", label: "Esercizi" },
    { value: "exam", label: "Prove d'esame" },
    { value: "review", label: "Ripasso" },
    { value: "spaced", label: "Spaced repetition" }
  ];
  
  taskTypes.forEach(type => {
    const option = document.createElement("option");
    option.value = type.value;
    option.textContent = type.label;
    typeSelect.appendChild(option);
  });
  
  typeLabel.appendChild(typeSelect);

  // Campo minuti
  const minutesLabel = document.createElement("label");
  minutesLabel.innerHTML = '<span>Durata (min)</span>';
  const minutesInput = document.createElement("input");
  minutesInput.type = "number";
  minutesInput.id = "nt-minutes";
  minutesInput.min = "15";
  // Imposta il massimo in base a taskMinutes del profilo
  const maxTaskMinutes = profile?.taskMinutes || 100;
  minutesInput.max = String(maxTaskMinutes);
  minutesInput.step = "5";
  // Imposta il valore predefinito a taskMinutes se disponibile, altrimenti 30
  minutesInput.value = String(profile?.taskMinutes || 30);
  minutesInput.required = true;
  minutesLabel.appendChild(minutesInput);

  // Aggiungi tutti i campi al form
  form.appendChild(examLabel);
  form.appendChild(labelLabel);
  form.appendChild(typeLabel);
  form.appendChild(minutesLabel);
  card.appendChild(form);

  // Azioni (bottoni) nella riga finale
  const btnRow = document.createElement("div");
  btnRow.className = "btnRow";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.type = "button";
  saveBtn.id = "nt-save";
  saveBtn.textContent = "Salva";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.type = "button";
  cancelBtn.id = "nt-cancel";
  cancelBtn.textContent = "Annulla";

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Funzione per chiudere la modale e rimuoverla dal DOM
  function closeModal() {
    try {
      document.body.removeChild(overlay);
    } catch {}
  }

  // Gestore Annulla
  cancelBtn.addEventListener("click", () => {
    closeModal();
  });

  // Gestore Salva
  saveBtn.addEventListener("click", async () => {
    // Recupera valori
    const examId = examSelect.value;
    const exam = exams.find((e) => String(e.id) === String(examId));
    const labelVal = labelInput.value.trim();
    const typeVal = typeSelect.value;
    const minutesVal = parseInt(minutesInput.value, 10);

    // Validazione con modali coerenti
    if (!exam) {
      showErrorModal("Seleziona un esame", "Errore di validazione");
      return;
    }
    if (!labelVal) {
      showErrorModal("La descrizione non può essere vuota", "Errore di validazione");
      return;
    }
    if (!typeVal) {
      showErrorModal("Seleziona un tipo di task", "Errore di validazione");
      return;
    }
    if (!minutesVal || isNaN(minutesVal)) {
      showErrorModal("La durata deve essere un numero valido", "Errore di validazione");
      return;
    }
    if (minutesVal < 15) {
      showErrorModal("La durata deve essere almeno 15 minuti", "Errore di validazione");
      return;
    }
    // Verifica che la durata non superi taskMinutes del profilo
    const maxTaskMinutes = profile?.taskMinutes || 100;
    if (minutesVal > maxTaskMinutes) {
      showErrorModal(`La durata non può superare ${maxTaskMinutes} minuti (durata task impostata)`, "Errore di validazione");
      return;
    }
    try {
      const newTask = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(16).slice(2),
        examId: exam.id,
        examName: exam.name,
        type: typeVal,
        label: labelVal,
        minutes: minutesVal,
        done: false,
      };
      const todayISO = isoToday();
      const day =
        plan.days?.find((d) => d.dateISO === todayISO) || plan.days?.[0];
      if (!day) {
        showErrorModal("Errore: giorno non trovato nel piano.", "Errore");
        return;
      }
      // Assegna periodo (mattina/pomeriggio) basato sulla capacità giornaliera
      const halfCap = (day.capacityMin || 0) / 2;
      const currentUsed = (day.tasks || []).reduce((sum, t) => sum + (t.minutes || 0), 0);
      newTask.period = (currentUsed + minutesVal) <= halfCap ? "morning" : "afternoon";
      day.tasks = [...(day.tasks || []), newTask];
      
      // Marca il task come aggiunto manualmente per preservarlo durante la rigenerazione
      if (!plan.manualTasks) plan.manualTasks = [];
      plan.manualTasks.push({
        dateISO: day.dateISO,
        task: newTask,
      });
      
      // Aggiorna l'allocazione per l'esame in base ai minuti aggiunti
      if (!plan.allocations) plan.allocations = [];
      const alloc = plan.allocations.find((a) => a.examId === exam.id);
      if (alloc) {
        alloc.targetMin = Number(alloc.targetMin || 0) + minutesVal;
      } else {
        plan.allocations.push({
          examId: exam.id,
          name: exam.name,
          targetMin: minutesVal,
        });
      }
      // Salva e ri-renderizza
      await saveWeeklyPlan(user.uid, weekStartISO, plan);
      await renderDashboard(plan, exams, profile, user, weekStartISO);
      bindAddTaskButton(plan, exams, profile, user, weekStartISO);
      closeModal();
    } catch (err) {
      console.error(err);
      showErrorModal("Errore creazione task: " + (err?.message || err), "Errore");
    }
  });
}

/**
 * Mostra un popup modale con i dettagli della task e permette la modifica
 * @param {object} task - Oggetto task con tutte le informazioni
 * @param {string} dateISO - Data ISO della task
 * @param {object} options - Opzioni: { user, weekStartISO, plan, onUpdate }
 */
function showTaskDetailsModal(task, dateISO, options = {}) {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("task-details-modal")) return;
  
  const { user, weekStartISO, plan, onUpdate } = options;
  const canEdit = !!(user && weekStartISO && plan);
  
  console.log("[Task Modal] Apertura modale:", {
    hasUser: !!user,
    weekStartISO,
    hasPlan: !!plan,
    canEdit,
    taskId: task?.id,
    taskLabel: task?.label
  });
  
  // Mappa dei tipi di task per le label
  const typeLabels = {
    theory: "Teoria",
    practice: "Esercizi",
    exam: "Prove d'esame",
    review: "Ripasso",
    spaced: "Spaced repetition"
  };
  
  // Overlay oscurante
  const overlay = document.createElement("div");
  overlay.id = "task-details-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.75)",
    zIndex: "10000",
    padding: "20px",
    animation: "fadeIn 0.2s ease-out",
    backdropFilter: "blur(4px)",
  });
  
  // Contenitore principale con stile card
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "800px";
  card.style.width = "90%";
  card.style.padding = "28px";
  card.style.position = "relative";
  card.style.animation = "slideUp 0.3s ease-out";
  card.style.background = "rgba(10, 12, 20, 0.95)";
  card.style.backdropFilter = "blur(10px)";
  card.style.border = "1px solid rgba(255, 255, 255, 0.15)";
  
  // Titolo modale
  const title = document.createElement("h2");
  title.textContent = "Dettagli Task";
  title.style.cssText = `
    font-size: 24px;
    font-weight: 900;
    margin: 0 0 24px 0;
    color: rgba(255,255,255,0.95);
  `;
  
  // Sezione informazioni
  const infoSection = document.createElement("div");
  infoSection.className = "infoSection";
  
  // Esame (non modificabile)
  const examRow = document.createElement("div");
  examRow.className = "infoRow";
  examRow.style.cssText = `
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  `;
  const examLabel = document.createElement("div");
  examLabel.className = "infoLabel";
  examLabel.style.cssText = `font-size: 13px; color: rgba(255, 255, 255, 0.5);`;
  examLabel.textContent = "Esame";
  const examValue = document.createElement("div");
  examValue.className = "infoValue";
  examValue.style.cssText = `font-weight: 700; color: rgba(99, 102, 241, 1); font-size: 14px;`;
  examValue.textContent = task.examName || "—";
  examRow.appendChild(examLabel);
  examRow.appendChild(examValue);
  infoSection.appendChild(examRow);
  
  // Descrizione (modificabile)
  const descRow = document.createElement("div");
  descRow.className = "infoRow";
  descRow.style.cssText = `
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  `;
  const descLabel = document.createElement("div");
  descLabel.className = "infoLabel";
  descLabel.style.cssText = `font-size: 13px; color: rgba(255, 255, 255, 0.5);`;
  descLabel.textContent = "Descrizione";
  const descValue = canEdit ? document.createElement("input") : document.createElement("div");
  if (canEdit) {
    descValue.type = "text";
    descValue.value = task.label || "";
    descValue.style.cssText = `
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      font-weight: 600;
    `;
  } else {
    descValue.className = "infoValue";
    descValue.style.cssText = `font-weight: 600; color: rgba(255, 255, 255, 0.9); font-size: 14px;`;
    descValue.textContent = task.label || "—";
  }
  descRow.appendChild(descLabel);
  descRow.appendChild(descValue);
  infoSection.appendChild(descRow);
  
  // Tipo (modificabile con select)
  const typeRow = document.createElement("div");
  typeRow.className = "infoRow";
  typeRow.style.cssText = `
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  `;
  const typeLabel = document.createElement("div");
  typeLabel.className = "infoLabel";
  typeLabel.style.cssText = `font-size: 13px; color: rgba(255, 255, 255, 0.5);`;
  typeLabel.textContent = "Tipo";
  const typeValue = canEdit ? document.createElement("select") : document.createElement("div");
  if (canEdit) {
    const taskTypes = [
      { value: "theory", label: "Teoria" },
      { value: "practice", label: "Esercizi" },
      { value: "exam", label: "Prove d'esame" },
      { value: "review", label: "Ripasso" },
      { value: "spaced", label: "Spaced repetition" }
    ];
    taskTypes.forEach(type => {
      const option = document.createElement("option");
      option.value = type.value;
      option.textContent = type.label;
      if (type.value === (task.type || "")) option.selected = true;
      typeValue.appendChild(option);
    });
    typeValue.style.cssText = `
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      font-weight: 600;
    `;
  } else {
    typeValue.className = "infoValue";
    typeValue.style.cssText = `font-weight: 600; color: rgba(255, 255, 255, 0.9); font-size: 14px;`;
    const typeLabels = {
      theory: "Teoria",
      practice: "Esercizi",
      exam: "Prove d'esame",
      review: "Ripasso",
      spaced: "Spaced repetition"
    };
    typeValue.textContent = typeLabels[task.type] || task.type || "—";
  }
  typeRow.appendChild(typeLabel);
  typeRow.appendChild(typeValue);
  infoSection.appendChild(typeRow);
  
  // Durata (modificabile)
  const minutesRow = document.createElement("div");
  minutesRow.className = "infoRow";
  minutesRow.style.cssText = `
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  `;
  const minutesLabel = document.createElement("div");
  minutesLabel.className = "infoLabel";
  minutesLabel.style.cssText = `font-size: 13px; color: rgba(255, 255, 255, 0.5);`;
  minutesLabel.textContent = "Durata";
  const minutesValue = canEdit ? document.createElement("input") : document.createElement("div");
  if (canEdit) {
    minutesValue.type = "number";
    minutesValue.min = "15";
    minutesValue.max = "100";
    minutesValue.step = "5";
    minutesValue.value = task.minutes || 30;
    minutesValue.style.cssText = `
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      font-weight: 600;
    `;
    const minutesSuffix = document.createElement("span");
    minutesSuffix.textContent = " min";
    minutesSuffix.style.cssText = `margin-left: 8px; color: rgba(255, 255, 255, 0.6); font-size: 13px;`;
    const minutesWrapper = document.createElement("div");
    minutesWrapper.style.cssText = `display: flex; align-items: center;`;
    minutesWrapper.appendChild(minutesValue);
    minutesWrapper.appendChild(minutesSuffix);
    minutesRow.appendChild(minutesLabel);
    minutesRow.appendChild(minutesWrapper);
  } else {
    minutesValue.className = "infoValue";
    minutesValue.style.cssText = `font-weight: 600; color: rgba(255, 255, 255, 0.9); font-size: 14px;`;
    minutesValue.textContent = `${task.minutes || 0} min`;
    minutesRow.appendChild(minutesLabel);
    minutesRow.appendChild(minutesValue);
  }
  infoSection.appendChild(minutesRow);
  
  // Data (non modificabile)
  const dateRow = document.createElement("div");
  dateRow.className = "infoRow";
  dateRow.style.cssText = `
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    padding: 12px 0;
  `;
  const dateLabel = document.createElement("div");
  dateLabel.className = "infoLabel";
  dateLabel.style.cssText = `font-size: 13px; color: rgba(255, 255, 255, 0.5);`;
  dateLabel.textContent = "Data";
  const dateValue = document.createElement("div");
  dateValue.className = "infoValue";
  dateValue.style.cssText = `font-weight: 600; color: rgba(255, 255, 255, 0.9); font-size: 14px;`;
  dateValue.textContent = dateISO || "—";
  dateRow.appendChild(dateLabel);
  dateRow.appendChild(dateValue);
  infoSection.appendChild(dateRow);
  
  // Bottoni
  const btnRow = document.createElement("div");
  btnRow.className = "btnRow";
  btnRow.style.marginTop = "24px";
  btnRow.style.display = "flex";
  btnRow.style.gap = "12px";
  
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = "Chiudi";
  closeBtn.style.flex = canEdit ? "1" : "1";
  
  let saveBtn = null;
  if (canEdit) {
    saveBtn = document.createElement("button");
    saveBtn.className = "btn primary";
    saveBtn.textContent = "Salva modifiche";
    saveBtn.style.flex = "1";
    console.log("[Task Modal] Bottone Salva creato");
  } else {
    console.warn("[Task Modal] Bottone Salva NON creato - canEdit è false");
  }
  
  // Funzione per chiudere
  const closeModal = () => {
    overlay.style.animation = "fadeOut 0.2s ease-out";
    card.style.animation = "slideDown 0.2s ease-out";
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    }, 200);
  };
  
  // Gestore salvataggio
  if (saveBtn && canEdit) {
    console.log("[Task Modal] Aggiungo event listener al bottone Salva");
    saveBtn.addEventListener("click", async () => {
      console.log("[Task Update] CLICK sul bottone Salva - inizio salvataggio");
      try {
        const newLabel = descValue.value.trim();
        const newType = typeValue.value;
        const newMinutes = parseInt(minutesValue.value);
        
        console.log("[Task Update] Valori da salvare:", { newLabel, newType, newMinutes });
        
        if (!newLabel) {
          showErrorModal("La descrizione non può essere vuota", "Errore di validazione");
          return;
        }
        if (!newMinutes || isNaN(newMinutes)) {
          showErrorModal("La durata deve essere un numero valido", "Errore di validazione");
          return;
        }
        if (newMinutes < 15) {
          showErrorModal("La durata deve essere almeno 15 minuti", "Errore di validazione");
          return;
        }
        if (newMinutes > 100) {
          showErrorModal("La durata non può superare 100 minuti", "Errore di validazione");
          return;
        }
        
        // Trova il task nel piano e aggiornalo
        console.log("[Task Update] Cercando task nel piano:", {
          taskId: task.id,
          taskLabel: task.label,
          taskType: task.type,
          taskExamId: task.examId,
          dateISO,
          weekStartISO,
          planDays: plan.days?.length
        });
        
        let taskFound = false;
        let foundDay = null;
        let foundTaskIndex = -1;
        
        for (const day of plan.days || []) {
          if (day.dateISO === dateISO) {
            console.log("[Task Update] Giorno trovato:", { dateISO: day.dateISO, tasksCount: day.tasks?.length });
            const tasks = day.tasks || [];
            for (let i = 0; i < tasks.length; i++) {
              const t = tasks[i];
              // Prova prima con l'ID
              if (t.id === task.id) {
                console.log("[Task Update] Task trovato per ID:", t.id);
                foundDay = day;
                foundTaskIndex = i;
                taskFound = true;
                break;
              }
              // Fallback: cerca per examId, label e type (prima di modificare)
              if (t.examId === task.examId && 
                  t.label === task.label && 
                  t.type === task.type) {
                console.log("[Task Update] Task trovato per match (examId, label, type):", {
                  examId: t.examId,
                  label: t.label,
                  type: t.type
                });
                foundDay = day;
                foundTaskIndex = i;
                taskFound = true;
                break;
              }
            }
            if (taskFound) break;
          }
        }
        
        if (!taskFound) {
          console.error("[Task Update] Task non trovato nel piano. Dettagli:", {
            taskId: task.id,
            taskLabel: task.label,
            taskType: task.type,
            taskExamId: task.examId,
            dateISO,
            availableDays: plan.days?.map(d => ({
              dateISO: d.dateISO,
              tasksCount: d.tasks?.length,
              tasks: d.tasks?.map(t => ({ id: t.id, label: t.label, type: t.type, examId: t.examId }))
            }))
          });
          showErrorModal("Task non trovato nel piano. Potrebbe essere necessario rigenerare il piano.", "Errore");
          return;
        }
        
        // Aggiorna il task trovato
        console.log("[Task Update] Aggiornando task:", {
          oldLabel: foundDay.tasks[foundTaskIndex].label,
          newLabel,
          oldType: foundDay.tasks[foundTaskIndex].type,
          newType,
          oldMinutes: foundDay.tasks[foundTaskIndex].minutes,
          newMinutes
        });
        
        foundDay.tasks[foundTaskIndex].label = newLabel;
        foundDay.tasks[foundTaskIndex].type = newType;
        foundDay.tasks[foundTaskIndex].minutes = newMinutes;
        
        // Salva il piano aggiornato
        console.log("[Task Update] Salvando piano aggiornato...");
        try {
          await saveWeeklyPlan(user.uid, weekStartISO, plan);
          console.log("[Task Update] Piano salvato con successo");
        } catch (err) {
          console.error("[Task Update] Errore durante il salvataggio:", err);
          alert("Errore durante il salvataggio: " + (err?.message || err));
          return;
        }
        
        // Notifica che il piano è stato modificato (per aggiornare la dashboard)
        const planUpdateKey = `plan_updated_${user.uid}_${weekStartISO}`;
        const updateTimestamp = Date.now().toString();
        try {
          localStorage.setItem(planUpdateKey, updateTimestamp);
          console.log("[Task Update] Flag aggiornamento salvato:", { planUpdateKey, updateTimestamp });
          // Emetti anche un evento personalizzato per la stessa scheda
          const event = new CustomEvent('planUpdated', { 
            detail: { weekStartISO, taskId: task.id, timestamp: updateTimestamp } 
          });
          window.dispatchEvent(event);
          console.log("[Task Update] Evento planUpdated emesso");
        } catch (e) {
          console.warn("Impossibile salvare flag aggiornamento piano:", e);
        }
        
        // Aggiorna anche la pagina task.html se siamo lì
        if (window.location.pathname.includes('task.html')) {
          // Aggiorna i valori nella pagina
          const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.textContent = v ?? "—";
          };
          set("info-label", newLabel);
          set("info-type", typeLabels[newType] || newType);
          set("info-minutes", `${newMinutes} min`);
          
          // Aggiorna anche il titolo e sottotitolo
          const elTitle = document.getElementById("task-title");
          const elSub = document.getElementById("task-subtitle");
          if (elTitle) elTitle.textContent = `${task.examName || "Esame"} · ${newLabel}`;
          if (elSub) elSub.textContent = `${dateISO || "—"} · ${newMinutes} min`;
          
          // Aggiorna il task nel payload
          task.label = newLabel;
          task.type = newType;
          task.minutes = newMinutes;
        }
        
        // Callback per aggiornare la dashboard se necessario
        if (onUpdate) {
          onUpdate();
        }
        
        showToast("Task aggiornato con successo!", 3000);
        closeModal();
      } catch (err) {
        console.error("Errore aggiornamento task:", err);
        showErrorModal("Errore durante l'aggiornamento: " + (err?.message || err), "Errore");
      }
    });
  }
  
  // Assemblea
  card.appendChild(title);
  card.appendChild(infoSection);
  if (saveBtn) btnRow.appendChild(saveBtn);
  btnRow.appendChild(closeBtn);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  
  // Event listeners
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  
  // Chiudi con ESC
  const escHandler = (e) => {
    if (e.key === "Escape" && document.getElementById("task-details-modal")) {
      closeModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

// ----------------- TASK PAGE -----------------
function mountTask() {
  setupMenu();

  const dbg = (msg) => {
    console.log("[TASK]", msg);
    const el = document.getElementById("dbg");
    if (el) el.textContent = msg;
  };

  const params = new URLSearchParams(location.search);
  let tid = params.get("tid") || params.get("taskId");

  if (!tid) {
    try {
      tid = localStorage.getItem("sp_last_tid");
    } catch {}
    if (tid) {
      const url = new URL(location.href);
      url.searchParams.set("tid", tid);
      history.replaceState(null, "", url.toString());
    }
  }

  if (!tid) {
    dbg("Missing tid (nessun parametro e nessun last_tid)");
    const h = document.getElementById("task-title");
    const sub = document.getElementById("task-subtitle");
    if (h) h.textContent = "Task non trovata";
    if (sub) sub.textContent = "Aprila dalla dashboard.";
    return;
  }

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await logout();
    window.location.assign("./index.html");
  });

  const bootWithPayload = async (payload, user = null) => {
    if (!payload?.task) {
      dbg("Task payload mancante.");
      const h = document.getElementById("task-title");
      const sub = document.getElementById("task-subtitle");
      if (h) h.textContent = "Task non disponibile";
      if (sub) sub.textContent = "Aprilo dalla dashboard.";
      return;
    }
    
    // Controllo premium per timer
    let isPremiumUser = false;
    if (user) {
      isPremiumUser = await isPremium(user.uid);
    }

    const t = payload.task;

    const title = `${t.examName || "Esame"} · ${t.label || "Task"}`;
    const subtitle = `${payload.dateISO || "—"} · ${t.minutes || 0} min`;

    const elTitle = document.getElementById("task-title");
    const elSub = document.getElementById("task-subtitle");
    if (elTitle) elTitle.textContent = title;
    if (elSub) elSub.textContent = subtitle;

    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v ?? "—";
    };
    const typeLabels = {
      theory: "Teoria",
      practice: "Esercizi",
      exam: "Prove d'esame",
      review: "Ripasso",
      spaced: "Spaced repetition"
    };
    set("info-exam", t.examName || "—");
    set("info-label", t.label || "—");
    set("info-type", typeLabels[t.type] || t.type || "—");
    set("info-minutes", `${t.minutes || 0} min`);
    set("info-date", payload.dateISO || "—");

    // Rendi l'intera card "Dettagli Task" cliccabile per aprire popup
    const taskInfoCard = document.querySelector(".taskInfoCard");
    if (taskInfoCard) {
      taskInfoCard.style.cursor = "pointer";
      taskInfoCard.style.userSelect = "none";
      taskInfoCard.style.transition = "transform 0.2s ease, box-shadow 0.2s ease";
      taskInfoCard.addEventListener("mouseenter", () => {
        taskInfoCard.style.transform = "translateY(-2px)";
        taskInfoCard.style.boxShadow = "0 8px 24px rgba(99, 102, 241, 0.2)";
      });
      taskInfoCard.addEventListener("mouseleave", () => {
        taskInfoCard.style.transform = "translateY(0)";
        taskInfoCard.style.boxShadow = "";
      });
      taskInfoCard.addEventListener("click", async () => {
        // Carica il piano se disponibile per permettere la modifica
        let plan = null;
        let weekStartISO = payload.weekStartISO;
        if (user && weekStartISO) {
          plan = await loadWeeklyPlan(user.uid, weekStartISO);
        }
        showTaskDetailsModal(t, payload.dateISO, {
          user,
          weekStartISO,
          plan,
          onUpdate: async () => {
            // Ricarica il payload e aggiorna la pagina
            if (user && weekStartISO) {
              const updatedPlan = await loadWeeklyPlan(user.uid, weekStartISO);
              if (updatedPlan) {
                // Trova il task aggiornato
                for (const day of updatedPlan.days || []) {
                  if (day.dateISO === payload.dateISO) {
                    const updatedTask = (day.tasks || []).find(task => 
                      task.id === t.id || 
                      (task.examId === t.examId && task.label === t.label && task.type === t.type)
                    );
                    if (updatedTask) {
                      payload.task = updatedTask;
                      await bootWithPayload(payload, user);
                      break;
                    }
                  }
                }
              }
            }
          }
        });
      });
    }

    // Carica informazioni esame per contesto
    if (user) {
      try {
        const exams = await listExams(user.uid);
        const exam = exams.find(e => e.id === t.examId || e.name === t.examName);
        if (exam) {
          renderExamContext(exam, payload.dateISO);
        }
      } catch (err) {
        console.error("Errore caricamento contesto esame:", err);
      }
    }

    // Genera consigli di studio
    generateTaskTips(t, payload.dateISO);

    const plannedSec = Math.max(60, Math.round(Number(t.minutes || 0) * 60));
    const timerKey = `sp_timer_${tid}`;

    const loadState = () => {
      try {
        const raw = localStorage.getItem(timerKey);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };
    const saveState = (st) => {
      try {
        localStorage.setItem(timerKey, JSON.stringify(st));
      } catch {}
    };

    let st =
      loadState() || {
        running: false,
        plannedSec,
        elapsedSec: 0,
        startedAtMs: null,
        lastTickMs: null,
        done: false,
        skipped: false,
      };

    st.plannedSec = plannedSec;

    try {
      if (localStorage.getItem(`sp_task_done_${tid}`) === "1") st.done = true;
    } catch {}

    let raf = null;

    function computeElapsed() {
      if (!st.running || !st.lastTickMs) return st.elapsedSec;
      const dt = (Date.now() - st.lastTickMs) / 1000;
      return st.elapsedSec + dt;
    }

    function paintRing(p01) {
      const pie = document.getElementById("pie");
      if (!pie) return;
      const angle = Math.round(clamp(p01, 0, 1) * 360);
      pie.style.setProperty("--angle", `${angle}deg`);
    }

    function renderTimer() {
      const elapsed = computeElapsed();
      const remaining = Math.max(0, st.plannedSec - elapsed);
      const p = st.plannedSec > 0 ? elapsed / st.plannedSec : 0;
      const clamped = clamp(p, 0, 1);
      const pct = Math.round(clamped * 100);

      const remEl = document.getElementById("timer-remaining");
      const metaEl = document.getElementById("timer-meta");
      if (remEl) remEl.textContent = fmtMMSS(remaining);
      if (metaEl) metaEl.textContent = `Fatto: ${fmtMMSS(elapsed)} · Target: ${fmtMMSS(st.plannedSec)}`;

      const barEl = document.getElementById("timer-bar");
      if (barEl) barEl.style.width = `${pct}%`;

      paintRing(clamped);

      const piePct = document.getElementById("piePct");
      const pieLbl = document.getElementById("pieLbl");
      const pie = document.getElementById("pie");
      const statusBadge = document.getElementById("timer-status-badge");
      
      if (piePct) piePct.textContent = `${pct}%`;
      if (pieLbl) pieLbl.textContent = st.running ? "in corso" : st.done ? "completato" : "pausa";
      
      // Aggiorna stato badge e animazione
      if (statusBadge) {
        if (st.done) {
          statusBadge.textContent = "Completato";
          statusBadge.className = "timerStatusBadge completed";
        } else if (st.running) {
          statusBadge.textContent = "In corso";
          statusBadge.className = "timerStatusBadge running";
        } else {
          statusBadge.textContent = "Pausa";
          statusBadge.className = "timerStatusBadge paused";
        }
      }
      
      if (pie) {
        if (st.running) {
          pie.classList.add("running");
        } else {
          pie.classList.remove("running");
        }
      }

      // Aggiorna progresso
      const progressPlanned = document.getElementById("progress-planned");
      const progressElapsed = document.getElementById("progress-elapsed");
      if (progressPlanned) progressPlanned.textContent = fmtMMSS(st.plannedSec);
      if (progressElapsed) progressElapsed.textContent = fmtMMSS(elapsed);

      // Controlla se il timer è finito: ferma il timer e completa la task
      if (st.running && !st.done && st.plannedSec > 0 && elapsed >= st.plannedSec) {
        // Ferma il timer
        pause();
        // Completa automaticamente la task
        markDone();
      }
    }

    function tick() {
      renderTimer();
      raf = requestAnimationFrame(tick);
    }

    function start() {
      if (st.running) return;
      st.running = true;
      const ms = Date.now();
      st.startedAtMs = st.startedAtMs ?? ms;
      st.lastTickMs = ms;
      saveState(st);
      if (!raf) tick();
    }

    function pause() {
      if (!st.running) return;
      st.elapsedSec = computeElapsed();
      st.running = false;
      st.lastTickMs = null;
      saveState(st);
      renderTimer();
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }

    function reset() {
      st.running = false;
      st.elapsedSec = 0;
      st.startedAtMs = null;
      st.lastTickMs = null;
      st.done = false;
      st.skipped = false;

      saveState(st);

      try {
        localStorage.removeItem(`sp_task_done_${tid}`);
        localStorage.removeItem(`sp_task_skipped_${tid}`);
      } catch {}

      renderTimer();
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }

    async function markDone() {
      st.done = true;
      st.skipped = false;
      st.running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      saveState(st);

      try {
        localStorage.setItem(`sp_task_done_${tid}`, "1");
        localStorage.removeItem(`sp_task_skipped_${tid}`); // Rimuovi skipped se viene segnato come fatto
      } catch {}

      renderTimer();
      
      const statusEl = document.getElementById("task-status");
      if (statusEl) {
        statusEl.textContent = "✓ Task completata! Ottimo lavoro!";
        statusEl.style.color = "rgba(34, 197, 94, 1)";
      }
      
      // Aggiorna automaticamente il livello dell'esame se l'utente è autenticato
      if (user && t?.examId) {
        try {
          const exams = await listExams(user.uid);
          // Trova l'esame (può essere con appelli)
          let exam = exams.find(e => {
            if (e.id === t.examId) return true;
            if (e.appelli && Array.isArray(e.appelli)) {
              const selectedAppelli = e.appelli.filter(a => a.selected !== false);
              for (const appello of selectedAppelli) {
                if (`${e.id}_${appello.date}` === t.examId) return true;
              }
            }
            return false;
          });
          
          // Se non trovato per ID, prova per nome
          if (!exam && t.examName) {
            exam = exams.find(e => e.name === t.examName);
          }
          
          if (exam) {
            const newLevel = await updateExamLevelAutomatically(user.uid, exam);
            if (newLevel !== null && newLevel > (exam.level || 0)) {
              // Mostra notifica discreta del progresso
              if (statusEl) {
                statusEl.textContent = `✓ Task completata! Livello preparazione: ${exam.level || 0} → ${newLevel}`;
                statusEl.style.color = "rgba(34, 197, 94, 1)";
              }
            }
          }
        } catch (err) {
          console.error("Errore aggiornamento livello esame:", err);
          // Non bloccare l'utente se c'è un errore
        }
      }
    }

    async function markSkip() {
      // Controllo premium: solo gli utenti premium possono vedere le conseguenze
      if (!isPremiumUser) {
        showUpgradeModal();
        return;
      }
      
      // Calcola le conseguenze usando i dati del task e payload disponibili nello scope
      const consequences = await calculateSkipConsequences(t, payload, st);
      
      // Mostra popup con le conseguenze
      showSkipConsequencesModal(consequences, () => {
        // Conferma: salta il task
        st.skipped = true;
        st.done = false;
        saveState(st);

        try {
          localStorage.removeItem(`sp_task_done_${tid}`);
          localStorage.setItem(`sp_task_skipped_${tid}`, "1");
        } catch {}

        renderTimer();
      });
    }
    
    /**
     * Calcola le conseguenze del saltare un task
     * Usa direttamente i dati del task invece di decodificare il taskId
     */
    async function calculateSkipConsequences(task, payload, taskState) {
      console.log("[Skip] Calcolo conseguenze:", { task, payload, taskState });
      
      try {
        const user = auth.currentUser;
        if (!user) {
          console.warn("[Skip] Utente non loggato");
          return {
            examName: task?.examName || "Sconosciuto",
            taskType: task?.type || "task",
            taskLabel: task?.label || task?.type || "task",
            taskMinutes: Math.round(task?.minutes || (taskState?.plannedSec / 60) || 0),
            impact: "sconosciuto",
            readinessLoss: 0,
            currentReadiness: 0,
            newReadiness: 0,
            daysLeft: 0,
            examDate: null,
            hoursNeeded: 0,
            hoursAvailable: 0,
            impactMessage: "",
            message: "Devi essere loggato per calcolare l'impatto"
          };
        }
        
        // Carica piano e profilo usando payload.weekStartISO o calcola dalla data
        let weekStartISOStr = payload?.weekStartISO;
        if (!weekStartISOStr && payload?.dateISO) {
          // Calcola weekStartISO dalla data del task
          const taskDate = new Date(payload.dateISO);
          const weekStart = startOfWeekISO(taskDate);
          const z = (n) => String(n).padStart(2, "0");
          weekStartISOStr = `${weekStart.getFullYear()}-${z(weekStart.getMonth() + 1)}-${z(weekStart.getDate())}`;
        }
        if (!weekStartISOStr) {
          // Fallback: usa la settimana corrente
          const weekStart = startOfWeekISO(getCurrentDate());
          const z = (n) => String(n).padStart(2, "0");
          weekStartISOStr = `${weekStart.getFullYear()}-${z(weekStart.getMonth() + 1)}-${z(weekStart.getDate())}`;
        }
        
        const plan = await loadWeeklyPlan(user.uid, weekStartISOStr);
        const profile = await getProfile(user.uid);
        const exams = await listExams(user.uid);
        
        if (!plan || !profile || !exams) {
          return {
            examName: task?.examName || "Sconosciuto",
            taskType: task?.type || "task",
            taskLabel: task?.label || task?.type || "task",
            taskMinutes: Math.round(task?.minutes || (taskState?.plannedSec / 60) || 0),
            impact: "sconosciuto",
            readinessLoss: 0,
            currentReadiness: 0,
            newReadiness: 0,
            daysLeft: 0,
            examDate: null,
            message: "Impossibile caricare i dati del piano"
          };
        }
        
        // Trova l'esame usando examId o examName dal task
        let exam = null;
        
        // Prova prima con examId
        if (task?.examId) {
          exam = exams.find(e => {
            // Gestisci esami con appelli (ID virtuali)
            if (e.appelli && e.appelli.length > 0) {
              const selectedAppelli = e.appelli.filter(a => a.selected !== false);
              const primaryAppello = selectedAppelli.find(a => a.primary === true) || selectedAppelli[0];
              if (primaryAppello) {
                const virtualId = `${e.id}_${primaryAppello.date}`;
                return virtualId === task.examId || e.id === task.examId;
              }
            }
            return e.id === task.examId;
          });
        }
        
        // Fallback: usa examName
        if (!exam && task?.examName) {
          exam = exams.find(e => e.name === task.examName);
        }
        
        // Se ancora non trovato, prova a cercare per nome parziale
        if (!exam && task?.examName) {
          exam = exams.find(e => e.name?.toLowerCase().includes(task.examName.toLowerCase()) || 
                                 task.examName.toLowerCase().includes(e.name?.toLowerCase()));
        }
        
        console.log("[Skip] Esame trovato:", { 
          found: !!exam, 
          examName: exam?.name,
          taskExamId: task?.examId,
          taskExamName: task?.examName
        });
        
        if (!exam) {
          console.warn("[Skip] Esame non trovato:", { 
            taskExamId: task?.examId, 
            taskExamName: task?.examName,
            availableExams: exams.map(e => ({ id: e.id, name: e.name }))
          });
          return {
            examName: task?.examName || "Sconosciuto",
            taskType: task?.type || "task",
            taskLabel: task?.label || task?.type || "task",
            taskMinutes: Math.round(task?.minutes || (taskState?.plannedSec / 60) || 0),
            impact: "sconosciuto",
            readinessLoss: 0,
            currentReadiness: 0,
            newReadiness: 0,
            daysLeft: 0,
            examDate: null,
            hoursNeeded: 0,
            hoursAvailable: 0,
            impactMessage: "",
            message: `Esame "${task?.examName || 'Sconosciuto'}" non trovato. Verifica che l'esame sia stato aggiunto correttamente.`
          };
        }
        
        // Calcola preparazione attuale
        // Trova l'allocazione per questo esame nel piano
        const allocThisWeek = plan.allocations?.find(a => {
          // Gestisci ID virtuali per appelli
          const allocExamId = a.examId.includes('_') ? a.examId.split('_').slice(0, -1).join('_') : a.examId;
          if (allocExamId === exam.id || a.examId === exam.id) return true;
          
          // Controlla anche ID virtuali
          if (exam.appelli && exam.appelli.length > 0) {
            const selectedAppelli = exam.appelli.filter(a => a.selected !== false);
            const primaryAppello = selectedAppelli.find(a => a.primary === true) || selectedAppelli[0];
            if (primaryAppello) {
              const virtualId = `${exam.id}_${primaryAppello.date}`;
              return a.examId === virtualId;
            }
          }
          return false;
        });
        
        const currentAlloc = allocThisWeek?.targetMin || 0;
        const currentReadiness = estimateReadinessPercent(exam, profile, currentAlloc);
        
        // Calcola preparazione dopo aver saltato (riduci allocazione di questo task)
        const taskMinutes = task?.minutes || (taskState?.plannedSec / 60) || 0;
        const newAlloc = Math.max(0, currentAlloc - taskMinutes);
        const newReadiness = estimateReadinessPercent(exam, profile, newAlloc);
        
        const readinessLoss = currentReadiness - newReadiness;
        
        // Determina impatto basato sulla perdita di preparazione e sulla percentuale
        let impact = "minimo";
        let impactMessage = "";
        if (readinessLoss > 5 || (readinessLoss > 0 && currentReadiness < 70)) {
          impact = "significativo";
          impactMessage = "Potresti avere difficoltà a raggiungere una preparazione adeguata.";
        } else if (readinessLoss > 2 || (readinessLoss > 0 && currentReadiness < 85)) {
          impact = "moderato";
          impactMessage = "La tua preparazione potrebbe essere leggermente compromessa.";
        } else {
          impactMessage = "L'impatto sulla tua preparazione sarà limitato.";
        }
        
        // Calcola giorni rimanenti
        const examDate = exam.appelli && exam.appelli.length > 0 
          ? (exam.appelli.find(a => a.primary === true) || exam.appelli[0])?.date 
          : exam.date;
        const daysLeft = examDate ? daysTo(examDate) : 0;
        
        // Calcola ore totali necessarie e rimanenti
        const required = estimateRequiredMinutes(exam, profile);
        const capacity = estimateCapacityUntilExamMinutes(exam, profile);
        const hoursNeeded = Math.round(required / 60);
        const hoursAvailable = Math.round(capacity / 60);
        
        return {
          examName: exam.name,
          taskType: task?.type || "task",
          taskLabel: task?.label || task?.type || "task",
          taskMinutes: Math.round(taskMinutes),
          impact,
          readinessLoss: Math.max(0, readinessLoss),
          currentReadiness,
          newReadiness: Math.max(0, newReadiness),
          daysLeft,
          examDate,
          hoursNeeded,
          hoursAvailable,
          impactMessage,
          message: readinessLoss > 0 
            ? `La tua preparazione per "${exam.name}" scenderà da ${currentReadiness}% a ${Math.max(0, newReadiness)}% (-${readinessLoss}%)`
            : `L'impatto sulla preparazione per "${exam.name}" sarà minimo`
        };
      } catch (err) {
        console.error("Errore calcolo conseguenze:", err);
        return {
          examName: task?.examName || "Sconosciuto",
          taskType: task?.type || "task",
          taskLabel: task?.label || task?.type || "task",
          taskMinutes: Math.round(task?.minutes || (taskState?.plannedSec / 60) || 0),
          impact: "sconosciuto",
          readinessLoss: 0,
          currentReadiness: 0,
          newReadiness: 0,
          daysLeft: 0,
          examDate: null,
          hoursNeeded: 0,
          hoursAvailable: 0,
          impactMessage: "",
          message: `Errore: ${err?.message || "Impossibile calcolare l'impatto esatto"}`
        };
      }
    }
    
    /**
     * Mostra popup con le conseguenze del saltare un task
     */
    function showSkipConsequencesModal(consequences, onConfirm) {
      if (!consequences) {
        // Se non possiamo calcolare, chiedi conferma semplice
        if (confirm("Sei sicuro di voler saltare questo task?")) {
          if (onConfirm) onConfirm();
        }
        return;
      }
      
      // Crea modale
      const overlay = document.createElement("div");
      overlay.id = "skip-consequences-modal";
      Object.assign(overlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.8)",
        zIndex: "10000",
        padding: "20px",
        animation: "fadeIn 0.2s ease-out",
      });
      
      const card = document.createElement("div");
      card.className = "card";
      card.style.maxWidth = "500px";
      card.style.width = "95%";
      card.style.padding = "32px";
      card.style.position = "relative";
      card.style.animation = "slideUp 0.3s ease-out";
      
      // Header
      const header = document.createElement("div");
      header.style.cssText = "margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1);";
      header.innerHTML = `
        <h2 style="margin: 0; font-size: 24px; font-weight: 900; color: rgba(255,255,255,0.95);">
          ⚠️ Conseguenze del Saltare il Task
        </h2>
      `;
      
      // Contenuto
      const content = document.createElement("div");
      content.style.cssText = "margin-bottom: 24px;";
      
      let impactColor = "rgba(245,158,11,1)";
      let impactBg = "rgba(245,158,11,0.1)";
      if (consequences.impact === "significativo") {
        impactColor = "rgba(239,68,68,1)";
        impactBg = "rgba(239,68,68,0.1)";
      } else if (consequences.impact === "minimo") {
        impactColor = "rgba(34,197,94,1)";
        impactBg = "rgba(34,197,94,0.1)";
      }
      
      content.innerHTML = `
        <div style="margin-bottom: 20px;">
          <div style="font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 8px;">Task da saltare:</div>
          <div style="font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.95); margin-bottom: 4px;">
            ${escapeHtml(consequences.taskLabel || consequences.taskType)}
          </div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.6);">
            ${escapeHtml(consequences.examName)} · ${consequences.taskMinutes} minuti (${Math.round(consequences.taskMinutes / 60 * 10) / 10}h)
          </div>
        </div>
        
        ${consequences.daysLeft > 0 ? `
          <div style="padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; font-size: 13px; color: rgba(255,255,255,0.7); margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span><strong>Esame:</strong> ${escapeHtml(consequences.examName)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span><strong>Data esame:</strong> ${escapeHtml(consequences.examDate || "N/A")}</span>
              <span style="color: rgba(245,158,11,1); font-weight: 600;">Tra ${consequences.daysLeft} giorni</span>
            </div>
          </div>
        ` : ''}
        
        <div style="padding: 16px; background: ${impactBg}; border-radius: 12px; border-left: 3px solid ${impactColor}; margin-bottom: 16px;">
          <div style="font-size: 13px; font-weight: 600; color: ${impactColor}; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">
            Impatto sulla preparazione: ${consequences.impact}
          </div>
          <div style="font-size: 14px; color: rgba(255,255,255,0.9); line-height: 1.6; margin-bottom: 12px;">
            ${escapeHtml(consequences.message)}
          </div>
          ${consequences.impactMessage ? `
            <div style="font-size: 13px; color: ${impactColor}; font-weight: 500; padding-top: 8px; border-top: 1px solid ${impactColor}40;">
              ${escapeHtml(consequences.impactMessage)}
            </div>
          ` : ''}
        </div>
        
        ${consequences.readinessLoss > 0 ? `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
            <div style="padding: 12px; background: rgba(99,102,241,0.1); border-radius: 8px; text-align: center; border: 1px solid rgba(99,102,241,0.3);">
              <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Preparazione attuale</div>
              <div style="font-size: 28px; font-weight: 900; color: rgba(99,102,241,1); margin-bottom: 4px;">${consequences.currentReadiness}%</div>
              <div style="font-size: 10px; color: rgba(255,255,255,0.5);">Preparazione stimata</div>
            </div>
            <div style="padding: 12px; background: rgba(239,68,68,0.1); border-radius: 8px; text-align: center; border: 1px solid rgba(239,68,68,0.3);">
              <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Dopo aver saltato</div>
              <div style="font-size: 28px; font-weight: 900; color: rgba(239,68,68,1); margin-bottom: 4px;">${consequences.newReadiness}%</div>
              <div style="font-size: 10px; color: rgba(255,255,255,0.5);">Perdita: -${consequences.readinessLoss}%</div>
            </div>
          </div>
        ` : consequences.currentReadiness > 0 ? `
          <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; text-align: center; margin-bottom: 16px;">
            <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">Preparazione attuale</div>
            <div style="font-size: 24px; font-weight: 900; color: rgba(99,102,241,1);">${consequences.currentReadiness}%</div>
          </div>
        ` : ''}
        
        ${consequences.hoursNeeded > 0 && consequences.hoursAvailable > 0 ? `
          <div style="padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; font-size: 13px; margin-bottom: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <div style="color: rgba(255,255,255,0.6); margin-bottom: 4px;">Ore necessarie</div>
                <div style="font-weight: 600; color: rgba(255,255,255,0.9);">${consequences.hoursNeeded}h</div>
              </div>
              <div>
                <div style="color: rgba(255,255,255,0.6); margin-bottom: 4px;">Ore disponibili</div>
                <div style="font-weight: 600; color: ${consequences.hoursAvailable >= consequences.hoursNeeded ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)'};">
                  ${consequences.hoursAvailable}h
                  ${consequences.hoursAvailable < consequences.hoursNeeded ? ' ⚠️' : ''}
                </div>
              </div>
            </div>
            ${consequences.hoursAvailable < consequences.hoursNeeded ? `
              <div style="margin-top: 8px; padding: 8px; background: rgba(239,68,68,0.1); border-radius: 6px; font-size: 12px; color: rgba(239,68,68,1);">
                ⚠️ Hai meno ore disponibili di quelle necessarie. Saltare questo task peggiorerà la situazione.
              </div>
            ` : ''}
          </div>
        ` : ''}
        
        ${consequences.readinessLoss > 0 ? `
          <div style="padding: 12px; background: rgba(245,158,11,0.1); border-radius: 8px; border-left: 3px solid rgba(245,158,11,0.6); font-size: 13px; color: rgba(255,255,255,0.9); line-height: 1.6;">
            <strong style="color: rgba(245,158,11,1);">💡 Suggerimento:</strong><br>
            ${consequences.readinessLoss > 5 
              ? `Considera di riprogrammare questo task per un altro giorno o aumentare le ore di studio settimanali per compensare.`
              : `Se possibile, prova a completare almeno una parte di questo task per mantenere la tua preparazione.`
            }
          </div>
        ` : ''}
      `;
      
      // Footer con bottoni
      const footer = document.createElement("div");
      footer.style.cssText = "display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);";
      
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn";
      cancelBtn.textContent = "Annulla";
      cancelBtn.addEventListener("click", () => closeModal());
      
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "btn";
      confirmBtn.style.background = "rgba(239,68,68,0.2)";
      confirmBtn.style.borderColor = "rgba(239,68,68,0.4)";
      confirmBtn.style.color = "rgba(239,68,68,1)";
      confirmBtn.textContent = "Conferma: Salta Task";
      confirmBtn.addEventListener("click", () => {
        closeModal();
        if (onConfirm) onConfirm();
      });
      
      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);
      
      card.appendChild(header);
      card.appendChild(content);
      card.appendChild(footer);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      document.body.style.overflow = "hidden";
      
      function closeModal() {
        overlay.style.animation = "fadeOut 0.2s ease-out";
        card.style.animation = "slideDown 0.2s ease-out";
        setTimeout(() => {
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
          document.body.style.overflow = "";
        }, 200);
      }
      
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal();
      });
      
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.getElementById("skip-consequences-modal")) {
          closeModal();
        }
      });
    }

    // Wrapper per controlli premium sul timer
    const premiumStart = () => {
      if (!isPremiumUser) {
        showUpgradeModal();
        return;
      }
      start();
    };
    
    const premiumPause = () => {
      if (!isPremiumUser) {
        showUpgradeModal();
        return;
      }
      pause();
    };
    
    const premiumReset = () => {
      if (!isPremiumUser) {
        showUpgradeModal();
        return;
      }
      reset();
    };
    
    document.getElementById("timer-start")?.addEventListener("click", premiumStart);
    document.getElementById("timer-pause")?.addEventListener("click", premiumPause);
    document.getElementById("timer-reset")?.addEventListener("click", premiumReset);
    document.getElementById("mark-done")?.addEventListener("click", markDone);
    document.getElementById("mark-skip")?.addEventListener("click", markSkip);

    renderTimer();

    if (st.running) {
      st.lastTickMs = Date.now();
      saveState(st);
      tick();
    }
  };

  // Funzione per renderizzare il contesto dell'esame
  function renderExamContext(exam, taskDateISO) {
    const container = document.getElementById("exam-context-info");
    if (!container) return;

    const daysLeft = daysTo(exam.date);
    const taskDate = new Date(taskDateISO);
    const examDate = new Date(exam.date);
    const isToday = taskDateISO === isoToday();

    let urgencyLevel = "normale";
    let urgencyColor = "rgba(99, 102, 241, 1)";
    if (daysLeft < 7) {
      urgencyLevel = "urgente";
      urgencyColor = "rgba(251, 113, 133, 1)";
    } else if (daysLeft < 14) {
      urgencyLevel = "imminente";
      urgencyColor = "rgba(245, 158, 11, 1)";
    }

    container.innerHTML = `
      <div class="examContextRow">
        <span class="examContextLabel">Data esame</span>
        <span class="examContextValue">${exam.date || "—"}</span>
      </div>
      <div class="examContextRow">
        <span class="examContextLabel">Giorni rimanenti</span>
        <span class="examContextValue">${daysLeft} giorni</span>
      </div>
      <div class="examContextRow">
        <span class="examContextLabel">Urgenza</span>
        <span class="examContextBadge" style="background: ${urgencyColor}20; color: ${urgencyColor};">${urgencyLevel}</span>
      </div>
      <div class="examContextRow">
        <span class="examContextLabel">CFU</span>
        <span class="examContextValue">${exam.cfu || "—"}</span>
      </div>
      <div class="examContextRow">
        <span class="examContextLabel">Difficoltà</span>
        <span class="examContextValue">${exam.difficulty || "—"}/3</span>
      </div>
      <div class="examContextRow">
        <span class="examContextLabel">Livello preparazione</span>
        <span class="examContextValue">${exam.level || 0}/5</span>
      </div>
    `;
  }

  // Funzione per generare consigli di studio
  function generateTaskTips(task, taskDateISO) {
    const container = document.getElementById("task-tips-list");
    if (!container) return;

    const tips = [];
    const taskType = (task.type || "").toLowerCase();
    const isToday = taskDateISO === isoToday();

    // Consigli basati sul tipo di task
    if (taskType.includes("theory") || taskType.includes("teoria")) {
      tips.push({
        icon: "📖",
        title: "Studio teorico efficace",
        desc: "Leggi attivamente: prendi appunti, fai domande, crea connessioni. Usa la tecnica Feynman: spiega i concetti come se dovessi insegnarli a qualcuno.",
        detail: "La tecnica Feynman prende il nome dal fisico premio Nobel Richard Feynman. Il principio è semplice: se riesci a spiegare un concetto in modo semplice, significa che lo hai veramente compreso. Prova a scrivere una spiegazione come se stessi insegnando a uno studente alle prime armi. Se ti blocchi su un punto, quello è l'argomento su cui devi concentrarti. Inoltre, prendi appunti attivi: non copiare passivamente, ma rielabora le informazioni creando connessioni tra i concetti. Usa mappe mentali, diagrammi e analogie per rendere i concetti astratti più concreti e memorabili."
      });
      tips.push({
        icon: "🔄",
        title: "Ripetizione spaziata (Spaced Repetition)",
        desc: "Il tuo piano usa intervalli ottimali tra le sessioni (1, 3, 7, 14 giorni) basati sulla curva dell'oblio. Segui il piano per massimizzare la memorizzazione.",
        detail: "La ripetizione spaziata (spaced repetition) è una delle tecniche più efficaci per la memorizzazione a lungo termine, supportata da decenni di ricerca scientifica. Il principio si basa sulla 'curva dell'oblio' di Ebbinghaus: dopo aver appreso qualcosa, la memoria si indebolisce nel tempo, ma ogni revisione al momento giusto rafforza il ricordo in modo permanente. Il tuo piano di studio è stato generato usando un algoritmo scientifico che calcola automaticamente gli intervalli ottimali tra le sessioni: prima revisione dopo 1 giorno, seconda dopo 3 giorni, terza dopo 7 giorni, quarta dopo 14 giorni. Questi intervalli sono adattati alla difficoltà dell'esame e al tuo livello di preparazione. Seguendo il piano, stai applicando una delle tecniche di apprendimento più efficaci validate dalla ricerca scientifica."
      });
      tips.push({
        icon: "📅",
        title: "Pratica distribuita (Distributed Practice)",
        desc: "Il tuo piano distribuisce lo studio su più giorni invece di concentrarlo. Questo è scientificamente più efficace del 'cramming'.",
        detail: "La pratica distribuita (distributed practice) è una tecnica di apprendimento supportata da numerosi studi scientifici che dimostrano come distribuire lo studio su più sessioni sia significativamente più efficace del 'cramming' (studio concentrato). Il tuo piano di studio è stato generato per distribuire i task dello stesso esame su più giorni della settimana, evitando di concentrare tutto in un unico giorno. Questo approccio migliora la ritenzione a lungo termine perché permette al cervello di consolidare le informazioni tra una sessione e l'altra. La ricerca mostra che studenti che usano la pratica distribuita ottengono risultati migliori e ricordano le informazioni più a lungo rispetto a chi studia tutto in una volta. Il tuo piano applica automaticamente questa tecnica, distribuendo i task in modo ottimale."
      });
    } else if (taskType.includes("practice") || taskType.includes("pratica") || taskType.includes("esercizi")) {
      tips.push({
        icon: "✏️",
        title: "Pratica attiva",
        desc: "Non limitarti a guardare le soluzioni. Prova prima da solo, anche se sbagli. L'errore è parte dell'apprendimento.",
        detail: "La pratica attiva è fondamentale per l'apprendimento. Quando guardi solo le soluzioni, stai usando la memoria passiva, che è molto meno efficace. Invece, quando provi a risolvere un problema da solo, stai attivando la memoria attiva e costruendo connessioni neurali più forti. Anche se sbagli, il processo di tentativo ti aiuta a identificare le lacune nella tua comprensione. Dopo aver provato, confronta la tua soluzione con quella corretta e analizza le differenze. Chiediti: perché ho sbagliato? Quale concetto non avevo compreso? Questo processo di riflessione trasforma ogni errore in un'opportunità di apprendimento."
      });
      tips.push({
        icon: "🎯",
        title: "Focus su pattern",
        desc: "Identifica i pattern ricorrenti negli esercizi. Una volta capito il metodo, applicalo a varianti simili.",
        detail: "La maggior parte degli esercizi segue pattern ricorrenti. Una volta identificato il metodo risolutivo, puoi applicarlo a decine di varianti simili. Inizia risolvendo 3-5 esercizi dello stesso tipo, analizzando attentamente il processo risolutivo. Identifica i passaggi chiave: quali sono le informazioni date? Qual è l'obiettivo? Quali sono i passaggi intermedi? Crea un 'template mentale' del metodo. Poi, prova a risolvere esercizi simili applicando lo stesso template. Se trovi difficoltà, torna agli esercizi base e rafforza la comprensione del metodo. Con il tempo, svilupperai un'intuizione che ti permetterà di riconoscere rapidamente quale metodo applicare."
      });
    } else if (taskType.includes("review") || taskType.includes("ripasso")) {
      tips.push({
        icon: "📝",
        title: "Ripasso attivo",
        desc: "Non rileggere passivamente. Crea mappe mentali, riassumi a parole tue, risolvi esercizi senza guardare le soluzioni.",
        detail: "Il ripasso passivo (rileggere semplicemente il materiale) è uno dei metodi meno efficaci di studio. Il cervello tende a confondere la familiarità con la comprensione: se hai già letto qualcosa, ti sembra di conoscerla, anche se in realtà non la ricordi davvero. Il ripasso attivo invece richiede di ricostruire attivamente le informazioni. Crea mappe mentali senza guardare il libro: questo ti costringe a ricordare le connessioni tra i concetti. Scrivi riassunti a parole tue: se riesci a spiegare un concetto con le tue parole, significa che lo hai compreso. Risolvi esercizi senza guardare le soluzioni: questo attiva la memoria procedurale. Ogni volta che ricostruisci attivamente un'informazione, la memorizzi più profondamente."
      });
      tips.push({
        icon: "🧠",
        title: "Testa te stesso",
        desc: "Chiudi il libro e prova a spiegare i concetti. Se non ci riesci, riapri e studia quella parte specifica.",
        detail: "Il self-testing (autovalutazione) è una delle tecniche più potenti per l'apprendimento. Quando chiudi il libro e provi a spiegare un concetto, stai facendo un 'recall test': stai cercando di recuperare le informazioni dalla memoria a lungo termine. Questo processo rafforza le connessioni neurali molto più della semplice rilettura. Se riesci a spiegare il concetto, significa che lo hai compreso. Se non ci riesci o ti blocchi, hai identificato una lacuna specifica nella tua comprensione. In quel caso, riapri il libro e studia solo quella parte, poi richiudi e riprova. Questo ciclo di test → identificazione lacune → studio mirato → nuovo test è estremamente efficace. Puoi anche creare domande per te stesso mentre studi e rispondere a queste domande durante il ripasso."
      });
    } else {
      tips.push({
        icon: "📚",
        title: "Studio mirato",
        desc: "Concentrati su un argomento alla volta. Completa questo task prima di passare al successivo.",
        detail: "Il multitasking è un mito quando si tratta di apprendimento. Il cervello ha risorse cognitive limitate e quando cerchi di fare più cose contemporaneamente, la qualità dell'apprendimento diminuisce. Concentrarsi su un argomento alla volta permette al cervello di costruire connessioni più profonde e più stabili. Quando completi un task prima di passare al successivo, crei un senso di realizzazione che aumenta la motivazione. Inoltre, questo approccio ti permette di entrare in uno stato di 'flow' (flusso), dove sei completamente immerso nell'attività e la concentrazione è massima. Elimina le distrazioni: metti il telefono in modalità silenziosa, chiudi le schede del browser non necessarie, trova un ambiente tranquillo. Dedica questo tempo esclusivamente al task corrente."
      });
    }

    // Consigli basati sul tempo
    if (isToday) {
      tips.push({
        icon: "⏰",
        title: "Task di oggi",
        desc: "Questo task è pianificato per oggi. Completa il timer per mantenere il ritmo di studio.",
        detail: "Mantenere il ritmo di studio è fondamentale per il successo. Quando completi i task pianificati per il giorno, mantieni la coerenza del tuo piano di studio e costruisci abitudini positive. Ogni task completato è un piccolo successo che aumenta la tua autoefficacia e motivazione. Se accumuli task non completati, rischi di creare un debito di studio che diventa sempre più difficile da recuperare. Usa il timer per mantenere la concentrazione: sapere che hai un tempo limitato ti aiuta a rimanere focalizzato. Al termine del timer, fai una breve pausa per rigenerare le energie mentali. Se non riesci a completare il task oggi, non scoraggiarti: riprogrammalo per domani e mantieni la costanza."
      });
    }

    // Consiglio generale Pomodoro
    tips.push({
      icon: "🍅",
      title: "Tecnica Pomodoro",
      desc: `Dopo ${task.minutes || 25} minuti di studio, fai una pausa di 5 minuti. Questo mantiene alta la concentrazione.`,
      detail: `La tecnica Pomodoro è stata sviluppata da Francesco Cirillo alla fine degli anni '80. Il metodo prevede sessioni di studio concentrate di ${task.minutes || 25} minuti (un 'pomodoro'), seguite da una pausa di 5 minuti. Dopo 4 pomodori completati, fai una pausa più lunga di 15-30 minuti. Questa tecnica funziona perché rispetta i limiti naturali dell'attenzione umana: il cervello può mantenere un'alta concentrazione solo per periodi limitati. Le pause brevi permettono al cervello di consolidare le informazioni appena apprese e di rigenerare le risorse cognitive. Durante la pausa, evita attività che richiedono concentrazione (come i social media): invece, alzati, cammina, bevi acqua, fai stretching o semplicemente guarda fuori dalla finestra. Questo aiuta il cervello a 'resettarsi' e prepararsi per il prossimo pomodoro.`
    });
    
    // Consiglio su interleaving (solo se ci sono più esami)
    tips.push({
      icon: "🔄",
      title: "Mescolamento intelligente (Interleaving)",
      desc: "Il tuo piano alterna esami diversi nella stessa giornata. Questo migliora il transfer learning e la capacità di distinguere tra concetti simili.",
      detail: "L'interleaving (mescolamento) è una tecnica di apprendimento supportata dalla ricerca scientifica che consiste nell'alternare argomenti diversi durante lo studio invece di concentrarsi su un solo argomento alla volta. Il tuo piano di studio è stato generato per distribuire task di esami diversi nella stessa giornata, applicando automaticamente questa tecnica. La ricerca mostra che l'interleaving migliora il 'transfer learning' - la capacità di applicare conoscenze in contesti diversi - e aiuta a distinguere meglio tra concetti simili. Anche se inizialmente può sembrare più difficile, questo approccio porta a una comprensione più profonda e duratura. Il tuo piano bilancia automaticamente la varietà (interleaving) con la necessità di concentrarsi su un argomento per sessioni sufficientemente lunghe."
    });

    // Renderizza i tips
    container.innerHTML = tips.map((tip, index) => `
      <div class="tipItem tipItemClickable" data-tip-index="${index}">
        <div class="tipTitle">
          <span class="tipIcon">${tip.icon}</span>
          <span>${escapeHtml(tip.title)}</span>
          <span class="tipExpandIcon">→</span>
        </div>
        <div class="tipDesc">${escapeHtml(tip.desc)}</div>
      </div>
    `).join("");

    // Salva i tips per il popup
    container._tips = tips;

    // Aggiungi event listeners per aprire il popup
    container.querySelectorAll(".tipItemClickable").forEach((item, index) => {
      item.addEventListener("click", () => {
        showTipDetailModal(tips[index]);
      });
    });
  }

  // Funzione per mostrare il popup di approfondimento del consiglio
  function showTipDetailModal(tip) {
    // Evita di aprire più modali contemporaneamente
    if (document.getElementById("tip-detail-modal")) return;

    // Overlay oscurante
    const overlay = document.createElement("div");
    overlay.id = "tip-detail-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.75)",
      zIndex: "10000",
      padding: "20px",
      animation: "fadeIn 0.2s ease-out",
    });

    // Contenitore principale con stile card
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxWidth = "600px";
    card.style.width = "90%";
    card.style.padding = "32px";
    card.style.maxHeight = "85vh";
    card.style.overflowY = "auto";
    card.style.position = "relative";
    card.style.animation = "slideUp 0.3s ease-out";

    // Icona e titolo
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "16px";
    header.style.marginBottom = "20px";

    const iconSpan = document.createElement("span");
    iconSpan.textContent = tip.icon;
    iconSpan.style.fontSize = "32px";
    iconSpan.style.lineHeight = "1";

    const title = document.createElement("h2");
    title.textContent = tip.title;
    title.style.margin = "0";
    title.style.fontSize = "24px";
    title.style.fontWeight = "900";
    title.style.color = "rgba(255, 255, 255, 0.95)";
    title.style.flex = "1";

    header.appendChild(iconSpan);
    header.appendChild(title);
    card.appendChild(header);

    // Descrizione breve
    const shortDesc = document.createElement("p");
    shortDesc.textContent = tip.desc;
    shortDesc.style.marginBottom = "24px";
    shortDesc.style.color = "rgba(255, 255, 255, 0.7)";
    shortDesc.style.fontSize = "15px";
    shortDesc.style.lineHeight = "1.6";
    shortDesc.style.paddingBottom = "20px";
    shortDesc.style.borderBottom = "1px solid rgba(255, 255, 255, 0.1)";
    card.appendChild(shortDesc);

    // Approfondimento
    const detailTitle = document.createElement("h3");
    detailTitle.textContent = "Approfondimento";
    detailTitle.style.marginTop = "0";
    detailTitle.style.marginBottom = "16px";
    detailTitle.style.fontSize = "18px";
    detailTitle.style.fontWeight = "700";
    detailTitle.style.color = "rgba(255, 255, 255, 0.9)";
    card.appendChild(detailTitle);

    const detail = document.createElement("div");
    detail.textContent = tip.detail || tip.desc;
    detail.style.color = "rgba(255, 255, 255, 0.8)";
    detail.style.fontSize = "15px";
    detail.style.lineHeight = "1.7";
    detail.style.whiteSpace = "pre-wrap";
    card.appendChild(detail);

    // Bottone di chiusura
    const closeBtn = document.createElement("button");
    closeBtn.className = "btn";
    closeBtn.textContent = "Chiudi";
    closeBtn.style.marginTop = "28px";
    closeBtn.style.width = "100%";
    closeBtn.addEventListener("click", () => closeModal());

    card.appendChild(closeBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Funzione per chiudere la modale
    function closeModal() {
      try {
        if (overlay.parentNode) {
          overlay.style.animation = "fadeOut 0.2s ease-out";
          card.style.animation = "slideDown 0.2s ease-out";
          setTimeout(() => {
            if (overlay.parentNode) {
              document.body.removeChild(overlay);
            }
          }, 200);
        }
      } catch {}
    }

    // Chiudi cliccando sull'overlay (ma non sulla card)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    // Chiudi con ESC
    const escHandler = (e) => {
      if (e.key === "Escape" && document.getElementById("tip-detail-modal")) {
        closeModal();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  }

  // 1) storage
  let payload = getStoredTaskPayload(tid);
  if (payload?.task) {
    // Prova a recuperare user da auth
    watchAuth(async (user) => {
      if (user) {
        await bootWithPayload(payload, user);
      } else {
        await bootWithPayload(payload);
      }
    });
    return;
  }

  // 2) ricostruzione
  dbg("Payload non trovato in storage -> provo ricostruzione...");
  watchAuth(async (user) => {
    try {
      if (!user) {
        dbg("Non sei loggato. Torna alla dashboard.");
        return;
      }
      await reload(user);
      if (!user.emailVerified) {
        dbg("Email non verificata. Torna al login.");
        return;
      }
      const rebuilt = await reconstructTaskPayloadFromFirestore(user, tid);
      if (rebuilt?.task) {
        const raw = JSON.stringify(rebuilt);
        try {
          sessionStorage.setItem(`sp_task_${tid}`, raw);
        } catch {}
        try {
          localStorage.setItem(`sp_task_${tid}`, raw);
        } catch {}
        try {
          localStorage.setItem("sp_last_tid", tid);
        } catch {}
        bootWithPayload(rebuilt, user);
      } else {
        dbg(
          "Non trovo il task nel piano salvato (settimana corrente). Rigenera o riapri dalla dashboard."
        );
        const h = document.getElementById("task-title");
        const sub = document.getElementById("task-subtitle");
        if (h) h.textContent = "Task non trovata";
        if (sub) sub.textContent = "Rigenera settimana e riprova.";
      }
    } catch (e) {
      console.error(e);
      dbg("Errore ricostruzione: " + (e?.message || e));
    }
  });
}

// ----------------- Single bootstrap -----------------
window.addEventListener("DOMContentLoaded", () => {
  if (qs("login-form")) {
    mountIndex();
    return;
  }
  if (qs("save-profile") || qs("finish-onboarding")) {
    mountOnboarding();
    return;
  }
  if (qs("add-task-btn") || qs("exam-cards")) {
    mountApp();
    return;
  }
  if (document.getElementById("task-title") || document.getElementById("timer-start")) {
    mountTask();
    return;
  }
  if (qs("add-passed-exam") || qs("personal-info-display")) {
    mountProfile();
    return;
  }
  if (qs("save-strategies") || qs("day-minutes") || qs("go-to-dashboard")) {
    // Potrebbe essere strategies.html o onboarding.html
    // Controlla se c'è il bottone save-strategies (strategies) o save-profile (onboarding)
    if (qs("save-strategies") || qs("go-to-dashboard")) {
      // TODO: mountStrategies() quando implementato
      mountOnboarding(); // Per ora usa onboarding per strategies
    } else {
      mountOnboarding();
    }
    return;
  }
  console.log("boot -> unknown page");
});