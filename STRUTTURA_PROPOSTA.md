# 📋 Struttura Proposta: Profilo e Strategie

## 🎯 Panoramica

La nuova struttura separa le funzionalità in **due pagine distinte** accessibili da un hub "Impostazioni":

1. **Profilo** (`profile.html`) - Informazioni personali, storico esami, statistiche
2. **Strategie** (`strategies.html`) - Configurazione algoritmo e esami da preparare
3. **Impostazioni** (`settings.html`) - Hub di navigazione tra le due sezioni

---

## 📄 1. PAGINA PROFILO (`profile.html`)

### Sezione A: Informazioni Personali
- **Visualizzazione** (non modificabile direttamente):
  - Nome
  - Facoltà
  - Età
  - Tipo preparazione (Esami/Esoneri/Entrambi)
- **Nota**: Per modificare, contattare supporto o ricreare account

### Sezione B: Esami Sostenuti
- **Form aggiunta esame sostenuto**:
  - Nome esame
  - Voto (18-30)
  - CFU
  - Data superamento
  - Note (opzionale)
- **Lista esami sostenuti**:
  - Card per ogni esame con:
    - Nome
    - Voto (evidenziato)
    - CFU
    - Data
    - Pulsanti modifica/rimuovi

### Sezione C: Statistiche e Consigli
- **Statistiche riassuntive**:
  - Media voti (calcolata)
  - CFU totali
  - Voto più alto (con nome esame)
- **Grafico distribuzione voti**:
  - Canvas/grafico a barre
  - Mostra frequenza voti (18-30)
- **Consigli personalizzati**:
  - Generati dinamicamente in base a:
    - Media voti
    - Distribuzione voti
    - Numero esami sostenuti
    - Trend (miglioramento/peggioramento)

---

## ⚙️ 2. PAGINA STRATEGIE (`strategies.html`)

### Sezione A: Impostazioni Algoritmo

#### Obiettivo di Studio
- **Select**: Sufficiente / Buono / Ottimo
- **Spiegazione dettagliata**:
  - Sufficiente: Piano leggero, meno ore, focus copertura
  - Buono: Bilanciato (raccomandato)
  - Ottimo: Intensivo, più ore, più ripetizioni

#### Carico di Studio Settimanale
- **Ore per settimana**: Input numerico (1-80)
- **Durata task**: Select (25/35/45/60 min)
- **Suggerimento**: Essere realistici

#### Disponibilità Giornaliera
- **Input per ogni giorno** (Lun-Dom):
  - Minuti massimi per giorno
  - Coerenza con ore settimanali
- **Hint**: Valori realistici

### Sezione B: Esami da Preparare
- **Form nuovo esame**:
  - Nome
  - Data esame
  - CFU
  - Livello preparazione (0-5)
  - Difficoltà (1-3)
- **Spiegazione livello preparazione**:
  - 0: Mai visto
  - 1-2: Poco visto
  - 3: Base da approfondire
  - 4: Abbastanza preparato
  - 5: Quasi pronto
- **Lista esami**:
  - Card con info esame
  - Pulsanti modifica/rimuovi
  - Link a dashboard

---

## 🏠 3. HUB IMPOSTAZIONI (`settings.html`)

### Layout
- **Due card affiancate**:
  - Card "Profilo" → link a `profile.html`
  - Card "Strategie" → link a `strategies.html`
- **Ogni card mostra**:
  - Icona
  - Titolo
  - Descrizione
  - Lista funzionalità (bullet points)
  - Pulsante "Apri →"

---

## 🔄 4. MODIFICHE MENU

### In tutte le pagine (app.html, simulations.html, consigli.html, contact.html):
- **Rimuovere**: "Modifica profilo" → `onboarding.html`
- **Aggiungere**: "Impostazioni" → `settings.html`

### Struttura menu aggiornata:
```
- Dashboard
- Simulazioni
- Consigli
- Contattaci
---
- Impostazioni (NUOVO)
- Logout
```

---

## 📊 5. FUNZIONALITÀ DA IMPLEMENTARE

