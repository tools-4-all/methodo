// app.js (single-file, GitHub Pages-friendly, Firebase via CDN)
// Works with: index.html, onboarding.html, app.html
// Requires: planner.js (ES module) for generateWeeklyPlan/startOfWeekISO

console.log("app.js loaded", location.href);

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
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

// ----------------- Firebase init -----------------
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
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

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
function statusLabel(s) {
  if (s === "danger") return "a rischio";
  if (s === "warn") return "attenzione";
  return "ok";
}

function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }

// Stima ore "necessarie" per arrivare pronto, in modo realistico ma semplice.
// Non è scienza: è un modello prodotto (serve decisione, non verità).
function estimateRequiredMinutes(exam, profile){
  const cfu = clamp(Number(exam.cfu || 6), 1, 30);
  const diff = clamp(Number(exam.difficulty || 2), 1, 3);   // 1..3
  const level = clamp(Number(exam.level || 0), 0, 5);       // 0..5

  // Base: ~7h/CFU per "passare" (Italia spesso 25h/CFU ufficiali, ma studio reale varia: qui scegliamo pratico)
  // Scala con difficoltà e con obiettivo.
  const mode = profile.goalMode || "good";
  const modeFactor = mode === "top" ? 1.15 : mode === "pass" ? 0.85 : 1.0;
  const diffFactor = 0.9 + 0.15 * (diff - 1);  // 0.9..1.2

  const baseHours = cfu * 7.0 * diffFactor * modeFactor;

  // Se level è alto, riduci il restante. Non lineare: da 0→5 riduce forte.
  // level 0 => 100% restante, level 5 => 15% restante
  const remainingFrac = clamp(1.0 - (level / 5) * 0.85, 0.15, 1.0);

  return Math.round(baseHours * remainingFrac * 60);
}

// Stima capacità fino alla data esame, usando le ore settimanali profilo.
function estimateCapacityUntilExamMinutes(exam, profile){
  const daysLeft = Math.max(0, daysTo(exam.date));
  const weeklyHours = clamp(Number(profile.weeklyHours || 10), 1, 80);
  const dailyAvgMin = (weeklyHours * 60) / 7;
  // Non contare tutti i giorni uguali: penalizza un po' (vita reale, imprevisti)
  const realism = 0.85;
  return Math.round(daysLeft * dailyAvgMin * realism);
}

// Readiness 0..100: quanto sei "coperto" rispetto al richiesto.
function estimateReadinessPercent(exam, profile, allocatedThisWeekMin){
  const required = estimateRequiredMinutes(exam, profile);
  const capacity = estimateCapacityUntilExamMinutes(exam, profile);

  // “Piano” settimanale: se la tua allocazione è piccola rispetto al necessario,
  // readiness cala anche se capacity teorica alta.
  // Usa un blend: 70% capacity-based + 30% plan-signal.
  const capScore = capacity / Math.max(1, required);
  const planScore = (allocatedThisWeekMin || 0) / Math.max(1, required * 0.35); // 35% del richiesto come target di breve

  const blended = 0.70 * capScore + 0.30 * planScore;
  return clamp(Math.round(blended * 100), 0, 100);
}

