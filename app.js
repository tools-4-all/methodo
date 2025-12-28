// app.js (single-file, GitHub Pages-friendly)
// Works with: index.html, onboarding.html, app.html, task.html, profile.html, strategies.html, settings.html
// Requires: planner.js (ES module) for generateWeeklyPlan/startOfWeekISO
// Auth moved to: auth.js

console.log("app.js loaded", location.href);

import {
  auth,
  db,
  watchAuth,
  loginWithEmail,
  signupWithEmail,
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
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { generateWeeklyPlan, startOfWeekISO } from "./planner.js";

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
function isoToday() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function daysTo(dateISO) {
  const now = new Date();
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

// ----------------- Firestore helpers -----------------
async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email ?? "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

async function getProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

async function setProfile(uid, data) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

async function listExams(uid) {
  const col = collection(db, "users", uid, "exams");
  const snap = await getDocs(col);
  const exams = [];
  snap.forEach((d) => {
    const examData = d.data();
    // Assicura che ogni esame abbia una category (per compatibilità con esami vecchi)
    if (!examData.category || examData.category === "auto") {
      examData.category = detectExamCategory(examData.name || "");
    }
    exams.push({ id: d.id, ...examData });
  });
  exams.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return exams;
}

async function addExam(uid, exam) {
  const col = collection(db, "users", uid, "exams");
  const ref = await addDoc(col, {
    ...exam,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function removeExam(uid, examId) {
  const ref = doc(db, "users", uid, "exams", examId);
  await deleteDoc(ref);
}

async function updateExam(uid, examId, examData) {
  const ref = doc(db, "users", uid, "exams", examId);
  await updateDoc(ref, { ...examData, updatedAt: serverTimestamp() });
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

async function saveWeeklyPlan(uid, weekStartISO, plan) {
  const ref = doc(db, "users", uid, "plans", weekStartISO);
  await setDoc(
    ref,
    { weekStart: weekStartISO, plan, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

async function loadWeeklyPlan(uid, weekStartISO) {
  const ref = doc(db, "users", uid, "plans", weekStartISO);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data()?.plan : null;
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

function estimateReadinessPercent(exam, profile, allocatedThisWeekMin) {
  const required = estimateRequiredMinutes(exam, profile);
  const capacity = estimateCapacityUntilExamMinutes(exam, profile);

  const capScore = capacity / Math.max(1, required);
  const planScore = (allocatedThisWeekMin || 0) / Math.max(1, required * 0.35);

  const blended = 0.7 * capScore + 0.3 * planScore;
  return clamp(Math.round(blended * 100), 0, 100);
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
  await ensureUserDoc(user);
  const profile = await getProfile(user.uid);
  
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
  ageInput.placeholder = "18";
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
      setText(loginErr, err?.message ?? "Errore login");
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

    try {
      const cred = await signupWithEmail(email, pass);

      // invia mail verifica
      await sendVerificationOrThrow(cred.user);

      // popup immediato
      showToast("Ti ho inviato una mail di verifica. Controlla inbox e spam.");

      // logout: niente accesso finché non verifica
      await logout();

      // fallback messaggio inline
      setText(signupErr, "Email inviata. Verifica e poi fai login.");

      activateTab("login");
    } catch (err) {
      console.error(err);
      setText(signupErr, err?.message ?? "Errore creazione account");
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
    dayContainer.querySelectorAll("input[data-day]").forEach((inp) => {
      out[inp.dataset.day] = Number(inp.value || 0);
    });
    return out;
  }

  function examCard(exam) {
    const d = document.createElement("div");
    d.className = "exam-card plain";
    d.innerHTML = `
      <div>
        <strong>${escapeHtml(exam.name)}</strong>
        <p class="muted small">${escapeHtml(exam.date)} · CFU ${exam.cfu} · livello ${exam.level}/5 · diff ${exam.difficulty}/3</p>
      </div>
      <div class="examCardActions">
        <button class="btn tiny" type="button" data-edit="${exam.id}">Modifica</button>
        <button class="btn tiny" type="button" data-del="${exam.id}">Rimuovi</button>
      </div>
    `;
    return d;
  }

  async function refreshExamList(uid) {
    const list = qs("exam-list");
    const exams = await listExams(uid);
    list.innerHTML = "";

    if (exams.length === 0) {
      const p = document.createElement("p");
      p.className = "muted small";
      p.textContent = "Nessun esame aggiunto.";
      list.appendChild(p);
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
    
    // Carica dati allenatore
    if (profile?.currentHours) qs("current-hours").value = profile.currentHours;
    if (profile?.targetHours) qs("target-hours").value = profile.targetHours;
    
    // Aggiorna visualizzazione allenatore
    updateCoachDisplay(profile);

    await refreshExamList(user.uid);

    // Funzione comune per salvare le impostazioni (usata sia da save-profile che save-strategies)
    const handleSaveSettings = async () => {
      const errorEl = qs("profile-error") || qs("strategy-error");
      const savedEl = qs("profile-saved") || qs("strategy-saved");
      
      if (errorEl) setText(errorEl, "");
      if (savedEl) setText(savedEl, "");

      try {
        const goalMode = qs("goal-mode")?.value;
        const weeklyHours = Number(qs("weekly-hours")?.value || 0);
        const taskMinutes = Number(qs("task-minutes")?.value || 35);
        const dayMinutes = readDayInputs();
        const currentHours = Number(qs("current-hours")?.value || 0);
        const targetHours = Number(qs("target-hours")?.value || 0);

        if (!goalMode) throw new Error("Seleziona un obiettivo di studio.");
        
        const totalMin = Object.values(dayMinutes).reduce((a, b) => a + Number(b || 0), 0);
        if (totalMin < 60) throw new Error("Disponibilità settimanale troppo bassa (< 60 min).");
        if (weeklyHours < 1) throw new Error("Ore settimanali non valide.");

        // Validazione allenatore
        if (currentHours > 0 && targetHours > 0) {
          if (targetHours <= currentHours) {
            throw new Error("L'obiettivo deve essere maggiore delle ore attuali.");
          }
          if (targetHours - currentHours > 15) {
            throw new Error("L'incremento è troppo grande (max 15h). Sii realistico.");
          }
        }

        await setProfile(user.uid, { 
          goalMode, 
          weeklyHours, 
          taskMinutes, 
          dayMinutes,
          currentHours: currentHours > 0 ? currentHours : null,
          targetHours: targetHours > 0 ? targetHours : null
        });
        
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
    
    // Aggiorna visualizzazione allenatore quando cambiano i valori
    const currentHoursInput = qs("current-hours");
    const targetHoursInput = qs("target-hours");
    const weeklyHoursInput = qs("weekly-hours");
    
    const updateCoachOnChange = () => {
      const profile = {
        currentHours: Number(currentHoursInput?.value || 0),
        targetHours: Number(targetHoursInput?.value || 0),
        weeklyHours: Number(weeklyHoursInput?.value || 0)
      };
      updateCoachDisplay(profile);
      
      // Se l'allenatore è attivo, aggiorna automaticamente weekly-hours
      if (profile.currentHours > 0 && profile.targetHours > 0 && profile.targetHours > profile.currentHours) {
        // Calcola ore suggerite per questa settimana (inizio della progressione)
        const suggestedHours = calculateSuggestedWeeklyHours(profile.currentHours, profile.targetHours);
        if (weeklyHoursInput && (!weeklyHoursInput.value || weeklyHoursInput.value === "0")) {
          weeklyHoursInput.value = suggestedHours.toFixed(1);
        }
      }
    };
    
    currentHoursInput?.addEventListener("input", updateCoachOnChange);
    targetHoursInput?.addEventListener("input", updateCoachOnChange);

    qs("add-exam")?.addEventListener("click", async (e) => {
      e.preventDefault();
      setText(qs("exam-error"), "");

      try {
        const name = (qs("exam-name").value || "").trim();
        const cfu = Number(qs("exam-cfu").value || 0);
        const date = qs("exam-date").value;
        const level = Number(qs("exam-level").value || 0);
        const difficulty = Number(qs("exam-diff").value || 2);
        const category = (qs("exam-category")?.value || "auto").trim();
        const topics = getTopicsArray("exam");

        if (!name) throw new Error("Nome esame mancante.");
        if (!date) throw new Error("Data esame mancante.");
        if (cfu < 1) throw new Error("CFU non validi.");

        // Auto-rileva categoria se non specificata
        let finalCategory = category;
        if (category === "auto") {
          finalCategory = detectExamCategory(name);
        }

        await addExam(user.uid, { 
          name, 
          cfu, 
          date, 
          level, 
          difficulty,
          category: finalCategory,
          topics: topics
        });
        
        // Reset form
        qs("exam-name").value = "";
        qs("exam-date").value = "";
        qs("exam-cfu").value = "6";
        qs("exam-level").value = "0";
        qs("exam-diff").value = "2";
        qs("exam-category").value = "auto";
        resetTopicsList("exam");
        
        await refreshExamList(user.uid);
      } catch (err) {
        console.error(err);
        setText(qs("exam-error"), err?.message ?? "Errore aggiunta esame");
      }
    });

    // Gestore "Vai alla dashboard" (sia da onboarding che da strategies)
    const finishBtn = qs("finish-onboarding");
    const goToDashboardBtn = qs("go-to-dashboard");
    
    const handleGoToDashboard = async () => {
      try {
        // Forza un delay più lungo per assicurarsi che eventuali salvataggi siano completati
        // (Firestore potrebbe richiedere tempo per propagare le modifiche)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Ricarica i dati freschi da Firestore (con retry per assicurarsi che siano aggiornati)
        let profile2 = await getProfile(user.uid);
        let exams2 = await listExams(user.uid);
        
        // Se non ci sono esami, aspetta un po' e riprova (potrebbe essere un problema di timing)
        if (exams2.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 300));
          exams2 = await listExams(user.uid);
        }

        console.log("[Dashboard] Verifica:", {
          hasGoalMode: !!profile2?.goalMode,
          hasDayMinutes: !!profile2?.dayMinutes,
          examsCount: exams2.length,
          profile: profile2,
          exams: exams2
        });

        if (!profile2?.goalMode || !profile2?.dayMinutes) {
          const errorEl = qs("profile-error") || qs("exam-error");
          if (errorEl) {
            setText(errorEl, "Salva prima le impostazioni del profilo (obiettivo, ore settimanali, disponibilità).");
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

        // Verifica se ci sono modifiche che richiedono rigenerazione del piano
        const weekStart = startOfWeekISO(new Date());
        const weekStartISO = `${weekStart.getFullYear()}-${z2(weekStart.getMonth() + 1)}-${z2(weekStart.getDate())}`;
        
        console.log("[handleGoToDashboard] Verifica modifiche:", {
          profile: {
            goalMode: profile2?.goalMode,
            weeklyHours: profile2?.weeklyHours,
            taskMinutes: profile2?.taskMinutes,
            currentHours: profile2?.currentHours,
            targetHours: profile2?.targetHours,
          },
          examsCount: exams2.length,
          exams: exams2.map(e => ({
            id: e.id,
            name: e.name,
            date: e.date,
            cfu: e.cfu,
            level: e.level,
            difficulty: e.difficulty,
            category: e.category
          }))
        });
        
        const savedPlan = await loadWeeklyPlan(user.uid, weekStartISO);
        const needsRegeneration = hasPlanChanges(profile2, exams2, savedPlan);
        
        if (needsRegeneration) {
          console.log("[handleGoToDashboard] Rilevate modifiche, rigenero il piano...");
          // Assicura che tutti gli esami abbiano una category valida
          const normalizedExams = exams2.map(e => ({
            ...e,
            category: e.category || detectExamCategory(e.name || "") || "mixed"
          }));
          
          // Rigenera il piano con i nuovi dati
          const newPlan = generateWeeklyPlan(profile2, normalizedExams, weekStart);
          // Aggiungi snapshot per future comparazioni
          addSnapshotToPlan(newPlan, profile2, normalizedExams);
          // Salva il piano rigenerato
          await saveWeeklyPlan(user.uid, weekStartISO, newPlan);
          console.log("[handleGoToDashboard] Piano rigenerato e salvato:", {
            weekStart: newPlan.weekStart,
            allocations: newPlan.allocations.length,
            totalTasks: newPlan.days.reduce((sum, d) => sum + (d.tasks?.length || 0), 0)
          });
        } else {
          console.log("[handleGoToDashboard] Nessuna modifica rilevata, uso piano esistente.");
        }

        // Tutto ok, vai alla dashboard
        window.location.assign("./app.html");
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
function calculateSuggestedWeeklyHours(currentHours, targetHours) {
  // Calcola le ore suggerite per questa settimana
  // Inizia con un incremento moderato (circa 10-15% rispetto a current)
  const increment = Math.min((targetHours - currentHours) * 0.15, 2); // Max 2h di incremento
  return Math.min(currentHours + increment, targetHours);
}

function calculateProgressionWeeks(currentHours, targetHours) {
  // Calcola quante settimane servono per raggiungere l'obiettivo
  // Incremento consigliato: 1-2h a settimana
  const incrementPerWeek = 1.5; // Incremento medio settimanale
  const totalIncrease = targetHours - currentHours;
  return Math.ceil(totalIncrease / incrementPerWeek);
}

function updateCoachDisplay(profile) {
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
    
    const weeks = calculateProgressionWeeks(current, target);
    const suggested = calculateSuggestedWeeklyHours(current, target);
    
    coachInfo.innerHTML = `
      <div style="font-size:12px; color:rgba(255,255,255,.7); margin-top:8px; line-height:1.5;">
        <strong style="color:rgba(255,255,255,.9);">Piano progressivo:</strong><br>
        Questa settimana: <strong>${suggested.toFixed(1)}h</strong> suggerite<br>
        Tempo stimato per raggiungere l'obiettivo: <strong>${weeks} settimane</strong>
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

// ----------------- Modale modifica esame -----------------
function openEditExamModal(uid, exam, onSuccess) {
  // Evita di aprire più modali contemporaneamente
  if (document.getElementById("exam-edit-modal")) return;

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
  });

  // Contenitore principale con stile card
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "480px";
  card.style.width = "90%";
  card.style.padding = "20px";

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

  // Campo data
  const dateLabel = document.createElement("label");
  dateLabel.innerHTML = '<span>Data</span>';
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.id = "ee-date";
  dateInput.value = exam.date || "";
  dateInput.required = true;
  dateLabel.appendChild(dateInput);

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

  // Aggiungi tutti i campi al form
  form.appendChild(nameLabel);
  form.appendChild(dateLabel);
  form.appendChild(cfuLabel);
  form.appendChild(levelLabel);
  form.appendChild(diffLabel);
  form.appendChild(catLabel);
  form.appendChild(topicsLabel);
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
      const date = dateInput.value;
      const cfu = Number(cfuInput.value || 0);
      const level = Number(levelInput.value || 0);
      const difficulty = Number(diffSelect.value || 2);
      const category = (catSelect.value || "auto").trim();
      const topics = getTopicsArray("edit");

      if (!name) throw new Error("Nome esame mancante.");
      if (!date) throw new Error("Data esame mancante.");
      if (cfu < 1) throw new Error("CFU non validi.");

      // Auto-rileva categoria se necessario
      let finalCategory = category;
      if (category === "auto") {
        finalCategory = detectExamCategory(name);
      }

      await updateExam(uid, exam.id, { 
        name, 
        cfu, 
        date, 
        level, 
        difficulty,
        category: finalCategory,
        topics
      });
      closeModal();
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error(err);
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
        <div class="tipIcon">💡</div>
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

  document.getElementById("regen-week-menu")?.addEventListener("click", () => {
    close();
    document.getElementById("regen-week")?.click();
  });

  document.getElementById("go-today")?.addEventListener("click", () => {
    close();
    const todayCard = document.querySelector(".card");
    todayCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "r" || e.key === "R") document.getElementById("regen-week")?.click();
    if (e.key === "m" || e.key === "M") toggle();
  });
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

      document.getElementById("user-line").textContent = user.email ?? "—";

      await ensureUserDoc(user);

      const profile = await getProfile(user.uid);
      if (!profile?.goalMode || !profile?.dayMinutes) {
        console.log("[App] Profilo incompleto, redirect a settings:", {
          hasGoalMode: !!profile?.goalMode,
          hasDayMinutes: !!profile?.dayMinutes,
          profileKeys: profile ? Object.keys(profile) : []
        });
        window.location.assign("./settings.html");
        return;
      }

      const exams = await listExams(user.uid);
      if (exams.length === 0) {
        console.log("[App] Nessun esame trovato, redirect a settings. Esami:", exams);
        window.location.assign("./settings.html");
        return;
      }
      
      console.log("[App] Tutto ok, carico dashboard. Esami:", exams.length);

      const weekStart = startOfWeekISO(new Date());
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
          plan = generateWeeklyPlan(profile, normalizedExams, weekStart);
          addSnapshotToPlan(plan, profile, normalizedExams);
          await saveWeeklyPlan(user.uid, weekStartISO, plan);
          console.log("[App] Piano rigenerato e salvato:", {
            weekStart: plan.weekStart,
            allocations: plan.allocations.length,
            totalTasks: plan.days.reduce((sum, d) => sum + (d.tasks?.length || 0), 0)
          });
        } else {
          console.log("[App] Nessuna modifica rilevata, uso piano esistente.");
        }
      }

      renderDashboard(plan, normalizedExams, profile, user, weekStartISO);
      // Associa il bottone per aggiungere task manuali dopo il primo render
      bindAddTaskButton(plan, normalizedExams, profile, user, weekStartISO);

      document.getElementById("regen-week")?.addEventListener("click", async () => {
        const plan2 = generateWeeklyPlan(profile, normalizedExams, weekStart);
        // Aggiungi snapshot per future comparazioni
        addSnapshotToPlan(plan2, profile, normalizedExams);
        await saveWeeklyPlan(user.uid, weekStartISO, plan2);
        renderDashboard(plan2, normalizedExams, profile, user, weekStartISO);
        // Ricollega il bottone per il nuovo piano
        bindAddTaskButton(plan2, normalizedExams, profile, user, weekStartISO);
      });

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

function renderDashboard(plan, exams, profile, user = null, weekStartISO = null) {
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

  safeText(
    "week-meta",
    `dal ${plan.weekStart} · budget ${Math.round(plan.weeklyBudgetMin / 60)}h · task ${plan.taskMinutes}m`
  );
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
      const isDone = (() => {
        try {
          return localStorage.getItem(doneKey) === "1";
        } catch {
          return false;
        }
      })();

      const row = document.createElement("div");
      row.className = `task taskClickable taskCompact ${isDone ? "taskDone" : ""}`;
      row.dataset.taskid = taskId;
      row.draggable = true;
      row.dataset.originalIndex = i;
      row.dataset.period = period;

      row.innerHTML = `
        <div class="taskDragHandle" title="Trascina per riordinare">⋮⋮</div>
        <input type="checkbox" class="taskChk" ${isDone ? "checked" : ""} />
        <div class="taskCompactContent">
          <div class="taskCompactTitle">${escapeHtml(t.examName)}</div>
          <div class="taskCompactMeta">
            <span class="tag tagSmall">${escapeHtml(t.type)}</span>
            <span class="taskMinutes">${t.minutes}m</span>
          </div>
        </div>
      `;

      const chk = row.querySelector(".taskChk");
      chk?.addEventListener("click", (e) => {
        e.stopPropagation();
        // Non preventDefault per permettere il toggle naturale del checkbox
      });
      chk?.addEventListener("change", (e) => {
        const checked = chk.checked;
        try {
          if (checked) localStorage.setItem(doneKey, "1");
          else localStorage.removeItem(doneKey);
        } catch {}
        row.classList.toggle("taskDone", checked);
        // Aggiorna il grafico di completamento
        updateTodayProgress(plan, todayDay);
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
          renderDashboard(plan, exams, profile, user, weekStartISO);
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
    for (const a of allocSorted) {
      const div = document.createElement("div");
      div.className = "weekItem";
      div.innerHTML = `
        <strong>${escapeHtml(a.name)}</strong>
        <span>${Math.round(((a.targetMin || 0) / 60) * 10) / 10}h</span>
      `;
      ws.appendChild(div);
    }
    if (plan.cut && plan.cut.length) {
      const cut = document.createElement("div");
      cut.className = "callout";
      cut.innerHTML = `
        <h3>Realismo</h3>
        <p>Ho tagliato alcune cose perché la tua disponibilità non copre tutto. Aumenta ore o riduci esami.</p>
      `;
      ws.appendChild(cut);
    }
  }

  const ec = safeHTML("exam-cards", "");
  if (!ec) {
    safeText("status-line", "Dashboard HTML incompleta: manca #exam-cards.");
    return;
  }

  const allocMap = new Map((plan.allocations || []).map((a) => [a.examId, a.targetMin]));
  const sortedExams = [...(exams || [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  for (const e of sortedExams) {
    const dleft = daysTo(e.date);
    const allocThisWeek = Number(allocMap.get(e.id) || 0);

    const pct = estimateReadinessPercent(e, profile, allocThisWeek);
    const badge = readinessBadge(pct);

    const required = estimateRequiredMinutes(e, profile);
    const cap = estimateCapacityUntilExamMinutes(e, profile);

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
            ${escapeHtml(e.date)} · tra ${dleft}g · CFU ${e.cfu} · livello ${e.level}/5 · diff ${e.difficulty}/3
          </div>
          <div class="examMeta">
            Piano settimanale: <b>${Math.round((allocThisWeek / 60) * 10) / 10}h</b> ·
            Necessario stimato: <b>${Math.round(required / 60)}h</b> ·
            Capacità fino all’esame: <b>${Math.round(cap / 60)}h</b>
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

  // Campo tipo
  const typeLabel = document.createElement("label");
  typeLabel.innerHTML = '<span>Tipo</span>';
  const typeInput = document.createElement("input");
  typeInput.type = "text";
  typeInput.id = "nt-type";
  typeInput.placeholder = "theory, practice, review...";
  typeInput.required = true;
  typeLabel.appendChild(typeInput);

  // Campo minuti
  const minutesLabel = document.createElement("label");
  minutesLabel.innerHTML = '<span>Durata (min)</span>';
  const minutesInput = document.createElement("input");
  minutesInput.type = "number";
  minutesInput.id = "nt-minutes";
  minutesInput.min = "1";
  minutesInput.value = "30";
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
    const typeVal = typeInput.value.trim();
    const minutesVal = parseInt(minutesInput.value, 10);

    if (!exam || !labelVal || !typeVal || !minutesVal || minutesVal <= 0) {
      alert("Compila tutti i campi con valori validi.");
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
        alert("Errore: giorno non trovato.");
        return;
      }
      // Assegna periodo (mattina/pomeriggio) basato sulla capacità giornaliera
      const halfCap = (day.capacityMin || 0) / 2;
      const currentUsed = (day.tasks || []).reduce((sum, t) => sum + (t.minutes || 0), 0);
      newTask.period = (currentUsed + minutesVal) <= halfCap ? "morning" : "afternoon";
      day.tasks = [...(day.tasks || []), newTask];
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
      renderDashboard(plan, exams, profile, user, weekStartISO);
      bindAddTaskButton(plan, exams, profile, user, weekStartISO);
      closeModal();
    } catch (err) {
      console.error(err);
      alert("Errore creazione task: " + (err?.message || err));
    }
  });
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
    set("info-exam", t.examName || "—");
    set("info-label", t.label || "—");
    set("info-type", t.type || "—");
    set("info-minutes", `${t.minutes || 0} min`);
    set("info-date", payload.dateISO || "—");

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
      } catch {}

      renderTimer();
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }

    function markDone() {
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
      } catch {}

      renderTimer();
      
      const statusEl = document.getElementById("task-status");
      if (statusEl) {
        statusEl.textContent = "✓ Task completata! Ottimo lavoro!";
        statusEl.style.color = "rgba(34, 197, 94, 1)";
      }
    }

    function markSkip() {
      st.skipped = true;
      st.done = false;
      saveState(st);

      try {
        localStorage.removeItem(`sp_task_done_${tid}`);
      } catch {}

      renderTimer();
    }

    document.getElementById("timer-start")?.addEventListener("click", start);
    document.getElementById("timer-pause")?.addEventListener("click", pause);
    document.getElementById("timer-reset")?.addEventListener("click", reset);
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
        title: "Ripetizione spaziata",
        desc: "Rivedi i concetti chiave dopo 24 ore, poi dopo 3 giorni. Questo aiuta la memorizzazione a lungo termine.",
        detail: "La ripetizione spaziata (spaced repetition) è una delle tecniche più efficaci per la memorizzazione a lungo termine. Il principio si basa sulla 'curva dell'oblio': dopo aver appreso qualcosa, la memoria si indebolisce nel tempo, ma ogni revisione rafforza il ricordo. Programma le tue revisioni: prima revisione dopo 24 ore, seconda dopo 3 giorni, terza dopo una settimana, quarta dopo due settimane. Puoi usare app come Anki o semplicemente un calendario. L'importante è essere costanti: anche solo 10-15 minuti di revisione al giorno possono fare la differenza tra ricordare e dimenticare completamente un argomento."
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
  if (qs("regen-week") || qs("exam-cards")) {
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