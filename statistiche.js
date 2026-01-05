// statistiche.js - Pagina statistiche con heatmap stile GitHub

import {
  auth,
  db,
  watchAuth,
  logout,
} from "./auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { startOfWeekISO } from "./planner.js";

// ----------------- Utils -----------------
function qs(id) {
  return document.getElementById(id);
}

function setText(el, t) {
  if (el) el.textContent = t ?? "";
}

function z2(n) {
  return String(n).padStart(2, "0");
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

function getCurrentDate() {
  const virtual = getVirtualDate();
  return virtual || new Date();
}

function toISODate(date) {
  return `${date.getFullYear()}-${z2(date.getMonth() + 1)}-${z2(date.getDate())}`;
}

function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function makeTaskId({ weekStartISO, dateISO, t, index }) {
  // DEVE corrispondere esattamente alla funzione in app.js
  const raw = [
    weekStartISO || "",
    dateISO || "",
    t?.examId || t?.examName || "exam",
    t?.type || "type",
    t?.label || "label",
    String(t?.minutes || 0),
    String(index || 0),
  ].join("|");
  // Genera hash come in app.js
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "t_" + (h >>> 0).toString(16);
}

// ----------------- Menu Setup -----------------
function setupMenu() {
  const btn = qs("menu-btn");
  const panel = qs("menu-panel");
  if (!btn || !panel) return;

  function toggle() {
    const isOpen = !panel.classList.contains("hidden");
    panel.classList.toggle("hidden", isOpen);
    btn.setAttribute("aria-expanded", !isOpen);
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  panel.addEventListener("click", (e) => {
    if (e.target.closest("a") || e.target.closest("button")) {
      panel.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  const logoutBtn = qs("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await logout();
      window.location.href = "./index.html";
    });
  }
}

// ----------------- Load All Plans -----------------
async function loadAllPlans(uid) {
  try {
    const plansRef = collection(db, "users", uid, "plans");
    const snapshot = await getDocs(plansRef);
    const plans = [];
    
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.plan) {
        plans.push(data.plan);
      }
    });
    
    return plans;
  } catch (error) {
    console.error("Errore caricamento piani:", error);
    return [];
  }
}

