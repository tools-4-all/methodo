// app.js (single-file, GitHub Pages-friendly)
// Works with: index.html, onboarding.html, app.html, task.html
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
    { weekStart: weekStartISO, plan, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

async function loadWeeklyPlan(uid, weekStartISO) {
  const ref = doc(db, "users", uid, "plans", weekStartISO);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data()?.plan : null;
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
  const needsOnboarding = !profile?.goalMode || !profile?.dayMinutes;
  window.location.assign(needsOnboarding ? "./onboarding.html" : "./app.html");
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

    renderDayInputs(profile?.dayMinutes ?? null);

    if (profile?.goalMode) qs("goal-mode").value = profile.goalMode;
    if (profile?.weeklyHours) qs("weekly-hours").value = profile.weeklyHours;
    if (profile?.taskMinutes) qs("task-minutes").value = String(profile.taskMinutes);

    await refreshExamList(user.uid);

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
        window.location.assign("./onboarding.html");
        return;
      }

      const exams = await listExams(user.uid);
      if (exams.length === 0) {
        window.location.assign("./onboarding.html");
        return;
      }

      const weekStart = startOfWeekISO(new Date());
      const weekStartISO = `${weekStart.getFullYear()}-${z2(weekStart.getMonth() + 1)}-${z2(
        weekStart.getDate()
      )}`;

      let plan = await loadWeeklyPlan(user.uid, weekStartISO);
      if (!plan) {
        plan = generateWeeklyPlan(profile, exams, weekStart);
        await saveWeeklyPlan(user.uid, weekStartISO, plan);
      }

      renderDashboard(plan, exams, profile);

      document.getElementById("regen-week")?.addEventListener("click", async () => {
        const plan2 = generateWeeklyPlan(profile, exams, weekStart);
        await saveWeeklyPlan(user.uid, weekStartISO, plan2);
        renderDashboard(plan2, exams, profile);
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

function renderDashboard(plan, exams, profile) {
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

  const todayWrap = safeHTML("today-tasks", "");
  if (!todayWrap) {
    safeText("status-line", "Dashboard HTML incompleta: manca #today-tasks.");
    return;
  }

  if (!todayDay || !todayDay.tasks || todayDay.tasks.length === 0) {
    todayWrap.innerHTML = `<div class="callout"><h3>Vuoto</h3><p>Nessun task oggi. Controlla disponibilità o rigenera.</p></div>`;
  } else {
    for (let i = 0; i < todayDay.tasks.length; i++) {
      const t = todayDay.tasks[i];
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

      const row = document.createElement("button");
      row.type = "button";
      row.className = "task taskClickable";
      row.dataset.taskid = taskId;

      row.innerHTML = `
        <div class="taskRow">
          <input type="checkbox" class="taskChk" ${isDone ? "checked" : ""} />
          <div style="min-width:0;text-align:left">
            <div class="taskTitle">${escapeHtml(t.examName)} · ${escapeHtml(t.label)}</div>
            <div class="taskSub">
              <span class="tag">${escapeHtml(t.type)}</span>
              <span style="margin-left:8px">${t.minutes} min</span>
            </div>
          </div>
        </div>
      `;

      const chk = row.querySelector(".taskChk");
      chk?.addEventListener("click", (e) => {
        e.stopPropagation();
        const checked = chk.checked;
        try {
          if (checked) localStorage.setItem(doneKey, "1");
          else localStorage.removeItem(doneKey);
        } catch {}
      });

      row.addEventListener("click", () => {
        openTaskPage({
          taskId,
          dateISO: todayDay.dateISO,
          weekStartISO: plan.weekStart,
          task: t,
        });
      });

      todayWrap.appendChild(row);
    }
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

  const bootWithPayload = async (payload) => {
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
      if (piePct) piePct.textContent = `${pct}%`;
      if (pieLbl) pieLbl.textContent = st.running ? "in corso" : "pausa";
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
      saveState(st);

      try {
        localStorage.setItem(`sp_task_done_${tid}`, "1");
      } catch {}

      renderTimer();
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

  // 1) storage
  let payload = getStoredTaskPayload(tid);
  if (payload?.task) {
    bootWithPayload(payload);
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
        bootWithPayload(rebuilt);
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
  console.log("boot -> unknown page");
});
