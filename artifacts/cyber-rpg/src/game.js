import {
  api, getToken, setToken,
  connectWs, disconnectWs, onWs, getOnlineIds,
  sendWorldMsg, sendPrivateMsg,
} from "./api.js";

const app = document.getElementById("app");

const AVATARS = ["cyan", "pink", "purple", "green", "yellow", "red"];
const HOME_CITY = "neo_torin";

const state = {
  me: null,
  gear: { weapon: null, armor: null },
  tab: "home",
  log: [],
  players: [],
  cities: [],
  worldMessages: [],
  privateThreads: {},
  unread: { world: 0, private: {} },
  activeChat: "world",
  viewingProfileId: null,
  authMode: "login",
  authError: "",
  online: new Set(),
  // tab data caches
  crimes: [],
  jobs: [],
  missions: [],
  shop: { city: null, stock: [] },
  inventory: [],
  viewedPlayer: null,
  selectedAction: null, // for "next action" suggestion
};

let countdownTimer = null;

// --- Helpers ---
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString(); }
function fmtSecs(s) {
  if (s <= 0) return "0s";
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
function avatarHtml(avatarKey, name, size = "") {
  const initial = (name || "?").slice(0, 2).toUpperCase();
  return `<div class="avatar ${size} ${avatarKey || "purple"}">${escapeHtml(initial)}</div>`;
}
function pushLog(text, type = "info") {
  state.log.unshift({ text, type, t: Date.now() });
  if (state.log.length > 30) state.log.length = 30;
}
function xpForNext(level) { return Math.round(80 * Math.pow(1.45, level - 1)); }
function cityName(id) { return state.cities.find(c => c.id === id)?.name || id; }
function cityFlag(id) { return state.cities.find(c => c.id === id)?.flag || ""; }
function diffClass(d) { return `diff-${d}`; }

function showToast(text, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = text;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; }, 3000);
  setTimeout(() => t.remove(), 3400);
}

// --- Boot ---
async function boot() {
  if (getToken()) {
    try {
      const r = await api.me();
      state.me = r.user;
      state.gear = r.gear || { weapon: null, armor: null };
      const cities = await api.cities();
      state.cities = cities.cities;
      connectWs();
      await loadInitialData();
    } catch {
      setToken("");
      state.me = null;
    }
  }
  startCountdownLoop();
  render();
}

async function loadInitialData() {
  const [players, world] = await Promise.all([
    api.players().catch(() => ({ players: [] })),
    api.worldChat().catch(() => ({ messages: [] })),
  ]);
  state.players = players.players;
  state.worldMessages = world.messages;
}

async function refreshMe() {
  try {
    const r = await api.me();
    state.me = r.user;
    state.gear = r.gear || { weapon: null, armor: null };
  } catch {}
}

// --- Countdown timer for status (travel, hospital, jail) and regen UI ---
function startCountdownLoop() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (!state.me) return;
    const els = document.querySelectorAll("[data-countdown-to]");
    let needsRefresh = false;
    els.forEach((el) => {
      const target = Number(el.dataset.countdownTo);
      const remain = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      el.textContent = fmtSecs(remain);
      if (remain === 0) needsRefresh = true;
    });
    if (needsRefresh) refreshAndRerender();
  }, 1000);
}

async function refreshAndRerender() {
  await refreshMe();
  render();
}

// --- WS handler ---
onWs((evt) => {
  if (evt.kind === "world_msg") {
    state.worldMessages.push(evt.message);
    if (state.tab !== "chat" || state.activeChat !== "world") state.unread.world += 1;
    if (state.tab === "chat" && state.activeChat === "world") scrollChatToBottom();
    render();
  } else if (evt.kind === "private_msg") {
    const otherId = evt.message.fromUserId === state.me?.id ? evt.message.toUserId : evt.message.fromUserId;
    if (!state.privateThreads[otherId]) state.privateThreads[otherId] = [];
    state.privateThreads[otherId].push(evt.message);
    if (evt.message.fromUserId !== state.me?.id) {
      if (state.tab !== "chat" || state.activeChat !== otherId) {
        state.unread.private[otherId] = (state.unread.private[otherId] || 0) + 1;
        const sender = state.players.find(p => p.id === otherId);
        showToast(`DM from ${sender?.username || "someone"}`, "info");
      }
    }
    if (state.tab === "chat" && state.activeChat === otherId) scrollChatToBottom();
    render();
  } else if (evt.kind === "online") {
    state.online = getOnlineIds();
    render();
  } else if (evt.kind === "auth_ok") {
    state.online = getOnlineIds();
    render();
  }
});

function scrollChatToBottom() {
  setTimeout(() => {
    const el = document.getElementById("chat-messages");
    if (el) el.scrollTop = el.scrollHeight;
  }, 30);
}

