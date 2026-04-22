import {
  api, getToken, setToken,
  connectWs, disconnectWs, onWs, getOnlineIds,
  sendWorldMsg, sendPrivateMsg,
} from "./api.js";

const app = document.getElementById("app");

const AVATARS = ["cyan", "pink", "purple", "green", "yellow", "red"];
const HOME_CITY = "neo_torin";
const GENDERS = [
  { id: "", label: "—" },
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
  { id: "prefer_not", label: "Prefer not to say" },
];

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
  crimes: [],
  jobs: [],
  missions: [],
  shop: { city: null, stock: [] },
  inventory: [],
  viewedPlayer: null,
  // Trade tab
  trades: { incoming: [], outgoing: [], history: [] },
  tradeDraft: null, // { toUserId, toName, offerMoney, wantMoney, offerItems[], wantItems[] }
  // AI helper
  aiHistory: [], // [{role:'user'|'bot', text}]
  aiBusy: false,
  // Admin
  admin: { users: [], focusUser: null },
};

let countdownTimer = null;

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString(); }
function fmtSecs(s) {
  if (s <= 0) return "ready";
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
function avatarHtml(p, size = "") {
  // p can be a user object or just an avatar key (legacy)
  if (typeof p === "string") {
    return `<div class="avatar ${size} ${p || "purple"}">??</div>`;
  }
  const name = p?.username || "?";
  const initial = name.slice(0, 2).toUpperCase();
  if (p?.avatarUrl) {
    return `<div class="avatar ${size} img"><img src="${escapeHtml(p.avatarUrl)}" alt="${escapeHtml(name)}" onerror="this.parentNode.innerHTML='${initial}'" /></div>`;
  }
  return `<div class="avatar ${size} ${p?.avatar || "purple"}">${escapeHtml(initial)}</div>`;
}
function pushLog(text, type = "info") {
  state.log.unshift({ text, type, t: Date.now() });
  if (state.log.length > 30) state.log.length = 30;
}
function xpForNext(level) { return Math.round(30 * Math.pow(1.25, level - 1)); }
function cityName(id) { return state.cities.find(c => c.id === id)?.name || id; }
function cityFlag(id) { return state.cities.find(c => c.id === id)?.flag || ""; }
function isStaff() { return state.me?.role === "admin" || state.me?.role === "dev"; }

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
      if (remain === 0 && el.dataset.countdownAuto !== "no") needsRefresh = true;
      if (remain === 0) {
        // Enable any "claim" button paired with this countdown
        const btn = el.closest(".mission-card")?.querySelector("[data-claim]");
        if (btn) btn.disabled = false;
      }
    });
    if (needsRefresh) refreshAndRerender();
  }, 1000);
}

async function refreshAndRerender() {
  await refreshMe();
  render();
}

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
    const ai = document.getElementById("ai-messages");
    if (ai) ai.scrollTop = ai.scrollHeight;
  }, 30);
}

