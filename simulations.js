// simulations.js
// Baseline + What-if simulations + Canvas line chart overlay (no external libs)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { daysBetween } from "./planner.js";

// ---------------- Firebase ----------------
const firebaseConfig = {
  apiKey: "AIzaSyCh32lo8dxpQ3u0xf6FnadGtKYo5-kNDRk",
  authDomain: "study-planner-80c7a.firebaseapp.com",
  projectId: "study-planner-80c7a",
  storageBucket: "study-planner-80c7a.firebasestorage.app",
  messagingSenderId: "551672760618",
  appId: "1:551672760618:web:b496e32ff8aea43d737653",
  measurementId: "G-VSNL2PK1KN"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- DOM helpers ----------------
const qs = (id) => document.getElementById(id);
const setText = (id, t) => { const el = qs(id); if (el) el.textContent = t ?? ""; };

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ---------------- Menu ----------------
function setupMenu(){
  const btn = qs("menu-btn");
  const panel = qs("menu-panel");
  if(!btn || !panel) return;

  const open = () => { panel.classList.remove("hidden"); btn.setAttribute("aria-expanded","true"); };
  const close = () => { panel.classList.add("hidden"); btn.setAttribute("aria-expanded","false"); };
  const toggle = () => panel.classList.contains("hidden") ? open() : close();

  btn.addEventListener("click", (e)=>{ e.preventDefault(); toggle(); });

  document.addEventListener("click", (e)=>{
    if(panel.classList.contains("hidden")) return;
    if(btn.contains(e.target) || panel.contains(e.target)) return;
    close();
  });

  document.addEventListener("keydown",(e)=>{
    if(e.key === "Escape") close();
  });

  qs("logout-btn")?.addEventListener("click", async ()=>{
    await signOut(auth);
    location.href = "./index.html";
  });
}

// ---------------- Firestore reads ----------------
async function getProfile(uid){
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// ----------------- Premium helpers -----------------
/**
 * Controlla se l'utente ha un abbonamento premium attivo
 */
async function isPremium(uid) {
  const profile = await getProfile(uid);
  if (!profile) return false;
  
  // Controlla abbonamento premium
  if (profile.subscription?.status === 'active') {
    const endDate = profile.subscription?.endDate?.toDate ? 
                    profile.subscription.endDate.toDate() : 
                    new Date(profile.subscription?.endDate);
    return endDate > new Date();
  }
  
  return false;
}

/**
 * Mostra modale per upgrade a premium
 */
function showUpgradeModal() {
  if (document.getElementById("upgrade-modal")) return;
  
  const overlay = document.createElement("div");
  overlay.id = "upgrade-modal";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.4)",
    zIndex: "10001",
    padding: "20px",
    animation: "fadeIn 0.2s ease-out",
    backdropFilter: "blur(4px)",
  });
  
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "600px";
  card.style.width = "95%";
  card.style.padding = "32px";
  card.style.position = "relative";
  card.style.animation = "slideUp 0.3s ease-out";
  card.style.background = "rgba(10, 12, 20, 0.95)";
  card.style.backdropFilter = "blur(10px)";
  card.style.border = "1px solid rgba(255, 255, 255, 0.15)";
  
  card.innerHTML = `
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="font-size: 28px; font-weight: 900; margin: 0 0 8px 0; color: rgba(255,255,255,0.95);">
        Funzionalità Premium
      </h2>
      <p style="color: rgba(255,255,255,0.7); font-size: 15px; margin: 0;">
        Questa funzionalità richiede un abbonamento Premium
      </p>
    </div>
    
    <div style="background: rgba(99,102,241,0.1); border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid rgba(99,102,241,0.3);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <div>
          <div style="font-size: 32px; font-weight: 900; color: rgba(255,255,255,0.95);">€5<span style="font-size: 18px; font-weight: 600; color: rgba(255,255,255,0.6);">/mese</span></div>
        </div>
      </div>
      <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px;">
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 14px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Esami illimitati</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 14px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Simulazione appelli avanzata</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 14px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Simulazioni avanzate</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 14px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Statistiche dettagliate</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 14px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Pianificazione multi-settimana</span>
        </li>
        <li style="display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.9); font-size: 14px;">
          <span style="color: rgba(34,197,94,1);">✓</span>
          <span>Esportazione piano di studio</span>
        </li>
      </ul>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <button id="upgrade-subscribe-btn" class="btn primary" style="width: 100%; padding: 14px; font-size: 16px; font-weight: 700;">
        Passa a Premium
      </button>
      <button id="upgrade-close-btn" class="btn ghost" style="width: 100%;">
        Forse più tardi
      </button>
    </div>
  `;
  
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  
  const closeModal = () => {
    overlay.style.animation = "fadeOut 0.2s ease-out";
    card.style.animation = "slideDown 0.2s ease-out";
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = "";
    }, 200);
  };
  
  qs("upgrade-close-btn")?.addEventListener("click", closeModal);
  qs("upgrade-subscribe-btn")?.addEventListener("click", () => {
    // TODO: Integrare con Stripe
    alert("Integrazione Stripe in arrivo! Per ora questa funzionalità è disponibile solo per utenti Premium.");
    closeModal();
  });
  
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("upgrade-modal")) {
      closeModal();
    }
  });
}