// --- AUTH ---
function renderAuth() {
  app.innerHTML = `
    <div class="auth-screen">
      <h1 class="title">Neon Streets</h1>
      <div class="subtitle">// MULTIPLAYER CYBER RPG //</div>
      <div class="panel auth-card">
        <div class="auth-toggle">
          <button class="${state.authMode === 'login' ? 'active' : ''}" data-mode="login">Sign In</button>
          <button class="${state.authMode === 'register' ? 'active' : ''}" data-mode="register">Register</button>
        </div>
        <div class="field">
          <label class="label">Callsign</label>
          <input class="input" id="auth-username" placeholder="3-20 chars" maxlength="20" autocomplete="username" />
        </div>
        <div class="field">
          <label class="label">PIN (4-8 digits)</label>
          <input class="input" id="auth-pin" type="password" inputmode="numeric" placeholder="••••" maxlength="8" autocomplete="${state.authMode === 'login' ? 'current-password' : 'new-password'}" />
        </div>
        <button class="btn" id="auth-submit" style="width: 100%;">${state.authMode === 'login' ? 'Jack In' : 'Create Operative'}</button>
        <div class="error-msg">${escapeHtml(state.authError)}</div>
      </div>
    </div>
  `;
  app.querySelectorAll(".auth-toggle button").forEach(b => {
    b.onclick = () => { state.authMode = b.dataset.mode; state.authError = ""; render(); };
  });
  const submit = async () => {
    const username = document.getElementById("auth-username").value.trim();
    const pin = document.getElementById("auth-pin").value.trim();
    if (!username || !pin) { state.authError = "Username and PIN required."; render(); return; }
    state.authError = "";
    try {
      const { user } = state.authMode === 'login'
        ? await api.login(username, pin)
        : await api.register(username, pin);
      setToken(user.token);
      state.me = user;
      const cities = await api.cities();
      state.cities = cities.cities;
      connectWs();
      await loadInitialData();
      state.tab = "home";
      pushLog(`${user.username} jacked into the grid.`, "info");
      render();
    } catch (e) { state.authError = e.message; render(); }
  };
  document.getElementById("auth-submit").onclick = submit;
  ["auth-username", "auth-pin"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  });
  document.getElementById("auth-username").focus();
}

// --- Status banner ---
function statusBanner() {
  const me = state.me;
  if (!me?.status || me.status.kind === "ok") return "";
  const s = me.status;
  const target = new Date(s.until).getTime();
  if (s.kind === "traveling") {
    return `<div class="status-banner travel">
      <span>✈️ Traveling ${cityFlag(s.from)} → ${cityFlag(s.to)} ${escapeHtml(cityName(s.to))}</span>
      <span>arrives in <b data-countdown-to="${target}">${fmtSecs(Math.ceil((target-Date.now())/1000))}</b></span>
    </div>`;
  }
  if (s.kind === "hospital") {
    return `<div class="status-banner hospital">
      <span>🏥 Hospitalized</span>
      <span>discharge in <b data-countdown-to="${target}">${fmtSecs(Math.ceil((target-Date.now())/1000))}</b></span>
      <button class="btn ghost sm" id="bust-btn">Pay Discharge</button>
    </div>`;
  }
  if (s.kind === "jail") {
    return `<div class="status-banner jail">
      <span>🚨 In Jail</span>
      <span>released in <b data-countdown-to="${target}">${fmtSecs(Math.ceil((target-Date.now())/1000))}</b></span>
    </div>`;
  }
  return "";
}

// --- TOPBAR ---
function topbarHtml() {
  const me = state.me;
  return `
    <div class="topbar">
      <div class="brand">
        <div class="title" style="font-size: 22px;">Neon Streets</div>
        <div class="subtitle">${cityFlag(me.location)} ${escapeHtml(cityName(me.location))} · L${me.level}</div>
      </div>
      <div class="me">
        ${avatarHtml(me.avatar, me.username)}
        <div>
          <div class="who">${escapeHtml(me.username)}</div>
          <div class="mini-stats">
            <span class="m">$<b>${me.money.toLocaleString()}</b></span>
            <span class="r">RES<b>${me.respect}</b></span>
          </div>
        </div>
        <button class="btn ghost sm" id="logout-btn">Logout</button>
      </div>
    </div>
  `;
}

// --- Vitals bars (always visible) ---
function vitalsBarsHtml() {
  const me = state.me;
  const xpNeed = xpForNext(me.level);
  return `
    <div class="vitals-row">
      ${vitalBar("HP", me.health, me.maxHealth, "health")}
      ${vitalBar("EN", me.energy, me.maxEnergy, "energy")}
      ${vitalBar("NRV", me.nerve, me.maxNerve, "nerve")}
      ${vitalBar("HPY", me.happy, me.maxHappy, "happy")}
      ${vitalBar("XP", me.xp, xpNeed, "xp")}
    </div>
  `;
}
function vitalBar(label, val, max, cls) {
  const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
  return `
    <div class="vital">
      <div class="vital-label"><span>${label}</span><span>${Math.floor(val)}/${max}</span></div>
      <div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
    </div>
  `;
}

// --- TABS ---
function tabsHtml() {
  const totalPrivateUnread = Object.values(state.unread.private).reduce((a, b) => a + b, 0);
  const tabs = [
    { id: "home",     label: "Home" },
    { id: "crimes",   label: "Crimes" },
    { id: "gym",      label: "Gym" },
    { id: "jobs",     label: "Jobs" },
    { id: "missions", label: "Missions" },
    { id: "travel",   label: "Travel" },
    { id: "items",    label: "Items" },
    { id: "chat",     label: "Chat", badge: (state.unread.world + totalPrivateUnread) || null },
    { id: "players",  label: "Players" },
    { id: "profile",  label: "Profile" },
  ];
  return `
    <div class="tabs">
      ${tabs.map(t => `
        <button class="tab ${state.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
          ${t.label}${t.badge ? `<span class="badge">${t.badge}</span>` : ''}
        </button>
      `).join("")}
    </div>
  `;
}