// --- AUTH ---
function renderAuth() {
  const isReg = state.authMode === "register";
  app.innerHTML = `
    <div class="auth-screen">
      <h1 class="title">Neon Streets</h1>
      <div class="subtitle">// MULTIPLAYER CYBER RPG //</div>
      <div class="panel auth-card">
        <div class="auth-toggle">
          <button class="${!isReg ? 'active' : ''}" data-mode="login">Sign In</button>
          <button class="${isReg ? 'active' : ''}" data-mode="register">Register</button>
        </div>
        <div class="field">
          <label class="label">Callsign</label>
          <input class="input" id="auth-username" placeholder="3-20 chars" maxlength="20" autocomplete="username" />
        </div>
        <div class="field">
          <label class="label">PIN (4-8 digits)</label>
          <input class="input" id="auth-pin" type="password" inputmode="numeric" placeholder="••••" maxlength="8" autocomplete="${isReg ? 'new-password' : 'current-password'}" />
        </div>
        ${isReg ? `
          <div class="field">
            <label class="label">Email <span class="muted small">(optional)</span></label>
            <input class="input" id="auth-email" type="email" placeholder="you@gmail.com" autocomplete="email" />
            <div class="muted small" style="margin-top:6px;">Heads-up: confirmation emails aren't enabled on the free tier, so we just save it for now.</div>
          </div>
          <div class="field">
            <label class="label">Gender</label>
            <select class="input" id="auth-gender">
              ${GENDERS.map(g => `<option value="${g.id}">${g.label}</option>`).join("")}
            </select>
          </div>
        ` : ""}
        <button class="btn" id="auth-submit" style="width: 100%;">${isReg ? 'Create Operative' : 'Jack In'}</button>
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
      let res;
      if (isReg) {
        const email = document.getElementById("auth-email")?.value.trim() || "";
        const gender = document.getElementById("auth-gender")?.value || "";
        res = await api.register({ username, pin, email, gender });
      } else {
        res = await api.login(username, pin);
      }
      const user = res.user;
      setToken(user.token);
      state.me = user;
      const cities = await api.cities();
      state.cities = cities.cities;
      connectWs();
      await loadInitialData();
      state.tab = "home";
      pushLog(`${user.username} jacked into the grid${user.role === "dev" ? " as the DEVELOPER" : ""}.`, "info");
      if (res.emailVerificationNote) showToast(res.emailVerificationNote, "info");
      render();
    } catch (e) { state.authError = e.message; render(); }
  };
  document.getElementById("auth-submit").onclick = submit;
  ["auth-username", "auth-pin", "auth-email"].forEach(id => {
    document.getElementById(id)?.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
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

function topbarHtml() {
  const me = state.me;
  const tag = me.role === "dev" ? '<span class="role-tag dev">DEV</span>' : me.role === "admin" ? '<span class="role-tag admin">ADMIN</span>' : "";
  return `
    <div class="topbar">
      <div class="brand">
        <div class="title" style="font-size: 22px;">Neon Streets</div>
        <div class="subtitle">${cityFlag(me.location)} ${escapeHtml(cityName(me.location))} · L${me.level}</div>
      </div>
      <div class="me">
        ${avatarHtml(me)}
        <div>
          <div class="who">${escapeHtml(me.username)} ${tag}</div>
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

function tabsHtml() {
  const totalPrivateUnread = Object.values(state.unread.private).reduce((a, b) => a + b, 0);
  const pendingTrades = state.trades.incoming.length;
  const tabs = [
    { id: "home",     label: "Home" },
    { id: "crimes",   label: "Crimes" },
    { id: "gym",      label: "Gym" },
    { id: "jobs",     label: "Jobs" },
    { id: "missions", label: "Missions" },
    { id: "travel",   label: "Travel" },
    { id: "items",    label: "Items" },
    { id: "trade",    label: "Trade", badge: pendingTrades || null },
    { id: "chat",     label: "Chat", badge: (state.unread.world + totalPrivateUnread) || null },
    { id: "helper",   label: "Helper" },
    { id: "players",  label: "Players" },
    { id: "profile",  label: "Profile" },
  ];
  if (isStaff()) tabs.push({ id: "admin", label: state.me.role === "dev" ? "Dev" : "Admin" });
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

function renderHome() {
  const me = state.me;
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
        <button class="btn cyan" data-go="trade">💱 Trade</button>
        <button class="btn" data-go="helper">🤖 Helper Bot</button>
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
  if (r.user) state.me = r.user;
  if (r.message) pushLog(r.message, r.type);
  if (r.leveled) {
    pushLog(`>>> LEVEL UP! Now level ${r.user.level}.`, "levelup");
    showToast(`LEVEL UP! → ${r.user.level}`, "levelup");
  }
  if (r.message) showToast(r.message, r.type);
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
      <div class="muted small" style="margin-bottom:14px;">Each train costs <b>5 energy</b> + <b>5 happy</b>. Higher happy = bigger gains.</div>
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

// --- MISSIONS (time-gated) ---
async function loadMissions() { try { state.missions = (await api.missions()).missions; } catch {} }
function renderMissions() {
  return `
    <div class="panel">
      <div class="panel-title">Active Missions
        <span class="spacer"></span>
        <button class="btn ghost sm" id="refresh-missions">Refresh Available</button>
      </div>
      <div class="muted small" style="margin-bottom:12px;">Start a mission to spend energy and start the clock. When the timer ends, hit <b>Claim</b> to roll for rewards. Hard contracts pay big but fail more.</div>
      ${state.missions.length === 0
        ? '<div class="muted" style="text-align:center; padding: 20px;">No missions. Refresh to pull new contracts.</div>'
        : state.missions.map(m => {
          const status = m.status;
          const completesAt = m.completesAt ? new Date(m.completesAt).getTime() : 0;
          const remaining = completesAt ? Math.max(0, Math.ceil((completesAt - Date.now()) / 1000)) : 0;
          const ready = status === "in_progress" && remaining === 0;
          return `
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
              <span>Time <b>${fmtSecs(m.durationSeconds)}</b></span>
              <span class="money">REWARD <b>$${m.moneyReward}</b></span>
              <span class="xp">XP <b>+${m.xpReward}</b></span>
            </div>
            <div class="mission-actions">
              ${status === "available" ? `
                <button class="btn sm" data-start="${m.id}" ${state.me.energy < m.energyCost ? 'disabled' : ''}>Start (${m.energyCost} EN)</button>
              ` : status === "in_progress" ? `
                <span class="muted small">${ready ? "✅ Ready to claim" : "In progress…"}</span>
                <span class="muted small" data-countdown-to="${completesAt}" data-countdown-auto="no">${fmtSecs(remaining)}</span>
                <button class="btn yellow sm" data-claim="${m.id}" ${ready ? '' : 'disabled'}>Claim Reward</button>
                <button class="btn ghost sm" data-abort="${m.id}">Abort</button>
              ` : ``}
            </div>
          </div>
          `;
        }).join("")
      }
    </div>
  `;
}
async function startMission(id) {
  try { const r = await api.startMission(id); state.missions = r.missions; handleResult(r); }
  catch (e) { showToast(e.message, "fail"); }
}
async function claimMission(id) {
  try { const r = await api.claimMission(id); state.missions = r.missions; handleResult(r); }
  catch (e) { showToast(e.message, "fail"); }
}
async function abortMission(id) {
  if (!confirm("Abort this mission? You won't get the energy back.")) return;
  try { const r = await api.abortMission(id); state.missions = r.missions; handleResult(r); }
  catch (e) { showToast(e.message, "fail"); }
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

// --- ITEMS ---
async function loadItemsTab() {
  try {
    const [shop, inv] = await Promise.all([api.shop(), api.inventory()]);
    state.shop = shop;
    state.inventory = inv.inventory;
  } catch {}
}
function itemIcon(cat) {
  return cat === "weapon" ? "⚔️" : cat === "armor" ? "🛡️" : cat === "consumable" ? "💊" : "📦";
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

// --- TRADE ---
async function loadTradeTab() {
  try {
    const [t, inv] = await Promise.all([api.trades(), api.inventory()]);
    state.trades = t;
    state.inventory = inv.inventory;
  } catch {}
}
function renderTradeItemsList(list) {
  if (!list || list.length === 0) return '<span class="muted small">nothing</span>';
  return list.map(it => {
    const meta = state.inventory.find(r => r.itemId === it.itemId)?.item;
    const name = meta?.name || it.itemId;
    return `<span class="trade-chip">${escapeHtml(name)} ×${it.quantity}</span>`;
  }).join(" ");
}
function renderTradeRow(t, side) {
  const offerName = side === "incoming" ? state.players.find(p => p.id === t.fromUserId)?.username : state.players.find(p => p.id === t.toUserId)?.username;
  return `
    <div class="trade-card">
      <div class="head">
        <div>
          <b>${side === "incoming" ? "From" : "To"}: ${escapeHtml(offerName || "?")}</b>
          <div class="muted small">${fmtTime(t.createdAt)} · ${escapeHtml(t.message || "")}</div>
        </div>
      </div>
      <div class="trade-rows">
        <div class="trade-side">
          <div class="muted small">They give${side === "incoming" ? "" : " (you give)"}</div>
          <div>${t.offerMoney > 0 ? `<span class="trade-chip money">$${t.offerMoney.toLocaleString()}</span>` : ""}</div>
          <div>${renderTradeItemsList(t.offerItems)}</div>
        </div>
        <div class="trade-arrow">⇄</div>
        <div class="trade-side">
          <div class="muted small">You give${side === "incoming" ? "" : " (they give)"}</div>
          <div>${t.wantMoney > 0 ? `<span class="trade-chip money">$${t.wantMoney.toLocaleString()}</span>` : ""}</div>
          <div>${renderTradeItemsList(t.wantItems)}</div>
        </div>
      </div>
      <div class="trade-actions">
        ${side === "incoming"
          ? `<button class="btn green sm" data-trade-accept="${t.id}">Accept</button>
             <button class="btn ghost sm" data-trade-reject="${t.id}">Reject</button>`
          : `<button class="btn ghost sm" data-trade-reject="${t.id}">Cancel</button>`}
      </div>
    </div>
  `;
}
function renderTrade() {
  const draft = state.tradeDraft;
  return `
    ${draft ? `
    <div class="panel">
      <div class="panel-title">New Trade Proposal → ${escapeHtml(draft.toName)}</div>
      <div class="trade-builder">
        <div>
          <div class="label">You offer:</div>
          <input class="input" type="number" min="0" placeholder="Money to send" value="${draft.offerMoney}" id="trade-offer-money" />
          <div class="muted small" style="margin: 8px 0;">Your inventory:</div>
          <div class="trade-inv-list">
            ${state.inventory.length === 0 ? '<span class="muted small">empty</span>' :
              state.inventory.map(r => {
                const inDraft = draft.offerItems.find(x => x.itemId === r.itemId)?.quantity || 0;
                return `
                  <div class="trade-inv-row">
                    <span>${escapeHtml(r.item?.name || r.itemId)} (×${r.quantity})</span>
                    <input class="input sm" type="number" min="0" max="${r.quantity}" value="${inDraft}" data-offer-item="${r.itemId}" style="width:80px;" />
                  </div>`;
              }).join("")}
          </div>
        </div>
        <div>
          <div class="label">You want:</div>
          <input class="input" type="number" min="0" placeholder="Money to receive" value="${draft.wantMoney}" id="trade-want-money" />
          <div class="muted small" style="margin: 8px 0;">Items you want (paste item id and qty):</div>
          <div class="trade-want-list">
            ${draft.wantItems.map((w, i) => `
              <div class="trade-inv-row">
                <input class="input sm" data-want-id="${i}" value="${escapeHtml(w.itemId)}" placeholder="item-id" />
                <input class="input sm" type="number" min="1" data-want-qty="${i}" value="${w.quantity}" style="width:80px;" />
                <button class="btn ghost sm" data-want-remove="${i}">×</button>
              </div>
            `).join("")}
          </div>
          <button class="btn ghost sm" id="add-want-row">+ Add wanted item</button>
          <div class="muted small" style="margin-top:6px;">Tip: see item IDs in your inventory list (under each item, or ask the Helper).</div>
        </div>
      </div>
      <div class="row" style="margin-top:12px; gap:8px;">
        <input class="input" id="trade-message" placeholder="Optional message…" maxlength="200" value="${escapeHtml(draft.message || "")}" />
        <button class="btn" id="trade-send">Send Proposal</button>
        <button class="btn ghost" id="trade-cancel-draft">Cancel</button>
      </div>
    </div>` : ""}

    <div class="panel">
      <div class="panel-title">Incoming Trades <span class="spacer"></span><span class="muted small">${state.trades.incoming.length}</span></div>
      ${state.trades.incoming.length === 0 ? '<div class="muted">Nothing waiting on you.</div>' :
        state.trades.incoming.map(t => renderTradeRow(t, "incoming")).join("")}
    </div>

    <div class="panel">
      <div class="panel-title">Outgoing Trades <span class="spacer"></span><span class="muted small">${state.trades.outgoing.length}</span></div>
      ${state.trades.outgoing.length === 0 ? '<div class="muted">No outgoing proposals.</div>' :
        state.trades.outgoing.map(t => renderTradeRow(t, "outgoing")).join("")}
    </div>

    <div class="panel">
      <div class="panel-title">Recent History</div>
      ${state.trades.history.length === 0 ? '<div class="muted">No history yet.</div>' :
        `<div class="trade-history">${state.trades.history.map(t => `
          <div class="trade-history-row">
            <span class="trade-status ${t.status}">${t.status.toUpperCase()}</span>
            <span class="muted small">${fmtTime(t.createdAt)}</span>
            <span>${t.fromUserId === state.me.id ? "→" : "←"} ${escapeHtml((t.fromUserId === state.me.id ? state.players.find(p => p.id === t.toUserId)?.username : state.players.find(p => p.id === t.fromUserId)?.username) || "?")}</span>
          </div>`).join("")}</div>`}
    </div>
  `;
}
function setupTradeHandlers() {
  app.querySelectorAll("[data-trade-accept]").forEach(el => {
    el.onclick = async () => {
      try { handleResult(await api.acceptTrade(el.dataset.tradeAccept)); await loadTradeTab(); render(); }
      catch (e) { showToast(e.message, "fail"); }
    };
  });
  app.querySelectorAll("[data-trade-reject]").forEach(el => {
    el.onclick = async () => {
      try { await api.rejectTrade(el.dataset.tradeReject); await loadTradeTab(); render(); showToast("Trade closed.", "info"); }
      catch (e) { showToast(e.message, "fail"); }
    };
  });

  if (!state.tradeDraft) return;
  document.getElementById("trade-cancel-draft").onclick = () => { state.tradeDraft = null; render(); };
  document.getElementById("add-want-row").onclick = () => {
    state.tradeDraft.wantItems.push({ itemId: "", quantity: 1 });
    render();
  };
  document.querySelectorAll("[data-want-remove]").forEach(el => {
    el.onclick = () => { state.tradeDraft.wantItems.splice(Number(el.dataset.wantRemove), 1); render(); };
  });
  document.getElementById("trade-send").onclick = async () => {
    const draft = state.tradeDraft;
    draft.offerMoney = Math.max(0, Number(document.getElementById("trade-offer-money").value || 0));
    draft.wantMoney = Math.max(0, Number(document.getElementById("trade-want-money").value || 0));
    draft.message = document.getElementById("trade-message").value;
    // collect offer items
    const offer = [];
    document.querySelectorAll("[data-offer-item]").forEach(el => {
      const q = Number(el.value || 0);
      if (q > 0) offer.push({ itemId: el.dataset.offerItem, quantity: q });
    });
    // collect want items
    const want = [];
    document.querySelectorAll("[data-want-id]").forEach((el, i) => {
      const id = el.value.trim();
      const q = Number(document.querySelector(`[data-want-qty="${i}"]`)?.value || 0);
      if (id && q > 0) want.push({ itemId: id, quantity: q });
    });
    try {
      await api.createTrade({
        toUserId: draft.toUserId,
        offerMoney: draft.offerMoney, offerItems: offer,
        wantMoney: draft.wantMoney, wantItems: want,
        message: draft.message,
      });
      state.tradeDraft = null;
      await loadTradeTab();
      showToast("Trade proposal sent.", "success");
      render();
    } catch (e) { showToast(e.message, "fail"); }
  };
}

// --- HELPER (AI) ---
function renderHelper() {
  return `
    <div class="panel ai-panel">
      <div class="panel-title">🤖 Choomba — Game Helper Bot
        <span class="spacer"></span>
        <button class="btn ghost sm" id="ai-clear">Clear chat</button>
      </div>
      <div class="muted small" style="margin-bottom:10px;">Ask anything about how this game works — crimes, gym, travel, missions, items, trade, PvP. The bot only answers game questions.</div>
      <div class="ai-messages" id="ai-messages">
        ${state.aiHistory.length === 0
          ? '<div class="ai-msg bot">Yo choom. Need a hand with the streets? Ask me about crimes, gym training, travel routes, missions, items, or PvP.</div>'
          : state.aiHistory.map(m => `<div class="ai-msg ${m.role}">${escapeHtml(m.text)}</div>`).join("")}
        ${state.aiBusy ? '<div class="ai-msg bot ai-typing">…</div>' : ''}
      </div>
      <div class="chat-input-row">
        <input class="input" id="ai-input" placeholder="Ask about the game…" maxlength="500" ${state.aiBusy ? 'disabled' : ''} />
        <button class="btn" id="ai-send" ${state.aiBusy ? 'disabled' : ''}>Ask</button>
      </div>
    </div>
  `;
}
function setupHelperHandlers() {
  const input = document.getElementById("ai-input");
  const send = async () => {
    const text = input.value.trim();
    if (!text || state.aiBusy) return;
    state.aiHistory.push({ role: "user", text });
    state.aiBusy = true;
    input.value = "";
    render();
    try {
      const r = await api.askAi(text);
      state.aiHistory.push({ role: "bot", text: r.answer });
    } catch (e) {
      state.aiHistory.push({ role: "bot", text: "⚠️ " + e.message });
    } finally {
      state.aiBusy = false;
      render();
      scrollChatToBottom();
    }
  };
  document.getElementById("ai-send").onclick = send;
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  input?.focus();
  document.getElementById("ai-clear").onclick = async () => {
    try { await api.clearAi(); } catch {}
    state.aiHistory = [];
    render();
  };
  scrollChatToBottom();
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
  app.querySelectorAll("[data-profile]").forEach(el => { el.onclick = () => openProfile(el.dataset.profile); });
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
            ${avatarHtml(p)}
            <div class="info">
              <div class="row" style="gap:8px;">
                <span class="online-badge ${state.online.has(p.id) ? 'on' : ''}"></span>
                <span class="name">${escapeHtml(p.username)}</span>
                ${p.role === "dev" ? '<span class="role-tag dev">DEV</span>' : p.role === "admin" ? '<span class="role-tag admin">ADMIN</span>' : ""}
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
  try { state.viewedPlayer = (await api.player(id)).player; }
  catch { state.viewedPlayer = null; }
  render();
}

// --- PROFILE (mine) ---
function renderMyProfile() {
  const me = state.me;
  return `
    <div class="panel">
      <div class="panel-title">Edit Profile</div>
      <div class="profile-header">
        ${avatarHtml(me, "lg")}
        <div class="info">
          <h2>${escapeHtml(me.username)} ${me.role === "dev" ? '<span class="role-tag dev">DEV</span>' : me.role === "admin" ? '<span class="role-tag admin">ADMIN</span>' : ""}</h2>
          <div class="lvl-text">LEVEL ${me.level} · ${me.xp}/${xpForNext(me.level)} XP</div>
          <div class="joined">Joined ${fmtDate(me.createdAt)}</div>
        </div>
      </div>

      <div style="margin-top: 24px;">
        <label class="label">Avatar Color</label>
        <div class="avatar-picker" id="avatar-picker">
          ${AVATARS.map(a => `<div class="avatar ${a} ${me.avatar === a ? 'selected' : ''}" data-avatar="${a}">${(me.username||"?").slice(0,2).toUpperCase()}</div>`).join("")}
        </div>
      </div>

      <div style="margin-top: 16px;">
        <label class="label">Profile Picture URL <span class="muted small">(use a real photo — paste any direct image link, e.g. from Imgur or Discord)</span></label>
        <div class="row" style="gap:8px;">
          <input class="input" id="avatar-url" value="${escapeHtml(me.avatarUrl || "")}" placeholder="https://i.imgur.com/your-pic.png" />
          <button class="btn ghost sm" id="clear-avatar-url">Clear</button>
        </div>
        <div class="muted small" style="margin-top:6px;">Direct image links only (.png .jpg .webp .gif). Free tier doesn't support file uploads.</div>
      </div>

      <div style="margin-top: 16px;">
        <label class="label">Gender</label>
        <select class="input" id="gender-input">
          ${GENDERS.map(g => `<option value="${g.id}" ${me.gender === g.id ? "selected" : ""}>${g.label}</option>`).join("")}
        </select>
      </div>

      <div style="margin-top: 16px;">
        <label class="label">Email</label>
        <input class="input" id="email-input" type="email" value="${escapeHtml(me.email || "")}" placeholder="you@gmail.com" />
        <div class="muted small" style="margin-top:6px;">Stored only — verification emails aren't enabled on the free tier.</div>
      </div>

      <div style="margin-top: 16px;">
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
  document.getElementById("clear-avatar-url").onclick = async () => {
    try { const { user } = await api.updateMe({ avatarUrl: "" }); state.me = user; render(); }
    catch (e) { showToast(e.message, "fail"); }
  };
  document.getElementById("save-profile").onclick = async () => {
    const bio = document.getElementById("bio-input").value;
    const gender = document.getElementById("gender-input").value;
    const avatarUrl = document.getElementById("avatar-url").value.trim();
    const email = document.getElementById("email-input").value.trim();
    try {
      const patch = { bio, gender };
      // only include avatarUrl/email if they changed (avoid validation errors on empty)
      patch.avatarUrl = avatarUrl;
      patch.email = email;
      const { user } = await api.updateMe(patch);
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
        ${avatarHtml(p, "lg")}
        <div class="info">
          <h2>${escapeHtml(p.username)}
            ${p.role === "dev" ? '<span class="role-tag dev">DEV</span>' : p.role === "admin" ? '<span class="role-tag admin">ADMIN</span>' : ""}
            ${state.online.has(p.id) ? '<span class="online-badge on" style="display:inline-block; vertical-align:middle;"></span>' : ''}
          </h2>
          <div class="lvl-text">LEVEL ${p.level} · ${p.respect} respect</div>
          <div class="joined">${cityFlag(p.location)} ${escapeHtml(cityName(p.location))} · ${targetStatus !== "ok" ? `${targetStatus.toUpperCase()}` : `last seen ${fmtTime(p.lastSeen)}`}</div>
          ${p.gender ? `<div class="muted small">Gender: ${escapeHtml(GENDERS.find(g => g.id === p.gender)?.label || p.gender)}</div>` : ""}
        </div>
        ${!isMe ? `
          <div class="row" style="gap:8px; flex-wrap:wrap;">
            <button class="btn pink sm" id="dm-btn">DM</button>
            <button class="btn green sm" id="send-money-btn">Send $</button>
            <button class="btn cyan sm" id="propose-trade-btn">Trade</button>
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
  document.getElementById("send-money-btn")?.addEventListener("click", async () => {
    const amount = Number(prompt(`Send how many credits to ${state.viewedPlayer.username}?`, "100") || 0);
    if (!amount || amount <= 0) return;
    const note = prompt("Optional note (or leave blank):", "") || "";
    try {
      const r = await api.transfer(state.viewingProfileId, amount, note);
      handleResult(r);
    } catch (e) { showToast(e.message, "fail"); }
  });
  document.getElementById("propose-trade-btn")?.addEventListener("click", async () => {
    state.tradeDraft = {
      toUserId: state.viewingProfileId,
      toName: state.viewedPlayer.username,
      offerMoney: 0, wantMoney: 0,
      offerItems: [], wantItems: [],
      message: "",
    };
    state.tab = "trade";
    await loadTradeTab();
    render();
  });
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

// --- ADMIN ---
async function loadAdminTab() {
  if (!isStaff()) return;
  try {
    const r = await api.adminUsers();
    state.admin.users = r.users;
  } catch (e) { showToast(e.message, "fail"); }
}
function renderAdmin() {
  const isDev = state.me.role === "dev";
  const focus = state.admin.focusUser;
  return `
    <div class="panel">
      <div class="panel-title">${isDev ? "Developer Console" : "Admin Console"}
        <span class="spacer"></span>
        <button class="btn ghost sm" id="refresh-admin">Refresh</button>
      </div>
      <div class="muted small" style="margin-bottom:10px;">${isDev
        ? "You can promote/demote players, grant rewards, heal/punish, and inspect anyone's full data."
        : "You can grant items/money and apply hospital/jail. Only the developer can change roles."}</div>
      <div class="admin-table">
        <div class="admin-row head">
          <div>User</div><div>Role</div><div>Lvl</div><div>$</div><div>City</div><div>Last Seen</div><div></div>
        </div>
        ${state.admin.users.map(u => `
          <div class="admin-row" data-admin-row="${u.id}">
            <div>${escapeHtml(u.username)} ${u.email ? `<span class="muted small">${escapeHtml(u.email)}</span>` : ""}</div>
            <div><span class="role-tag ${u.role}">${u.role.toUpperCase()}</span></div>
            <div>${u.level}</div>
            <div>$${u.money.toLocaleString()}</div>
            <div>${cityFlag(u.location)} ${escapeHtml(cityName(u.location))}</div>
            <div class="muted small">${fmtTime(u.lastSeen)}</div>
            <div><button class="btn ghost sm" data-admin-focus="${u.id}">Manage</button></div>
          </div>
        `).join("")}
      </div>
    </div>

    ${focus ? `
    <div class="panel">
      <div class="panel-title">Manage: ${escapeHtml(focus.user.username)}
        <span class="spacer"></span>
        <button class="btn ghost sm" id="close-focus">Close</button>
      </div>
      <div class="stats-grid">
        <div class="stat"><div class="stat-label">Role</div><div class="stat-value">${focus.user.role.toUpperCase()}</div></div>
        <div class="stat"><div class="stat-label">HP</div><div class="stat-value health">${focus.user.health}/${focus.user.maxHealth}</div></div>
        <div class="stat"><div class="stat-label">EN</div><div class="stat-value energy">${focus.user.energy}/${focus.user.maxEnergy}</div></div>
        <div class="stat"><div class="stat-label">XP</div><div class="stat-value">${focus.user.xp}/${xpForNext(focus.user.level)}</div></div>
        <div class="stat"><div class="stat-label">Crimes</div><div class="stat-value pink">${focus.user.crimesCommitted}</div></div>
        <div class="stat"><div class="stat-label">W/L</div><div class="stat-value">${focus.user.attacksWon}/${focus.user.attacksLost}</div></div>
      </div>

      <div class="admin-actions">
        ${isDev && focus.user.role !== "dev" ? `
          <div class="admin-act-group">
            <b>Role:</b>
            ${focus.user.role === "player"
              ? `<button class="btn purple sm" data-promote="${focus.user.id}">Promote to Admin</button>`
              : `<button class="btn ghost sm" data-demote="${focus.user.id}">Demote to Player</button>`}
            <button class="btn red sm" data-delete="${focus.user.id}">Delete account</button>
          </div>` : ""}
        <div class="admin-act-group">
          <b>Grant:</b>
          <input class="input sm" id="grant-money" placeholder="money (e.g. 5000 or -1000)" style="width:160px;" />
          <button class="btn green sm" id="grant-money-btn">Grant Money</button>
        </div>
        <div class="admin-act-group">
          <b>Item:</b>
          <input class="input sm" id="grant-item-id" placeholder="item-id (e.g. medkit)" style="width:160px;" />
          <input class="input sm" id="grant-item-qty" type="number" min="1" value="1" style="width:80px;" />
          <button class="btn green sm" id="grant-item-btn">Grant Item</button>
        </div>
        <div class="admin-act-group">
          <b>Punish:</b>
          <input class="input sm" id="hosp-secs" type="number" min="0" placeholder="hospital secs" style="width:130px;" />
          <input class="input sm" id="jail-secs" type="number" min="0" placeholder="jail secs" style="width:120px;" />
          <button class="btn red sm" id="punish-btn">Apply</button>
          <button class="btn cyan sm" id="heal-full-btn">Full Heal/Release</button>
        </div>
      </div>

      <div class="panel-title" style="margin-top:18px;">Inventory</div>
      ${focus.inventory.length === 0 ? '<div class="muted">empty</div>' : `
        <div class="item-list">
          ${focus.inventory.map(r => `
            <div class="item-row">
              <div class="item-icon ${r.item?.category}">${itemIcon(r.item?.category)}</div>
              <div class="info">
                <b>${escapeHtml(r.item?.name || r.itemId)}</b> <span class="muted">×${r.quantity}</span>
                <div class="muted small">${escapeHtml(r.itemId)}</div>
              </div>
            </div>
          `).join("")}
        </div>`}
    </div>
    ` : ""}
  `;
}
function setupAdminHandlers() {
  document.getElementById("refresh-admin")?.addEventListener("click", async () => { await loadAdminTab(); render(); });
  app.querySelectorAll("[data-admin-focus]").forEach(el => {
    el.onclick = async () => {
      try {
        state.admin.focusUser = await api.adminUser(el.dataset.adminFocus);
        render();
      } catch (e) { showToast(e.message, "fail"); }
    };
  });
  document.getElementById("close-focus")?.addEventListener("click", () => { state.admin.focusUser = null; render(); });

  const focus = state.admin.focusUser;
  if (!focus) return;
  const userId = focus.user.id;
  document.querySelector("[data-promote]")?.addEventListener("click", async () => {
    try { await api.adminRole(userId, "admin"); showToast("Promoted to admin.", "success"); await reloadAdminFocus(userId); } catch (e) { showToast(e.message, "fail"); }
  });
  document.querySelector("[data-demote]")?.addEventListener("click", async () => {
    try { await api.adminRole(userId, "player"); showToast("Demoted to player.", "info"); await reloadAdminFocus(userId); } catch (e) { showToast(e.message, "fail"); }
  });
  document.querySelector("[data-delete]")?.addEventListener("click", async () => {
    if (!confirm(`PERMANENTLY delete ${focus.user.username}? This cannot be undone.`)) return;
    try { await api.adminDelete(userId); showToast("Deleted.", "info"); state.admin.focusUser = null; await loadAdminTab(); render(); } catch (e) { showToast(e.message, "fail"); }
  });
  document.getElementById("grant-money-btn")?.addEventListener("click", async () => {
    const money = Number(document.getElementById("grant-money").value || 0);
    if (!money) return;
    try { await api.adminGrant({ userId, money }); showToast("Money granted.", "success"); await reloadAdminFocus(userId); } catch (e) { showToast(e.message, "fail"); }
  });
  document.getElementById("grant-item-btn")?.addEventListener("click", async () => {
    const itemId = document.getElementById("grant-item-id").value.trim();
    const qty = Number(document.getElementById("grant-item-qty").value || 1);
    if (!itemId) return;
    try { await api.adminGrant({ userId, itemId, qty }); showToast("Item granted.", "success"); await reloadAdminFocus(userId); } catch (e) { showToast(e.message, "fail"); }
  });
  document.getElementById("punish-btn")?.addEventListener("click", async () => {
    const hospitalSeconds = Number(document.getElementById("hosp-secs").value || 0);
    const jailSeconds = Number(document.getElementById("jail-secs").value || 0);
    try { await api.adminPunish({ userId, hospitalSeconds, jailSeconds }); showToast("Applied.", "info"); await reloadAdminFocus(userId); } catch (e) { showToast(e.message, "fail"); }
  });
  document.getElementById("heal-full-btn")?.addEventListener("click", async () => {
    try { await api.adminPunish({ userId, healFull: true }); showToast("Full heal.", "success"); await reloadAdminFocus(userId); } catch (e) { showToast(e.message, "fail"); }
  });
}
async function reloadAdminFocus(id) {
  try { state.admin.focusUser = await api.adminUser(id); await loadAdminTab(); render(); } catch {}
}

// --- MAIN RENDER ---
async function loadTabData(tab) {
  if (tab === "crimes" && state.crimes.length === 0) await loadCrimes();
  else if (tab === "jobs" && state.jobs.length === 0) await loadJobs();
  else if (tab === "missions") await loadMissions();
  else if (tab === "items") await loadItemsTab();
  else if (tab === "trade") await loadTradeTab();
  else if (tab === "admin") await loadAdminTab();
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
  else if (state.tab === "trade") body = renderTrade();
  else if (state.tab === "helper") body = renderHelper();
  else if (state.tab === "chat") body = renderChat();
  else if (state.tab === "players") body = renderPlayers();
  else if (state.tab === "profile") body = renderMyProfile();
  else if (state.tab === "profile-view") body = renderViewProfile();
  else if (state.tab === "admin") body = isStaff() ? renderAdmin() : `<div class="panel"><div class="muted">Access denied.</div></div>`;

  app.innerHTML = topbarHtml() + statusBanner() + vitalsBarsHtml() + tabsHtml() + body;

  app.querySelectorAll(".tab[data-tab]").forEach(el => {
    el.onclick = async () => { state.tab = el.dataset.tab; await loadTabData(state.tab); render(); };
  });
  document.getElementById("logout-btn")?.addEventListener("click", () => {
    setToken(""); disconnectWs();
    state.me = null; state.log = [];
    state.worldMessages = []; state.privateThreads = {};
    state.unread = { world: 0, private: {} };
    state.aiHistory = []; state.tradeDraft = null;
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
    app.querySelectorAll("[data-start]").forEach(el => { el.onclick = () => startMission(el.dataset.start); });
    app.querySelectorAll("[data-claim]").forEach(el => { el.onclick = () => claimMission(el.dataset.claim); });
    app.querySelectorAll("[data-abort]").forEach(el => { el.onclick = () => abortMission(el.dataset.abort); });
  } else if (state.tab === "travel") {
    app.querySelectorAll("[data-travel]").forEach(el => { el.onclick = () => doTravel(el.dataset.travel); });
  } else if (state.tab === "items") {
    app.querySelectorAll("[data-buy]").forEach(el => { el.onclick = () => doBuy(el.dataset.buy); });
    app.querySelectorAll("[data-sell]").forEach(el => { el.onclick = () => doSell(el.dataset.sell); });
    app.querySelectorAll("[data-use]").forEach(el => { el.onclick = () => doUse(el.dataset.use); });
  } else if (state.tab === "trade") {
    setupTradeHandlers();
  } else if (state.tab === "helper") {
    setupHelperHandlers();
  } else if (state.tab === "chat") {
    setupChatHandlers();
  } else if (state.tab === "players") {
    app.querySelectorAll("[data-profile]").forEach(el => { el.onclick = () => openProfile(el.dataset.profile); });
  } else if (state.tab === "profile") {
    setupMyProfileHandlers();
  } else if (state.tab === "profile-view") {
    setupViewProfileHandlers();
  } else if (state.tab === "admin") {
    setupAdminHandlers();
  }
}

boot();
