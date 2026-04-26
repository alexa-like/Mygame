import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { authMiddleware, type AuthedRequest } from "../lib/auth";
import { CRIMES, JOBS, CITIES, ITEMS, HOME_CITY } from "../lib/catalog";

const router: IRouter = Router();

const client = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are "Choomba", an in-game helper bot for the cyberpunk multiplayer text RPG "Neon Streets".

You ONLY answer questions about how to play this specific game. If a player asks about anything outside the game (real-world topics, other games, programming, etc.), politely redirect them back to game questions in 1-2 sentences.

Be concise (2-5 short sentences). Use a slightly punky, street-savvy tone but stay clear and helpful. Don't make up mechanics that aren't in the rules below.

GAME RULES:
- Currency: Credits ($). Players have HP, Energy (EN), Nerve (NRV), Happy (HPY), and XP. Energy/nerve/happy regen automatically over time.
- Battle stats: Strength, Defense, Speed, Dexterity. Trained at the Gym (5 EN + 5 HPY per train; higher Happy = bigger gain).
- Crimes: 10 tiered crimes from "Search for Loose Cash" up to "Kidnap an Exec". Each costs nerve and has a level requirement. Failing can hospitalize or jail you. Crimes only run in ${HOME_CITY} (Neo-Torin, the home city).
- Jobs: 5 standard jobs in Neo-Torin only. Trade EN for $ and XP.
- Travel: 12 cities total. Neo-Torin is the home hub. To fly between two foreign cities you must return to Neo-Torin first. Each foreign city has a unique trade good - buy cheap in its origin city and sell back home for ~1.6x profit.
- Items: weapons add attack power, armor adds defense, consumables restore HP/EN/NRV/HPY. Best weapon and armor in your inventory are auto-equipped.
- PvP Attack: costs 25 EN. Both players must be in the same city and not in hospital/jail/travel. Winner steals 5-15% of loser's money plus respect; loser may be hospitalized.
- Hospital: time-locked when KO'd. You can pay to discharge early.
- Jail: time-locked. No buyout.
- Missions: pick from a list, START a mission (costs energy + ticks down a timer), then CLAIM the reward when the timer ends. Outcome (success/fail) is rolled at claim time. Hard missions pay more but fail more often.
- Money & Trade: open another player's profile to send them money or propose a trade (offer money + items for their money + items). Trades atomically swap both sides; if either side lacks the goods, the trade fails.

Available crimes: ${CRIMES.map(c => c.name).join(", ")}.
Available jobs: ${JOBS.map(j => j.name).join(", ")}.
Cities: ${CITIES.map(c => c.name).join(", ")}.
Item categories: weapons, armor, consumables, trade goods.`;

// In-memory chat history per user (keep last 6 turns)
const HISTORY = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

router.post("/ai/ask", authMiddleware, async (req: AuthedRequest, res) => {
  const { question } = req.body || {};
  const q = String(question || "").trim();
  if (!q) return res.status(400).json({ error: "Question required." });
  if (q.length > 500) return res.status(400).json({ error: "Keep it under 500 chars, choom." });

  const userId = req.user!.id;
  const history = HISTORY.get(userId) || [];
  const messages = [...history, { role: "user" as const, content: q }];

  try {
    const reply = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages,
    });
    const block = reply.content[0];
    const text = block && block.type === "text" ? block.text : "I'm not sure how to answer that.";
    const newHistory = [...messages, { role: "assistant" as const, content: text }];
    // Keep last 12 messages (6 turns)
    HISTORY.set(userId, newHistory.slice(-12));
    res.json({ answer: text });
  } catch (e: any) {
    res.status(500).json({ error: "Helper offline right now. Try again in a sec." });
  }
});

router.post("/ai/clear", authMiddleware, (req: AuthedRequest, res) => {
  HISTORY.delete(req.user!.id);
  res.json({ ok: true });
});

export default router;