// --- HOME ---
function renderHome() {
  const me = state.me;
  const xpNeed = xpForNext(me.level);
  return `
    <div class="panel">
      <div class="panel-title">Vitals</div>
      <div class="stats-grid">
        <div class="stat"><div class="stat-label">Credits</div><div class="stat-value money">$${me.money.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Level</div><div class="stat-value level">${me.level}</div></div>
        <div class="stat"><div class="stat-label">Respect</div><div class="stat-value pink" style="color:var(--neon-pink)">${me.respect}</div></div>
        <div class="stat"><div class="stat-label">Location</div><div class="stat-value">${cityFlag(me.location)} ${escapeHtml(cityName(me.location))}</div></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Battle Stats</div>
      <div class="stats-grid">
        <div class="stat"><div class="stat-label">Strength</div><div class="stat-value pink" style="color:var(--neon-pink)">${me.strength.toFixed(1)}</div></div>
        <div class="stat"><div class="stat-label">Defense</div><div class="stat-value energy">${me.defense.toFixed(1)}</div></div>
        <div class="stat"><div class="stat-label">Speed</div><div class="stat-value">${me.speed.toFixed(1)}</div></div>
        <div class="stat"><div class="stat-label">Dexterity</div><div class="stat-value level">${me.dexterity.toFixed(1)}</div></div>
      </div>
      <div class="row" style="margin-top:12px; gap:12px; flex-wrap:wrap;">
        <div class="muted small">Weapon: <b style="color:var(--neon-pink)">${state.gear.weapon ? escapeHtml(state.gear.weapon.name) + ` (+${state.gear.weapon.attackPower} ATK)` : 'unarmed'}</b></div>
        <div class="muted small">Armor: <b style="color:var(--neon-purple)">${state.gear.armor ? escapeHtml(state.gear.armor.name) + ` (+${state.gear.armor.defensePower} DEF)` : 'unarmored'}</b></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Quick Actions</div>
      <div class="actions">
        <button class="btn pink" data-go="crimes">🔪 Crimes</button>
        <button class="btn purple" data-go="gym">💪 Gym</button>
        <button class="btn green" data-go="jobs">💼 Jobs</button>
        <button class="btn yellow" data-go="missions">🎯 Missions</button>
        <button class="btn orange" data-go="travel">✈️ Travel</button>
        <button class="btn ghost" data-act="heal" ${me.money < 50 + me.level * 10 || me.health >= me.maxHealth ? 'disabled' : ''}>🏥 Heal ($${50 + me.level * 10})</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Activity Log</div>
      <div class="log" id="log">
        ${state.log.length
          ? state.log.map(l => `<div class="log-entry ${l.type}">${escapeHtml(l.text)}</div>`).join("")
          : '<div class="log-entry info">No activity yet. Get to work, choom.</div>'}
      </div>
    </div>
  `;
}

async function doSimpleAction(act) {
  try {
    let r;
    if (act === "heal") r = await api.heal();
    else if (act === "bust") r = await api.bustHospital();
    else return;
    handleResult(r);
  } catch (e) { showToast(e.message, "fail"); }
}

function handleResult(r) {
  state.me = r.user;
  pushLog(r.message, r.type);
  if (r.leveled) {
    pushLog(`>>> LEVEL UP! Now level ${r.user.level}.`, "levelup");
    showToast(`LEVEL UP! → ${r.user.level}`, "levelup");
  }
  showToast(r.message, r.type);
  render();
}

// --- CRIMES ---
async function loadCrimes() { try { state.crimes = (await api.crimes()).crimes; } catch {} }
function renderCrimes() {
  const me = state.me;
  if (me.location !== HOME_CITY) {
    return `<div class="panel"><div class="muted">You can only run crimes in Neo-Torin. Travel home first.</div></div>`;
  }
  return `
    <div class="panel">
      <div class="panel-title">Crime Catalog
        <span class="spacer"></span>
        <span class="muted small">Nerve: <b style="color:var(--neon-cyan)">${me.nerve}/${me.maxNerve}</b></span>
      </div>
      <div class="crime-list">
        ${state.crimes.map(c => {
          const locked = me.level < c.levelReq;
          const noNerve = me.nerve < c.nerveCost;
          return `
            <div class="crime-card ${locked ? 'locked' : ''}">
              <div class="head">
                <div>
                  <h3>${escapeHtml(c.name)}</h3>
                  <div class="muted small">${escapeHtml(c.description)}</div>
                </div>
                <button class="btn pink sm" data-crime="${c.id}" ${locked || noNerve ? 'disabled' : ''}>Commit</button>
              </div>
              <div class="meta">
                <span>Lvl <b>${c.levelReq}</b></span>
                <span>Nerve <b style="color:var(--neon-cyan)">${c.nerveCost}</b></span>
                <span>Reward <b style="color:var(--neon-green)">$${c.moneyMin}-$${c.moneyMax}</b></span>
                <span>XP <b style="color:var(--neon-yellow)">+${c.xpReward}</b></span>
                <span>Success <b>${Math.round(c.baseSuccess*100)}%</b></span>
                ${locked ? `<span class="muted">🔒 Requires Lvl ${c.levelReq}</span>` : ''}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}
