// planner-improved.js
//
// Versione migliorata dell'algoritmo di pianificazione per Methodo.
// Questo file si basa sul planner originale ma introduce durate
// dinamiche dei task in base alla difficoltà e al livello di
// preparazione di ciascun esame. Il risultato è che esami più
// difficili o con livello più basso ricevono sessioni di studio
// più lunghe, mentre esami più semplici o già ben preparati
// ricevono sessioni più brevi. Tutte le altre logiche di
// allocazione rimangono invariate rispetto al planner originale.

// Funzioni di utilità copiate dal planner originale

export function startOfWeekISO(date = new Date()) {
  // ISO week: Monday start
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // move to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function toISODate(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / ms);
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Calcola un budget settimanale progressivo basato sull'allenatore di studio.
 * Aumenta gradualmente il carico settimana dopo settimana per raggiungere l'obiettivo.
 * 
 * @param {object} profile - Profilo utente con currentHours, targetHours
 * @param {Date} weekStartDate - Data di inizio settimana
 * @param {Array} exams - Array di esami per calcolare la distanza temporale
 * @returns {number} Budget in minuti per questa settimana
 */
function calculateProgressiveWeeklyBudget(profile, weekStartDate, exams) {
  const currentHours = profile.currentHours || 0;
  const targetHours = profile.targetHours || 0;
  
  if (!currentHours || !targetHours || targetHours <= currentHours) {
    // Fallback: usa weeklyHours o dayMinutes
    const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const dayMinutes = profile.dayMinutes || {};
    const totalMin = dayKeys.reduce((acc, k) => acc + (dayMinutes[k] || 0), 0);
    return totalMin > 0 ? totalMin : clamp((profile.weeklyHours ?? 10) * 60, 60, 6000);
  }
  
  // Trova l'esame più vicino per calcolare quante settimane abbiamo
  const now = new Date();
  const weekStart = new Date(weekStartDate);
  weekStart.setHours(0, 0, 0, 0);
  
  let minWeeksToExam = Infinity;
  for (const exam of exams) {
    if (!exam.date) continue;
    const examDate = new Date(exam.date);
    const weeksToExam = Math.ceil((examDate - weekStart) / (7 * 24 * 60 * 60 * 1000));
    if (weeksToExam > 0 && weeksToExam < minWeeksToExam) {
      minWeeksToExam = weeksToExam;
    }
  }
  
  // Se non ci sono esami o sono troppo lontani, usa un default di 8 settimane
  const totalWeeks = minWeeksToExam === Infinity ? 8 : Math.min(minWeeksToExam, 12);
  
  // Calcola quale settimana siamo (0 = prima settimana, totalWeeks-1 = ultima)
  // Per ora assumiamo che questa sia la settimana 0 (inizio)
  // In futuro potremmo tracciare quante settimane sono passate dall'inizio
  const currentWeek = 0; // TODO: tracciare settimane passate
  
  // Calcola incremento settimanale
  const totalIncrease = targetHours - currentHours;
  const incrementPerWeek = totalIncrease / Math.max(1, totalWeeks - 1);
  
  // Calcola ore per questa settimana (progressivo)
  const hoursThisWeek = Math.min(
    currentHours + (incrementPerWeek * currentWeek),
    targetHours
  );
  
  // Converti in minuti e assicurati che sia ragionevole
  const budgetMin = Math.round(hoursThisWeek * 60);
  return clamp(budgetMin, 60, 6000);
}

function examUrgencyScore(exam, now) {
  const examDate = new Date(exam.date);
  const d = clamp(daysBetween(now, examDate), 0, 3650);
  // più è vicino, più cresce (evita infinito)
  return 1 / (d + 3);
}

function examIgnoranceScore(exam) {
  // level: 0..5 (0 = zero, 5 = pronto)
  const level = clamp(exam.level ?? 0, 0, 5);
  return 6 - level; // 6..1
}

function examDifficultyScore(exam) {
  const diff = clamp(exam.difficulty ?? 2, 1, 3);
  return diff; // 1..3
}

function examWeight(exam, now, goalMode) {
  // goalMode: pass | good | top
  const u = examUrgencyScore(exam, now);
  const ig = examIgnoranceScore(exam);
  const df = examDifficultyScore(exam);
  const cfu = clamp(exam.cfu ?? 6, 1, 30);
  // Taratura aggressività
  const goalFactor = goalMode === "top" ? 1.25 : goalMode === "good" ? 1.0 : 0.85;
  // Formula leggibile: urgenza domina, poi ignoranza, poi difficoltà+CFU
  const w = goalFactor * (u * 12) * (ig / 3) * (1 + (df - 1) * 0.25) * (1 + (cfu - 6) * 0.02);
  return w;
}

function normalizeWeights(items) {
  const sum = items.reduce((acc, x) => acc + x.weight, 0) || 1;
  return items.map((x) => ({ ...x, frac: x.weight / sum }));
}

function buildTaskTemplates(goalMode, examCategory = "mixed") {
  // Task primitives: cambiano in base all'obiettivo e al tipo di esame
  // pass: più esercizi d'esame presto, top: più teoria/approfondimento
  
  // Template base per ogni obiettivo
  const passBase = [
    { type: "exam", label: "Prove d'esame + correzione" },
    { type: "practice", label: "Esercizi mirati (weakness)" },
    { type: "review", label: "Ripasso attivo + error log" },
    { type: "spaced", label: "Spaced repetition / flashcard" },
  ];
  const goodBase = [
    { type: "theory", label: "Teoria (lettura attiva)" },
    { type: "practice", label: "Esercizi base → medi" },
    { type: "exam", label: "Prove d'esame + correzione" },
    { type: "review", label: "Ripasso attivo + error log" },
    { type: "spaced", label: "Spaced repetition / flashcard" },
  ];
  const topBase = [
    { type: "theory", label: "Teoria + dimostrazioni chiave" },
    { type: "practice", label: "Esercizi difficili" },
    { type: "exam", label: "Prove d'esame (timeboxed)" },
    { type: "review", label: "Ripasso attivo + mappe" },
    { type: "spaced", label: "Spaced repetition / flashcard" },
  ];
  
  // Seleziona template base
  let templates = goalMode === "top" ? topBase : goalMode === "good" ? goodBase : passBase;
  
  // Filtra in base alla categoria dell'esame
  if (examCategory === "scientific") {
    // Esami scientifici: NO spaced repetition (non efficace per formule/esercizi)
    templates = templates.filter(t => t.type !== "spaced");
  } else if (examCategory === "humanistic") {
    // Esami umanistici: NO esercizi pratici (focus su teoria, ripasso, memorizzazione)
    templates = templates.filter(t => t.type !== "practice");
    // Aggiungi più focus su spaced repetition per memorizzazione
    if (!templates.some(t => t.type === "spaced")) {
      templates.push({ type: "spaced", label: "Spaced repetition / flashcard" });
    }
  }
  // Per "mixed" o altri, usa tutti i template
  
  return templates;
}

function pickTaskType(idx, templates) {
  return templates[idx % templates.length];
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function cryptoId() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return `${a[0].toString(16)}${a[1].toString(16)}`;
  }
  return Math.random().toString(16).slice(2);
}