// ----------------- Calculate Daily Hours -----------------
async function calculateDailyHours(plans, uid) {
  const dailyData = new Map(); // dateISO -> { hours, tasks }
  
  // Carica i task completati da Firestore
  const doneTasksMap = new Map();
  if (uid) {
    try {
      const col = collection(db, "users", uid, "completedTasks");
      const snapshot = await getDocs(col);
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const taskId = data.taskId || docSnap.id;
        doneTasksMap.set(taskId, true);
      });
      console.log("[Statistiche] Task completati caricati da Firestore:", doneTasksMap.size);
    } catch (e) {
      console.warn("[Statistiche] Errore caricamento task completati da Firestore:", e);
    }
  }
  
  // Fallback: carica anche da localStorage (per compatibilità)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sp_task_done_") && localStorage.getItem(key) === "1") {
        const taskId = key.replace("sp_task_done_", "");
        if (!doneTasksMap.has(taskId)) {
          doneTasksMap.set(taskId, true);
        }
      }
    }
  } catch (e) {
    console.warn("[Statistiche] Errore scansionando localStorage:", e);
  }
  
  console.log("[Statistiche] Task completati totali (Firestore + localStorage):", doneTasksMap.size);
  console.log("[Statistiche] Piani da analizzare:", plans.length);
  
  // Debug: mostra tutti i taskId completati per confronto
  const allDoneTaskIds = Array.from(doneTasksMap.keys());
  console.log("[Statistiche] Tutti i taskId completati:", allDoneTaskIds.slice(0, 10).map(id => id.substring(0, 50)));
  
  // Crea una copia dei taskId completati per tracciare quelli non trovati
  const unmatchedTaskIds = new Set(allDoneTaskIds);
  
  let totalTasksChecked = 0;
  let totalTasksFound = 0;
  
  for (const plan of plans) {
    if (!plan.days) continue;
    
    for (const day of plan.days) {
      if (!day.dateISO || !day.tasks) continue;
      
      let completedMinutes = 0;
      let completedTasks = 0;
      
      for (let i = 0; i < day.tasks.length; i++) {
        const task = day.tasks[i];
        totalTasksChecked++;
        
        const taskId = makeTaskId({
          weekStartISO: plan.weekStart,
          dateISO: day.dateISO,
          t: task,
          index: i,
        });
        
        try {
          const doneKey = `sp_task_done_${taskId}`;
          const isDone = doneTasksMap.has(taskId) || localStorage.getItem(doneKey) === "1";
          
          // Debug per i primi task per vedere il formato
          if (totalTasksChecked <= 3) {
            console.log("[Statistiche] Task controllato:", {
              dateISO: day.dateISO,
              weekStartISO: plan.weekStart,
              taskId: taskId,
              foundInMap: doneTasksMap.has(taskId),
              foundInStorage: localStorage.getItem(doneKey) === "1",
              examId: task.examId,
              label: task.label,
              minutes: task.minutes
            });
          }
          
          if (isDone) {
            totalTasksFound++;
            completedTasks++;
            const taskMinutes = Number(task.minutes || 0);
            completedMinutes += taskMinutes;
            
            // Rimuovi dalla lista dei non trovati se presente
            unmatchedTaskIds.delete(taskId);
            
            // Debug per i primi task
            if (totalTasksFound <= 5) {
              console.log("[Statistiche] ✓ Task completato trovato:", {
                dateISO: day.dateISO,
                taskId: taskId,
                minutes: taskMinutes,
                examId: task.examId,
                label: task.label
              });
            }
          }
        } catch (e) {
          console.warn("[Statistiche] Errore controllo task:", e);
        }
      }
      
      if (completedMinutes > 0) {
        const hours = completedMinutes / 60;
        const existing = dailyData.get(day.dateISO);
        if (existing) {
          existing.hours += hours;
          existing.tasks += completedTasks;
        } else {
          dailyData.set(day.dateISO, {
            hours,
            tasks: completedTasks,
            date: parseISODate(day.dateISO),
          });
        }
      }
    }
  }
  
  console.log("[Statistiche] Task controllati:", totalTasksChecked);
  console.log("[Statistiche] Task completati trovati:", totalTasksFound);
  console.log("[Statistiche] Giorni con ore calcolate:", dailyData.size);
  const totalHours = Array.from(dailyData.values()).reduce((sum, d) => sum + d.hours, 0);
  console.log("[Statistiche] Totale ore:", totalHours.toFixed(2));
  
  // Debug: mostra taskId completati ma non trovati nei piani
  if (unmatchedTaskIds.size > 0) {
    const unmatchedArray = Array.from(unmatchedTaskIds).slice(0, 5);
    console.warn("[Statistiche] ⚠️ TaskId completati ma non trovati nei piani:", unmatchedArray);
    console.warn("[Statistiche] ⚠️ Questo potrebbe indicare che i task completati sono di settimane non più presenti nei piani salvati.");
  }
  
  // Debug: mostra alcuni esempi di date con ore
  if (dailyData.size > 0) {
    const sampleDates = Array.from(dailyData.entries()).slice(0, 5);
    console.log("[Statistiche] Esempi date con ore:", sampleDates.map(([date, data]) => ({
      date,
      hours: data.hours.toFixed(2),
      tasks: data.tasks
    })));
  }
  
  return dailyData;
}