async function doCrime(id) {
  try { handleResult(await api.doCrime(id)); }
  catch (e) { showToast(e.message, "fail"); }
}

// --- GYM ---
function renderGym() {
  const me = state.me;
  const stats = [
    { id: "strength",  label: "Strength",  desc: "Raw hitting power.",   color: "pink" },
    { id: "defense",   label: "Defense",   desc: "Damage reduction.",     color: "purple" },
    { id: "speed",     label: "Speed",     desc: "Hit harder, dodge more.", color: "cyan" },
    { id: "dexterity", label: "Dexterity", desc: "Crit & stealth.",       color: "yellow" },
  ];
  return `
    <div class="panel">
      <div class="panel-title">Gym
        <span class="spacer"></span>
        <span class="muted small">Energy: <b style="color:var(--neon-purple)">${me.energy}/${me.maxEnergy}</b> · Happy: <b style="color:var(--neon-yellow)">${me.happy}/${me.maxHappy}</b></span>
      </div>
      <div class="muted small" style="margin-bottom:14px;">Each train costs <b>5 energy</b> + <b>5 happy</b>. Higher happy = bigger gains. Buy Mood Pills to keep happy up.</div>
      <div class="gym-grid">
        ${stats.map(s => `
          <div class="gym-card">
            <div class="gym-stat-label">${s.label}</div>
            <div class="gym-stat-val ${s.color}">${me[s.id].toFixed(1)}</div>
            <div class="muted small" style="margin: 6px 0 12px;">${s.desc}</div>
            <button class="btn ${s.color} sm" data-gym="${s.id}" ${me.energy < 5 || me.happy < 1 ? 'disabled' : ''}>Train +1</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}
async function doGym(stat) {
  try { handleResult(await api.gym(stat)); }
  catch (e) { showToast(e.message, "fail"); }
}

// --- JOBS ---
async function loadJobs() { try { state.jobs = (await api.jobs()).jobs; } catch {} }
function renderJobs() {
  const me = state.me;
  if (me.location !== HOME_CITY) {
    return `<div class="panel"><div class="muted">Jobs are only available in Neo-Torin.</div></div>`;
  }
  return `
    <div class="panel">
      <div class="panel-title">Job Board</div>
      <div class="job-list">
        ${state.jobs.map(j => `
          <div class="job-card">
            <div>
              <h3>${escapeHtml(j.name)}</h3>
              <div class="muted small">${escapeHtml(j.description)}</div>
              <div class="meta" style="margin-top:8px;">
                <span>EN <b style="color:var(--neon-purple)">-${j.energyCost}</b></span>
                <span>Pay <b style="color:var(--neon-green)">~$${Math.round(j.basePay * (1 + me.level * 0.12))}</b></span>
                <span>XP <b style="color:var(--neon-yellow)">+${j.baseXp}</b></span>
              </div>
            </div>
            <button class="btn green sm" data-job="${j.id}" ${me.energy < j.energyCost ? 'disabled' : ''}>Work</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}
async function doJob(id) {
  try { handleResult(await api.doJob(id)); }
  catch (e) { showToast(e.message, "fail"); }
}

// --- MISSIONS ---
async function loadMissions() { try { state.missions = (await api.missions()).missions; } catch {} }
function renderMissions() {
  return `
    <div class="panel">
      <div class="panel-title">Active Missions
        <span class="spacer"></span>
        <button class="btn ghost sm" id="refresh-missions">Refresh</button>
      </div>
      ${state.missions.length === 0
        ? '<div class="muted" style="text-align:center; padding: 20px;">No missions available. Refresh to pull new contracts.</div>'
        : state.missions.map(m => `
          <div class="mission-card">
            <div class="head">
              <div>
                <h3>${escapeHtml(m.title)}</h3>
                <div class="muted small" style="margin-top:4px;">Difficulty: <span class="diff-${m.difficulty}">${m.difficulty.toUpperCase()}</span></div>
              </div>
            </div>
            <div class="desc">${escapeHtml(m.description)}</div>
            <div class="meta">
              <span class="energy">EN <b>-${m.energyCost}</b></span>
              <span class="money">REWARD <b>$${m.moneyReward}</b></span>
              <span class="xp">XP <b>+${m.xpReward}</b></span>
            </div>
            <div class="mission-actions">
              <button class="btn sm" data-mission="${m.id}" ${state.me.energy < m.energyCost ? 'disabled' : ''}>Accept</button>
            </div>
          </div>
        `).join("")
      }
    </div>
  `;
}
async function takeMission(id) {
  try {
    const r = await api.completeMission(id);
    state.missions = r.missions;
    handleResult(r);
  } catch (e) { showToast(e.message, "fail"); }
}
async function refreshMissions() {
  try { state.missions = (await api.refreshMissions()).missions; render(); }
  catch (e) { showToast(e.message, "fail"); }
}

