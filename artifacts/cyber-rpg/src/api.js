const API = "/api";

let token = localStorage.getItem("ns-token") || "";

export function getToken() { return token; }
export function setToken(t) {
  token = t || "";
  if (token) localStorage.setItem("ns-token", token);
  else localStorage.removeItem("ns-token");
}

async function http(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  register: (username, pin) => http("POST", "/auth/register", { username, pin }),
  login: (username, pin) => http("POST", "/auth/login", { username, pin }),
  me: () => http("GET", "/me"),
  updateMe: (patch) => http("PATCH", "/me", patch),
  players: () => http("GET", "/players"),
  player: (id) => http("GET", `/players/${id}`),

  crimes: () => http("GET", "/crimes"),
  doCrime: (id) => http("POST", `/crimes/${id}`),
  jobs: () => http("GET", "/jobs"),
  doJob: (id) => http("POST", `/jobs/${id}`),
  gym: (stat) => http("POST", `/gym/${stat}`),
  heal: () => http("POST", "/heal"),
  bustHospital: () => http("POST", "/hospital/bust"),

  cities: () => http("GET", "/cities"),
  travel: (city) => http("POST", "/travel", { city }),

  shop: () => http("GET", "/shop"),
  inventory: () => http("GET", "/inventory"),
  buy: (itemId, qty) => http("POST", "/shop/buy", { itemId, qty }),
  sell: (itemId, qty) => http("POST", "/shop/sell", { itemId, qty }),
  useItem: (itemId) => http("POST", "/items/use", { itemId }),

  attack: (userId) => http("POST", `/attack/${userId}`),

  missions: () => http("GET", "/missions"),
  refreshMissions: () => http("POST", "/missions/refresh"),
  completeMission: (id) => http("POST", `/missions/${id}/complete`),

  worldChat: () => http("GET", "/chat/world"),
  privateChat: (uid) => http("GET", `/chat/private/${uid}`),
};

// --- WebSocket ---
let ws = null;
let wsListeners = new Set();
let reconnectTimer = null;
let onlineUserIds = new Set();

export function onWs(fn) { wsListeners.add(fn); return () => wsListeners.delete(fn); }
export function getOnlineIds() { return onlineUserIds; }
function emit(evt) { for (const fn of wsListeners) fn(evt); }

export function connectWs() {
  if (!token) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/api/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ kind: "auth", token }));
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.kind === "online") onlineUserIds = new Set(data.userIds);
      emit(data);
    } catch {}
  };
  ws.onclose = () => {
    ws = null;
    if (token) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connectWs, 2000); }
  };
  ws.onerror = () => {};
}

export function disconnectWs() {
  if (ws) { ws.close(); ws = null; }
  clearTimeout(reconnectTimer);
}

export function sendWorldMsg(content) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: "world_msg", content }));
}
export function sendPrivateMsg(toUserId, content) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: "private_msg", toUserId, content }));
}
