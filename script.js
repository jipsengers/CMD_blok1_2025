const URL_BEWEGING = "model-beweging/";   // TM labels: "Geen beweging", "Beweging"
const URL_HART     = "model-hart/";       // TM class:  "hart_gebaar"

// Blippar Preview link:
const BLIPPAR_URL  = "https://ar.blippar.com/155118964";

// Platform-detectie 
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Timings (ms)
const STEP_MS        = 5_000;  // autosleep: 5s per frame
const BLIP_DELAY_MS  = 5_000;  // na sleeping → POST_BLIP
const STEP_HOLD_MS   = 4_000;  // 4s aaneengesloten beweging → volgende reactieve stap
const IDLE_BACK_MS   = 4_000;  // 4s aaneengesloten geen beweging → terug naar sleeping
const SHAKE_FLIP_MS  = 700;    // wissel tempo tussen left/right alert

// Drempels
const MOVE_TH      = 0.60;     // “Beweging”
const IDLE_TH_REST = 0.75;     // “Geen beweging”

// Harttrigger (80% voor 2s)
const HEART_CLASS      = "hart_gebaar";
const HEART_THRESHOLD  = 0.80;
const HEART_HOLD_MS    = 2_000;

// Debug (toon percentages)
const DEBUG = false;

/*************** DOM ***************/
const startButton   = document.getElementById("startButton");
const overlay       = document.getElementById("overlay");
const statusLabel   = document.getElementById("status");
const expressionImg = document.getElementById("expression");
const openArBtn     = document.getElementById("open-ar");
const reactiveBtn   = document.getElementById("reactiveBtn");

/*************** HELPERS ***************/
const ASSET_MAP = {
  alert_shake_left:  "assets/alert_shake_left.png",
  alert_shake_right: "assets/alert_shake_right.png",
  awake:             "assets/awake.png",
  detect_more:       "assets/detect_more.png",
  getting_tired:     "assets/getting_tired.png",
  half_sleep:        "assets/half_sleep.png",
  sleeping:          "assets/sleeping.png",
  very_tired:        "assets/very_tired.png",
};
const DEFAULT_STATE = "awake";

const toSlug = s => s.trim().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");

let __lastStatus = "";
function setStatus(msg){
  if (!DEBUG && (msg.startsWith("reactive:") || msg.includes("%"))) return;
  if (msg !== __lastStatus){ statusLabel.textContent = msg; __lastStatus = msg; }
}
function hideOverlay(){ overlay.classList.add("overlay--hidden"); }
function showOverlay(){ overlay.classList.remove("overlay--hidden"); }

function setExpression(key){
  const src = ASSET_MAP[key] ?? ASSET_MAP[DEFAULT_STATE];
  expressionImg.style.opacity = "0.75";
  expressionImg.src = src;
  expressionImg.alt = `Wezen gezichtsuitdrukking: ${key.replace(/_/g," ")}`;
  expressionImg.onload = ()=> expressionImg.style.opacity = "1";
}

// Zichtbaarheid hard forceren (class + inline)
function show(el){ if(!el) return; el.classList.remove('hidden'); el.style.display = ''; el.style.opacity = '1'; }
function hide(el){ if(!el) return; el.classList.add('hidden'); el.style.display = 'none'; }

// Robuust extern openen (mobiel/desktop)
function openExternal(url){
  // 1) via <a> click (beste kans op iOS)
  const a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  // 2) fallback zelfde tab
  setTimeout(()=>{ window.location.href = url; }, 120);
}

/*************** STATE ***************/
const state = {
  // WAIT_HEART → AUTO_SLEEP → SLEEP → POST_BLIP → REACTIVE
  phase: "WAIT_HEART",

  // Hart
  heartDetected: false,
  heartStreakMs: 0,

  // Autosleep
  autoStepIndex: 0,

  // Reactief
  reactiveStep: 0,     // 0=sleeping, 1=half_sleep, 2=detect_more, 3=alert (shake)
  moveStreakMs: 0,
  idleStreakMs: 0,
  altShake: false,
  lastShakeFlip: 0,
};

// Models & loop
let modelBeweging = null;
let modelHart     = null;
let webcam        = null;
let raf           = null;

// Flags
let visitedAR = false;