function readinessBadge(pct){
  if(pct >= 85) return {cls:"good", text:"on track"};
  if(pct >= 60) return {cls:"warn", text:"borderline"};
  return {cls:"bad", text:"rischio"};
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
  snap.forEach((d) => exams.push({ id: d.id, ...d.data() }));
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

async function saveWeeklyPlan(uid, weekStartISO, plan) {
  const ref = doc(db, "users", uid, "plans", weekStartISO);
  await setDoc(
    ref,
    {
      weekStart: weekStartISO,
      plan,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function loadWeeklyPlan(uid, weekStartISO) {
  const ref = doc(db, "users", uid, "plans", weekStartISO);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data()?.plan : null;
}

// Redirect logic (single source of truth)
async function routeAfterLogin(user) {
  await ensureUserDoc(user);
  const profile = await getProfile(user.uid);
  const needsOnboarding = !profile?.goalMode || !profile?.dayMinutes;

  console.log("routeAfterLogin ->", needsOnboarding ? "onboarding" : "app");
  window.location.assign(needsOnboarding ? "./onboarding.html" : "./app.html");
}

// ----------------- INDEX (AUTH) -----------------
function mountIndex() {
  console.log("mountIndex()");

  // Tabs
  const tabLogin = qs("tab-login");
  const tabSignup = qs("tab-signup");
  const loginForm = qs("login-form");
  const signupForm = qs("signup-form");

  // Inputs
  const loginEmail = qs("login-email");
  const loginPass = qs("login-pass");
  const signupEmail = qs("signup-email");
  const signupPass = qs("signup-pass");

  // Errors
  const loginErr = qs("login-error");
  const signupErr = qs("signup-error");

  // Buttons (recommended IDs in HTML)
  const loginBtn = qs("login-submit");
  const signupBtn = qs("signup-submit");

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
    console.log("doLogin()");
    clearErrors();

    const email = (loginEmail?.value || "").trim();
    const pass = loginPass?.value || "";
    if (!email || !pass) {
      setText(loginErr, "Inserisci email e password.");
      return;
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      console.log("LOGIN ok");
      await routeAfterLogin(cred.user);
    } catch (err) {
      console.error(err);
      setText(loginErr, err?.message ?? "Errore login");
    }
  }

  async function doSignup() {
    console.log("doSignup()");
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
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      console.log("SIGNUP ok");
      await routeAfterLogin(cred.user);
    } catch (err) {
      console.error(err);
      setText(signupErr, err?.message ?? "Errore creazione account");
    }
  }

  // Submit handlers
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log("LOGIN submit fired");
    await doLogin();
  });
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log("SIGNUP submit fired");
    await doSignup();
  });

  // Click fallbacks (in case submit is weird)
  loginBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    console.log("LOGIN button click fired");
    await doLogin();
  });
  signupBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    console.log("SIGNUP button click fired");
    await doSignup();
  });

  // If already logged in, route immediately
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    console.log("already logged in -> route");
    await routeAfterLogin(user);
  });
}

