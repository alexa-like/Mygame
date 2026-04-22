import {
  api, getToken, setToken,
  connectWs, disconnectWs, onWs, getOnlineIds,
  sendWorldMsg, sendPrivateMsg,
} from "./api.js";

const app = document.getElementById("app");

const AVATARS = ["cyan", "pink", "purple", "green", "yellow", "red"];

const state = {
  me: null,
  tab: "home",
  log: [],
  players: [],
  missions: [],
  worldMessages: [],
  privateThreads: {}, // userId -> messages[]
  unread: { world: 0, private: {} },
  activeChat: "world", // "world" or userId
  viewingProfileId: null,
  authMode: "login",
  authError: "",
  online: new Set(),
};

// --- Helpers ---
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString();
}
function avatarHtml(avatarKey, name, size = "") {
  const initial = (name || "?").slice(0, 2).toUpperCase();
  return `<div class="avatar ${size} ${avatarKey || "purple"}">${escapeHtml(initial)}</div>`;
}
function pushLog(text, type = "info") {
  state.log.unshift({ text, type, t: Date.now() });
  if (state.log.length > 30) state.log.length = 30;
}
function xpForNext(level) { return Math.round(50 * Math.pow(1.5, level - 1)); }

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
      const { user } = await api.me();
      state.me = user;
      connectWs();
      await loadInitialData();
    } catch {
      setToken("");
      state.me = null;
    }
  }
  render();
}

async function loadInitialData() {
  const [players, missions, world] = await Promise.all([
    api.players().catch(() => ({ players: [] })),
    api.missions().catch(() => ({ missions: [] })),
    api.worldChat().catch(() => ({ messages: [] })),
  ]);
  state.players = players.players;
  state.missions = missions.missions;
  state.worldMessages = world.messages;
}

// --- WS handler ---
onWs((evt) => {
  if (evt.kind === "world_msg") {
    state.worldMessages.push(evt.message);
    if (state.tab !== "chat" || state.activeChat !== "world") state.unread.world += 1;
    if (state.tab === "chat" && state.activeChat === "world") scrollChatToBottom();
    render();
  } else if (evt.kind === "private_msg") {
    const otherId = evt.message.fromUserId === state.me?.id
      ? evt.message.toUserId : evt.message.fromUserId;
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
      connectWs();
      await loadInitialData();
      state.tab = "home";
      pushLog(`${user.username} jacked into the grid.`, "info");
      render();
    } catch (e) {
      state.authError = e.message;
      render();
    }
  };
  document.getElementById("auth-submit").onclick = submit;
  ["auth-username", "auth-pin"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  });
  document.getElementById("auth-username").focus();
}

// --- TOPBAR + TABS ---
function topbarHtml() {
  const me = state.me;
  return `
    <div class="topbar">
      <div class="brand">
        <div class="title" style="font-size: 22px;">Neon Streets</div>
        <div class="subtitle">// LEVEL ${me.level} OPERATIVE //</div>
      </div>
      <div class="me">
        ${avatarHtml(me.avatar, me.username)}
        <div>
          <div class="who">${escapeHtml(me.username)}</div>
          <div class="mini-stats">
            <span class="m">$<b>${me.money}</b></span>
            <span class="l">L<b>${me.level}</b></span>
            <span class="h">HP<b>${me.health}/${me.maxHealth}</b></span>
            <span class="e">EN<b>${me.energy}/${me.maxEnergy}</b></span>
          </div>
        </div>
        <button class="btn ghost sm" id="logout-btn">Logout</button>
      </div>
    </div>
  `;
}