async function listExams(uid){
  const colref = collection(db, "users", uid, "exams");
  const snap = await getDocs(colref);
  const exams = [];
  snap.forEach(d => exams.push({ id:d.id, ...d.data() }));
  exams.sort((a,b)=> String(a.date).localeCompare(String(b.date)));
  return exams;
}


// ---------------- Info popovers (auto from .paramHelp) ----------------
function setupInfoPopovers(){
    // Create a single shared popover (lightweight)
    let tip = document.getElementById("popTip");
    if(!tip){
      tip = document.createElement("div");
      tip.id = "popTip";
      tip.className = "popTip hidden";
      tip.setAttribute("role", "dialog");
      tip.setAttribute("aria-modal", "false");
      tip.innerHTML = `
        <div class="popTipTitle" id="popTipTitle"></div>
        <div class="popTipBody" id="popTipBody"></div>
      `;
      document.body.appendChild(tip);
    }
  
    const titleEl = tip.querySelector("#popTipTitle");
    const bodyEl  = tip.querySelector("#popTipBody");
  
    let anchorBtn = null;
  
    const close = ()=>{
      tip.classList.add("hidden");
      if(anchorBtn) anchorBtn.setAttribute("aria-expanded", "false");
      anchorBtn = null;
    };
  
    const place = (btn)=>{
      const r = btn.getBoundingClientRect();
      const pad = 10;
  
      // measure (need visible)
      tip.classList.remove("hidden");
      const tr = tip.getBoundingClientRect();
  
      // prefer below-right, fallback above if needed
      let x = r.left;
      let y = r.bottom + 8;
  
      if(x + tr.width > window.innerWidth - pad) x = window.innerWidth - pad - tr.width;
      if(x < pad) x = pad;
  
      if(y + tr.height > window.innerHeight - pad){
        y = r.top - tr.height - 8;
      }
      if(y < pad) y = pad;
  
      tip.style.left = `${Math.round(x)}px`;
      tip.style.top  = `${Math.round(y)}px`;
    };
  
    const openFor = (btn, title, text)=>{
      if(anchorBtn === btn && !tip.classList.contains("hidden")){
        close();
        return;
      }
      anchorBtn = btn;
      btn.setAttribute("aria-expanded", "true");
  
      titleEl.textContent = title || "Info";
      bodyEl.textContent  = text || "—";
  
      place(btn);
    };
  
    // Auto-generate info buttons from existing .paramHelp
    const rows = document.querySelectorAll(".paramRow");
    rows.forEach(row=>{
      const label = row.querySelector(".paramLabel");
      const help = row.querySelector(".paramHelp");
      if(!label || !help) return;
  
      const helpText = help.textContent.trim();
      if(!helpText) return;
  
      // Title: first child text inside paramLabel (your markup has <div>Title</div> then <div class=paramHelp>)
      const titleNode = label.querySelector("div:first-child");
      const title = titleNode?.textContent?.trim() || "Info";
  
      // Avoid double insertion
      if(label.querySelector(".infoBtn")) return;
  
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "infoBtn";
      btn.textContent = "i";
      btn.setAttribute("aria-label", `Info: ${title}`);
      btn.setAttribute("aria-expanded", "false");
  
      // Put the button next to the title line
      // We want it inside the first <div> of label (the title row)
      if(titleNode){
        titleNode.appendChild(btn);
      }else{
        label.appendChild(btn);
      }
  
      // Hide inline help (we will use it in popover)
      help.classList.add("isCaptured");
  
      btn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();
        openFor(btn, title, helpText);
      });
    });
  
    // Close on outside click
    document.addEventListener("click", (e)=>{
      if(tip.classList.contains("hidden")) return;
      if(anchorBtn && (anchorBtn.contains(e.target) || tip.contains(e.target))) return;
      close();
    });
  
    // Close on ESC
    document.addEventListener("keydown", (e)=>{
      if(e.key === "Escape") close();
    });
  
    // Reposition on scroll/resize if open
    window.addEventListener("resize", ()=>{
      if(!tip.classList.contains("hidden") && anchorBtn) place(anchorBtn);
    }, { passive:true });
  
    window.addEventListener("scroll", ()=>{
      if(!tip.classList.contains("hidden") && anchorBtn) place(anchorBtn);
    }, { passive:true });
  }
  
// ---------------- Utils ----------------
function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }

function toDayKey(d){
  const z = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}

function minutesForDate(profile, date){
  const dm = profile.dayMinutes || {mon:120,tue:120,wed:120,thu:120,fri:120,sat:180,sun:0};
  const dow = date.getDay(); // 0 Sun .. 6 Sat
  const key =
    dow===0 ? "sun" :
    dow===1 ? "mon" :
    dow===2 ? "tue" :
    dow===3 ? "wed" :
    dow===4 ? "thu" :
    dow===5 ? "fri" : "sat";
  return Number(dm[key] || 0);
}

function weeklyBudgetHours(profile){
  const dm = profile.dayMinutes || {mon:120,tue:120,wed:120,thu:120,fri:120,sat:180,sun:0};
  const totalMin = ["mon","tue","wed","thu","fri","sat","sun"].reduce((a,k)=>a+Number(dm[k]||0),0);
  return Math.round((totalMin/60)*10)/10;
}

