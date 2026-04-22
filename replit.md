# Neon Streets

A multiplayer browser-based cyberpunk text RPG (inspired by Torn City).

## Stack
- **Frontend** (`artifacts/cyber-rpg`): Vanilla HTML/CSS/JS served via Vite. ES modules, no framework.
- **Backend** (`artifacts/api-server`): Express + WebSocket (`ws`) on `/api/*` and `/api/ws`.
- **Database** (`lib/db`): PostgreSQL via Drizzle ORM. Schema in `lib/db/src/schema/index.ts`.

## Auth
Simple username + 4-8 digit PIN. PIN is sha256-hashed with a constant salt. A bearer token is generated on register and rotated on every login. Token is stored in `localStorage` and sent as `Authorization: Bearer <token>` for HTTP and as `{kind:"auth",token}` over WebSocket.

## Game Features
- **Stats**: money, level, XP, health, energy. XP curve `50 * 1.5^(level-1)`. Level-ups raise max health/energy and fully heal.
- **Actions** (`POST /api/me/action` with `type`): `crime`, `work`, `train`, `heal_paid`, `heal_free`. All logic server-side in `artifacts/api-server/src/lib/game.ts`.
- **Missions** (`/api/missions`, `/api/missions/refresh`, `/api/missions/:id/complete`): 4 random missions per user, refreshed on demand or after 2 min TTL. Difficulty (easy/medium/hard) scales reward and success chance.
- **Players** (`/api/players`, `/api/players/:id`): listing + public profiles.
- **Profile** (`PATCH /api/me`): edit `bio` and `avatar`.
- **Chat**: real-time via WebSocket at `/api/ws`.
  - World chat (broadcast)
  - Private DMs between players
  - History persisted in `messages` table; loaded on demand.
  - Online presence broadcast via `{kind:"online",userIds:[...]}`.

## Files of note
- `artifacts/api-server/src/index.ts` — http server + ws attach
- `artifacts/api-server/src/lib/wsServer.ts` — WebSocket logic
- `artifacts/api-server/src/lib/game.ts` — game mechanics
- `artifacts/api-server/src/lib/auth.ts` — token + middleware
- `artifacts/api-server/src/routes/{auth,me,players,missions,chat}.ts`
- `artifacts/cyber-rpg/src/{api,game}.js` + `style.css`
- `lib/db/src/schema/index.ts` — `users` and `messages` tables
