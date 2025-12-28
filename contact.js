// contact.js — Firebase Firestore integration for feedback submission

import { db } from "./auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ===== UTILITY FUNCTIONS =====
const $ = (id) => document.getElementById(id);

function setStatus(el, msg, ok = false) {
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok ? "rgba(34,197,94,.95)" : "rgba(251,113,133,.95)";
  el.style.fontSize = "13px";
  el.style.marginTop = "8px";
  el.style.lineHeight = "1.5";
}

function setLoading(button, textEl, isLoading, defaultText) {
  if (button) {
    button.disabled = isLoading;
    button.style.opacity = isLoading ? "0.6" : "1";
    button.style.cursor = isLoading ? "not-allowed" : "pointer";
  }
  if (textEl) {
    textEl.textContent = isLoading ? "Invio in corso..." : defaultText;
  }
}

function getPageFallback() {
  return location.pathname.split("/").pop() || "/";
}

// ===== FEEDBACK FORM =====
const feedbackForm = $("feedback-form");
if (feedbackForm) {
  feedbackForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = $("feedback-email")?.value.trim();
    const type = $("feedback-type")?.value;
    const details = $("feedback-details")?.value.trim();
    const page = $("feedback-page")?.value.trim() || getPageFallback();
    const canContact = $("feedback-can-contact")?.checked || false;
    const statusEl = $("feedback-status");
    const submitBtn = $("feedback-submit");
    const submitText = $("feedback-submit-text");

    // Validazione
    if (!email || !type || !details) {
      setStatus(statusEl, "Compila tutti i campi obbligatori.", false);
      return;
    }

    // Validazione email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setStatus(statusEl, "Inserisci un indirizzo email valido.", false);
      return;
    }

    // Mostra loading
    setLoading(submitBtn, submitText, true, "Invia feedback");
    setStatus(statusEl, "", false);

    try {
      // Mappa i tipi per display
      const typeLabels = {
        bug: "Bug / Errore",
        suggestion: "Suggerimento",
        ux: "Problema di usabilità",
        feature: "Richiesta nuova funzionalità",
        other: "Altro"
      };

      // Prepara i dati per Firestore
      const feedbackData = {
        email: email,
        type: type,
        typeLabel: typeLabels[type] || type,
        details: details,
        page: page,
        canContact: canContact,
        status: "new", // new, read, resolved
        createdAt: serverTimestamp(),
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      };

      // Salva feedback su Firestore nella collection "feedback"
      const feedbackRef = collection(db, "feedback");
      await addDoc(feedbackRef, feedbackData);

      // Successo
      setStatus(
        statusEl,
        "✓ Feedback inviato con successo! Grazie per aver aiutato a migliorare Methodo.",
        true
      );
      feedbackForm.reset();

      // Reset dopo 6 secondi
      setTimeout(() => {
        setStatus(statusEl, "", false);
      }, 6000);

    } catch (error) {
      console.error("Errore salvataggio feedback:", error);
      setStatus(
        statusEl,
        "Errore nell'invio del feedback. Riprova più tardi o scrivi direttamente a info@methodo.app",
        false
      );
    } finally {
      setLoading(submitBtn, submitText, false, "Invia feedback");
    }
  });
}

// ===== EXPORT PER TEST =====
if (typeof module !== "undefined" && module.exports) {
  module.exports = { setStatus, setLoading, getPageFallback };
}