function bindRangePair(rangeId, numId){
    const r = qs(rangeId), n = qs(numId);
    if(!r || !n) return;
    const syncToNum = ()=>{ n.value = r.value; };
    const syncToRange = ()=>{ r.value = n.value; };
    r.addEventListener("input", syncToNum);
    n.addEventListener("input", syncToRange);
    syncToNum();
  }
  
  function setupSimUI(){
    bindRangePair("decay", "decay-num");
    bindRangePair("noise", "noise-num");
    bindRangePair("urgency-boost", "urgency-boost-num");
    bindRangePair("delta-hours", "delta-hours-num");
  
    // presets
    const setPreset = (chipId, noise, decay, urgency) => {
      qs("noise").value = noise; qs("noise-num").value = noise;
      qs("decay").value = decay; qs("decay-num").value = decay;
      qs("urgency-boost").value = urgency; qs("urgency-boost-num").value = urgency;
      
      // Update active state
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      qs(chipId)?.classList.add("active");
    };
    
    qs("preset-realistic")?.addEventListener("click", ()=>{
      setPreset("preset-realistic", "0.12", "0.007", "2.1");
    });
  
    qs("preset-optimistic")?.addEventListener("click", ()=>{
      setPreset("preset-optimistic", "0.06", "0.004", "1.7");
    });
  
    qs("preset-stress")?.addEventListener("click", ()=>{
      setPreset("preset-stress", "0.22", "0.010", "2.6");
    });
  }
  

// Dynamic weight: urgency * ignorance * difficulty * cfu (with urgency exponent)
function examDynamicWeight(exam, now, urgencyBoost){
  const examDate = new Date(exam.date);
  const d = clamp(daysBetween(now, examDate), 0, 3650);

  const urgency = 1 / (d + 3);                       // bounded
  const level = clamp(Number(exam.level||0), 0, 5);  // 0..5
  const ignorance = (6 - level);                     // 6..1
  const diff = clamp(Number(exam.difficulty||2), 1, 3);
  const cfu  = clamp(Number(exam.cfu||6), 1, 30);

  // exponent controls how aggressively urgency dominates
  const w = Math.pow(urgency * 12, urgencyBoost) * (ignorance/3) * (1 + (diff-1)*0.25) * (1 + (cfu-6)*0.02);
  return w;
}

function normalize(ws){
  const s = ws.reduce((a,x)=>a+x,0) || 1;
  return ws.map(x => x/s);
}

