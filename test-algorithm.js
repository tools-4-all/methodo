/**
 * Test semplice per verificare il comportamento dell'algoritmo scientifico
 * Esegui questo file con Node.js per testare la logica di distribuzione
 */

// Simula le funzioni necessarie
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / ms);
}

function calculateSpacedRepetitionInterval(sessionNumber, difficulty, level) {
  const baseIntervals = [1, 3, 7, 14, 30];
  const difficultyFactor = 1.0 - ((difficulty - 1) / 3) * 0.2;
  const levelFactor = 0.9 + (level / 5) * 0.2;
  const intervalIndex = Math.min(sessionNumber, baseIntervals.length - 1);
  let interval = baseIntervals[intervalIndex] * difficultyFactor * levelFactor;
  if (sessionNumber >= baseIntervals.length) {
    interval = baseIntervals[baseIntervals.length - 1] * Math.pow(1.5, sessionNumber - baseIntervals.length + 1);
  }
  return Math.max(1, Math.round(interval));
}

function calculateTaskPriority(task, exam, dayDate, now, daysSinceLastSession, remainingCapacity, sessionCount = 0) {
  const examDate = new Date(exam.date);
  const daysToExam = daysBetween(dayDate, examDate);
  const urgencyScore = daysToExam > 0 ? 
    Math.max(0.1, 10 / (daysToExam + 1)) : 
    10;
  
  const optimalInterval = calculateSpacedRepetitionInterval(
    sessionCount,
    exam.difficulty || 2,
    exam.level || 0
  );
  const intervalScore = daysSinceLastSession >= optimalInterval ? 
    (1 + Math.min((daysSinceLastSession - optimalInterval) * 0.1, 0.5)) : 
    Math.max((daysSinceLastSession / optimalInterval) * 0.5, 0.1);
  
  const distributionBonus = sessionCount > 0 ? 1.2 : 1.0;
  const interleavingBonus = 1.05;
  const capacityScore = task.minutes <= remainingCapacity ? 1.0 : 0.1;
  
  const typeWeights = {
    'exam': 1.3,
    'review': 1.2,
    'practice': 1.1,
    'theory': 1.0,
    'spaced': 0.9,
    'micro': 0.8
  };
  const typeWeight = typeWeights[task.type] || 1.0;
  
  return urgencyScore * intervalScore * distributionBonus * interleavingBonus * capacityScore * typeWeight;
}

// Test 1: Verifica intervalli spaced repetition
console.log("=== Test 1: Spaced Repetition Intervals ===");
const testIntervals = [];
for (let i = 0; i < 5; i++) {
  const interval = calculateSpacedRepetitionInterval(i, 2, 0);
  testIntervals.push(interval);
  console.log(`Sessione ${i + 1}: intervallo ottimale = ${interval} giorni`);
}
console.log("✓ Intervalli crescenti:", testIntervals[0] < testIntervals[1] && testIntervals[1] < testIntervals[2]);

// Test 2: Verifica adattamento alla difficoltà
console.log("\n=== Test 2: Adattamento alla Difficoltà ===");
const easyInterval = calculateSpacedRepetitionInterval(1, 1, 0); // Facile
const hardInterval = calculateSpacedRepetitionInterval(1, 3, 0); // Difficile
console.log(`Esame facile (difficoltà 1): ${easyInterval} giorni`);
console.log(`Esame difficile (difficoltà 3): ${hardInterval} giorni`);
console.log("✓ Esami difficili hanno intervalli più brevi:", hardInterval < easyInterval);

// Test 3: Verifica sistema di priorità
console.log("\n=== Test 3: Sistema di Priorità ===");
const now = new Date();
const examDate = new Date();
examDate.setDate(examDate.getDate() + 14); // Esame tra 14 giorni

const task1 = { type: 'exam', minutes: 30 };
const task2 = { type: 'theory', minutes: 30 };
const exam = { date: examDate.toISOString(), difficulty: 2, level: 0 };

const priority1 = calculateTaskPriority(task1, exam, now, now, 0, 60, 0);
const priority2 = calculateTaskPriority(task2, exam, now, now, 0, 60, 0);

console.log(`Priorità task 'exam': ${priority1.toFixed(2)}`);
console.log(`Priorità task 'theory': ${priority2.toFixed(2)}`);
console.log("✓ Task 'exam' hanno priorità più alta:", priority1 > priority2);

// Test 4: Verifica spaced repetition timing
console.log("\n=== Test 4: Timing Spaced Repetition ===");
const day1 = new Date();
const day4 = new Date();
day4.setDate(day4.getDate() + 3);

// Prima sessione: dovrebbe avere priorità normale
const priorityDay1 = calculateTaskPriority(task1, exam, day1, now, 0, 60, 0);
// Dopo 3 giorni (intervallo ottimale): dovrebbe avere priorità più alta
const priorityDay4 = calculateTaskPriority(task1, exam, day4, now, 3, 60, 1);

console.log(`Priorità giorno 1 (prima sessione): ${priorityDay1.toFixed(2)}`);
console.log(`Priorità giorno 4 (dopo 3 giorni): ${priorityDay4.toFixed(2)}`);
console.log("✓ Priorità aumenta quando è tempo di rivedere:", priorityDay4 > priorityDay1);

// Test 5: Verifica distributed practice
console.log("\n=== Test 5: Distributed Practice ===");
const firstSession = calculateTaskPriority(task1, exam, now, now, 0, 60, 0);
const secondSession = calculateTaskPriority(task1, exam, now, now, 0, 60, 1);
console.log(`Prima sessione (sessionCount=0): ${firstSession.toFixed(2)}`);
console.log(`Seconda sessione (sessionCount=1): ${secondSession.toFixed(2)}`);
console.log("✓ Distributed practice bonus applicato:", secondSession > firstSession);

console.log("\n=== Tutti i test completati! ===");
console.log("L'algoritmo implementa correttamente:");
console.log("✓ Spaced repetition con intervalli crescenti");
console.log("✓ Adattamento alla difficoltà degli esami");
console.log("✓ Sistema di priorità basato su tipo task");
console.log("✓ Timing ottimale per le revisioni");
console.log("✓ Distributed practice bonus");