// ----------------- Calculate Statistics -----------------
function calculateStats(dailyData) {
  const entries = Array.from(dailyData.values());
  
  if (entries.length === 0) {
    return {
      totalHours: 0,
      avgDaily: 0,
      totalDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      bestDay: { date: null, hours: 0 },
    };
  }
  
  // Ordina per data
  entries.sort((a, b) => a.date - b.date);
  
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  const avgDaily = totalHours / entries.length;
  const totalDays = entries.length;
  
  // Trova il miglior giorno
  const bestDay = entries.reduce((best, e) => 
    e.hours > best.hours ? { date: e.date, hours: e.hours } : best,
    { date: null, hours: 0 }
  );
  
  // Calcola streak
  const today = getCurrentDate();
  today.setHours(0, 0, 0, 0);
  
  // Current streak (giorni consecutivi fino a oggi)
  let currentStreak = 0;
  let checkDate = new Date(today);
  const dateSet = new Set(entries.map(e => {
    const d = new Date(e.date);
    d.setHours(0, 0, 0, 0);
    return toISODate(d);
  }));
  
  while (dateSet.has(toISODate(checkDate))) {
    currentStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
    checkDate.setHours(0, 0, 0, 0);
  }
  
  // Longest streak
  let longestStreak = 0;
  let tempStreak = 0;
  let lastDate = null;
  
  for (const entry of entries) {
    const entryDate = entry.date;
    entryDate.setHours(0, 0, 0, 0);
    
    if (lastDate) {
      const daysDiff = Math.round((entryDate - lastDate) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    } else {
      tempStreak = 1;
    }
    lastDate = entryDate;
  }
  longestStreak = Math.max(longestStreak, tempStreak);
  
  return {
    totalHours,
    avgDaily,
    totalDays,
    currentStreak,
    longestStreak,
    bestDay,
  };
}

// ----------------- Render Heatmap -----------------
function renderHeatmap(dailyData) {
  const container = qs("heatmap");
  if (!container) return;
  
  container.innerHTML = "";
  
  // Crea mappa per accesso rapido
  const hoursMap = new Map();
  dailyData.forEach((data, dateISO) => {
    hoursMap.set(dateISO, data.hours);
  });
  
  // Calcola range di date (ultimi 365 giorni)
  const today = getCurrentDate();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 365);
  startDate.setHours(0, 0, 0, 0);
  
  console.log("[Statistiche Heatmap] Data virtuale oggi:", today.toISOString().split('T')[0]);
  console.log("[Statistiche Heatmap] Range:", startDate.toISOString().split('T')[0], "->", today.toISOString().split('T')[0]);
  
  // Raggruppa per settimana (lunedì-domenica)
  const weeks = [];
  let currentWeek = null;
  let weekStart = new Date(startDate);
  
  // Vai al lunedì della settimana di startDate
  const dayOfWeek = weekStart.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekStart.setDate(weekStart.getDate() - daysToMonday);
  weekStart.setHours(0, 0, 0, 0);
  
  // Crea una copia della data per il loop per evitare problemi di mutazione
  const todayTime = today.getTime();
  let dayCount = 0;
  for (let d = new Date(weekStart); d.getTime() <= todayTime; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    dayCount++;
    const dateISO = toISODate(d);
    const hours = hoursMap.get(dateISO) || 0;
    const dayOfWeek = d.getDay(); // 0 = domenica, 1 = lunedì
    
    // Inizia nuova settimana se è lunedì
    if (dayOfWeek === 1 || currentWeek === null) {
      if (currentWeek && currentWeek.days.length > 0) {
        weeks.push(currentWeek);
      }
      currentWeek = { 
        startDate: new Date(d),
        days: [] 
      };
    }
    
    if (currentWeek) {
      currentWeek.days.push({
        date: new Date(d),
        dateISO,
        hours,
        dayOfWeek,
      });
    }
  }
  
  // Aggiungi l'ultima settimana se ha giorni
  if (currentWeek && currentWeek.days.length > 0) {
    weeks.push(currentWeek);
  }
  
  console.log("[Statistiche Heatmap] Giorni processati:", dayCount);
  console.log("[Statistiche Heatmap] Settimane create:", weeks.length);
  
  console.log("[Statistiche Heatmap] Giorni processati:", dayCount);
  console.log("[Statistiche Heatmap] Settimane create:", weeks.length);
  
  // Raggruppa settimane per mese
  const months = [];
  let currentMonth = null;
  
  for (const week of weeks) {
    // Trova il primo giorno della settimana che ha un mese
    const firstDay = week.days.find(d => d.date <= today);
    if (!firstDay) continue;
    
    const monthKey = `${firstDay.date.getFullYear()}-${z2(firstDay.date.getMonth() + 1)}`;
    
    if (!currentMonth || currentMonth.key !== monthKey) {
      if (currentMonth) {
        months.push(currentMonth);
      }
      currentMonth = {
        key: monthKey,
        label: firstDay.date.toLocaleDateString("it-IT", { month: "short", year: "numeric" }),
        weeks: [],
      };
    }
    
    currentMonth.weeks.push(week);
  }
  
  if (currentMonth) {
    months.push(currentMonth);
  }
  
  // Renderizza
  months.forEach((month) => {
    const monthDiv = document.createElement("div");
    monthDiv.className = "heatmapMonth";
    
    const label = document.createElement("div");
    label.className = "heatmapMonthLabel";
    label.textContent = month.label;
    monthDiv.appendChild(label);
    
    const weeksContainer = document.createElement("div");
    weeksContainer.style.display = "flex";
    weeksContainer.style.gap = "3px";
    
    month.weeks.forEach((week) => {
      const weekDiv = document.createElement("div");
      weekDiv.className = "heatmapWeek";
      
      // Assicura che ci siano sempre 7 giorni (lun-dom)
      for (let i = 0; i < 7; i++) {
        const day = week.days[i];
        const dayDiv = document.createElement("div");
        dayDiv.className = "heatmapDay";
        
        if (day && day.date <= today) {
          // Determina livello di intensità (0-5)
          let level = 0;
          if (day.hours > 0) {
            if (day.hours < 0.5) level = 1;
            else if (day.hours < 1) level = 2;
            else if (day.hours < 2) level = 3;
            else if (day.hours < 4) level = 4;
            else level = 5;
          }
          
          dayDiv.setAttribute("data-level", level);
          
          // Tooltip
          const tooltip = document.createElement("div");
          tooltip.className = "heatmapTooltip";
          const dateStr = day.date.toLocaleDateString("it-IT", { 
            weekday: "long", 
            year: "numeric", 
            month: "long", 
            day: "numeric" 
          });
          tooltip.textContent = `${dateStr}: ${day.hours.toFixed(1)}h`;
          dayDiv.appendChild(tooltip);
        } else {
          // Giorno futuro o mancante
          dayDiv.setAttribute("data-level", "0");
          dayDiv.style.opacity = "0.3";
        }
        
        weekDiv.appendChild(dayDiv);
      }
      
      weeksContainer.appendChild(weekDiv);
    });
    
    monthDiv.appendChild(weeksContainer);
    container.appendChild(monthDiv);
  });
}