// ----------------- ONBOARDING -----------------
function mountOnboarding() {
  console.log("mountOnboarding()");

  qs("logout-btn")?.addEventListener("click", async () => {
    await signOut(auth);
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
        <div class="day-label">${label}</div>
        <input class="day-input" data-day="${k}" type="number" min="0" max="600" step="5" value="${val}">
        <div class="muted small">min</div>
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
      <button class="btn tiny" type="button" data-del="${exam.id}">Rimuovi</button>
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
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.assign("./index.html");
      return;
    }

    setText(qs("user-line"), user.email ?? "—");
    await ensureUserDoc(user);

    // hydrate UI
    const profile = await getProfile(user.uid);

    renderDayInputs(profile?.dayMinutes ?? null);

    if (profile?.goalMode) qs("goal-mode").value = profile.goalMode;
    if (profile?.weeklyHours) qs("weekly-hours").value = profile.weeklyHours;
    if (profile?.taskMinutes) qs("task-minutes").value = String(profile.taskMinutes);

    await refreshExamList(user.uid);

    // Save profile
    qs("save-profile")?.addEventListener("click", async () => {
      setText(qs("profile-error"), "");
      setText(qs("profile-saved"), "");

      try {
        const goalMode = qs("goal-mode").value;
        const weeklyHours = Number(qs("weekly-hours").value || 0);
        const taskMinutes = Number(qs("task-minutes").value || 35);
        const dayMinutes = readDayInputs();

        const totalMin = Object.values(dayMinutes).reduce((a, b) => a + Number(b || 0), 0);
        if (totalMin < 60) throw new Error("Disponibilità settimanale troppo bassa (< 60 min).");
        if (weeklyHours < 1) throw new Error("Ore settimanali non valide.");

        await setProfile(user.uid, { goalMode, weeklyHours, taskMinutes, dayMinutes });
        setText(qs("profile-saved"), "Profilo salvato.");
      } catch (err) {
        console.error(err);
        setText(qs("profile-error"), err?.message ?? "Errore salvataggio profilo");
      }
    });

    // Add exam
    qs("add-exam")?.addEventListener("click", async (e) => {
      e.preventDefault();
      setText(qs("exam-error"), "");

      try {
        const name = (qs("exam-name").value || "").trim();
        const cfu = Number(qs("exam-cfu").value || 0);
        const date = qs("exam-date").value;
        const level = Number(qs("exam-level").value || 0);
        const difficulty = Number(qs("exam-diff").value || 2);

        if (!name) throw new Error("Nome esame mancante.");
        if (!date) throw new Error("Data esame mancante.");
        if (cfu < 1) throw new Error("CFU non validi.");

        await addExam(user.uid, { name, cfu, date, level, difficulty });
        qs("exam-name").value = "";
        await refreshExamList(user.uid);
      } catch (err) {
        console.error(err);
        setText(qs("exam-error"), err?.message ?? "Errore aggiunta esame");
      }
    });

    // Finish onboarding
    qs("finish-onboarding")?.addEventListener("click", async () => {
      const profile2 = await getProfile(user.uid);
      const exams2 = await listExams(user.uid);

      if (!profile2?.goalMode || !profile2?.dayMinutes) {
        setText(qs("profile-error"), "Salva prima il profilo.");
        return;
      }
      if (exams2.length === 0) {
        setText(qs("exam-error"), "Aggiungi almeno un esame.");
        return;
      }

      window.location.assign("./app.html");
    });
  });
}