/*************** MODELLEN ***************/
async function loadModels(){
  modelBeweging = await tmImage.load(
    URL_BEWEGING + "model.json",
    URL_BEWEGING + "metadata.json"
  );
  try{
    modelHart = await tmImage.load(
      URL_HART + "model.json",
      URL_HART + "metadata.json"
    );
    console.log("Hart-model geladen ✅");
  }catch{
    modelHart = null;
    console.warn("Hart-model niet gevonden (optioneel).");
  }
  setStatus("Maak een hartjesgebaar om de slaaproutine te starten — of druk op H");
}

/*************** START/STOP ***************/
async function start(){
  try{
    const w=320, h=240, flip=true;
    webcam = new tmImage.Webcam(w,h,flip);

    setStatus("Webcam initialiseren…");
    await webcam.setup();   // desktop: direct; mobiel: toestemming prompt
    await webcam.play();

    hideOverlay();
    setExpression("awake");
    setStatus("Maak een hartjesgebaar om de slaaproutine te starten — of druk op H");

    Object.assign(state, {
      phase: "WAIT_HEART",
      heartDetected: false,
      heartStreakMs: 0,
      autoStepIndex: 0,
      reactiveStep: 0,
      moveStreakMs: 0,
      idleStreakMs: 0,
      altShake: false,
      lastShakeFlip: 0,
    });

    visitedAR = false;
    hide(openArBtn);
    hide(reactiveBtn);

    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);

  }catch(err){
    console.error("[start] webcam fout:", err);
    showOverlay();
    setExpression("awake");
    setStatus("Kon de webcam niet starten. Sta cam-toegang toe of sluit andere apps.");
  }
}

/*************** AUTOSLEEP ***************/
function startAutoSleep(){
  state.phase = "AUTO_SLEEP";
  const steps = ["awake","getting_tired","very_tired","sleeping"];
  state.autoStepIndex = 0;
  setStatus("Slaaproutine gestart…");

  setExpression(steps[0]);

  const stepTimer = setInterval(() => {
    state.autoStepIndex++;
    const k = steps[state.autoStepIndex];
    setExpression(k);

    if (k === "sleeping"){
      clearInterval(stepTimer);
      state.phase = "SLEEP";
      handleSleepPhase();
    }
  }, STEP_MS);
}

function handleSleepPhase(){
  setExpression("sleeping");
  setStatus("Het wezen slaapt");
  openPostBlipAfterDelay();
}

let sleepTimer = null;
function openPostBlipAfterDelay(){
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    state.phase = "POST_BLIP";
    setExpression("sleeping");
    setStatus("De droomwereld wordt geopend…");
    show(openArBtn);   // Knop tonen, ongeacht device
    hide(reactiveBtn);
  }, BLIP_DELAY_MS);
}