// --- TRAVEL ---
function renderTravel() {
  const me = state.me;
  const here = me.location;
  return `
    <div class="panel">
      <div class="panel-title">Travel Hub
        <span class="spacer"></span>
        <span class="muted small">Currently in: <b>${cityFlag(here)} ${escapeHtml(cityName(here))}</b></span>
      </div>
      <div class="city-grid">
        ${state.cities.map(c => {
          const here2 = c.id === here;
          const cost = here === HOME_CITY ? c.travelCost : Math.floor((state.cities.find(x => x.id === here)?.travelCost || 0) * 0.5);
          const secs = here === HOME_CITY ? c.travelSeconds : (state.cities.find(x => x.id === here)?.travelSeconds || 0);
          const canTravel = !here2 && me.status?.kind === "ok"
            && ((here === HOME_CITY) || c.id === HOME_CITY);
          return `
            <div class="city-card ${here2 ? 'here' : ''}">
              <div class="city-flag">${c.flag}</div>
              <div class="city-name">${escapeHtml(c.name)}</div>
              ${here2 ? '<div class="muted small">You are here</div>' :
                c.id === HOME_CITY ? `<div class="muted small">Home base</div>` :
                `<div class="muted small">${secs}s · $${cost}</div>`}
              ${canTravel ? `<button class="btn orange sm" data-travel="${c.id}" style="margin-top:8px;">${c.id === HOME_CITY ? 'Return Home' : 'Fly'}</button>` : ''}
            </div>
          `;
        }).join("")}
      </div>
      ${here !== HOME_CITY ? '<div class="muted small" style="margin-top:12px;">Note: You must return to Neo-Torin before flying to another city.</div>' : ''}
    </div>
  `;
}
async function doTravel(city) {
  try { handleResult(await api.travel(city)); }
  catch (e) { showToast(e.message, "fail"); }
}