function tabsHtml() {
  const totalPrivateUnread = Object.values(state.unread.private).reduce((a, b) => a + b, 0);
  const tabs = [
    { id: "home", label: "Home" },
    { id: "missions", label: "Missions", badge: state.missions.length || null },
    { id: "chat", label: "Chat", badge: (state.unread.world + totalPrivateUnread) || null },
    { id: "players", label: "Players" },
    { id: "profile", label: "Profile" },
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
        <div class="stat"><div class="stat-label">Credits</div><div class="stat-value money">$${me.money}</div></div>
        <div class="stat">
          <div class="stat-label">Level</div>
          <div class="stat-value level">${me.level}</div>
          <div class="bar"><div class="bar-fill xp" style="width:${(me.xp/xpNeed)*100}%"></div></div>
          <div class="stat-label" style="margin-top:4px;">${me.xp} / ${xpNeed} XP</div>
        </div>
        <div class="stat">
          <div class="stat-label">Health</div>
          <div class="stat-value health">${me.health}/${me.maxHealth}</div>
          <div class="bar"><div class="bar-fill health" style="width:${(me.health/me.maxHealth)*100}%"></div></div>
        </div>
        <div class="stat">
          <div class="stat-label">Energy</div>
          <div class="stat-value energy">${me.energy}/${me.maxEnergy}</div>
          <div class="bar"><div class="bar-fill energy" style="width:${(me.energy/me.maxEnergy)*100}%"></div></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Actions</div>
      <div class="actions">
        <button class="btn pink" data-act="crime" ${me.energy < 10 ? 'disabled' : ''}>Commit Crime</button>
        <button class="btn green" data-act="work" ${me.energy < 15 ? 'disabled' : ''}>Work Job</button>
        <button class="btn purple" data-act="train">Train</button>
        <button class="btn ghost" data-act="heal_paid" ${me.money < 25 || me.health >= me.maxHealth ? 'disabled' : ''}>Ripperdoc Heal ($25)</button>
        <button class="btn ghost" data-act="heal_free" ${me.health >= me.maxHealth ? 'disabled' : ''}>Patch Up (Free)</button>
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

async function doAction(type) {
  try {
    const r = await api.doAction(type);
    state.me = r.user;
    pushLog(r.message, r.type);
    if (r.leveled) {
      pushLog(`>>> LEVEL UP! Now level ${r.user.level}.`, "levelup");
      showToast(`LEVEL UP! → ${r.user.level}`, "levelup");
    }
    render();
  } catch (e) {
    pushLog(e.message, "fail");
    render();
  }
}

// --- MISSIONS ---
function renderMissions() {
  return `
    <div class="panel">
      <div class="panel-title">
        Active Missions
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
              <div class="muted small">${m.type === 'money' ? '💰' : m.type === 'xp' ? '⚡' : '★'} ${m.type.toUpperCase()}</div>
            </div>
            <div class="desc">${escapeHtml(m.description)}</div>
            <div class="meta">
              <span class="energy">EN <b>-${m.energyCost}</b></span>
              <span class="money">REWARD <b>$${m.moneyReward}</b></span>
              <span class="xp">XP <b>+${m.xpReward}</b></span>
            </div>
            <div class="mission-actions">
              <button class="btn sm" data-mission="${m.id}" ${state.me.energy < m.energyCost ? 'disabled' : ''}>Accept Mission</button>
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
    state.me = r.user;
    state.missions = r.missions;
    pushLog(r.message, r.type);
    if (r.leveled) {
      pushLog(`>>> LEVEL UP! Now level ${r.user.level}.`, "levelup");
      showToast(`LEVEL UP! → ${r.user.level}`, "levelup");
    }
    showToast(r.message, r.type);
    render();
  } catch (e) {
    showToast(e.message, "fail");
  }
}

async function refreshMissions() {
  try {
    const r = await api.refreshMissions();
    state.missions = r.missions;
    render();
  } catch (e) { showToast(e.message, "fail"); }
}

// --- CHAT ---
async function openChat(channel) {
  state.activeChat = channel;
  if (channel === "world") {
    state.unread.world = 0;
  } else {
    state.unread.private[channel] = 0;
    if (!state.privateThreads[channel]) {
      try {
        const r = await api.privateChat(channel);
        state.privateThreads[channel] = r.messages;
      } catch {}
    }
  }
  render();
  scrollChatToBottom();
}

function renderChat() {
  const channels = state.players.filter(p => p.id !== state.me.id);
  const activeIsWorld = state.activeChat === "world";
  const activeUser = !activeIsWorld ? state.players.find(p => p.id === state.activeChat) : null;
  const messages = activeIsWorld
    ? state.worldMessages
    : (state.privateThreads[state.activeChat] || []);

  return `
    <div class="chat-layout">
      <div class="chat-sidebar">
        <div class="chat-section-label">Channels</div>
        <div class="chat-channel ${activeIsWorld ? 'active' : ''}" data-channel="world">
          <span># World</span>
          ${state.unread.world ? `<span class="badge" style="background:var(--neon-pink);color:white;font-size:9px;padding:1px 5px;border-radius:8px;font-family:'Share Tech Mono',monospace;">${state.unread.world}</span>` : ''}
        </div>
        <div class="chat-section-label">Direct Messages</div>
        ${channels.length === 0 ? '<div class="muted small" style="padding:10px;">No other players online yet.</div>' : ''}
        ${channels.map(p => `
          <div class="chat-channel ${state.activeChat === p.id ? 'active' : ''} ${state.online.has(p.id) ? 'online' : ''}" data-channel="${p.id}">
            <span class="row" style="gap:8px;"><span class="dot"></span>${escapeHtml(p.username)}</span>
            ${state.unread.private[p.id] ? `<span class="badge" style="background:var(--neon-pink);color:white;font-size:9px;padding:1px 5px;border-radius:8px;font-family:'Share Tech Mono',monospace;">${state.unread.private[p.id]}</span>` : ''}
          </div>
        `).join("")}
      </div>
      <div class="chat-main">
        <div class="chat-header">
          ${activeIsWorld ? '# WORLD CHAT' : `▸ DM with ${escapeHtml(activeUser?.username || "?")}`}
        </div>
        <div class="chat-messages" id="chat-messages">
          ${messages.length === 0
            ? '<div class="chat-empty">No messages yet. Say something.</div>'
            : messages.map(m => `
              <div class="chat-msg ${m.fromUserId === state.me.id ? 'mine' : ''}">
                <span class="author" data-profile="${m.fromUserId}">${escapeHtml(m.fromUsername || "?")}</span>
                <span class="body">${escapeHtml(m.content)}</span>
                <span class="spacer"></span>
                <span class="time">${fmtTime(m.createdAt)}</span>
              </div>
            `).join("")
          }
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
  app.querySelectorAll("[data-channel]").forEach(el => {
    el.onclick = () => openChat(el.dataset.channel);
  });
  app.querySelectorAll("[data-profile]").forEach(el => {
    el.onclick = () => { state.viewingProfileId = el.dataset.profile; state.tab = "profile-view"; render(); };
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
      <div class="panel-title">
        Operatives <span class="spacer"></span>
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
              </div>
              <div class="stats">$${p.money} · ${p.crimesCommitted} crimes · ${p.missionsCompleted} missions</div>
            </div>
            <div class="lvl">L${p.level}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// --- PROFILE ---
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
        <span class="spacer"></span>
        <span class="muted small" id="save-status"></span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Stats</div>
      <div class="stats-grid">
        <div class="stat"><div class="stat-label">Crimes</div><div class="stat-value pink">${me.crimesCommitted}</div></div>
        <div class="stat"><div class="stat-label">Missions</div><div class="stat-value level">${me.missionsCompleted}</div></div>
        <div class="stat"><div class="stat-label">Net Worth</div><div class="stat-value money">$${me.money}</div></div>
      </div>
    </div>
  `;
}

function setupMyProfileHandlers() {
  app.querySelectorAll("[data-avatar]").forEach(el => {
    el.onclick = async () => {
      const avatar = el.dataset.avatar;
      try {
        const { user } = await api.updateMe({ avatar });
        state.me = user;
        render();
      } catch (e) { showToast(e.message, "fail"); }
    };
  });
  document.getElementById("save-profile").onclick = async () => {
    const bio = document.getElementById("bio-input").value;
    try {
      const { user } = await api.updateMe({ bio });
      state.me = user;
      document.getElementById("save-status").textContent = "Saved.";
      showToast("Profile saved.", "success");
      setTimeout(() => render(), 800);
    } catch (e) { showToast(e.message, "fail"); }
  };
}

function renderViewProfile() {
  const id = state.viewingProfileId;
  const p = state.players.find(x => x.id === id);
  if (!p) {
    return `<div class="panel"><div class="muted">Loading profile…</div></div>`;
  }
  const isMe = p.id === state.me.id;
  return `
    <div class="panel">
      <div class="row" style="margin-bottom:12px;">
        <button class="btn ghost sm" id="back-btn">← Back</button>
      </div>
      <div class="profile-header">
        ${avatarHtml(p.avatar, p.username, "lg")}
        <div class="info">
          <h2>${escapeHtml(p.username)} ${state.online.has(p.id) ? '<span class="online-badge on" style="display:inline-block; vertical-align:middle;"></span>' : ''}</h2>
          <div class="lvl-text">LEVEL ${p.level}</div>
          <div class="joined">Joined ${fmtDate(p.createdAt)} · Last seen ${fmtTime(p.lastSeen)}</div>
        </div>
        ${!isMe ? `<button class="btn pink sm" id="dm-btn">Send Message</button>` : ''}
      </div>

      <div class="profile-bio ${p.bio ? '' : 'empty'}">${p.bio ? escapeHtml(p.bio) : 'No bio set.'}</div>

      <div class="stats-grid" style="margin-top:20px;">
        <div class="stat"><div class="stat-label">Level</div><div class="stat-value level">${p.level}</div></div>
        <div class="stat"><div class="stat-label">Crimes</div><div class="stat-value pink" style="color:var(--neon-pink)">${p.crimesCommitted}</div></div>
        <div class="stat"><div class="stat-label">Missions</div><div class="stat-value">${p.missionsCompleted}</div></div>
        <div class="stat"><div class="stat-label">Credits</div><div class="stat-value money">$${p.money}</div></div>
      </div>
    </div>
  `;
}

function setupViewProfileHandlers() {
  const back = document.getElementById("back-btn");
  if (back) back.onclick = () => { state.tab = "players"; state.viewingProfileId = null; render(); };
  const dm = document.getElementById("dm-btn");
  if (dm) dm.onclick = () => { state.tab = "chat"; openChat(state.viewingProfileId); };
}

// --- MAIN RENDER ---
function render() {
  if (!state.me) { renderAuth(); return; }

  let body = "";
  if (state.tab === "home") body = renderHome();
  else if (state.tab === "missions") body = renderMissions();
  else if (state.tab === "chat") body = renderChat();
  else if (state.tab === "players") body = renderPlayers();
  else if (state.tab === "profile") body = renderMyProfile();
  else if (state.tab === "profile-view") body = renderViewProfile();

  app.innerHTML = topbarHtml() + tabsHtml() + body;

  // Common handlers
  app.querySelectorAll(".tab[data-tab]").forEach(el => {
    el.onclick = async () => {
      state.tab = el.dataset.tab;
      if (state.tab === "players") {
        try { state.players = (await api.players()).players; } catch {}
      } else if (state.tab === "missions" && state.missions.length === 0) {
        try { state.missions = (await api.missions()).missions; } catch {}
      }
      render();
    };
  });
  document.getElementById("logout-btn")?.addEventListener("click", () => {
    setToken(""); disconnectWs();
    state.me = null; state.log = [];
    state.worldMessages = []; state.privateThreads = {};
    state.unread = { world: 0, private: {} };
    render();
  });

  if (state.tab === "home") {
    app.querySelectorAll("[data-act]").forEach(el => {
      el.onclick = () => doAction(el.dataset.act);
    });
  } else if (state.tab === "missions") {
    document.getElementById("refresh-missions")?.addEventListener("click", refreshMissions);
    app.querySelectorAll("[data-mission]").forEach(el => {
      el.onclick = () => takeMission(el.dataset.mission);
    });
  } else if (state.tab === "chat") {
    setupChatHandlers();
  } else if (state.tab === "players") {
    app.querySelectorAll("[data-profile]").forEach(el => {
      el.onclick = async () => {
        state.viewingProfileId = el.dataset.profile;
        state.tab = "profile-view";
        try { const { player } = await api.player(el.dataset.profile);
          // patch in viewed profile so renderViewProfile finds it with full data
          const idx = state.players.findIndex(p => p.id === player.id);
          if (idx >= 0) state.players[idx] = player; else state.players.push(player);
        } catch {}
        render();
      };
    });
  } else if (state.tab === "profile") {
    setupMyProfileHandlers();
  } else if (state.tab === "profile-view") {
    setupViewProfileHandlers();
  }
}

boot();