/*************** OPLETTENDE MODUS ***************/
function startReactive(){
  hide(openArBtn);
  hide(reactiveBtn);

  state.phase = "REACTIVE";
  state.reactiveStep = 0;
  state.moveStreakMs = 0;
  state.idleStreakMs = 0;
  state.altShake = false;
  state.lastShakeFlip = 0;

  setExpression("sleeping");
  setStatus("Het wezen slaapt");

  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

function applyReactive(preds){
  const prob = wantName => {
    const wantSlug = toSlug(wantName);
    const p = preds.find(x => toSlug(x.className) === wantSlug);
    return p ? p.probability : 0;
  };

  const pMove = prob("Beweging");
  const pIdle = prob("Geen beweging");

  if (DEBUG) setStatus(`reactive: move=${(pMove*100).toFixed(0)}% • idle=${(pIdle*100).toFixed(0)}% · step=${state.reactiveStep}`);

  // 4s beweging → stap omhoog
  if (pMove >= MOVE_TH && pIdle < IDLE_TH_REST){
    state.moveStreakMs += 16;
    const wanted = Math.min(3, Math.floor(state.moveStreakMs / STEP_HOLD_MS));

    if (wanted !== state.reactiveStep){
      state.reactiveStep = wanted;
      if (wanted === 0){ setExpression("sleeping");    setStatus("Het wezen slaapt"); }
      if (wanted === 1){ setExpression("half_sleep");  setStatus("Het wezen slaapt half"); }
      if (wanted === 2){ setExpression("detect_more"); setStatus("Het wezen wordt wakker"); }
      if (wanted === 3){
        state.altShake = !state.altShake;
        setExpression(state.altShake ? "alert_shake_left" : "alert_shake_right");
        state.lastShakeFlip = performance.now();
        setStatus("Het wezen is alert!");
      }
    } else if (state.reactiveStep === 3){
      const now = performance.now();
      if (now - state.lastShakeFlip > SHAKE_FLIP_MS){
        state.altShake = !state.altShake;
        setExpression(state.altShake ? "alert_shake_left" : "alert_shake_right");
        state.lastShakeFlip = now;
      }
    }
    state.idleStreakMs = 0;
    return;
  }

  // 4s stil → terug naar sleeping
  if (pIdle >= IDLE_TH_REST && pMove < 0.45){
    state.idleStreakMs += 16;
    state.moveStreakMs  = 0;
    if (state.idleStreakMs > IDLE_BACK_MS && state.reactiveStep !== 0){
      state.reactiveStep = 0;
      setExpression("sleeping");
      setStatus("Het wezen slaapt");
    }
    return;
  }
}

/*************** MAIN LOOP ***************/
async function loop(){
  webcam.update();

  // 1) WACHT OP HART-GEBAAR
  if (state.phase === "WAIT_HEART"){
    let heartProb = 0;

    if (modelHart){
      const preds = await modelHart.predict(webcam.canvas);
      const heart = preds.find(p => toSlug(p.className) === toSlug(HEART_CLASS));
      heartProb = heart ? heart.probability : 0;
    }

    setExpression("awake");
    setStatus("Maak een hartjesgebaar om de slaaproutine te starten — of druk op H");

    if (heartProb >= HEART_THRESHOLD || state.heartDetected){
      state.heartStreakMs += 16;
      if (state.heartStreakMs > HEART_HOLD_MS){
        startAutoSleep(); return;
      }
    } else {
      state.heartStreakMs = 0;
    }

    raf = requestAnimationFrame(loop);
    return;
  }

  // 2) NA SLAPEN → BLIPPAR / KNOPPEN
  if (state.phase === "POST_BLIP"){
    setExpression("sleeping");

    if (visitedAR){
      setStatus("Het wezen slaapt");
      show(reactiveBtn);
      hide(openArBtn);
    } else {
      setStatus("De droomwereld wordt geopend…");
      show(openArBtn);
      hide(reactiveBtn);
    }

    raf = requestAnimationFrame(loop);
    return;
  }

  // 3) OPLETTENDE MODUS
  if (state.phase === "REACTIVE"){
    try{
      const predsMove = await modelBeweging.predict(webcam.canvas);
      if (Array.isArray(predsMove) && predsMove.length){ applyReactive(predsMove); }
      else { setStatus("Geen voorspellingen uit model-beweging."); }
    }catch(err){
      console.error("Predict-fout (beweging):", err);
      setStatus("Predict-fout in model-beweging. Check console.");
    }
    raf = requestAnimationFrame(loop);
    return;
  }

  // AUTO_SLEEP / SLEEP 
  raf = requestAnimationFrame(loop);
}

/*************** EVENTS ***************/
openArBtn?.addEventListener("click", () => {
  visitedAR = true;
  hide(openArBtn);
  show(reactiveBtn);            
  openExternal(BLIPPAR_URL);
});

reactiveBtn?.addEventListener("click", () => {
  hide(reactiveBtn);
  startReactive();
});

window.addEventListener("keydown", e=>{
  const k = e.key.toLowerCase();
  if (k==="h" && state.phase==="WAIT_HEART") state.heartDetected = true; // demo
  if (k==="r") startReactive(); 
});

window.addEventListener("load", async ()=>{
  if (!window.tmImage){ setStatus("Teachable Machine library niet gevonden."); return; }
  try{
    await loadModels();
    startButton?.addEventListener("click", start);
  }catch(e){
    console.error(e);
    setStatus("Fout bij laden van modellen.");
  }
});

// Tab zichtbaarheid: pauze/play zonder reset
document.addEventListener("visibilitychange", () => {
  if (document.hidden){
    if (raf) cancelAnimationFrame(raf), raf = null;
    if (webcam) webcam.stop();
  } else {
    if (webcam && webcam.webcam && webcam.webcam.srcObject){
      raf = requestAnimationFrame(loop);
    } else if (state.phase === "REACTIVE"){
      start();               // webcam opnieuw starten
      state.phase = "REACTIVE";
      setExpression("sleeping");
      setStatus("Het wezen slaapt");
    } else if (state.phase === "POST_BLIP"){
      setExpression("sleeping");
      if (visitedAR){
        setStatus("Het wezen slaapt");
        show(reactiveBtn);
        hide(openArBtn);
      } else {
        setStatus("De droomwereld wordt geopend…");
        show(openArBtn);
        hide(reactiveBtn);
      }
      raf = requestAnimationFrame(loop);
    } else {
      raf = requestAnimationFrame(loop);
    }
  }
});