// --- ITEMS / SHOP / INVENTORY ---
async function loadItemsTab() {
  try {
    const [shop, inv] = await Promise.all([api.shop(), api.inventory()]);
    state.shop = shop;
    state.inventory = inv.inventory;
  } catch {}
}
function renderItems() {
  const me = state.me;
  return `
    <div class="panel">
      <div class="panel-title">Shop · ${cityFlag(me.location)} ${escapeHtml(cityName(me.location))}</div>
      ${state.shop.stock.length === 0
        ? '<div class="muted">Nothing for sale here.</div>'
        : `<div class="item-list">
          ${state.shop.stock.map(it => `
            <div class="item-row">
              <div class="item-icon ${it.category}">${itemIcon(it.category)}</div>
              <div class="info">
                <div class="row" style="gap:8px;"><b>${escapeHtml(it.name)}</b> <span class="cat-${it.category}">${it.category.toUpperCase()}</span></div>
                <div class="muted small">${escapeHtml(it.description)}</div>
                ${it.attackPower ? `<div class="small" style="color:var(--neon-pink)">+${it.attackPower} ATK</div>` : ''}
                ${it.defensePower ? `<div class="small" style="color:var(--neon-purple)">+${it.defensePower} DEF</div>` : ''}
                ${it.effect ? `<div class="small" style="color:var(--neon-green)">+${it.effect.amount} ${it.effect.stat.toUpperCase()}</div>` : ''}
              </div>
              <div style="text-align:right;">
                <div style="color:var(--neon-green); font-family: 'Orbitron'; font-weight:700;">$${it.buyPrice.toLocaleString()}</div>
                <button class="btn sm" data-buy="${it.id}" ${me.money < it.buyPrice ? 'disabled' : ''}>Buy</button>
              </div>
            </div>
          `).join("")}
        </div>`
      }
    </div>

    <div class="panel">
      <div class="panel-title">Your Inventory</div>
      ${state.inventory.length === 0
        ? '<div class="muted">Empty. Buy something.</div>'
        : `<div class="item-list">
          ${state.inventory.map(r => {
            const it = r.item;
            if (!it) return '';
            const sellPrice = state.shop.stock.find(s => s.id === it.id)?.sellPrice
              ?? Math.floor((it.basePrice || 0) * 0.5);
            return `
              <div class="item-row">
                <div class="item-icon ${it.category}">${itemIcon(it.category)}</div>
                <div class="info">
                  <div class="row" style="gap:8px;"><b>${escapeHtml(it.name)}</b> <span class="cat-${it.category}">${it.category.toUpperCase()}</span> <span class="muted">×${r.quantity}</span></div>
                  <div class="muted small">${escapeHtml(it.description)}</div>
                  ${it.attackPower ? `<div class="small" style="color:var(--neon-pink)">+${it.attackPower} ATK</div>` : ''}
                  ${it.defensePower ? `<div class="small" style="color:var(--neon-purple)">+${it.defensePower} DEF</div>` : ''}
                  ${it.effect ? `<div class="small" style="color:var(--neon-green)">+${it.effect.amount} ${it.effect.stat.toUpperCase()}</div>` : ''}
                </div>
                <div style="text-align:right; display:flex; flex-direction:column; gap:4px;">
                  ${it.category === 'consumable' ? `<button class="btn green sm" data-use="${it.id}">Use</button>` : ''}
                  <button class="btn ghost sm" data-sell="${it.id}">Sell $${sellPrice.toLocaleString()}</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>`
      }
    </div>
  `;
}
function itemIcon(cat) {
  return cat === "weapon" ? "⚔️" : cat === "armor" ? "🛡️" : cat === "consumable" ? "💊" : "📦";
}
async function doBuy(id) {
  try { handleResult(await api.buy(id, 1)); await loadItemsTab(); render(); }
  catch (e) { showToast(e.message, "fail"); }
}
async function doSell(id) {
  try { handleResult(await api.sell(id, 1)); await loadItemsTab(); render(); }
  catch (e) { showToast(e.message, "fail"); }
}
async function doUse(id) {
  try { handleResult(await api.useItem(id)); await loadItemsTab(); render(); }
  catch (e) { showToast(e.message, "fail"); }
}

// --- CHAT ---
async function openChat(channel) {
  state.activeChat = channel;
  if (channel === "world") state.unread.world = 0;
  else {
    state.unread.private[channel] = 0;
    if (!state.privateThreads[channel]) {
      try { state.privateThreads[channel] = (await api.privateChat(channel)).messages; } catch {}
    }
  }
  render();
  scrollChatToBottom();
}
function renderChat() {
  const channels = state.players.filter(p => p.id !== state.me.id);
  const activeIsWorld = state.activeChat === "world";
  const activeUser = !activeIsWorld ? state.players.find(p => p.id === state.activeChat) : null;
  const messages = activeIsWorld ? state.worldMessages : (state.privateThreads[state.activeChat] || []);
  return `
    <div class="chat-layout">
      <div class="chat-sidebar">
        <div class="chat-section-label">Channels</div>
        <div class="chat-channel ${activeIsWorld ? 'active' : ''}" data-channel="world">
          <span># World</span>
          ${state.unread.world ? `<span class="badge-pink">${state.unread.world}</span>` : ''}
        </div>
        <div class="chat-section-label">Direct Messages</div>
        ${channels.length === 0 ? '<div class="muted small" style="padding:10px;">No other operatives yet.</div>' : ''}
        ${channels.map(p => `
          <div class="chat-channel ${state.activeChat === p.id ? 'active' : ''} ${state.online.has(p.id) ? 'online' : ''}" data-channel="${p.id}">
            <span class="row" style="gap:8px;"><span class="dot"></span>${escapeHtml(p.username)}</span>
            ${state.unread.private[p.id] ? `<span class="badge-pink">${state.unread.private[p.id]}</span>` : ''}
          </div>
        `).join("")}
      </div>
      <div class="chat-main">
        <div class="chat-header">${activeIsWorld ? '# WORLD CHAT' : `▸ DM with ${escapeHtml(activeUser?.username || "?")}`}</div>
        <div class="chat-messages" id="chat-messages">
          ${messages.length === 0 ? '<div class="chat-empty">No messages yet. Say something.</div>' :
            messages.map(m => `
              <div class="chat-msg ${m.fromUserId === state.me.id ? 'mine' : ''}">
                <span class="author" data-profile="${m.fromUserId}">${escapeHtml(m.fromUsername || "?")}</span>
                <span class="body">${escapeHtml(m.content)}</span>
                <span class="spacer"></span>
                <span class="time">${fmtTime(m.createdAt)}</span>
              </div>
            `).join("")}
        </div>
        <div class="chat-input-row">
          <input class="input" id="chat-input" placeholder="${activeIsWorld ? 'Broadcast to the world...' : 'Send a private message...'}" maxlength="500" />
          <button class="btn" id="chat-send">Send</button>
        </div>
      </div>
    </div>
  `;
}
function setupChatHandlers() {
  app.querySelectorAll("[data-channel]").forEach(el => { el.onclick = () => openChat(el.dataset.channel); });
  app.querySelectorAll("[data-profile]").forEach(el => {
    el.onclick = () => openProfile(el.dataset.profile);
  });
  const input = document.getElementById("chat-input");
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    if (state.activeChat === "world") sendWorldMsg(text);
    else sendPrivateMsg(state.activeChat, text);
    input.value = "";
  };
  if (input) {
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    document.getElementById("chat-send").onclick = send;
    input.focus();
  }
  scrollChatToBottom();
}

// --- PLAYERS ---
function renderPlayers() {
  return `
    <div class="panel">
      <div class="panel-title">Operatives
        <span class="spacer"></span>
        <span class="muted small">${state.players.length} total · ${state.online.size} online</span>
      </div>
      <div class="player-list">
        ${state.players.map(p => `
          <div class="player-row" data-profile="${p.id}">
            ${avatarHtml(p.avatar, p.username)}
            <div class="info">
              <div class="row" style="gap:8px;">
                <span class="online-badge ${state.online.has(p.id) ? 'on' : ''}"></span>
                <span class="name">${escapeHtml(p.username)}</span>
                ${p.id === state.me.id ? '<span class="muted small">(you)</span>' : ''}
                <span class="muted small">${cityFlag(p.location)}</span>
              </div>
              <div class="stats">$${p.money.toLocaleString()} · ${p.respect} respect · ${p.attacksWon}W/${p.attacksLost}L</div>
            </div>
            <div class="lvl">L${p.level}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

async function openProfile(id) {
  state.viewingProfileId = id;
  state.tab = "profile-view";
  try {
    state.viewedPlayer = (await api.player(id)).player;
  } catch { state.viewedPlayer = null; }
  render();
}

// --- PROFILE (mine) ---
function renderMyProfile() {
  const me = state.me;
  return `
    <div class="panel">
      <div class="panel-title">Edit Profile</div>
      <div class="profile-header">
        ${avatarHtml(me.avatar, me.username, "lg")}
        <div class="info">
          <h2>${escapeHtml(me.username)}</h2>
          <div class="lvl-text">LEVEL ${me.level} · ${me.xp}/${xpForNext(me.level)} XP</div>
          <div class="joined">Joined ${fmtDate(me.createdAt)}</div>
        </div>
      </div>

      <div style="margin-top: 24px;">
        <label class="label">Avatar</label>
        <div class="avatar-picker" id="avatar-picker">
          ${AVATARS.map(a => `<div class="avatar ${a} ${me.avatar === a ? 'selected' : ''}" data-avatar="${a}">${(me.username||"?").slice(0,2).toUpperCase()}</div>`).join("")}
        </div>
      </div>

      <div style="margin-top: 20px;">
        <label class="label">Bio (max 280 chars)</label>
        <textarea class="input" id="bio-input" rows="4" maxlength="280" placeholder="Tell other operatives about yourself...">${escapeHtml(me.bio)}</textarea>
      </div>

      <div style="margin-top: 16px;" class="row">
        <button class="btn" id="save-profile">Save Profile</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Career Stats</div>
      <div class="stats-grid">
        <div class="stat"><div class="stat-label">Crimes</div><div class="stat-value pink" style="color:var(--neon-pink)">${me.crimesCommitted}</div></div>
        <div class="stat"><div class="stat-label">Missions</div><div class="stat-value level">${me.missionsCompleted}</div></div>
        <div class="stat"><div class="stat-label">Attacks Won</div><div class="stat-value money">${me.attacksWon}</div></div>
        <div class="stat"><div class="stat-label">Attacks Lost</div><div class="stat-value health">${me.attacksLost}</div></div>
        <div class="stat"><div class="stat-label">Respect</div><div class="stat-value pink" style="color:var(--neon-pink)">${me.respect}</div></div>
        <div class="stat"><div class="stat-label">Net Worth</div><div class="stat-value money">$${me.money.toLocaleString()}</div></div>
      </div>
    </div>
  `;
}
function setupMyProfileHandlers() {
  app.querySelectorAll("[data-avatar]").forEach(el => {
    el.onclick = async () => {
      try {
        const { user } = await api.updateMe({ avatar: el.dataset.avatar });
        state.me = user; render();
      } catch (e) { showToast(e.message, "fail"); }
    };
  });
  document.getElementById("save-profile").onclick = async () => {
    const bio = document.getElementById("bio-input").value;
    try {
      const { user } = await api.updateMe({ bio });
      state.me = user;
      showToast("Profile saved.", "success");
      render();
    } catch (e) { showToast(e.message, "fail"); }
  };
}

// --- PROFILE VIEW (other player) ---
function renderViewProfile() {
  const p = state.viewedPlayer;
  if (!p) return `<div class="panel"><div class="muted">Loading profile…</div></div>`;
  const isMe = p.id === state.me.id;
  const sameCity = p.location === state.me.location;
  const targetStatus = p.status?.kind || "ok";
  const canAttack = !isMe && sameCity && targetStatus === "ok" && state.me.status?.kind === "ok" && state.me.energy >= 25;
  return `
    <div class="panel">
      <div class="row" style="margin-bottom:12px;">
        <button class="btn ghost sm" id="back-btn">← Back</button>
      </div>
      <div class="profile-header">
        ${avatarHtml(p.avatar, p.username, "lg")}
        <div class="info">
          <h2>${escapeHtml(p.username)} ${state.online.has(p.id) ? '<span class="online-badge on" style="display:inline-block; vertical-align:middle;"></span>' : ''}</h2>
          <div class="lvl-text">LEVEL ${p.level} · ${p.respect} respect</div>
          <div class="joined">${cityFlag(p.location)} ${escapeHtml(cityName(p.location))} · ${targetStatus !== "ok" ? `${targetStatus.toUpperCase()}` : `last seen ${fmtTime(p.lastSeen)}`}</div>
        </div>
        ${!isMe ? `
          <div class="row" style="gap:8px;">
            <button class="btn pink sm" id="dm-btn">DM</button>
            <button class="btn red sm" id="atk-btn" ${canAttack ? '' : 'disabled'} title="${canAttack ? 'Attack (25 EN)' : sameCity ? 'Cannot attack now' : 'Different city'}">Attack</button>
          </div>` : ''}
      </div>

      <div class="profile-bio ${p.bio ? '' : 'empty'}">${p.bio ? escapeHtml(p.bio) : 'No bio set.'}</div>

      <div class="stats-grid" style="margin-top:20px;">
        <div class="stat"><div class="stat-label">Strength</div><div class="stat-value pink" style="color:var(--neon-pink)">${p.strength.toFixed(1)}</div></div>
        <div class="stat"><div class="stat-label">Defense</div><div class="stat-value energy">${p.defense.toFixed(1)}</div></div>
        <div class="stat"><div class="stat-label">Speed</div><div class="stat-value">${p.speed.toFixed(1)}</div></div>
        <div class="stat"><div class="stat-label">Dexterity</div><div class="stat-value level">${p.dexterity.toFixed(1)}</div></div>
        <div class="stat"><div class="stat-label">Crimes</div><div class="stat-value">${p.crimesCommitted}</div></div>
        <div class="stat"><div class="stat-label">W/L</div><div class="stat-value">${p.attacksWon}/${p.attacksLost}</div></div>
      </div>
    </div>
  `;
}
function setupViewProfileHandlers() {
  document.getElementById("back-btn")?.addEventListener("click", () => { state.tab = "players"; render(); });
  document.getElementById("dm-btn")?.addEventListener("click", () => { state.tab = "chat"; openChat(state.viewingProfileId); });
  document.getElementById("atk-btn")?.addEventListener("click", async () => {
    if (!confirm("Attack this player? (25 EN)")) return;
    try {
      const r = await api.attack(state.viewingProfileId);
      handleResult(r);
      state.viewedPlayer = (await api.player(state.viewingProfileId)).player;
      render();
    } catch (e) { showToast(e.message, "fail"); }
  });
}

// --- MAIN RENDER ---
async function loadTabData(tab) {
  if (tab === "crimes" && state.crimes.length === 0) await loadCrimes();
  else if (tab === "jobs" && state.jobs.length === 0) await loadJobs();
  else if (tab === "missions" && state.missions.length === 0) await loadMissions();
  else if (tab === "items") await loadItemsTab();
  else if (tab === "players") {
    try { state.players = (await api.players()).players; } catch {}
  }
}

function render() {
  if (!state.me) { renderAuth(); return; }
  let body = "";
  if (state.tab === "home") body = renderHome();
  else if (state.tab === "crimes") body = renderCrimes();
  else if (state.tab === "gym") body = renderGym();
  else if (state.tab === "jobs") body = renderJobs();
  else if (state.tab === "missions") body = renderMissions();
  else if (state.tab === "travel") body = renderTravel();
  else if (state.tab === "items") body = renderItems();
  else if (state.tab === "chat") body = renderChat();
  else if (state.tab === "players") body = renderPlayers();
  else if (state.tab === "profile") body = renderMyProfile();
  else if (state.tab === "profile-view") body = renderViewProfile();

  app.innerHTML = topbarHtml() + statusBanner() + vitalsBarsHtml() + tabsHtml() + body;

  // Common handlers
  app.querySelectorAll(".tab[data-tab]").forEach(el => {
    el.onclick = async () => { state.tab = el.dataset.tab; await loadTabData(state.tab); render(); };
  });
  document.getElementById("logout-btn")?.addEventListener("click", () => {
    setToken(""); disconnectWs();
    state.me = null; state.log = [];
    state.worldMessages = []; state.privateThreads = {};
    state.unread = { world: 0, private: {} };
    render();
  });
  document.getElementById("bust-btn")?.addEventListener("click", () => doSimpleAction("bust"));

  if (state.tab === "home") {
    app.querySelectorAll("[data-go]").forEach(el => {
      el.onclick = async () => { state.tab = el.dataset.go; await loadTabData(state.tab); render(); };
    });
    app.querySelectorAll("[data-act]").forEach(el => { el.onclick = () => doSimpleAction(el.dataset.act); });
  } else if (state.tab === "crimes") {
    app.querySelectorAll("[data-crime]").forEach(el => { el.onclick = () => doCrime(el.dataset.crime); });
  } else if (state.tab === "gym") {
    app.querySelectorAll("[data-gym]").forEach(el => { el.onclick = () => doGym(el.dataset.gym); });
  } else if (state.tab === "jobs") {
    app.querySelectorAll("[data-job]").forEach(el => { el.onclick = () => doJob(el.dataset.job); });
  } else if (state.tab === "missions") {
    document.getElementById("refresh-missions")?.addEventListener("click", refreshMissions);
    app.querySelectorAll("[data-mission]").forEach(el => { el.onclick = () => takeMission(el.dataset.mission); });
  } else if (state.tab === "travel") {
    app.querySelectorAll("[data-travel]").forEach(el => { el.onclick = () => doTravel(el.dataset.travel); });
  } else if (state.tab === "items") {
    app.querySelectorAll("[data-buy]").forEach(el => { el.onclick = () => doBuy(el.dataset.buy); });
    app.querySelectorAll("[data-sell]").forEach(el => { el.onclick = () => doSell(el.dataset.sell); });
    app.querySelectorAll("[data-use]").forEach(el => { el.onclick = () => doUse(el.dataset.use); });
  } else if (state.tab === "chat") {
    setupChatHandlers();
  } else if (state.tab === "players") {
    app.querySelectorAll("[data-profile]").forEach(el => { el.onclick = () => openProfile(el.dataset.profile); });
  } else if (state.tab === "profile") {
    setupMyProfileHandlers();
  } else if (state.tab === "profile-view") {
    setupViewProfileHandlers();
  }
}

boot();