// deterministic RNG for repeatable sims
function makeRng(seed){
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------- Scenario overrides ----------------
function applyScenarioOverrides(profile, overrides){
  // copy profile safely
  const p = structuredClone(profile);

  // goal mode override
  if(overrides?.goalMode) p.goalMode = overrides.goalMode;

  // task minutes override (not used by this continuous sim yet, but stored for future)
  if(typeof overrides?.taskMinutes === "number" && !Number.isNaN(overrides.taskMinutes)){
    p.taskMinutes = clamp(overrides.taskMinutes, 15, 120);
  }

  // delta weekly hours: spread across Mon..Sat proportionally (Sun untouched)
  if(typeof overrides?.deltaHours === "number" && overrides.deltaHours !== 0){
    const dm = p.dayMinutes || {mon:120,tue:120,wed:120,thu:120,fri:120,sat:180,sun:0};
    const addMin = Math.round(overrides.deltaHours * 60);

    const keys = ["mon","tue","wed","thu","fri","sat"];
    const base = keys.reduce((a,k)=>a+Number(dm[k]||0),0) || 1;

    let rem = addMin;
    for(const k of keys){
      const inc = Math.round(addMin * (Number(dm[k]||0) / base));
      dm[k] = Math.max(0, Number(dm[k]||0) + inc);
      rem -= inc;
    }
    let i=0;
    while(rem !== 0 && i < 100000){
      const k = keys[i % keys.length];
      dm[k] = Math.max(0, Number(dm[k]||0) + (rem>0 ? 1 : -1));
      rem += (rem>0 ? -1 : 1);
      i++;
    }
    p.dayMinutes = dm;
  }

  return p;
}

function applyExamOverrides(exams, overrides){
  let exs = (exams || []).map(e => ({...e}));
  if(overrides?.dropExamId){
    exs = exs.filter(e => e.id !== overrides.dropExamId);
  }
  return exs;
}

// ---------------- Simulation ----------------
// readiness in [0,100]; daily update: decay + study_gain - urgency_penalty_if_not_studied + noise
function simulate(profile, exams, params, seed = 1, overrides = null){
  const horizon = clamp(Number(params.horizonDays||60), 7, 365);
  const decay = clamp(Number(params.decay||0.006), 0, 0.03);
  const noise = clamp(Number(params.noise||0.10), 0, 0.5);
  const urgencyBoost = clamp(Number(params.urgencyBoost||2.0), 0.5, 4.0);

  const rng = makeRng(seed);

  const p = overrides ? applyScenarioOverrides(profile, overrides) : structuredClone(profile);
  const exs = overrides ? applyExamOverrides(exams, overrides) : (exams || []).map(e => ({...e}));

  const start = new Date();
  start.setHours(0,0,0,0);

  // init from level (0..5) -> 0..100
  const r = {};
  for(const e of exs){
    const level = clamp(Number(e.level||0), 0, 5);
    r[e.id] = (level/5) * 100;
  }

  const dates = [];
  const series = {};
  for(const e of exs) series[e.id] = [];

  for(let t=0; t<horizon; t++){
    const now = new Date(start);
    now.setDate(start.getDate() + t);
    dates.push(toDayKey(now));

    const cap = minutesForDate(p, now);

    // weight allocation (optionally boost one exam)
    const ws = exs.map(e => {
      let w = examDynamicWeight(e, now, urgencyBoost);
      if(overrides?.boostExamId && e.id === overrides.boostExamId){
        w *= clamp(Number(overrides.boostFactor || 1.0), 0.5, 3.0);
      }
      return w;
    });
    const frac = normalize(ws);

    // integer minutes allocation
    const allocMin = exs.map((e,i)=> Math.floor(cap * frac[i]));

    for(let i=0;i<exs.length;i++){
      const e = exs[i];
      const id = e.id;

      // decay
      let rr = r[id] * (1 - decay);

      // study gain with diminishing returns near 100
      const m = allocMin[i];
      const gain = (m/60) * 14 * (1 - rr/110); // ~14 pts per hour early
      rr += gain;

      // penalty if close and you did 0 today
      const dleft = clamp(daysBetween(now, new Date(e.date)), 0, 3650);
      const close = dleft <= 14 ? (14 - dleft)/14 : 0; // 0..1
      if(m <= 0) rr -= close * 2.0;

      // noise
      rr += (rng()*2 - 1) * noise * 6;

      r[id] = clamp(rr, 0, 100);
      series[id].push(r[id]);
    }
  }

  return { dates, series, exams: exs, profile: p };
}

// ---------------- Monte Carlo median aggregator ----------------
function median(arr){
  const a = [...arr].sort((x,y)=>x-y);
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

function aggregateMedian(mcRuns){
  const dates = mcRuns[0].dates;
  const examIds = Object.keys(mcRuns[0].series);
  const out = {};
  for(const id of examIds){
    out[id] = dates.map((_,t)=>{
      const vals = mcRuns.map(r => r.series[id][t]);
      return median(vals);
    });
  }
  return { dates, series: out };
}

// ---------------- Charting (Canvas) ----------------
function hashColor(i){
  const hue = (i * 67) % 360;
  return `hsl(${hue} 85% 65%)`;
}

function drawChartOverlay(canvas, dates, examsA, seriesA, examsB=null, seriesB=null, title=""){
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0,0,W,H);

  const padL=56, padR=18, padT=32, padB=44;
  const x0=padL, y0=padT, x1=W-padR, y1=H-padB;

  // background gradient
  const bgGradient = ctx.createLinearGradient(0, 0, 0, H);
  bgGradient.addColorStop(0, "rgba(10, 12, 20, 0.4)");
  bgGradient.addColorStop(1, "rgba(10, 12, 20, 0.6)");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0,0,W,H);

  // axes
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0,y0);
  ctx.lineTo(x0,y1);
  ctx.lineTo(x1,y1);
  ctx.stroke();

  // y-grid
  ctx.font = "12px system-ui";
  for(let k=0;k<=5;k++){
    const val = k*20;
    const y = y1 - (val/100)*(y1-y0);
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.beginPath();
    ctx.moveTo(x0,y);
    ctx.lineTo(x1,y);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillText(String(val), 16, y+4);
  }

  // x ticks
  const n = dates.length;
  const ticks = Math.min(8, n);
  for(let t=0;t<ticks;t++){
    const idx = Math.round(t*(n-1)/(ticks-1));
    const x = x0 + (idx/(n-1))*(x1-x0);
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.beginPath();
    ctx.moveTo(x,y1);
    ctx.lineTo(x,y1+6);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillText(dates[idx].slice(5), x-16, H-16);
  }

  // baseline lines (solid)
  examsA.forEach((e, i)=>{
    const col = hashColor(i);
    const yvals = seriesA[e.id];
    if(!yvals) return;

    ctx.setLineDash([]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;

    ctx.beginPath();
    for(let j=0;j<n;j++){
      const x = x0 + (j/(n-1))*(x1-x0);
      const y = y1 - (yvals[j]/100)*(y1-y0);
      if(j===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  });

  // scenario lines (dashed)
  if(examsB && seriesB){
    examsB.forEach((eB, j)=>{
      // match color by exam name if possible, else index-based
      const idxA = examsA.findIndex(eA => eA.name === eB.name);
      const col = hashColor(idxA >= 0 ? idxA : j);

      const yvals = seriesB[eB.id];
      if(!yvals) return;

      ctx.setLineDash([8,6]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;

      ctx.beginPath();
      for(let k=0;k<n;k++){
        const x = x0 + (k/(n-1))*(x1-x0);
        const y = y1 - (yvals[k]/100)*(y1-y0);
        if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // title
  ctx.fillStyle = "rgba(255,255,255,.90)";
  ctx.font = "bold 15px system-ui";
  ctx.fillText(title || "Baseline vs Scenario", x0, 20);
  
  // axis labels
  ctx.fillStyle = "rgba(255,255,255,.60)";
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Tempo (giorni)", (x0 + x1) / 2, H - 8);
  ctx.save();
  ctx.translate(20, (y0 + y1) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Preparazione (%)", 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
}

// legend
function renderLegend(exams){
  const wrap = qs("legend");
  if(!wrap) return;
  wrap.innerHTML = "";

  const tip = document.createElement("div");
  tip.className = "legendItem";
  tip.innerHTML = `<span class="legendSwatch" style="background:rgba(255,255,255,.85)"></span>
                   <span>Linea piena: Baseline · Tratteggio: Scenario</span>`;
  wrap.appendChild(tip);

  exams.forEach((e,i)=>{
    const item = document.createElement("div");
    item.className = "legendItem";
    item.innerHTML = `<span class="legendSwatch" style="background:${hashColor(i)}"></span><span>${escapeHtml(e.name)}</span>`;
    wrap.appendChild(item);
  });
}

// Exam summary
function renderExamSummary(exams){
  const container = qs("exam-summary");
  if(!container) return;
  
  if(exams.length === 0){
    container.style.display = "none";
    return;
  }
  
  container.style.display = "grid";
  container.innerHTML = "";
  
  exams.forEach((e) => {
    const item = document.createElement("div");
    item.className = "examSummaryItem";
    const daysLeft = daysBetween(new Date(), new Date(e.date));
    item.innerHTML = `
      <div class="examSummaryName">${escapeHtml(e.name)}</div>
      <div class="examSummaryMeta">${e.date || "—"} · ${daysLeft} giorni · ${e.cfu || "—"} CFU</div>
    `;
    container.appendChild(item);
  });
}

// ---------------- UI read helpers ----------------
function readParams(){
  return {
    horizonDays: Number(qs("horizon-days")?.value || 60),
    noise: Number(qs("noise")?.value || 0.10),
    decay: Number(qs("decay")?.value || 0.006),
    urgencyBoost: Number(qs("urgency-boost")?.value || 2.0),
  };
}

function readScenarioOverrides(){
  const goal = (qs("goal-override")?.value || "").trim();
  const taskRaw = (qs("task-override")?.value || "").trim();
  const dropExamId = (qs("drop-exam")?.value || "").trim();
  const boostExamId = (qs("boost-exam")?.value || "").trim();

  return {
    deltaHours: Number(qs("delta-hours")?.value || 0),
    goalMode: goal || null,
    taskMinutes: taskRaw ? Number(taskRaw) : null,
    dropExamId: dropExamId || null,
    boostExamId: boostExamId || null,
    boostFactor: Number(qs("boost-factor")?.value || 1.0),
  };
}

function populateSelect(selectEl, exams){
  if(!selectEl) return;
  // keep first option (none)
  while(selectEl.options.length > 1) selectEl.remove(1);
  for(const e of exams){
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = e.name;
    selectEl.appendChild(o);
  }
}

// ----------------- SHARE SIMULATION -----------------
/**
 * Setup del bottone per condividere le simulazioni (solo premium)
 */
function setupShareSimulationButton(uid, profile, exams) {
  const shareBtn = qs("share-simulation-btn");
  if (!shareBtn) return;

  // Inizialmente nascosto - verrà mostrato dopo l'esecuzione di una simulazione
  shareBtn.style.display = "none";

  // Evita di aggiungere listener multipli
  if (shareBtn.dataset.bound) return;
  shareBtn.dataset.bound = "1";

  shareBtn.addEventListener("click", async () => {
    try {
      shareBtn.disabled = true;
      shareBtn.textContent = "⏳ Generazione...";
      
      await shareSimulation(profile, exams);
      
      shareBtn.disabled = false;
      shareBtn.textContent = "Condividi simulazione";
    } catch (err) {
      console.error("Errore condivisione simulazione:", err);
      alert("Errore durante la condivisione: " + (err?.message || err));
      shareBtn.disabled = false;
      shareBtn.textContent = "Condividi simulazione";
    }
  });
}

/**
 * Funzione principale per condividere la simulazione
 */
async function shareSimulation(profile, exams) {
  // Verifica se html2canvas è disponibile
  if (typeof html2canvas === "undefined") {
    shareSimulationAsText(profile, exams);
    return;
  }

  const chartCanvas = qs("chart");
  const chartWrap = chartCanvas?.closest(".chartWrap");
  const legend = qs("legend");
  const examSummary = qs("exam-summary");
  
  if (!chartCanvas || !chartWrap) {
    throw new Error("Grafico simulazione non trovato");
  }

  // Verifica se c'è un grafico disegnato (non vuoto)
  const ctx = chartCanvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, chartCanvas.width, chartCanvas.height);
  const hasContent = imageData.data.some(pixel => pixel !== 0);
  
  if (!hasContent) {
    throw new Error("Esegui prima una simulazione per poterla condividere");
  }

  // Crea un contenitore temporaneo per l'immagine
  const shareContainer = document.createElement("div");
  shareContainer.style.position = "absolute";
  shareContainer.style.left = "-9999px";
  shareContainer.style.width = "800px";
  shareContainer.style.padding = "32px";
  shareContainer.style.background = "linear-gradient(180deg, #070a12, #0b0f1a)";
  shareContainer.style.color = "rgba(255,255,255,.93)";
  shareContainer.style.fontFamily = "system-ui, -apple-system, sans-serif";
  shareContainer.style.borderRadius = "12px";

  // Header
  const header = document.createElement("div");
  header.style.marginBottom = "24px";
  header.style.textAlign = "center";
  header.innerHTML = `
    <h2 style="margin:0 0 8px 0; font-size:24px; font-weight:900;">Simulazione Preparazione</h2>
    <p style="margin:0; font-size:14px; color:rgba(255,255,255,.6);">Study Planner</p>
  `;
  shareContainer.appendChild(header);

  // Info simulazione
  const infoDiv = document.createElement("div");
  infoDiv.style.marginBottom = "24px";
  infoDiv.style.padding = "16px";
  infoDiv.style.background = "rgba(255,255,255,.05)";
  infoDiv.style.borderRadius = "10px";
  infoDiv.style.fontSize = "13px";
  infoDiv.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; text-align:center;">
      <div>
        <div style="color:rgba(255,255,255,.6); margin-bottom:4px;">Esami</div>
        <div style="font-weight:700; font-size:18px;">${exams.length}</div>
      </div>
      <div>
        <div style="color:rgba(255,255,255,.6); margin-bottom:4px;">Budget</div>
        <div style="font-weight:700; font-size:18px;">${weeklyBudgetHours(profile)}h</div>
      </div>
      <div>
        <div style="color:rgba(255,255,255,.6); margin-bottom:4px;">Orizzonte</div>
        <div style="font-weight:700; font-size:18px;">${qs("horizon-days")?.value || 60}g</div>
      </div>
    </div>
  `;
  shareContainer.appendChild(infoDiv);

  // Clona il canvas del grafico
  const chartClone = document.createElement("canvas");
  chartClone.width = chartCanvas.width;
  chartClone.height = chartCanvas.height;
  const cloneCtx = chartClone.getContext("2d");
  cloneCtx.drawImage(chartCanvas, 0, 0);
  
  const chartWrapper = document.createElement("div");
  chartWrapper.style.marginBottom = "24px";
  chartWrapper.style.textAlign = "center";
  chartWrapper.appendChild(chartClone);
  shareContainer.appendChild(chartWrapper);

  // Aggiungi info esami se disponibile
  if (examSummary && examSummary.style.display !== "none" && examSummary.children.length > 0) {
    const examsInfo = document.createElement("div");
    examsInfo.style.marginTop = "16px";
    examsInfo.style.padding = "16px";
    examsInfo.style.background = "rgba(255,255,255,.03)";
    examsInfo.style.borderRadius = "10px";
    examsInfo.style.fontSize = "12px";
    examsInfo.innerHTML = examSummary.innerHTML;
    shareContainer.appendChild(examsInfo);
  }

  // Footer
  const footer = document.createElement("div");
  footer.style.marginTop = "24px";
  footer.style.textAlign = "center";
  footer.style.fontSize = "12px";
  footer.style.color = "rgba(255,255,255,.5)";
  footer.textContent = "Generato con Study Planner Premium";
  shareContainer.appendChild(footer);

  document.body.appendChild(shareContainer);

  try {
    // Genera immagine
    const shareCanvas = await html2canvas(shareContainer, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true,
    });

    // Rimuovi contenitore temporaneo
    document.body.removeChild(shareContainer);

    // Converti canvas in blob
    shareCanvas.toBlob(async (blob) => {
      if (!blob) {
        throw new Error("Errore nella generazione dell'immagine");
      }

      const file = new File([blob], "simulazione-study-planner.png", { type: "image/png" });
      const url = URL.createObjectURL(blob);

      // Prova Web Share API
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "La mia simulazione - Study Planner",
            text: "Guarda la mia simulazione di preparazione! 📊",
            files: [file],
          });
          URL.revokeObjectURL(url);
          return;
        } catch (shareErr) {
          if (shareErr.name !== "AbortError") {
            console.error("Errore Web Share:", shareErr);
          }
        }
      }

      // Fallback: download + link WhatsApp
      downloadImage(url, "simulazione-study-planner.png");
      showShareOptions(url);
    }, "image/png");
  } catch (err) {
    document.body.removeChild(shareContainer);
    throw err;
  }
}

/**
 * Condivisione come testo (fallback)
 */
function shareSimulationAsText(profile, exams) {
  const horizon = qs("horizon-days")?.value || 60;
  const text = `📊 Simulazione Preparazione - Study Planner

Esami: ${exams.length}
Budget settimanale: ${weeklyBudgetHours(profile)}h
Orizzonte: ${horizon} giorni

Generato con Study Planner Premium`;

  if (navigator.share) {
    navigator.share({
      title: "La mia simulazione",
      text: text,
    }).catch(() => {
      copyToClipboard(text);
      showWhatsAppLink(text);
    });
  } else {
    copyToClipboard(text);
    showWhatsAppLink(text);
  }
}

/**
 * Download dell'immagine
 */
function downloadImage(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Mostra opzioni di condivisione
 */
function showShareOptions(imageUrl) {
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    background: #0b0f1a;
    padding: 24px;
    border-radius: 12px;
    max-width: 400px;
    width: 90%;
    border: 1px solid rgba(255,255,255,.12);
  `;

  card.innerHTML = `
    <h3 style="margin:0 0 16px 0; font-size:18px;">Immagine scaricata! 📥</h3>
    <p style="margin:0 0 20px 0; color:rgba(255,255,255,.7); font-size:14px;">
      L'immagine è stata scaricata. Puoi condividerla su Instagram, WhatsApp o altre app.
    </p>
    <div style="display:flex; gap:12px;">
      <button id="share-whatsapp" class="btn primary" style="flex:1;">📱 WhatsApp</button>
      <button id="share-close" class="btn" style="flex:1;">Chiudi</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const closeModal = () => {
    document.body.removeChild(modal);
    URL.revokeObjectURL(imageUrl);
  };

  card.querySelector("#share-close").addEventListener("click", closeModal);
  
  card.querySelector("#share-whatsapp")?.addEventListener("click", () => {
    const text = encodeURIComponent("Guarda la mia simulazione di preparazione! 📊\n\nGenerato con Study Planner Premium");
    const whatsappUrl = `https://wa.me/?text=${text}`;
    window.open(whatsappUrl, "_blank");
    closeModal();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}

/**
 * Copia testo negli appunti
 */
function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      alert("Testo copiato negli appunti!");
    });
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    alert("Testo copiato negli appunti!");
  }
}

/**
 * Mostra link WhatsApp
 */
function showWhatsAppLink(text) {
  const encodedText = encodeURIComponent(text);
  const whatsappUrl = `https://wa.me/?text=${encodedText}`;
  
  if (confirm("Vuoi aprire WhatsApp per condividere?")) {
    window.open(whatsappUrl, "_blank");
  }
}

// ---------------- Main ----------------
window.addEventListener("DOMContentLoaded", ()=>{
  setupMenu();
  setupInfoPopovers();

  onAuthStateChanged(auth, async (user)=>{
    setupSimUI();

    if(!user){ location.href="./index.html"; return; }
    setText("user-line", user.email ?? "—");

    // Controllo premium - mostra popup ma lascia vedere la pagina sotto
    const premium = await isPremium(user.uid);
    if (!premium) {
      // Mostra popup premium ma lascia vedere la pagina
      setTimeout(() => {
        showUpgradeModal();
      }, 500);
      
      // Disabilita i bottoni di simulazione
      const disableButtons = () => {
        const runSimBtn = qs("run-sim");
        const runWhatIfBtn = qs("run-whatif");
        if (runSimBtn) {
          runSimBtn.disabled = true;
          runSimBtn.style.opacity = "0.5";
          runSimBtn.style.cursor = "not-allowed";
          runSimBtn.addEventListener("click", (e) => {
            e.preventDefault();
            showUpgradeModal();
          });
        }
        if (runWhatIfBtn) {
          runWhatIfBtn.disabled = true;
          runWhatIfBtn.style.opacity = "0.5";
          runWhatIfBtn.style.cursor = "not-allowed";
          runWhatIfBtn.addEventListener("click", (e) => {
            e.preventDefault();
            showUpgradeModal();
          });
        }
      };
      
      // Disabilita dopo che la pagina è caricata
      setTimeout(disableButtons, 100);
    }

    const profile = await getProfile(user.uid);
    const exams = await listExams(user.uid);

    if(!profile?.dayMinutes || !profile?.goalMode){
      setText("sim-status", "Profilo incompleto → vai su Modifica profilo.");
      return;
    }
    if(!exams || exams.length === 0){
      setText("sim-status", "Nessun esame → aggiungili nel profilo.");
      return;
    }

    setText("sim-meta", `Esami: ${exams.length} · Budget settimanale: ${weeklyBudgetHours(profile)}h`);
    
    // Setup bottone condividi simulazione (solo premium)
    if (premium) {
      setupShareSimulationButton(user.uid, profile, exams);
    }
    
    // Mostra statistiche
    const statsGrid = qs("sim-stats");
    if (statsGrid) {
      statsGrid.style.display = "grid";
      setText("stat-exams", exams.length);
      setText("stat-budget", weeklyBudgetHours(profile));
      setText("stat-horizon", "60");
    }
    
    // Aggiorna orizzonte quando cambia
    qs("horizon-days")?.addEventListener("input", (e) => {
      setText("stat-horizon", e.target.value || "60");
    });
    
    renderLegend(exams);
    renderExamSummary(exams);

    populateSelect(qs("drop-exam"), exams);
    populateSelect(qs("boost-exam"), exams);

    const canvas = qs("chart");
    if(!canvas){
      setText("sim-status", "Errore: canvas non trovato.");
      return;
    }

    // Funzione per mostrare bottone condividi dopo simulazione
    const showShareButton = () => {
      const shareBtn = qs("share-simulation-btn");
      if (shareBtn && premium) {
        shareBtn.style.display = "block";
      }
    };

    // ---- Run functions ----
    const runBaseline = ()=>{
      // Controllo premium
      if (!premium) {
        showUpgradeModal();
        return;
      }
      
      const params = readParams();
      const out = simulate(profile, exams, params, 123, null);
      drawChartOverlay(canvas, out.dates, out.exams, out.series, null, null, "Simulazione (Baseline)");
      setText("sim-status", `Baseline OK · orizzonte ${params.horizonDays}g · noise ${params.noise} · decay ${params.decay}`);
      showShareButton();
    };

    const runMCBaseline = ()=>{
      // Controllo premium
      if (!premium) {
        showUpgradeModal();
        return;
      }
      
      const params = readParams();
      const runs = [];
      for(let k=0;k<20;k++){
        runs.push(simulate(profile, exams, params, 1000+k, null));
      }
      const agg = aggregateMedian(runs);
      const baseExams = runs[0].exams;
      drawChartOverlay(canvas, agg.dates, baseExams, agg.series, null, null, "Monte Carlo (mediana) — Baseline");
      setText("sim-status", `MC Baseline OK · 20 scenari · mediana`);
      showShareButton();
    };

    const runWhatIf = ()=>{
      // Controllo premium
      if (!premium) {
        showUpgradeModal();
        return;
      }
      
      const params = readParams();
      const ov = readScenarioOverrides();

      const base = simulate(profile, exams, params, 111, null);
      const scen = simulate(profile, exams, params, 222, ov);

      drawChartOverlay(
        canvas,
        base.dates,
        base.exams,
        base.series,
        scen.exams,
        scen.series,
        "Baseline (pieno) vs Scenario (tratteggio)"
      );

      const dropName = ov.dropExamId ? (exams.find(e=>e.id===ov.dropExamId)?.name || "sì") : "—";
      const boostName = ov.boostExamId ? (exams.find(e=>e.id===ov.boostExamId)?.name || "sì") : "—";
      setText(
        "sim-status",
        `What-if OK · Δh=${ov.deltaHours} · goal=${ov.goalMode||"—"} · task=${ov.taskMinutes||"—"} · drop=${dropName} · boost=${boostName}×${ov.boostFactor}`
      );
      showShareButton();
    };

    const runWhatIfMC = ()=>{
      // Controllo premium
      if (!premium) {
        showUpgradeModal();
        return;
      }
      
      const params = readParams();
      const ov = readScenarioOverrides();

      const baseRuns = [];
      const scenRuns = [];
      for(let k=0;k<20;k++){
        baseRuns.push(simulate(profile, exams, params, 1000+k, null));
        scenRuns.push(simulate(profile, exams, params, 2000+k, ov));
      }

      const baseAgg = aggregateMedian(baseRuns);
      const scenAgg = aggregateMedian(scenRuns);

      const baseExams = baseRuns[0].exams;
      const scenExams = scenRuns[0].exams;

      drawChartOverlay(
        canvas,
        baseAgg.dates,
        baseExams,
        baseAgg.series,
        scenExams,
        scenAgg.series,
        "What-if Monte Carlo (mediana) — pieno vs tratteggio"
      );

      setText("sim-status", "What-if MC OK · 20 scenari · mediana");
      showShareButton();
    };

    // ---- Hook buttons if present ----
    qs("run-sim")?.addEventListener("click", runBaseline);
    qs("run-mc")?.addEventListener("click", runMCBaseline);
    qs("run-whatif")?.addEventListener("click", runWhatIf);
    qs("run-whatif-mc")?.addEventListener("click", runWhatIfMC);

    // autorun baseline solo se premium
    if (premium) {
      runBaseline();
    } else {
      // Mostra messaggio placeholder sul canvas
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255,255,255,.60)";
      ctx.font = "bold 16px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Passa a Premium per vedere le simulazioni", canvas.width / 2, canvas.height / 2);
      setText("sim-status", "Passa a Premium per eseguire simulazioni");
    }
    
    // Gestione premium badge e upgrade button
    const premiumBadge = qs("premium-badge");
    const upgradeBtn = qs("upgrade-btn");
    
    if (premiumBadge) {
      if (premium) {
        premiumBadge.textContent = "Premium";
        premiumBadge.className = "badge good";
        premiumBadge.style.display = "inline-block";
        if (upgradeBtn) upgradeBtn.style.display = "none";
      } else {
        premiumBadge.style.display = "none";
        if (upgradeBtn) {
          upgradeBtn.style.display = "inline-block";
          upgradeBtn.addEventListener("click", () => showUpgradeModal());
        }
      }
    }
    
    // Aggiungi bottone di test premium (solo in localhost)
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.href.includes('localhost')) {
      const testBtn = document.createElement("button");
      testBtn.className = "btn";
      testBtn.style.cssText = "margin-right: 12px; font-size: 11px; padding: 6px 12px; background: rgba(245,158,11,0.2); border-color: rgba(245,158,11,0.4); color: rgba(245,158,11,1);";
      testBtn.textContent = premium ? "🧪 Test: Disattiva Premium" : "🧪 Test: Attiva Premium";
      testBtn.addEventListener("click", async () => {
      // Funzione di test inline per simulations.js
      const user = auth.currentUser;
      if (!user) return;

      const activate = !premium;
      if (activate) {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        const {doc, updateDoc, serverTimestamp} = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
        const ref = doc(db, 'users', user.uid);
        await updateDoc(ref, {
          subscription: {
            status: 'active',
            startDate: serverTimestamp(),
            endDate: endDate.toISOString(),
            type: 'monthly',
            price: 5,
          },
          updatedAt: serverTimestamp(),
        });
        alert('✅ Premium attivato! Ricarica la pagina.');
      } else {
        const {doc, updateDoc, serverTimestamp} = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
        const ref = doc(db, 'users', user.uid);
        await updateDoc(ref, {
          subscription: {
            status: 'cancelled',
            endDate: new Date().toISOString(),
          },
          updatedAt: serverTimestamp(),
        });
        alert('❌ Premium disattivato! Ricarica la pagina.');
      }
      setTimeout(() => window.location.reload(), 1000);
      });
      const toolbar = document.querySelector('.toolbar');
      if (toolbar && !toolbar.querySelector('.test-premium-btn')) {
        testBtn.classList.add('test-premium-btn');
        toolbar.insertBefore(testBtn, toolbar.firstChild);
      }
    }
  });
});
