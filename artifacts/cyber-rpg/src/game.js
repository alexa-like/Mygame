const SAVE_KEY = "cyber-rpg-save-v1";
const app = document.getElementById("app");

const defaultPlayer = () => ({
  name: "",
  money: 100,
  health: 100,
  maxHealth: 100,
  energy: 100,
  maxEnergy: 100,
  level: 1,
  xp: 0,
  log: [],
});

let state = loadGame() || defaultPlayer();

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.name) return null;
    return { ...defaultPlayer(), ...data };
  } catch {
    return null;
  }
}

function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  state = defaultPlayer();
  render();
}

function xpForNext(level) {
  return Math.round(50 * Math.pow(1.5, level - 1));
}

function pushLog(text, type = "info") {
  state.log.unshift({ text, type, t: Date.now() });
  if (state.log.length > 40) state.log.length = 40;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function checkLevelUp() {
  let leveled = false;
  while (state.xp >= xpForNext(state.level)) {
    state.xp -= xpForNext(state.level);
    state.level += 1;
    state.maxHealth += 10;
    state.maxEnergy += 5;
    state.health = state.maxHealth;
    state.energy = state.maxEnergy;
    pushLog(`>>> LEVEL UP! You are now level ${state.level}. Max HP/EN restored.`, "levelup");
    leveled = true;
  }
  return leveled;
}

// --- ACTIONS ---

function commitCrime() {
  if (state.energy < 10) {
    pushLog("Not enough energy to pull a job.", "fail");
    return render();
  }
  state.energy -= 10;
  const crimes = [
    "pickpocketing a corpo suit",
    "hacking an ATM",
    "boosting a hover-bike",
    "running a data heist",
    "shaking down a vendor",
    "raiding a back-alley clinic",
  ];
  const crime = crimes[Math.floor(Math.random() * crimes.length)];
  const successChance = 0.55 + Math.min(0.25, state.level * 0.02);
  const success = Math.random() < successChance;

  if (success) {
    const reward = Math.floor((20 + Math.random() * 60) * (1 + state.level * 0.2));
    const xpGain = Math.floor(10 + Math.random() * 15 + state.level * 2);
    state.money += reward;
    state.xp += xpGain;
    pushLog(`Pulled off ${crime}. +$${reward}, +${xpGain} XP.`, "success");
    checkLevelUp();
  } else {
    const dmg = Math.floor(8 + Math.random() * 18);
    state.health = clamp(state.health - dmg, 0, state.maxHealth);
    pushLog(`Got burned ${crime}. -${dmg} HP.`, "fail");
    if (state.health <= 0) handleDeath();
  }
  saveGame();
  render();
}

function workJob() {
  if (state.energy < 15) {
    pushLog("Too tired to work. Train or rest first.", "fail");
    return render();
  }
  state.energy -= 15;
  const pay = Math.floor((15 + Math.random() * 25) * (1 + state.level * 0.15));
  const xpGain = Math.floor(3 + Math.random() * 5);
  state.money += pay;
  state.xp += xpGain;
  pushLog(`Worked a shift at the noodle bar. +$${pay}, +${xpGain} XP.`, "reward");
  checkLevelUp();
  saveGame();
  render();
}

function healPaid() {
  const cost = 25;
  if (state.money < cost) {
    pushLog(`Need $${cost} for the ripperdoc. Not enough creds.`, "fail");
    return render();
  }
  if (state.health >= state.maxHealth) {
    pushLog("Already at full health.", "info");
    return render();
  }
  state.money -= cost;
  state.health = state.maxHealth;
  pushLog(`Visited the ripperdoc. -$${cost}. Fully healed.`, "success");
  saveGame();
  render();
}

function healFree() {
  if (state.health >= state.maxHealth) {
    pushLog("Already at full health.", "info");
    return render();
  }
  const heal = Math.floor(8 + Math.random() * 8);
  state.health = clamp(state.health + heal, 0, state.maxHealth);
  pushLog(`Patched yourself up in an alley. +${heal} HP.`, "info");
  saveGame();
  render();
}

function train() {
  if (state.energy >= state.maxEnergy && state.xp <= 0) {
    pushLog("Already maxed energy.", "info");
    return render();
  }
  // Train: restore some energy and earn small XP
  const energyGain = Math.floor(15 + Math.random() * 15);
  const xpGain = Math.floor(5 + Math.random() * 8);
  state.energy = clamp(state.energy + energyGain, 0, state.maxEnergy);
  state.xp += xpGain;
  pushLog(`Trained at the underground gym. +${energyGain} EN, +${xpGain} XP.`, "reward");
  checkLevelUp();
  saveGame();
  render();
}

function showStats() {
  renderModal(`
    <h2>Operative Profile</h2>
    <div class="detail-row"><span class="key">CALLSIGN</span><span class="val">${escapeHtml(state.name)}</span></div>
    <div class="detail-row"><span class="key">LEVEL</span><span class="val">${state.level}</span></div>
    <div class="detail-row"><span class="key">XP</span><span class="val">${state.xp} / ${xpForNext(state.level)}</span></div>
    <div class="detail-row"><span class="key">HEALTH</span><span class="val">${state.health} / ${state.maxHealth}</span></div>
    <div class="detail-row"><span class="key">ENERGY</span><span class="val">${state.energy} / ${state.maxEnergy}</span></div>
    <div class="detail-row"><span class="key">CREDITS</span><span class="val">$${state.money}</span></div>
    <div class="detail-row"><span class="key">STATUS</span><span class="val">${state.health <= 0 ? "DOWN" : "ACTIVE"}</span></div>
    <div class="btn-row">
      <button class="btn ghost" id="modal-close">Close</button>
      <button class="btn ghost" id="modal-reset" style="color: var(--neon-red); border-color: rgba(255,59,92,0.4);">Reset Save</button>
    </div>
  `);
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-reset").onclick = () => {
    if (confirm("Wipe your operative? This cannot be undone.")) {
      closeModal();
      resetGame();
    }
  };
}

