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

### Missions (time-gated)
Up to 4 contracts per user, easy/medium/hard. Flow: **Start** (consumes EN, sets `completesAt`) → live countdown → **Claim** (rolls success: easy 0.85, medium 0.70, hard 0.55; on failure player takes HP damage and may be hospitalized). Routes: `GET /api/missions`, `POST /api/missions/refresh`, `POST /api/missions/:id/start`, `POST /api/missions/:id/claim`, `POST /api/missions/:id/abort`. XP curve lowered to `30 * 1.25^(L-1)`.

### Chat (WS)
World chat (broadcast) + private 1:1 DMs. Online presence tracked.

### Money transfer + Trade
- `POST /api/transfer { toUserId, amount, note }` — instant credits transfer with audit row in `transfers` table.
- Trade proposals: `POST /api/trades` with `{toUserId, offerMoney, offerItems[], wantMoney, wantItems[]}`. Items are NOT escrowed — both sides re-verified atomically inside a DB transaction at accept time. `POST /api/trades/:id/accept|reject`, `GET /api/trades` returns `{incoming, outgoing, history}`. Stored in `trades` table.

### AI Helper Bot ("Choomba")
`POST /api/ai/ask { question }` → claude-haiku-4-5 via Anthropic AI integration. System prompt restricts answers to game-only topics. In-memory rolling history per user (last 12 messages). `POST /api/ai/clear` resets it.

### Roles & Admin
- Roles: `player` / `admin` / `dev`. The first registered user is auto-promoted to `dev`.
- Devs only can change roles; devs cannot be demoted or deleted.
- Admin/dev console (`/api/admin/*`): list users, inspect inventories, grant money or items, apply hospital/jail or full-heal, promote/demote, delete accounts.

## Files
- Catalog: `artifacts/api-server/src/lib/catalog.ts`
- Game logic: `artifacts/api-server/src/lib/game.ts` (xpForNext lowered)
- Auth + regen + role helpers: `artifacts/api-server/src/lib/auth.ts`
- Trade engine: `artifacts/api-server/src/lib/trade.ts`
- Mission engine: `artifacts/api-server/src/lib/missions.ts`
- Routes: `routes/{auth,me,players,chat,missions,trade,admin,ai}.ts`
- WS: `artifacts/api-server/src/lib/wsServer.ts`
- Schema: `lib/db/src/schema/index.ts` (users add `email,gender,avatarUrl,role`; new `transfers`, `trades`, time-gated `missions`)
- Frontend: `artifacts/cyber-rpg/src/{game.js,api.js,style.css}`

## Tabs (frontend)
home / crimes / gym / jobs / missions / travel / items / **trade** / chat / **helper** / players / profile (+ **admin** for staff) + dynamic profile-view (DM, Send $, Trade, Attack buttons).

## Notes (free tier constraints)
- No real email confirmation: emails are stored on the user but unverified.
- Profile pictures are URL-only (paste a direct image link), since file uploads aren't enabled.
- Anthropic uses Replit's AI Integration proxy (`AI_INTEGRATIONS_ANTHROPIC_*` env).