// ----------------- Generate Insights -----------------
function generateInsights(stats, dailyData) {
  const insights = [];
  const entries = Array.from(dailyData.values());
  
  if (entries.length === 0) {
    insights.push({
      title: "Inizia a studiare!",
      content: "Completa i tuoi primi task per vedere le statistiche qui.",
    });
    return insights;
  }
  
  // Insight sulla media
  if (stats.avgDaily > 0) {
    if (stats.avgDaily < 1) {
      insights.push({
        title: "💡 Puoi fare di più",
        content: `La tua media giornaliera è ${stats.avgDaily.toFixed(1)}h. Prova ad aumentare gradualmente il tempo di studio.`,
      });
    } else if (stats.avgDaily >= 4) {
      insights.push({
        title: "🔥 Grande impegno!",
        content: `Stai studiando in media ${stats.avgDaily.toFixed(1)}h al giorno. Ottimo lavoro!`,
      });
    }
  }
  
  // Insight sulla serie
  if (stats.currentStreak > 0) {
    if (stats.currentStreak >= 7) {
      insights.push({
        title: "🔥 Serie impressionante!",
        content: `Hai studiato per ${stats.currentStreak} giorni consecutivi. Continua così!`,
      });
    } else if (stats.currentStreak >= 3) {
      insights.push({
        title: "✨ Buona serie",
        content: `Stai mantenendo una serie di ${stats.currentStreak} giorni. Cerca di mantenerla!`,
      });
    }
  } else {
    insights.push({
      title: "📅 Costanza è la chiave",
      content: "Prova a studiare ogni giorno, anche solo per poco tempo. La costanza paga!",
    });
  }
  
  // Insight sul miglior giorno
  if (stats.bestDay.hours > 0) {
    const bestDateStr = stats.bestDay.date.toLocaleDateString("it-IT", {
      day: "numeric",
      month: "long",
    });
    insights.push({
      title: "⭐ Giorno record",
      content: `Il tuo miglior giorno è stato il ${bestDateStr} con ${stats.bestDay.hours.toFixed(1)}h di studio.`,
    });
  }
  
  // Insight sulla serie più lunga
  if (stats.longestStreak > stats.currentStreak && stats.longestStreak >= 7) {
    insights.push({
      title: "🏆 Record personale",
      content: `La tua serie più lunga è stata di ${stats.longestStreak} giorni consecutivi. Riesci a batterla?`,
    });
  }
  
  // Insight sul totale
  if (stats.totalHours >= 100) {
    insights.push({
      title: "🎉 Traguardo raggiunto!",
      content: `Hai superato le ${Math.floor(stats.totalHours)} ore totali di studio. Complimenti!`,
    });
  }
  
  return insights;
}

