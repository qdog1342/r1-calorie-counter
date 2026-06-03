const DAY_MINUTES = 1440;
const RING_LENGTH = 616;
const STORAGE_KEY = "r1_kcal_state_v1";

const state = {
  dailyBudget: 2000,
  consumed: 0,
  exerciseCredits: 0,
  fastXp: 0,
  lastFoodAt: null,
  currentDay: dayKey(new Date()),
  modeIndex: 0,
  entries: [],
  foodMemory: {},
  pending: null,
  listening: false,
  scrollLocked: false,
  scrollUnlockTimer: null,
  transcript: "",
  boosts: {
    exercise: 1,
    fasting: 1
  }
};

const modes = ["today", "actions", "log"];

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  await waitForStorageBridge();
  await loadState();
  normalizeDay();
  bindInputs();
  bindHardware();
  renderAll();
  setInterval(renderAll, 15000);
});

function bindElements() {
  [
    "app",
    "clock",
    "dayArc",
    "availableArc",
    "availableCalories",
    "centerLabel",
    "budgetLabel",
    "spentLabel",
    "boostLabel",
    "boostGrid",
    "logList",
    "voiceButton",
    "exerciseButton",
    "manualInput",
    "statusText",
    "burst"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindInputs() {
  els.voiceButton.addEventListener("click", () => {
    if (state.listening) endVoiceCapture();
    else startVoiceCapture();
  });

  els.manualInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitTranscript(els.manualInput.value);
    }
  });

  els.exerciseButton.addEventListener("click", () => {
    setMode(0);
    requestExerciseEstimate("30 minute walk");
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") setMode(state.modeIndex - 1);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") setMode(state.modeIndex + 1);
  });

  window.addEventListener("wheel", (event) => {
    event.preventDefault();
    handleScroll(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  window.addEventListener("pagehide", () => {
    saveState();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState();
  });
}

function bindHardware() {
  window.addEventListener("scrollUp", () => handleScroll(-1));
  window.addEventListener("scrollDown", () => handleScroll(1));
  window.addEventListener("sideClick", () => startVoiceCapture());
  window.addEventListener("longPressStart", () => startVoiceCapture());
  window.addEventListener("longPressEnd", () => endVoiceCapture());
}

window.onPluginMessage = function onPluginMessage(data) {
  const parsed = parsePluginPayload(data);
  if (!state.pending) {
    setStatus("received AI response");
    return;
  }

  if (state.pending.type === "food") {
    addFoodEntry(normalizeFoodResult(parsed), state.pending.source);
  } else if (state.pending.type === "exercise") {
    addExerciseEntry(normalizeExerciseResult(parsed));
  }

  state.pending = null;
  saveState();
  renderAll();
};

function minutesSinceMidnight(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function normalizeDay() {
  const today = dayKey(new Date());
  if (state.currentDay === today) return;
  state.currentDay = today;
  state.consumed = 0;
  state.exerciseCredits = 0;
  state.lastFoodAt = null;
  state.entries = [];
  state.boosts.exercise = 1;
  state.boosts.fasting = 1;
}

function unlockedCalories(date = new Date()) {
  return state.dailyBudget * (minutesSinceMidnight(date) / DAY_MINUTES);
}

function netAvailable(date = new Date()) {
  return Math.round(unlockedCalories(date) + state.exerciseCredits - state.consumed);
}

function renderAll() {
  normalizeDay();
  refreshFastingBoost(false);
  updateRing();
  renderBoosts();
  renderLog();
}

function updateRing() {
  const now = new Date();
  const available = netAvailable(now);
  const dayProgress = minutesSinceMidnight(now) / DAY_MINUTES;
  const availableProgress = clamp((unlockedCalories(now) + state.exerciseCredits - state.consumed) / state.dailyBudget, 0, 1);

  els.clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  els.dayArc.style.strokeDashoffset = String(RING_LENGTH * (1 - dayProgress));
  els.availableArc.style.strokeDashoffset = String(RING_LENGTH * (1 - availableProgress));
  updateBoostClass(available);
  els.availableCalories.textContent = String(available);
  els.centerLabel.textContent = state.pending ? "thinking" : "available";
  els.budgetLabel.textContent = String(state.dailyBudget);
  els.spentLabel.textContent = String(Math.round(state.consumed));
  els.boostLabel.textContent = `${combinedMultiplier().toFixed(2)}x`;
}

function renderBoosts() {
  const strongest = strongestBoost();
  const cards = [
    ["move", `${state.boosts.exercise.toFixed(2)}x`, "var(--cyan)", "move"],
    ["fast", `${state.boosts.fasting.toFixed(2)}x`, "var(--orange)", "fast"]
  ];

  els.boostGrid.innerHTML = cards.map(([name, value, accent, key]) => `
    <article class="boost-chip ${strongest === key ? "hot" : ""}" style="--accent:${accent}">
      <span>${name}</span>
      <b>${value}</b>
    </article>
  `).join("");
}

function renderLog() {
  if (!state.entries.length) {
    els.logList.innerHTML = "<li><strong>no entries</strong><span>yet</span></li>";
    return;
  }

  els.logList.innerHTML = state.entries.slice(0, 3).map((entry) => `
    <li>
      <strong>${entry.title}</strong>
      <span>${entry.kind === "fast" ? "focus" : `${entry.kind === "food" ? "-" : "+"}${Math.round(entry.calories)}`}</span>
    </li>
  `).join("");
}

function setMode(index) {
  const nextIndex = clamp(index, 0, modes.length - 1);
  if (nextIndex === state.modeIndex) {
    setStatus(nextIndex === 0 ? "top" : "bottom");
    return;
  }
  els.app.classList.toggle("nav-down", nextIndex > state.modeIndex);
  els.app.classList.toggle("nav-up", nextIndex < state.modeIndex);
  state.modeIndex = nextIndex;
  const activeMode = modes[state.modeIndex];
  document.querySelectorAll(".page").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${activeMode}Panel`);
  });
  if (activeMode === "actions") setStatus("side button logs voice");
  if (activeMode === "log") setStatus("scroll up for wheel");
}

function handleScroll(direction) {
  if (state.scrollLocked) {
    resetScrollUnlockTimer();
    return;
  }

  state.scrollLocked = true;
  setMode(state.modeIndex + direction);
  resetScrollUnlockTimer();
}

function resetScrollUnlockTimer() {
  if (state.scrollUnlockTimer) clearTimeout(state.scrollUnlockTimer);
  state.scrollUnlockTimer = setTimeout(() => {
    state.scrollLocked = false;
    state.scrollUnlockTimer = null;
  }, 420);
}

function startVoiceCapture() {
  state.listening = true;
  state.transcript = "";
  els.voiceButton.classList.add("active");
  setStatus("listening...");
  startSpeechRecognition();
}

function endVoiceCapture() {
  state.listening = false;
  els.voiceButton.classList.remove("active");
  stopSpeechRecognition();

  const spoken = state.transcript.trim();
  if (!spoken) {
    showManualFallback("type food then enter");
    return;
  }
  submitTranscript(spoken);
}

function submitTranscript(text) {
  const cleanText = text.trim();
  if (!cleanText) {
    showManualFallback("type food then enter");
    return;
  }

  els.manualInput.classList.remove("show");
  els.manualInput.value = "";
  const fastHours = parseFastHours(cleanText);
  if (fastHours) {
    applyFastingBoost(fastHours);
    return;
  }

  if (/\b(run|walk|bike|cycle|lift|weights|exercise|workout|jog)\b/i.test(cleanText)) {
    requestExerciseEstimate(cleanText);
    return;
  }

  requestFoodEstimate(cleanText);
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showManualFallback("speech unavailable");
    return;
  }

  try {
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = true;
    state.recognition.lang = "en-US";
    state.recognition.onresult = (event) => {
      state.transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      setStatus(state.transcript);
    };
    state.recognition.onerror = () => showManualFallback("type transcript");
    state.recognition.start();
  } catch (error) {
    showManualFallback("type transcript");
  }
}

function stopSpeechRecognition() {
  if (!state.recognition) return;
  try {
    state.recognition.stop();
  } catch (error) {
    // SpeechRecognition can throw if it already stopped.
  }
  state.recognition = null;
}

function requestFoodEstimate(text) {
  state.pending = { type: "food", source: "voice" };
  const mentionedTime = parseMentionedTime(text);
  const rememberedFoods = summarizeFoodMemory();
  const prompt = [
    "Estimate calories for a calorie counter creation.",
    "Return ONLY valid JSON with this exact shape:",
    "{\"title\":\"short meal name\",\"calories\":number,\"eatenAt\":\"HH:MM or null\",\"confidence\":0.0}",
    "If the same food appears in remembered foods, prefer that stored calorie estimate for consistency.",
    `User said: ${text}`,
    `Remembered foods: ${JSON.stringify(rememberedFoods)}`,
    mentionedTime ? `Parsed local eating time hint: ${timeHHMM(mentionedTime)}` : "No parsed time hint."
  ].join("\n");

  sendLLM(prompt, () => {
    addFoodEntry(mockFoodEstimate(text), "voice");
  });
}

function requestExerciseEstimate(text) {
  state.pending = { type: "exercise" };
  const prompt = [
    "Estimate active calories for an exercise entry.",
    "Return ONLY valid JSON with this exact shape:",
    "{\"title\":\"short exercise name\",\"activeCalories\":number,\"intensity\":\"light|moderate|vigorous\"}",
    "Use conservative estimates.",
    `User said: ${text}`
  ].join("\n");

  sendLLM(prompt, () => {
    addExerciseEntry(mockExerciseEstimate(text));
  });
}

function sendLLM(message, browserFallback) {
  renderAll();
  setStatus("asking r1 AI");

  if (typeof PluginMessageHandler !== "undefined") {
    PluginMessageHandler.postMessage(JSON.stringify({
      message,
      useLLM: true,
      wantsR1Response: false,
      wantsJournalEntry: false
    }));
    return;
  }

  setTimeout(() => {
    state.pending = null;
    browserFallback();
    saveState();
    renderAll();
  }, 220);
}

function parsePluginPayload(data) {
  const candidates = [data?.data, data?.message, data];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "object") return candidate;
    if (typeof candidate === "string") {
      try {
        return JSON.parse(candidate);
      } catch (error) {
        const json = candidate.match(/\{[\s\S]*\}/);
        if (json) {
          try {
            return JSON.parse(json[0]);
          } catch (innerError) {
            // Continue to next candidate.
          }
        }
      }
    }
  }
  return {};
}

function normalizeFoodResult(result) {
  const title = String(result.title || "Food").slice(0, 28);
  const memory = state.foodMemory?.[foodKey(title)];
  const calories = memory
    ? memory.calories
    : clamp(Math.round(Number(result.calories) || 450), 5, 4000);
  const eatenAt = result.eatenAt && result.eatenAt !== "null"
    ? parseTimeString(result.eatenAt) || new Date()
    : new Date();
  return { title, calories, confidence: Number(result.confidence) || 0.5, eatenAt };
}

function normalizeExerciseResult(result) {
  return {
    title: String(result.title || "Move").slice(0, 28),
    activeCalories: clamp(Math.round(Number(result.activeCalories) || 120), 5, 2000),
    intensity: ["light", "moderate", "vigorous"].includes(result.intensity) ? result.intensity : "moderate"
  };
}

function addFoodEntry(result, source) {
  state.consumed += result.calories;
  state.lastFoodAt = result.eatenAt;
  state.entries.unshift({
    kind: "food",
    title: result.title,
    calories: result.calories,
    source,
    at: result.eatenAt
  });
  rememberFood(result);
  refreshFastingBoost(false);
  setStatus(`${result.title}: -${result.calories}`);
  playBurst();
  saveState();
  renderAll();
}

function addExerciseEntry(result) {
  const credit = Math.round(result.activeCalories * exerciseCreditFactor(result.intensity));
  state.exerciseCredits += credit;
  state.boosts.exercise = clamp(1 + state.exerciseCredits / 1800, 1, 1.35);
  state.entries.unshift({
    kind: "exercise",
    title: result.title,
    calories: credit,
    at: new Date()
  });
  setStatus(`${result.title}: +${credit}`);
  playBurst();
  saveState();
  renderAll();
}

function applyFastingBoost(hours) {
  if (hours < 12) {
    state.boosts.fasting = 1;
    setStatus("fast starts at 12h");
    return;
  }
  state.lastFoodAt = new Date(Date.now() - hours * 36e5);
  refreshFastingBoost(false);
  state.fastXp += Math.round(hours * 10);
  state.entries.unshift({
    kind: "fast",
    title: `${hours.toFixed(1)}h fast`,
    calories: 0,
    at: new Date()
  });
  setStatus(`${hours.toFixed(1)}h fast`);
  playBurst();
  saveState();
  renderAll();
}

function refreshFastingBoost(shouldAnnounce) {
  if (!state.lastFoodAt) return;
  const hours = (Date.now() - new Date(state.lastFoodAt).getTime()) / 36e5;
  const previous = state.boosts.fasting;
  if (hours < 12) state.boosts.fasting = 1;
  else if (hours >= 18) state.boosts.fasting = 1.18;
  else if (hours >= 16) state.boosts.fasting = 1.12;
  else state.boosts.fasting = 1.06;
  if (shouldAnnounce && state.boosts.fasting > previous) setStatus(`${hours.toFixed(1)}h fast`);
}

function combinedMultiplier() {
  return state.boosts.exercise * state.boosts.fasting;
}

function strongestBoost() {
  return state.boosts.fasting > state.boosts.exercise ? "fast" : "move";
}

function updateBoostClass(available) {
  els.app.classList.remove("boost-move", "boost-fast", "overdrawn");
  if (available < 0) {
    els.app.classList.add("overdrawn");
    return;
  }
  els.app.classList.add(`boost-${strongestBoost()}`);
}

function exerciseCreditFactor(intensity) {
  if (intensity === "vigorous") return 0.75;
  if (intensity === "moderate") return 0.65;
  return 0.55;
}

function mockFoodEstimate(text) {
  const lower = text.toLowerCase();
  const foods = [
    ["pizza", 760],
    ["burger", 680],
    ["fries", 420],
    ["salad", 320],
    ["eggs", 180],
    ["toast", 150],
    ["oatmeal", 290],
    ["coffee", 40],
    ["sandwich", 520],
    ["rice", 240],
    ["chicken", 380],
    ["pasta", 640],
    ["banana", 105],
    ["apple", 95]
  ];
  const matches = foods.filter(([name]) => lower.includes(name));
  return {
    title: matches.length ? titleCase(matches.map(([name]) => name).join(" + ")) : "Voice meal",
    calories: matches.length ? matches.reduce((sum, [, kcal]) => sum + kcal, 0) : 450,
    confidence: matches.length ? 0.72 : 0.42,
    eatenAt: parseMentionedTime(text) || new Date()
  };
}

function mockExerciseEstimate(text) {
  const lower = text.toLowerCase();
  const minutes = Number(lower.match(/(\d+)\s*(min|minute|minutes)/)?.[1] || 30);
  let title = "walk";
  let activeCalories = minutes * 3.6;
  let intensity = "light";
  if (lower.includes("run") || lower.includes("jog")) {
    title = "run";
    activeCalories = minutes * 9.8;
    intensity = "vigorous";
  } else if (lower.includes("bike") || lower.includes("cycle")) {
    title = "bike";
    activeCalories = minutes * 7.1;
    intensity = "moderate";
  } else if (lower.includes("lift") || lower.includes("weights")) {
    title = "lift";
    activeCalories = minutes * 4.6;
    intensity = "moderate";
  }
  return { title: `${minutes}m ${title}`, activeCalories, intensity };
}

function parseMentionedTime(text) {
  const match = text.match(/\b(?:at|around|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;
  return parseClockParts(match[1], match[2], match[3]);
}

function parseTimeString(value) {
  const match = String(value).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;
  return parseClockParts(match[1], match[2], match[3]);
}

function parseClockParts(hourValue, minuteValue, meridiemValue) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  const meridiem = meridiemValue?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function parseFastHours(text) {
  const match = text.match(/\b(?:fasted|fast|fasting)\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/i);
  return match ? Number(match[1]) : null;
}

function timeHHMM(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function titleCase(text) {
  return text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function foodKey(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 48);
}

function rememberFood(result) {
  const key = foodKey(result.title);
  if (!key) return;
  const previous = state.foodMemory?.[key];
  const count = previous ? previous.count + 1 : 1;
  const calories = previous
    ? Math.round((previous.calories * previous.count + result.calories) / count)
    : result.calories;
  state.foodMemory = {
    ...state.foodMemory,
    [key]: {
      title: result.title,
      calories,
      count,
      lastAt: new Date().toISOString()
    }
  };
}

function summarizeFoodMemory() {
  return Object.values(state.foodMemory || {})
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
    .slice(0, 12)
    .map(({ title, calories, count }) => ({ title, calories, count }));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showManualFallback(message) {
  setStatus(message);
  els.manualInput.classList.add("show");
  els.manualInput.focus();
  els.manualInput.select();
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function playBurst() {
  els.burst.classList.remove("play");
  void els.burst.offsetWidth;
  els.burst.classList.add("play");
}

async function loadState() {
  try {
    const decoded = await readStoredState();
    if (!decoded) return;
    Object.assign(state, decoded);
    state.boosts = {
      exercise: Number(state.boosts?.exercise) || 1,
      fasting: Number(state.boosts?.fasting) || 1
    };
    state.foodMemory = state.foodMemory || {};
    if (state.lastFoodAt) state.lastFoodAt = new Date(state.lastFoodAt);
    state.entries = (state.entries || []).map((entry) => ({
      ...entry,
      at: entry.at ? new Date(entry.at) : new Date()
    }));
  } catch (error) {
    setStatus("storage reset");
  }
}

async function saveState() {
  const snapshot = {
    savedAt: Date.now(),
    dailyBudget: state.dailyBudget,
    consumed: state.consumed,
    exerciseCredits: state.exerciseCredits,
    fastXp: state.fastXp,
    lastFoodAt: state.lastFoodAt,
    currentDay: state.currentDay,
    entries: state.entries.slice(0, 12),
    foodMemory: state.foodMemory,
    boosts: state.boosts
  };
  try {
    await writeStoredState(encodeSnapshot(snapshot));
  } catch (error) {
    setStatus("storage failed");
  }
}

async function readStoredState() {
  const encodedStates = [];

  if (window.creationStorage?.plain) {
    try {
      encodedStates.push(await window.creationStorage.plain.getItem(STORAGE_KEY));
    } catch (error) {
      // Continue to web storage fallbacks.
    }
  }

  if (typeof window.localStorage !== "undefined") {
    try {
      encodedStates.push(window.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      // Continue to cookie fallback.
    }
  }

  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${STORAGE_KEY}=([^;]*)`));
    encodedStates.push(match ? decodeURIComponent(match[1]) : null);
  } catch (error) {
    // No readable cookie.
  }

  const snapshots = encodedStates
    .filter(Boolean)
    .map(decodeSnapshot)
    .filter(Boolean)
    .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));

  return snapshots[0] || null;
}

async function writeStoredState(encodedState) {
  writeBrowserState(encodedState);

  if (typeof window.localStorage !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, encodedState);
    } catch (error) {
      // Continue to cookie fallback.
    }
  }

  if (window.creationStorage?.plain) {
    await window.creationStorage.plain.setItem(STORAGE_KEY, encodedState);
  }
}

function writeBrowserState(encodedState) {
  try {
    document.cookie = `${STORAGE_KEY}=${encodeURIComponent(encodedState)}; max-age=31536000; path=/; SameSite=Lax`;
  } catch (error) {
    // Cookies may be unavailable in some WebViews.
  }
}

function encodeSnapshot(snapshot) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(snapshot))));
}

function decodeSnapshot(encodedState) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(encodedState))));
  } catch (error) {
    try {
      return JSON.parse(atob(encodedState));
    } catch (innerError) {
      return null;
    }
  }
}

async function waitForStorageBridge() {
  if (window.creationStorage?.plain || typeof window.localStorage !== "undefined") return;
  const startedAt = Date.now();
  while (!window.creationStorage?.plain && Date.now() - startedAt < 1200) {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}