function setupMenu(){
    const btn = document.getElementById("menu-btn");
    const panel = document.getElementById("menu-panel");
    if(!btn || !panel) return;
  
    const open = () => {
      panel.classList.remove("hidden");
      btn.setAttribute("aria-expanded","true");
    };
    const close = () => {
      panel.classList.add("hidden");
      btn.setAttribute("aria-expanded","false");
    };
    const toggle = () => panel.classList.contains("hidden") ? open() : close();
  
    btn.addEventListener("click", (e)=>{ e.preventDefault(); toggle(); });
  
    // click outside closes
    document.addEventListener("click", (e)=>{
      if(panel.classList.contains("hidden")) return;
      if(btn.contains(e.target) || panel.contains(e.target)) return;
      close();
    });
  
    // ESC closes
    document.addEventListener("keydown", (e)=>{
      if(e.key === "Escape") close();
    });
  
    // menu actions
    document.getElementById("regen-week-menu")?.addEventListener("click", ()=>{
      close();
      document.getElementById("regen-week")?.click();
    });
  
    document.getElementById("go-today")?.addEventListener("click", ()=>{
      close();
      // scroll to Today card
      const todayCard = document.querySelector(".card");
      todayCard?.scrollIntoView({behavior:"smooth", block:"start"});
    });
  
    // shortcuts (optional)
    document.addEventListener("keydown", (e)=>{
      if(e.target && ["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
      if(e.key === "r" || e.key === "R") document.getElementById("regen-week")?.click();
      if(e.key === "m" || e.key === "M") toggle();
    });
  }
  

// ----------------- DASHBOARD -----------------
function mountApp(){
    const dbg = (msg) => {
      console.log("[APP]", msg);
      const el = document.getElementById("dbg");
      if (el) el.textContent = msg;
    };
    const dbg2 = (msg) => {
      console.log("[APP2]", msg);
      const el = document.getElementById("dbg2");
      if (el) el.textContent = msg;
    };
    
    setupMenu();

    dbg("mountApp() chiamata");
  
    document.getElementById("logout-btn")?.addEventListener("click", async ()=>{
      dbg("logout...");
      await signOut(auth);
      window.location.assign("./index.html");
    });
  
    onAuthStateChanged(auth, async (user) => {
      try{
        if(!user){
          dbg("NO USER -> redirect index");
          window.location.assign("./index.html");
          return;
        }
  
        dbg(`USER OK: ${user.uid}`);
        document.getElementById("user-line").textContent = user.email ?? "—";
  
        await ensureUserDoc(user);
        dbg("ensureUserDoc ok");
  
        const profile = await getProfile(user.uid);
        dbg2("profile: " + JSON.stringify(profile));
  
        if(!profile?.goalMode || !profile?.dayMinutes){
          dbg("PROFILE MISSING -> redirect onboarding");
          window.location.assign("./onboarding.html");
          return;
        }
  
        const exams = await listExams(user.uid);
        dbg(`exams: ${exams.length}`);
  
        if(exams.length === 0){
          dbg("NO EXAMS -> redirect onboarding");
          window.location.assign("./onboarding.html");
          return;
        }
  
        const weekStart = startOfWeekISO(new Date());
        const z = (n)=>String(n).padStart(2,"0");
        const weekStartISO = `${weekStart.getFullYear()}-${z(weekStart.getMonth()+1)}-${z(weekStart.getDate())}`;
        dbg(`weekStartISO: ${weekStartISO}`);
  
        let plan = await loadWeeklyPlan(user.uid, weekStartISO);
        dbg(plan ? "loaded saved plan" : "no saved plan -> generate");
  
        if(!plan){
          plan = generateWeeklyPlan(profile, exams, weekStart);
          await saveWeeklyPlan(user.uid, weekStartISO, plan);
          dbg("generated + saved plan");
        }
  
        dbg("renderDashboard...");
        renderDashboard(plan, exams, profile);
        dbg("renderDashboard OK");
  
        document.getElementById("regen-week")?.addEventListener("click", async ()=>{
          dbg("regen...");
          const plan2 = generateWeeklyPlan(profile, exams, weekStart);
          await saveWeeklyPlan(user.uid, weekStartISO, plan2);
          renderDashboard(plan2, exams, profile);
          dbg("regen OK");
        });
  
        document.getElementById("mark-today-done")?.addEventListener("click", async ()=>{
          document.getElementById("status-line").textContent = "Segnato: oggi completato (MVP).";
        });
  
        document.getElementById("mark-today-less")?.addEventListener("click", async ()=>{
          document.getElementById("status-line").textContent = "Segnato: oggi sotto target (MVP).";
        });
  
      }catch(e){
        console.error(e);
        dbg("CRASH: " + (e?.message || e));
      }
    });
  }
  

function renderDashboard(plan, exams, profile){
    const $ = (id) => document.getElementById(id);
  
    // helper: scrive solo se esiste
    const safeText = (id, txt) => { const el = $(id); if(el) el.textContent = txt ?? ""; };
    const safeHTML = (id, html) => { const el = $(id); if(el) el.innerHTML = html ?? ""; return el; };
  
    const todayISO = isoToday();
  
    safeText("week-meta", `dal ${plan.weekStart} · budget ${Math.round(plan.weeklyBudgetMin/60)}h · task ${plan.taskMinutes}m`);
    safeText("today-meta", todayISO);
  
    // --- TODAY ---
    const todayDay = plan.days?.find(d => d.dateISO === todayISO) || plan.days?.[0] || null;
    const todayTotal = (todayDay?.tasks || []).reduce((a,t)=>a + Number(t.minutes||0), 0);
    safeText("today-pill", `Target oggi: ${Math.round(todayTotal)} min · ${Math.round(todayTotal/60*10)/10}h`);
  
    const todayWrap = safeHTML("today-tasks", "");
    if(!todayWrap){
      // Se manca il container, non crashare: mostra almeno un errore sullo status-line
      safeText("status-line", "Dashboard HTML incompleta: manca #today-tasks. Aggiorna app.html.");
      return;
    }
  
    if(!todayDay || !todayDay.tasks || todayDay.tasks.length === 0){
      todayWrap.innerHTML = `<div class="callout"><h3>Vuoto</h3><p>Nessun task oggi. Controlla disponibilità o rigenera.</p></div>`;
    } else {
      for(const t of todayDay.tasks){
        const row = document.createElement("div");
        row.className = "task";
        row.innerHTML = `
          <div class="taskRow">
            <input type="checkbox" />
            <div style="min-width:0">
              <div class="taskTitle">${escapeHtml(t.examName)} · ${escapeHtml(t.label)}</div>
              <div class="taskSub">
                <span class="tag">${escapeHtml(t.type)}</span>
                <span style="margin-left:8px">${t.minutes} min</span>
              </div>
            </div>
          </div>
        `;
        todayWrap.appendChild(row);
      }
    }
  
    // --- WEEK SUMMARY ---
    const ws = safeHTML("week-summary", "");
    if(ws){
      const allocSorted = [...(plan.allocations || [])].sort((a,b)=> (b.targetMin||0) - (a.targetMin||0));
      for(const a of allocSorted){
        const div = document.createElement("div");
        div.className = "weekItem";
        div.innerHTML = `
          <strong>${escapeHtml(a.name)}</strong>
          <span>${Math.round((a.targetMin||0)/60*10)/10}h</span>
        `;
        ws.appendChild(div);
      }
      if(plan.cut && plan.cut.length){
        const cut = document.createElement("div");
        cut.className = "callout";
        cut.innerHTML = `
          <h3>Realismo</h3>
          <p>Ho tagliato alcune cose perché la tua disponibilità non copre tutto. Aumenta ore o riduci esami.</p>
        `;
        ws.appendChild(cut);
      }
    }
  
    // --- EXAMS ---
    const ec = safeHTML("exam-cards", "");
    if(!ec){
      safeText("status-line", "Dashboard HTML incompleta: manca #exam-cards. Aggiorna app.html.");
      return;
    }
  
    const allocMap = new Map((plan.allocations || []).map(a => [a.examId, a.targetMin]));
    const sortedExams = [...(exams || [])].sort((a,b)=> String(a.date).localeCompare(String(b.date)));
  
    if(sortedExams.length === 0){
      ec.innerHTML = `<div class="callout"><h3>Nessun esame</h3><p>Torna su Profilo e aggiungi almeno un esame.</p></div>`;
      safeText("status-line", "Nessun esame trovato.");
      return;
    }
  
    for(const e of sortedExams){
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
              Piano settimanale: <b>${Math.round(allocThisWeek/60*10)/10}h</b> ·
              Necessario stimato: <b>${Math.round(required/60)}h</b> ·
              Capacità fino all’esame: <b>${Math.round(cap/60)}h</b>
            </div>
          </div>
        </div>
        <span class="badge ${badge.cls}">${badge.text}</span>
      `;
      ec.appendChild(card);
    }
  
    const next = sortedExams[0];
    const alloc = Number(allocMap.get(next.id) || 0);
    const pct = estimateReadinessPercent(next, profile, alloc);
    const badge = readinessBadge(pct);
  
    safeText(
      "status-line",
      `Prossimo: ${next.name}. Readiness stimata ${pct}% (${badge.text}). Se vuoi salire: aumenta ore o riduci esami attivi.`
    );
  }
  
  

// ----------------- Single bootstrap -----------------
window.addEventListener("DOMContentLoaded", () => {
  if (qs("login-form")) {
    console.log("boot -> index");
    mountIndex();
    return;
  }
  if (qs("save-profile") || qs("finish-onboarding")) {
    console.log("boot -> onboarding");
    mountOnboarding();
    return;
  }
  if (qs("regen-week") || qs("exam-cards")) {
    console.log("boot -> app");
    mountApp();
    return;
  }
  console.log("boot -> unknown page");
});