/**
 * Calcola una durata personalizzata per i task di un esame.  Il valore è
 * proporzionale alla difficoltà e all'ignoranza (quanto manca da
 * preparare): esami più difficili o con livello più basso riceveranno
 * sessioni più lunghe.  Il risultato è clampato a [15,120] minuti.
 *
 * @param {number} baseMin - Durata base dei task (profile.taskMinutes)
 * @param {object} exam - Oggetto esame con proprietà difficulty e level
 */
function computeExamTaskMinutes(baseMin, exam) {
  const diff = clamp(exam.difficulty ?? 2, 1, 3);
  const level = clamp(exam.level ?? 0, 0, 5);
  // Fattore di difficoltà: 0.9, 1.0, 1.1 per diff 1,2,3
  const diffFactor = 0.9 + (diff - 1) * 0.1;
  // Fattore di ignoranza: se il livello è basso (0) → 1.2; se alto (5) → 1.0
  const ignFactor = 1.0 + ((5 - level) / 5) * 0.2;
  const minutes = Math.round(baseMin * diffFactor * ignFactor);
  return clamp(minutes, 15, 120);
}

/**
 * Genera un piano di studio settimanale con durate dinamiche dei task.
 * La logica di allocazione è identica al planner originale ma per
 * ciascun esame viene calcolata una durata personalizzata per i task.
 *
 * @param {object} profile - Profilo utente con goalMode, taskMinutes,
 *                           weeklyHours e dayMinutes.
 * @param {Array} exams - Array di esami con proprietà id, name, date,
 *                        cfu, level e difficulty.
 * @param {Date} weekStartDate - Data di inizio settimana ISO (lunedì).
 * @param {object} opts - Opzioni addizionali (non usate qui).
 */
