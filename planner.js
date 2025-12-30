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
  // Usa la data di inizio dell'allenatore se disponibile nel profilo
  let currentWeek = 0;
  
  // Se il profilo ha una data di inizio allenatore, calcola la settimana corrente
  if (profile.coachStartDate) {
    const coachStart = new Date(profile.coachStartDate);
    coachStart.setHours(0, 0, 0, 0);
    const weeksSinceStart = Math.floor((weekStart - coachStart) / (7 * 24 * 60 * 60 * 1000));
    currentWeek = Math.max(0, weeksSinceStart);
  } else {
    // Fallback: calcola dalla data di inizio del profilo o usa settimana 0
    // Se non c'è tracciamento, assumiamo che sia la settimana 0
    currentWeek = 0;
  }
  
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

function buildTaskTemplates(goalMode, examCategory = "mixed", examLevel = 0) {
  // Task primitives: cambiano in base all'obiettivo e al tipo di esame
  // pass: più esercizi d'esame presto, top: più teoria/approfondimento
  // IMPORTANTE: Filtra task "exam" in base al livello di preparazione
  // Livello 0-1: NO esercizi d'esame (preparazione graduale)
  // Livello 2-3: Esercizi d'esame con percentuale ridotta
  // Livello 4-5: Esercizi d'esame normalmente inclusi
  
  const level = clamp(examLevel ?? 0, 0, 5);
  
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
  
  // Filtra task "exam" in base al livello di preparazione
  if (level <= 1) {
    // Livello 0-1: Escludi completamente esercizi d'esame
    templates = templates.filter(t => t.type !== "exam");
  }
  // Livello 2-3: Mantieni "exam" ma verrà ridotta la percentuale nella generazione
  // Livello 4-5: Nessuna restrizione
  
  // Filtra in base alla categoria dell'esame
  if (examCategory === "scientific") {
    // Esami scientifici: mantieni spaced repetition per scheduling, ma usa label diversa
    // La spaced repetition come tecnica di scheduling è efficace anche per materie scientifiche
    templates = templates.map(t => 
      t.type === "spaced" 
        ? { ...t, label: "Ripasso spaziato / revisione formule" }
        : t
    );
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
 * Calcola l'intervallo ottimale per spaced repetition basato sulla curva dell'oblio.
 * Basato sulla ricerca di Ebbinghaus e algoritmi moderni come SM-2.
 * 
 * @param {number} sessionNumber - Numero della sessione (0 = prima, 1 = seconda, etc.)
 * @param {number} difficulty - Difficoltà dell'esame (1-3)
 * @param {number} level - Livello di preparazione (0-5)
 * @returns {number} Intervallo in giorni prima della prossima sessione
 */
function calculateSpacedRepetitionInterval(sessionNumber, difficulty, level) {
  // Base intervals per spaced repetition (in giorni)
  // Prima sessione: 1 giorno, seconda: 3 giorni, terza: 7 giorni, etc.
  const baseIntervals = [1, 3, 7, 14, 30];
  
  // Aggiusta in base alla difficoltà: esami più difficili richiedono intervalli più brevi
  const difficultyFactor = 1.0 - ((difficulty - 1) / 3) * 0.2; // 0.8-1.0
  
  // Aggiusta in base al livello: se sei più preparato, puoi aspettare di più
  const levelFactor = 0.9 + (level / 5) * 0.2; // 0.9-1.1
  
  const intervalIndex = Math.min(sessionNumber, baseIntervals.length - 1);
  let interval = baseIntervals[intervalIndex] * difficultyFactor * levelFactor;
  
  // Se è oltre gli intervalli base, usa una progressione esponenziale
  if (sessionNumber >= baseIntervals.length) {
    interval = baseIntervals[baseIntervals.length - 1] * Math.pow(1.5, sessionNumber - baseIntervals.length + 1);
  }
  
  return Math.max(1, Math.round(interval));
}

/**
 * Calcola il punteggio di priorità per un task in un giorno specifico.
 * Considera: urgenza esame, distanza dall'ultima sessione, capacità giornaliera.
 * 
 * @param {object} task - Task da valutare
 * @param {object} exam - Esame associato
 * @param {Date} dayDate - Data del giorno
 * @param {Date} now - Data corrente
 * @param {number} daysSinceLastSession - Giorni dall'ultima sessione di questo esame
 * @param {number} remainingCapacity - Capacità rimanente del giorno
 * @param {number} sessionCount - Numero di sessioni già completate per questo esame
 * @returns {number} Punteggio di priorità (più alto = più prioritario)
 */
function calculateTaskPriority(task, exam, dayDate, now, daysSinceLastSession, remainingCapacity, sessionCount = 0) {
  // 1. Urgenza esame (più vicino = più urgente)
  // Usa examWeight per considerare anche difficoltà, livello, CFU e goalMode
  const examDate = new Date(exam.date);
  const daysToExam = daysBetween(dayDate, examDate);
  // Normalizza l'urgenza: esami molto vicini hanno urgenza alta
  const urgencyScore = daysToExam > 0 ? 
    Math.max(0.1, 10 / (daysToExam + 1)) : 
    10; // Molto urgente se passato
  
  // 2. Spaced repetition: punteggio basato su quanto è tempo di rivedere
  const optimalInterval = calculateSpacedRepetitionInterval(
    sessionCount,
    exam.difficulty || 2,
    exam.level || 0
  );
  const intervalScore = daysSinceLastSession >= optimalInterval ? 
    (1 + Math.min((daysSinceLastSession - optimalInterval) * 0.1, 0.5)) : // Bonus se è tempo di rivedere (max +50%)
    Math.max((daysSinceLastSession / optimalInterval) * 0.5, 0.1); // Penalità se troppo presto (min 10%)
  
  // 3. Distributed practice: bonus per distribuire su più giorni
  const distributionBonus = sessionCount > 0 ? 1.2 : 1.0;
  
  // 4. Interleaving: leggero bonus per alternare esami diversi
  const interleavingBonus = 1.05;
  
  // 5. Capacità: penalità se il task non ci sta
  const capacityScore = task.minutes <= remainingCapacity ? 1.0 : 0.1;
  
  // 6. Tipo task: alcuni task sono più importanti
  const typeWeights = {
    'exam': 1.3,      // Prove d'esame sono prioritarie
    'review': 1.2,    // Ripasso è importante
    'practice': 1.1,  // Esercizi sono utili
    'theory': 1.0,   // Teoria è base
    'spaced': 0.9,   // Spaced repetition è importante ma meno urgente
    'micro': 0.8     // Micro-ripasso è meno prioritario
  };
  const typeWeight = typeWeights[task.type] || 1.0;
  
  return urgencyScore * intervalScore * distributionBonus * interleavingBonus * capacityScore * typeWeight;
}

/**
 * Distribuisce i task tra i giorni usando un algoritmo basato sulla letteratura scientifica.
 * Implementa: spaced repetition, distributed practice, interleaving intelligente.
 * 
 * Valido per tutti i tipi di esami (umanistici, scientifici, tecnici):
 * - Spaced repetition: intervalli ottimali per formule, teoremi, concetti
 * - Distributed practice: distribuzione su più giorni (efficace per matematica, fisica, etc.)
 * - Interleaving: mescolamento intelligente (particolarmente efficace per materie scientifiche)
 * 
 * @param {Array} days - Array di giorni con capacità
 * @param {Map} taskQueues - Map di code di task per esame
 * @param {Array} allocations - Allocazioni di minuti per esame
 * @param {Array} validExams - Array di esami validi (qualsiasi categoria)
 * @param {Date} now - Data corrente
 * @param {Date} weekStartDate - Data di inizio settimana
 */
function distributeTasksScientifically(days, taskQueues, allocations, validExams, now, weekStartDate) {
  // Traccia le sessioni per ogni esame (per spaced repetition)
  const examSessions = new Map(); // examId -> { lastDayIndex, sessionCount }
  
  // Inizializza le sessioni
  for (const exam of validExams) {
    examSessions.set(exam.id, { lastDayIndex: -1, sessionCount: 0 });
  }
  
  // Crea una lista di tutti i task con metadati
  const allTasks = [];
  for (const [examId, queue] of taskQueues.entries()) {
    const exam = validExams.find(e => e.id === examId);
    if (!exam) continue;
    
    for (const task of queue) {
      allTasks.push({
        task,
        examId,
        exam,
        priority: 0 // Sarà calcolato dinamicamente
      });
    }
  }
  
  // Distribuisci i task giorno per giorno
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const day = days[dayIndex];
    const dayDate = new Date(day.dateISO);
    let remainingCapacity = day.capacityMin;
    
    if (remainingCapacity <= 0) continue;
    
    // Lista di task già piazzati oggi (per interleaving)
    const tasksPlacedToday = [];
    
    // Continua a piazzare task finché c'è capacità
    let iterations = 0;
    const maxIterations = 1000;
    
    while (remainingCapacity >= 15 && iterations < maxIterations) {
      iterations++;
      
      // Calcola priorità per tutti i task rimanenti (non ancora piazzati)
      const availableTasks = allTasks.filter(t => 
        !t.placed && 
        t.task.minutes <= remainingCapacity
      );
      
      if (availableTasks.length === 0) break;
      
      // Calcola priorità per ogni task disponibile
      for (const taskData of availableTasks) {
        const sessionInfo = examSessions.get(taskData.examId);
        const daysSinceLastSession = sessionInfo.lastDayIndex >= 0 ? 
          (dayIndex - sessionInfo.lastDayIndex) : 999;
        
        taskData.priority = calculateTaskPriority(
          taskData.task,
          taskData.exam,
          dayDate,
          now,
          daysSinceLastSession,
          remainingCapacity,
          sessionInfo.sessionCount
        );
        
        // Bonus per interleaving: se oggi abbiamo già piazzato task di altri esami, 
        // dai un leggero bonus per variare
        const differentExamsToday = tasksPlacedToday.filter(t => 
          t.examId !== taskData.examId
        ).length;
        if (differentExamsToday > 0) {
          taskData.priority *= 1.1; // Bonus per varietà
        }
      }
      
      // Ordina per priorità (più alta = prima)
      availableTasks.sort((a, b) => b.priority - a.priority);
      
      // Prendi il task con priorità più alta
      const bestTask = availableTasks[0];
      if (!bestTask) break;
      
      // Piazza il task
      day.tasks.push(bestTask.task);
      remainingCapacity -= bestTask.task.minutes;
      bestTask.placed = true;
      tasksPlacedToday.push(bestTask);
      
      // Rimuovi il task dalla coda
      const queue = taskQueues.get(bestTask.examId);
      if (queue) {
        const index = queue.indexOf(bestTask.task);
        if (index >= 0) queue.splice(index, 1);
      }
      
      // Aggiorna le sessioni per spaced repetition
      const sessionInfo = examSessions.get(bestTask.examId);
      if (sessionInfo.lastDayIndex !== dayIndex) {
        sessionInfo.lastDayIndex = dayIndex;
        sessionInfo.sessionCount++;
      }
    }
  }
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
    const examLevel = clamp(exam?.level ?? 0, 0, 5);
    
    // Controlla se l'esame ha una distribuzione personalizzata
    const customDistribution = exam?.taskDistribution;
    
    const examTaskMin = computeExamTaskMinutes(baseTaskMin, exam);
    const nTasks = Math.max(1, Math.floor(a.targetMin / examTaskMin));
    const queue = [];
    
    // Funzione helper per generare label con messaggio esplicativo per task "exam"
    const getExamTaskLabel = (baseLabel, level) => {
      if (level <= 1) {
        // Non dovrebbe mai arrivare qui perché filtriamo, ma per sicurezza
        return baseLabel;
      } else if (level >= 2 && level <= 3) {
        // Livello 2-3: aggiungi messaggio esplicativo
        return `${baseLabel} (familiarizzazione graduale - livello ${level}/5)`;
      } else {
        // Livello 4-5: nessun messaggio aggiuntivo
        return baseLabel;
      }
    };
    
    if (customDistribution) {
      // Usa distribuzione personalizzata
      let examPercent = customDistribution.exam || 0;
      
      // Riduci percentuale "exam" in base al livello
      if (examLevel <= 1) {
        // Livello 0-1: escludi completamente
        examPercent = 0;
      } else if (examLevel >= 2 && examLevel <= 3) {
        // Livello 2-3: riduci a max 15% del totale
        examPercent = Math.min(examPercent, 15);
      }
      // Livello 4-5: usa percentuale originale
      
      const totalPercent = (customDistribution.theory || 0) + 
                          (customDistribution.practice || 0) + 
                          examPercent + 
                          (customDistribution.review || 0) + 
                          (customDistribution.spaced || 0);
      
      if (totalPercent > 0) {
        // Calcola quanti task per ogni tipo in base alle percentuali
        const taskCounts = {
          theory: Math.round((nTasks * (customDistribution.theory || 0)) / totalPercent),
          practice: Math.round((nTasks * (customDistribution.practice || 0)) / totalPercent),
          exam: Math.round((nTasks * examPercent) / totalPercent),
          review: Math.round((nTasks * (customDistribution.review || 0)) / totalPercent),
          spaced: Math.round((nTasks * (customDistribution.spaced || 0)) / totalPercent)
        };
        
        // Genera task per ogni tipo
        const taskLabels = {
          theory: "Teoria (lettura attiva)",
          practice: "Esercizi mirati",
          exam: getExamTaskLabel("Prove d'esame + correzione", examLevel),
          review: "Ripasso attivo",
          spaced: "Spaced repetition / flashcard"
        };
        
        // Filtra in base alla categoria e al livello
        let allowedTypes = ["theory", "practice", "exam", "review", "spaced"];
        // Spaced repetition è efficace anche per esami scientifici (come tecnica di scheduling)
        // Rimuoviamo solo per umanistici se non ha practice
        if (examCategory === "humanistic") {
          allowedTypes = allowedTypes.filter(t => t !== "practice");
        }
        // Filtra "exam" se livello è 0-1
        if (examLevel <= 1) {
          allowedTypes = allowedTypes.filter(t => t !== "exam");
        }
        // Per scientifici, manteniamo tutti i tipi incluso spaced repetition
        
        // Genera task per ogni tipo consentito
        for (const type of allowedTypes) {
          const count = taskCounts[type] || 0;
          for (let i = 0; i < count; i++) {
            queue.push({
              id: cryptoId(),
              examId: a.examId,
              examName: a.name,
              type: type,
              label: taskLabels[type] || type,
              minutes: examTaskMin,
              done: false,
            });
          }
        }
        
        // Se mancano task (per arrotondamenti), aggiungi i più importanti
        while (queue.length < nTasks) {
          const priorityTypes = allowedTypes.filter(t => (taskCounts[t] || 0) > 0);
          if (priorityTypes.length > 0) {
            const type = priorityTypes[0];
            queue.push({
              id: cryptoId(),
              examId: a.examId,
              examName: a.name,
              type: type,
              label: taskLabels[type] || type,
              minutes: examTaskMin,
              done: false,
            });
          } else {
            break;
          }
        }
      }
    }
    
    // Se non c'è distribuzione personalizzata o non è valida, usa il comportamento di default
    if (queue.length === 0) {
      const templates = buildTaskTemplates(goalMode, examCategory, examLevel);
      for (let i = 0; i < nTasks; i++) {
        const t = pickTaskType(i, templates);
        // Se il template include "exam" e il livello è 2-3, aggiungi messaggio esplicativo
        let label = t.label;
        if (t.type === "exam" && examLevel >= 2 && examLevel <= 3) {
          label = getExamTaskLabel(t.label, examLevel);
        }
        queue.push({
          id: cryptoId(),
          examId: a.examId,
          examName: a.name,
          type: t.type,
          label: label,
          minutes: examTaskMin,
          done: false,
        });
      }
    }
    // se restano minuti non multipli, aggiungi un task corto
    const rem = a.targetMin - nTasks * examTaskMin;
    if (rem >= 15) {
      let microType = "micro";
      let microLabel = "Micro-ripasso / revisione";
      
      if (examCategory === "scientific") {
        // Per scientifici: micro-ripasso con focus su formule e concetti chiave
        microType = "micro";
        microLabel = "Micro-ripasso formule / concetti chiave";
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
  // Distribuzione scientifica: algoritmo basato su spaced repetition, distributed practice e interleaving
  distributeTasksScientifically(days, taskQueues, allocations, validExams, now, weekStartDate);
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