function handleDeath() {
  pushLog("You bled out in the gutter. Reset and start fresh.", "fail");
  state.health = 1;
  state.money = Math.floor(state.money / 2);
}

// --- RENDER ---

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderStartScreen() {
  app.innerHTML = `
    <div class="start-screen">
      <h1 class="title">Neon Streets</h1>
      <div class="subtitle">// CYBER RPG // v1.0 //</div>
      <div class="panel" style="width: 100%; max-width: 420px;">
        <div class="panel-title">Create Operative</div>
        <div class="input-group">
          <input id="name-input" class="input" placeholder="ENTER CALLSIGN..." maxlength="20" autocomplete="off" />
          <button id="start-btn" class="btn">Jack In</button>
        </div>
      </div>
    </div>
  `;
  const input = document.getElementById("name-input");
  const btn = document.getElementById("start-btn");
  input.focus();
  const start = () => {
    const name = input.value.trim();
    if (!name) {
      input.style.borderColor = "var(--neon-red)";
      return;
    }
    state = defaultPlayer();
    state.name = name;
    pushLog(`${name} jacked into the grid. Welcome to Night City.`, "info");
    saveGame();
    render();
  };
  btn.onclick = start;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
}

function renderGame() {
  const xpNeed = xpForNext(state.level);
  app.innerHTML = `
    <div class="header">
      <h1 class="title" style="font-size: 24px; text-align: left; margin-bottom: 0;">Neon Streets</h1>
      <div class="player-name">${escapeHtml(state.name)}</div>
    </div>
    <div class="subtitle" style="text-align: left; margin-bottom: 20px;">// LEVEL ${state.level} OPERATIVE //</div>

    <div class="panel">
      <div class="panel-title">Vitals</div>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">Credits</div>
          <div class="stat-value money">$${state.money}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Level</div>
          <div class="stat-value level">${state.level}</div>
          <div class="bar"><div class="bar-fill xp" style="width: ${(state.xp / xpNeed) * 100}%"></div></div>
          <div class="stat-label" style="margin-top:4px;">${state.xp} / ${xpNeed} XP</div>
        </div>
        <div class="stat">
          <div class="stat-label">Health</div>
          <div class="stat-value health">${state.health}/${state.maxHealth}</div>
          <div class="bar"><div class="bar-fill health" style="width: ${(state.health / state.maxHealth) * 100}%"></div></div>
        </div>
        <div class="stat">
          <div class="stat-label">Energy</div>
          <div class="stat-value energy">${state.energy}/${state.maxEnergy}</div>
          <div class="bar"><div class="bar-fill energy" style="width: ${(state.energy / state.maxEnergy) * 100}%"></div></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Actions</div>
      <div class="actions">
        <button class="btn pink" id="act-crime" ${state.energy < 10 ? "disabled" : ""}>Commit Crime</button>
        <button class="btn green" id="act-work" ${state.energy < 15 ? "disabled" : ""}>Work Job</button>
        <button class="btn purple" id="act-train">Train</button>
        <button class="btn yellow" id="act-stats">Stats</button>
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="act-heal-paid" ${state.money < 25 || state.health >= state.maxHealth ? "disabled" : ""}>Ripperdoc Heal ($25)</button>
        <button class="btn ghost" id="act-heal-free" ${state.health >= state.maxHealth ? "disabled" : ""}>Patch Up (Free)</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Activity Log</div>
      <div class="log" id="log">
        ${state.log.map(l => `<div class="log-entry ${l.type}">${escapeHtml(l.text)}</div>`).join("") || '<div class="log-entry info">No activity yet. Get to work, choom.</div>'}
      </div>
    </div>
  `;

  document.getElementById("act-crime").onclick = commitCrime;
  document.getElementById("act-work").onclick = workJob;
  document.getElementById("act-train").onclick = train;
  document.getElementById("act-stats").onclick = showStats;
  document.getElementById("act-heal-paid").onclick = healPaid;
  document.getElementById("act-heal-free").onclick = healFree;
}

function renderModal(html) {
  let backdrop = document.getElementById("modal-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "modal-backdrop";
    backdrop.className = "modal-backdrop";
    document.body.appendChild(backdrop);
  }
  backdrop.innerHTML = `<div class="modal">${html}</div>`;
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
}

function closeModal() {
  const b = document.getElementById("modal-backdrop");
  if (b) b.remove();
}

function render() {
  if (!state.name) renderStartScreen();
  else renderGame();
}

render();