export function generateWeeklyPlan(profile, exams, weekStartDate = startOfWeekISO(new Date()), opts = {}) {
  const now = new Date();
  const goalMode = profile.goalMode ?? "good";
  const baseTaskMin = clamp(profile.taskMinutes ?? 35, 15, 120);

  // disponibilità: minuti per giorno ISO Mon..Sun
  const dayMinutes = profile.dayMinutes ?? {
    mon: 120,
    tue: 120,
    wed: 120,
    thu: 120,
    fri: 120,
    sat: 180,
    sun: 0,
  };

  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const dayLabels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

  // Filtra e valida esami PRIMA di usarli
  // Considera solo esami con appelli selezionati
  const validExams = [];
  for (const exam of exams || []) {
    if (!exam?.name) continue;
    
    // Se ha appelli, usa quello marcato come "primary" o il più prossimo
    if (exam.appelli && Array.isArray(exam.appelli) && exam.appelli.length > 0) {
      const selectedAppelli = exam.appelli.filter(a => a.selected !== false);
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
      
      // Crea un solo esame virtuale per l'appello primario
      validExams.push({
        ...exam,
        id: `${exam.id}_${primaryAppello.date}`,
        date: primaryAppello.date,
        appelloType: primaryAppello.type,
        originalExamId: exam.id, // Mantieni riferimento all'esame originale
        allSelectedAppelli: selectedAppelli // Salva tutti gli appelli selezionati per riferimento
      });
    } else if (exam.date) {
      // Compatibilità con esami vecchi (solo date)
      validExams.push({ ...exam });
    }
  }

  // Calcola budget settimanale reale
  let weeklyBudgetMin = dayKeys.reduce((acc, k) => acc + (dayMinutes[k] || 0), 0);
  
  // Se c'è un allenatore attivo, calcola un budget progressivo
  if (profile.currentHours && profile.targetHours && profile.targetHours > profile.currentHours) {
    weeklyBudgetMin = calculateProgressiveWeeklyBudget(profile, weekStartDate, validExams);
  } else {
    // Budget normale: usa dayMinutes o weeklyHours
    weeklyBudgetMin = weeklyBudgetMin > 0 ? weeklyBudgetMin : clamp((profile.weeklyHours ?? 10) * 60, 60, 6000);
  }
  
  const weeklyBudget = weeklyBudgetMin;
  if (validExams.length === 0) {
    return {
      weekStart: toISODate(weekStartDate),
      weeklyBudgetMin: weeklyBudget,
      allocations: [],
      days: dayKeys.map((k, i) => ({
        key: k,
        label: dayLabels[i],
        dateISO: toISODate(addDays(weekStartDate, i)),
        capacityMin: dayMinutes[k] || 0,
        tasks: [],
      })),
    };
  }
  // pesi esami
  const weighted = validExams.map((e) => ({
    examId: e.id,
    name: e.name,
    date: e.date,
    weight: examWeight(e, now, goalMode),
  }));
  const norm = normalizeWeights(weighted);

  // allocazione minuti per esame (minimo garantito per evitare 0)
  const minPerExam = Math.min(60, Math.floor(weeklyBudget * 0.08)); // <= 8% o 60 min
  let remaining = weeklyBudget - minPerExam * norm.length;
  remaining = Math.max(0, remaining);
  const allocations = norm.map((x) => {
    const extra = Math.floor(remaining * x.frac);
    return {
      examId: x.examId,
      name: x.name,
      targetMin: minPerExam + extra,
    };
  });
  // ripartisci eventuali minuti persi per arrotondamenti
  const used = allocations.reduce((a, x) => a + x.targetMin, 0);
  let slack = weeklyBudget - used;
  allocations.sort((a, b) => b.targetMin - a.targetMin);
  let idx = 0;
  while (slack > 0 && allocations.length) {
    allocations[idx % allocations.length].targetMin += 1;
    slack -= 1;
    idx += 1;
  }

  // genera tasks per giorno
  const days = dayKeys.map((k, i) => ({
    key: k,
    label: dayLabels[i],
    dateISO: toISODate(addDays(weekStartDate, i)),
    capacityMin: dayMinutes[k] || 0,
    tasks: [],
  }));

  // Coda di task per esame
  const taskQueues = new Map();
  for (const a of allocations) {
    // trova esame per recuperare difficulty/level e categoria
    const exam = validExams.find((ex) => ex.id === a.examId);
    const examCategory = exam?.category || "mixed";
    
    // Genera template specifico per questo esame
    const templates = buildTaskTemplates(goalMode, examCategory);
    
    const examTaskMin = computeExamTaskMinutes(baseTaskMin, exam);
    const nTasks = Math.max(1, Math.floor(a.targetMin / examTaskMin));
    const queue = [];
    for (let i = 0; i < nTasks; i++) {
      const t = pickTaskType(i, templates);
      queue.push({
        id: cryptoId(),
        examId: a.examId,
        examName: a.name,
        type: t.type,
        label: t.label,
        minutes: examTaskMin,
        done: false,
      });
    }
    // se restano minuti non multipli, aggiungi un task corto
    // Per esami scientifici, evita "spaced" (flashcard)
    const rem = a.targetMin - nTasks * examTaskMin;
    if (rem >= 15) {
      let microType = "micro";
      let microLabel = "Micro-ripasso / flashcard";
      
      if (examCategory === "scientific") {
        // Per scientifici: micro-ripasso teorico invece di flashcard
        microType = "micro";
        microLabel = "Micro-ripasso teorico";
      } else if (examCategory === "humanistic") {
        // Per umanistici: flashcard/spaced repetition va bene
        microType = "spaced";
        microLabel = "Flashcard / ripasso veloce";
      }
      
      queue.push({
        id: cryptoId(),
        examId: a.examId,
        examName: a.name,
        type: microType,
        label: microLabel,
        minutes: rem,
        done: false,
      });
    }
    taskQueues.set(a.examId, queue);
  }
  // Distribuzione: round-robin per evitare un giorno monolitico
  const examOrder = allocations.map((a) => a.examId);
  for (const day of days) {
    let cap = day.capacityMin;
    if (cap <= 0) continue;
    let guard = 0;
    while (cap >= 15 && guard < 5000) {
      guard++;
      let placed = false;
      for (const exId of examOrder) {
        const q = taskQueues.get(exId) || [];
        if (q.length === 0) continue;
        const next = q[0];
        if (next.minutes <= cap) {
          day.tasks.push(q.shift());
          cap -= next.minutes;
          placed = true;
          if (cap < 15) break;
        }
      }
      if (!placed) break; // niente task che ci sta → stop
    }
  }
  // “cosa tagliare” (se non siamo riusciti a piazzare tutto)
  const unplaced = [];
  for (const [exId, q] of taskQueues.entries()) {
    for (const t of q) unplaced.push(t);
  }

  // Assegna un periodo suggerito (mattina o pomeriggio) alle attività di ciascun giorno.
  // Se il numero o la durata totale dei task supera metà della capacità giornaliera,
  // i primi task riempiono la mattina e i rimanenti il pomeriggio.  La ripartizione
  // è basata sulla capacità dichiarata (day.capacityMin) e non dipende dall'ora attuale.
  for (const day of days) {
    const halfCap = (day.capacityMin || 0) / 2;
    let used = 0;
    for (const t of day.tasks) {
      // assegna 'morning' finché non si supera metà capacità
      if (used + (t.minutes || 0) <= halfCap) {
        t.period = "morning";
        used += t.minutes || 0;
      } else {
        t.period = "afternoon";
      }
    }
  }
  return {
    weekStart: toISODate(weekStartDate),
    weeklyBudgetMin: weeklyBudget,
    taskMinutes: baseTaskMin,
    allocations,
    days,
    cut: unplaced.map((t) => ({ examName: t.examName, label: t.label, minutes: t.minutes })),
  };
}