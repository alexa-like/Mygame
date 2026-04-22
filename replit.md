# Neon Streets

A multiplayer browser-based cyberpunk text RPG with Torn-style mechanics.

## Stack
- **Frontend** (`artifacts/cyber-rpg`): Vanilla HTML/CSS/JS via Vite. ES modules, no framework.
- **Backend** (`artifacts/api-server`): Express + WebSocket on `/api/*` and `/api/ws`.
- **DB** (`lib/db`): Postgres via Drizzle. Schema in `lib/db/src/schema/index.ts`.

## Auth
Username + 4-8 digit PIN. sha256+salt hash, bearer token in `localStorage`, sent as `Authorization: Bearer <token>` for HTTP and `{kind:"auth",token}` over WS.

## Game Mechanics (Torn-style)

### Stats
- **Vitals**: HP, Energy (gym/work/missions/attacks), Nerve (crimes), Happy (gym multiplier), XP.
- **Battle stats**: Strength, Defense, Speed, Dexterity (real numbers, trained at gym).
- **Resources**: money (credits), respect.
- **Regen** (lazy, on every authed request): Energy +1/30s, Nerve +1/120s, Happy +5/60s.

### Crimes (`lib/catalog.ts` → CRIMES; `POST /api/crimes/:id`)
10 tiered crimes from "Search for Loose Cash" to "Kidnap an Exec". Each costs nerve, has a level requirement, success chance scales with dex+speed. Failure can hospitalize or jail you. Only available in **Neo-Torin** (home city).

### Gym (`POST /api/gym/:stat`)
Train Strength/Defense/Speed/Dexterity. Costs 5 EN + 5 Happy per train. Gain scales with happy multiplier (0.5x–2x) and diminishing returns on stat value.

### Jobs (`POST /api/jobs/:id`)
5 job types in Neo-Torin only. Trade EN for $ + XP. Pay scales with level.

### Travel (`POST /api/travel`)
12 cities (Neo-Torin home + 11 foreign). Costs $ and time. Must return to Neo-Torin before flying anywhere else (hub-and-spoke). Status banner with countdown shown during travel.

### Items (`lib/catalog.ts` → ITEMS)
- **Weapons**: combat_knife → plasma_rifle (+ATK)
- **Armor**: leather_jacket → exo_armor (+DEF)
- **Consumables**: stim_pack (HP), nerve_booster (NRV), mood_pill (HPY), energy_shot (EN)
- **Trade items**: each foreign city has a unique trade good — buy cheap in origin (60% price), sell back home for 1.6× — classic Torn travel-trading loop.

Shop endpoints: `GET /api/shop` (current city), `POST /api/shop/buy`, `POST /api/shop/sell`, `POST /api/items/use`. Inventory: `GET /api/inventory`. Best weapon/armor in inventory is auto-equipped (highest power).

### PvP (`POST /api/attack/:userId`)
Costs 25 EN. Effective attack = STR×0.55 + SPD×0.25 + DEX×0.20 + weapon. Effective defense = DEF×0.65 + DEX×0.20 + SPD×0.15 + armor. ±25% RNG. Winner damages loser; if loser hits 0 HP they're hospitalized. Winner steals 5–15% of loser's money + respect. Both must be in same city, "ok" status. Logged to `attacks` table.

### Hospital / Jail
Time-locked status (`hospitalUntil`/`jailUntil`). Hospital can be paid out via `POST /api/hospital/bust` (cost scales with remaining time + level).

### Missions (kept lightweight)
4 random per user, easy/medium/hard. `GET /api/missions`, `POST /api/missions/refresh`, `POST /api/missions/:id/complete`.

### Chat (WS)
World chat (broadcast) + private 1:1 DMs. Online presence tracked.

## Files
- Catalog: `artifacts/api-server/src/lib/catalog.ts`
- Game logic: `artifacts/api-server/src/lib/game.ts`
- Auth + regen: `artifacts/api-server/src/lib/auth.ts`
- Routes: `artifacts/api-server/src/routes/me.ts` (most), `routes/players.ts`, `routes/chat.ts`, `routes/auth.ts`, `routes/missions.ts`
- WS: `artifacts/api-server/src/lib/wsServer.ts`
- Frontend: `artifacts/cyber-rpg/src/{game.js,api.js,style.css}`

## Tabs (frontend)
home / crimes / gym / jobs / missions / travel / items / chat / players / profile + dynamic profile-view (with Attack button).
