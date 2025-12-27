// planner.js
// Pianificatore "Runna-style" per studio: task finibili + adattamento.
// Pure functions: niente Firebase qui.

export function startOfWeekISO(date = new Date()) {
    // ISO week: Monday start
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay(); // 0 Sun ... 6 Sat
    const diff = (day === 0 ? -6 : 1 - day); // move to Monday
    d.setUTCDate(d.getUTCDate() + diff);
    d.setUTCHours(0,0,0,0);
    return d;
  }
  
  export function toISODate(d) {
    const z = (n)=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
  }
  
  export function daysBetween(a, b) {
    const ms = 24*60*60*1000;
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((db - da)/ms);
  }
  
  function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }
  
  function examUrgencyScore(exam, now) {
    const examDate = new Date(exam.date);
    const d = clamp(daysBetween(now, examDate), 0, 3650);
    // più è vicino, più cresce (evita infinito)
    return 1 / (d + 3);
  }
  
  function examIgnoranceScore(exam) {
    // level: 0..5 (0 = zero, 5 = pronto)
    const level = clamp(exam.level ?? 0, 0, 5);
    return (6 - level); // 6..1
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
    const w = goalFactor * (u * 12) * (ig/3) * (1 + (df-1)*0.25) * (1 + (cfu-6)*0.02);
    return w;
  }
  
  function normalizeWeights(items) {
    const sum = items.reduce((acc, x)=>acc + x.weight, 0) || 1;
    return items.map(x => ({...x, frac: x.weight / sum}));
  }
  
  function buildTaskTemplates(goalMode) {
    // Task primitives: cambiano in base all'obiettivo
    // pass: più esercizi d'esame presto, top: più teoria/approfondimento
    const pass = [
      {type:"exam", label:"Prove d'esame + correzione"},
      {type:"practice", label:"Esercizi mirati (weakness)"},
      {type:"review", label:"Ripasso attivo + error log"}
    ];
    const good = [
      {type:"theory", label:"Teoria (lettura attiva)"},
      {type:"practice", label:"Esercizi base → medi"},
      {type:"exam", label:"Prove d'esame + correzione"},
      {type:"review", label:"Ripasso attivo + error log"}
    ];
    const top = [
      {type:"theory", label:"Teoria + dimostrazioni chiave"},
      {type:"practice", label:"Esercizi difficili"},
      {type:"exam", label:"Prove d'esame (timeboxed)"},
      {type:"review", label:"Ripasso attivo + mappe"}
    ];
    return goalMode === "top" ? top : goalMode === "good" ? good : pass;
  }
  
  function pickTaskType(idx, templates) {
    return templates[idx % templates.length];
  }
  
  export function generateWeeklyPlan(profile, exams, weekStartDate = startOfWeekISO(new Date()), opts = {}) {
    const now = new Date();
    const goalMode = profile.goalMode ?? "good";
    const taskMinutes = clamp(profile.taskMinutes ?? 35, 15, 120);
  
    // disponibilità: minuti per giorno ISO Mon..Sun
    const dayMinutes = profile.dayMinutes ?? {mon:120,tue:120,wed:120,thu:120,fri:120,sat:180,sun:0};
  
    const dayKeys = ["mon","tue","wed","thu","fri","sat","sun"];
    const dayLabels = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
  
    // Calcola budget settimanale reale
    const weeklyBudgetMin = dayKeys.reduce((acc,k)=>acc + (dayMinutes[k]||0), 0);
    const weeklyBudget = weeklyBudgetMin > 0 ? weeklyBudgetMin : clamp((profile.weeklyHours ?? 10)*60, 60, 6000);
  
    const validExams = (exams || [])
      .filter(e => e?.name && e?.date)
      .map(e => ({...e}));
  
    if(validExams.length === 0){
      return {
        weekStart: toISODate(weekStartDate),
        weeklyBudgetMin: weeklyBudget,
        allocations: [],
        days: dayKeys.map((k,i)=>({
          key:k, label:dayLabels[i], dateISO: toISODate(addDays(weekStartDate,i)),
          capacityMin: dayMinutes[k]||0,
          tasks:[]
        }))
      };
    }
  
    // pesi esami
    const weighted = validExams.map(e => ({
      examId: e.id,
      name: e.name,
      date: e.date,
      weight: examWeight(e, now, goalMode),
    }));
  
    const norm = normalizeWeights(weighted);
  
    // allocazione minuti per esame (minimo garantito per evitare 0)
    const minPerExam = Math.min(60, Math.floor(weeklyBudget*0.08)); // <= 8% o 60 min
    let remaining = weeklyBudget - minPerExam * norm.length;
    remaining = Math.max(0, remaining);
  
    const allocations = norm.map(x => {
      const extra = Math.floor(remaining * x.frac);
      return {
        examId: x.examId,
        name: x.name,
        targetMin: minPerExam + extra
      };
    });
  
    // ripartisci eventuali minuti persi per arrotondamenti
    const used = allocations.reduce((a,x)=>a+x.targetMin,0);
    let slack = weeklyBudget - used;
    allocations.sort((a,b)=> b.targetMin - a.targetMin);
    let idx = 0;
    while(slack > 0 && allocations.length){
      allocations[idx % allocations.length].targetMin += 1;
      slack -= 1;
      idx += 1;
    }
  
    // genera tasks per giorno
    const templates = buildTaskTemplates(goalMode);
  
    const days = dayKeys.map((k,i)=>({
      key:k,
      label: dayLabels[i],
      dateISO: toISODate(addDays(weekStartDate,i)),
      capacityMin: dayMinutes[k]||0,
      tasks:[]
    }));
  
    // Coda di task per esame
    const taskQueues = new Map();
    for(const a of allocations){
      const nTasks = Math.max(1, Math.floor(a.targetMin / taskMinutes));
      const queue = [];
      for(let i=0;i<nTasks;i++){
        const t = pickTaskType(i, templates);
        queue.push({
          id: cryptoId(),
          examId: a.examId,
          examName: a.name,
          type: t.type,
          label: t.label,
          minutes: taskMinutes,
          done: false
        });
      }
      // se restano minuti non multipli, aggiungi un task corto
      const rem = a.targetMin - nTasks*taskMinutes;
      if(rem >= 15){
        queue.push({
          id: cryptoId(),
          examId: a.examId,
          examName: a.name,
          type: "micro",
          label: "Micro-ripasso / flashcard",
          minutes: rem,
          done:false
        });
      }
      taskQueues.set(a.examId, queue);
    }
  
    // Distribuzione: round-robin per evitare un giorno monolitico
    // 1) costruisci lista esami ordinata per priorità (già in allocations desc)
    const examOrder = allocations.map(a=>a.examId);
  
    for(const day of days){
      let cap = day.capacityMin;
      if(cap <= 0) continue;
  
      let guard = 0;
      while(cap >= 15 && guard < 5000){
        guard++;
        let placed = false;
  
        for(const exId of examOrder){
          const q = taskQueues.get(exId) || [];
          if(q.length === 0) continue;
  
          const next = q[0];
          if(next.minutes <= cap){
            day.tasks.push(q.shift());
            cap -= next.minutes;
            placed = true;
            if(cap < 15) break;
          }
        }
  
        if(!placed) break; // niente task che ci sta → stop
      }
    }
  
    // “cosa tagliare” (se non siamo riusciti a piazzare tutto)
    const unplaced = [];
    for(const [exId, q] of taskQueues.entries()){
      for(const t of q) unplaced.push(t);
    }
  
    return {
      weekStart: toISODate(weekStartDate),
      weeklyBudgetMin: weeklyBudget,
      taskMinutes,
      allocations,
      days,
      cut: unplaced.map(t => ({examName:t.examName, label:t.label, minutes:t.minutes}))
    };
  }
  
  function addDays(d, n){
    const x = new Date(d);
    x.setDate(x.getDate()+n);
    return x;
  }
  
  function cryptoId(){
    if(typeof crypto !== "undefined" && crypto.getRandomValues){
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return `${a[0].toString(16)}${a[1].toString(16)}`;
    }
    return Math.random().toString(16).slice(2);
  }
  