// ----------------- Render Insights -----------------
function renderInsights(insights) {
  const container = qs("insights");
  if (!container) return;
  
  container.innerHTML = "";
  
  if (insights.length === 0) {
    container.innerHTML = '<div class="insightCard"><div class="insightContent">Nessun insight disponibile al momento.</div></div>';
    return;
  }
  
  insights.forEach((insight) => {
    const card = document.createElement("div");
    card.className = "insightCard";
    
    const title = document.createElement("div");
    title.className = "insightTitle";
    title.textContent = insight.title;
    
    const content = document.createElement("div");
    content.className = "insightContent";
    content.textContent = insight.content;
    
    card.appendChild(title);
    card.appendChild(content);
    container.appendChild(card);
  });
}

// ----------------- Load and Render Statistics -----------------
async function loadAndRenderStatistics(user) {
  if (!user) return;
  
  setText(qs("user-line"), user.email || "—");
  
  const loadingEl = qs("loading");
  const contentEl = qs("stats-content");
  
  // Mostra loading se il contenuto è già visibile
  if (contentEl && contentEl.style.display !== "none") {
    if (loadingEl) {
      loadingEl.style.display = "block";
      loadingEl.textContent = "Aggiornamento statistiche...";
    }
    if (contentEl) contentEl.style.display = "none";
  }
  
  try {
    // Carica tutti i piani
    const plans = await loadAllPlans(user.uid);
    
    // Calcola ore giornaliere (carica anche i task completati da Firestore)
    const dailyData = await calculateDailyHours(plans, user.uid);
    
    // Calcola statistiche
    const stats = calculateStats(dailyData);
    
    // Renderizza statistiche
    setText(qs("total-hours"), `${stats.totalHours.toFixed(1)}h`);
    setText(qs("avg-daily"), `${stats.avgDaily.toFixed(1)}h`);
    setText(qs("total-days"), `${stats.totalDays}`);
    setText(qs("current-streak"), `${stats.currentStreak}`);
    setText(qs("longest-streak"), `${stats.longestStreak}`);
    if (stats.bestDay.date) {
      const bestDateStr = stats.bestDay.date.toLocaleDateString("it-IT", {
        day: "numeric",
        month: "short",
      });
      setText(qs("best-day"), `${stats.bestDay.hours.toFixed(1)}h (${bestDateStr})`);
    } else {
      setText(qs("best-day"), "—");
    }
    
    // Renderizza heatmap
    renderHeatmap(dailyData);
    
    // Genera e renderizza insight
    const insights = generateInsights(stats, dailyData);
    renderInsights(insights);
    
    // Mostra contenuto
    if (loadingEl) loadingEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";
  } catch (error) {
    console.error("Errore caricamento statistiche:", error);
    if (loadingEl) {
      loadingEl.textContent = "Errore nel caricamento delle statistiche. Riprova più tardi.";
      loadingEl.style.color = "rgba(239, 68, 68, 1)";
    }
  }
}