### In `app.js`:

#### Per Profile Page:
- `mountProfile()`:
  - Carica informazioni personali
  - Carica esami sostenuti (nuova collection `passedExams`)
  - Calcola statistiche
  - Genera grafico voti
  - Genera consigli personalizzati
- `addPassedExam(uid, examData)`:
  - Salva esame sostenuto in Firestore
- `listPassedExams(uid)`:
  - Recupera esami sostenuti
- `calculateStats(passedExams)`:
  - Media voti
  - CFU totali
  - Voto max
- `generatePersonalizedTips(stats, passedExams)`:
  - Consigli basati su dati

#### Per Strategies Page:
- `mountStrategies()`:
  - Carica impostazioni algoritmo
  - Carica esami da preparare
  - Renderizza form e liste
- `saveStrategies(uid, strategies)`:
  - Salva goalMode, weeklyHours, taskMinutes, dayMinutes
- Gestione esami (già esistente, da riutilizzare)

---

## 🎨 6. STILI CSS AGGIUNTIVI

### Già aggiunti in `styles.css`:
- `.settingsCard` - Card hub impostazioni
- `.passedExamCard` - Card esame sostenuto
- `.statsSummary` - Grid statistiche
- `.statCard` - Card singola statistica
- `.gradesChart` - Container grafico
- `.personalizedTips` - Lista consigli
- `.tipCard` - Card singolo consiglio
- `.infoBox` - Box informativo con spiegazioni

---

## 🔍 7. DETTAGLI IMPLEMENTAZIONE

### Firestore Structure:

#### Collection: `users/{uid}/passedExams`
```javascript
{
  name: "Analisi 1",
  grade: 25,
  cfu: 6,
  date: "2024-01-15",
  notes: "Esame difficile, ho studiato 2 mesi",
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Consigli Personalizzati - Logica:

1. **Se media < 22**:
   - "La tua media è sotto la sufficienza. Considera di dedicare più tempo allo studio e di seguire un piano più strutturato."

2. **Se media 22-26**:
   - "Ottima media! Continua così. Potresti provare a puntare a voti più alti concentrandoti sugli esami più importanti."

3. **Se media > 26**:
   - "Eccellente! La tua media è molto alta. Continua a mantenere questo livello di preparazione."

4. **Se trend negativo** (ultimi 3 esami peggiori):
   - "Hai avuto un calo recente. Potrebbe essere utile rivedere il tuo metodo di studio."

5. **Se pochi esami** (< 3):
   - "Aggiungi più esami per avere statistiche più accurate e consigli più personalizzati."

### Grafico Voti:

- **Tipo**: Bar chart o line chart
- **Asse X**: Voti (18-30)
- **Asse Y**: Frequenza
- **Libreria**: Canvas nativo o Chart.js (se necessario)

---

## ✅ 8. PROSSIMI PASSI

1. ✅ Creare bozza HTML delle tre pagine
2. ⏳ Implementare logica JavaScript in `app.js`
3. ⏳ Creare funzioni Firestore per esami sostenuti
4. ⏳ Implementare calcolo statistiche
5. ⏳ Implementare generazione consigli
6. ⏳ Implementare grafico voti
7. ⏳ Aggiornare menu in tutte le pagine
8. ⏳ Testare flusso completo

---

## 💡 NOTE E SUGGERIMENTI

- **Separazione responsabilità**: Profilo = storico, Strategie = futuro
- **UX**: Hub impostazioni rende chiaro dove trovare cosa
- **Scalabilità**: Facile aggiungere nuove sezioni in futuro
- **Coerenza**: Stile visivo uniforme con resto del sito

---

## 🔄 FLUSSO UTENTE

1. **Primo login** → Popup informazioni personali
2. **Dopo popup** → `onboarding.html` (da rimuovere o trasformare)
3. **Menu "Impostazioni"** → `settings.html` (hub)
4. **Scelta**:
   - Profilo → `profile.html` (storico, statistiche)
   - Strategie → `strategies.html` (configurazione, esami futuri)

---

**Fine bozza struttura**