// ----------------- Main -----------------
function mountStatistics() {
  setupMenu();
  
  let currentUser = null;
  
  watchAuth(async (user) => {
    if (!user) {
      window.location.href = "./index.html";
      return;
    }
    
    currentUser = user;
    await loadAndRenderStatistics(user);
  });
  
  // Intercetta i cambiamenti di localStorage nella stessa scheda
  // (l'evento 'storage' funziona solo tra schede diverse)
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  
  Storage.prototype.setItem = function(key, value) {
    originalSetItem.apply(this, arguments);
    if (key && key.startsWith("sp_task_done_") && currentUser) {
      // Debounce per evitare troppi aggiornamenti
      clearTimeout(window._statsUpdateTimeout);
      window._statsUpdateTimeout = setTimeout(async () => {
        console.log("[Statistiche] Task completato, aggiorno statistiche...");
        await loadAndRenderStatistics(currentUser);
      }, 500);
    }
  };
  
  Storage.prototype.removeItem = function(key) {
    originalRemoveItem.apply(this, arguments);
    if (key && key.startsWith("sp_task_done_") && currentUser) {
      // Debounce per evitare troppi aggiornamenti
      clearTimeout(window._statsUpdateTimeout);
      window._statsUpdateTimeout = setTimeout(async () => {
        console.log("[Statistiche] Task modificato, aggiorno statistiche...");
        await loadAndRenderStatistics(currentUser);
      }, 500);
    }
  };
  
  // Listener per aggiornamento quando localStorage cambia in altre schede
  window.addEventListener("storage", async (e) => {
    // Aggiorna solo se la chiave è relativa ai task completati
    if (e.key && e.key.startsWith("sp_task_done_") && currentUser) {
      console.log("[Statistiche] Rilevato cambio in localStorage (altra scheda), aggiorno statistiche...");
      await loadAndRenderStatistics(currentUser);
    }
  });
  
  // Listener per eventi personalizzati (quando un task viene completato nella stessa scheda)
  window.addEventListener("planUpdated", async (e) => {
    if (currentUser) {
      console.log("[Statistiche] Rilevato evento planUpdated, aggiorno statistiche...", e.detail);
      // Piccolo delay per assicurarsi che localStorage sia aggiornato
      setTimeout(async () => {
        await loadAndRenderStatistics(currentUser);
      }, 300);
    }
  });
  
  // Aggiorna quando la pagina torna in focus (utente potrebbe aver completato task in altra scheda)
  let lastFocusTime = Date.now();
  window.addEventListener("focus", async () => {
    // Aggiorna solo se sono passati almeno 5 secondi dall'ultimo focus
    const now = Date.now();
    if (now - lastFocusTime > 5000 && currentUser) {
      console.log("[Statistiche] Pagina in focus, aggiorno statistiche...");
      await loadAndRenderStatistics(currentUser);
      lastFocusTime = now;
    }
  });
  
  // Aggiorna anche quando la pagina diventa visibile (utente torna alla scheda)
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && currentUser) {
      console.log("[Statistiche] Pagina visibile, aggiorno statistiche...");
      await loadAndRenderStatistics(currentUser);
    }
  });
  
  // Aggiorna quando cambia la data virtuale (solo in localhost)
  window.addEventListener("virtualDateChanged", async () => {
    if (currentUser) {
      console.log("[Statistiche] Data virtuale cambiata, aggiorno statistiche...");
      await loadAndRenderStatistics(currentUser);
    }
  });
}

// Avvia quando il DOM è pronto
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountStatistics);
} else {
  mountStatistics();
}

