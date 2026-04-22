import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, type AuthedRequest, privateProfile } from "../lib/auth";
import {
  doJob, actHealPaid, doCrime, doGym, startTravel,
  buyItem, sellItem, useItem, attackPlayer, getInventory, bustHospital,
  bestGear,
} from "../lib/game";
import { CRIMES, JOBS, CITIES, ITEMS, shopInventory, shopPriceFor, sellbackPriceFor, HOME_CITY } from "../lib/catalog";

const router: IRouter = Router();

router.get("/me", authMiddleware, async (req: AuthedRequest, res) => {
  const gear = await bestGear(req.user!.id);
  res.json({ user: privateProfile(req.user!), gear });
});

router.patch("/me", authMiddleware, async (req: AuthedRequest, res) => {
  const { bio, avatar, gender, avatarUrl, email } = req.body || {};
  const updates: Record<string, unknown> = {};
  if (typeof bio === "string") updates.bio = bio.slice(0, 280);
  if (typeof avatar === "string" && /^[a-z0-9-]{1,20}$/.test(avatar)) updates.avatar = avatar;
  if (typeof gender === "string" && ["male", "female", "other", "prefer_not", ""].includes(gender)) updates.gender = gender;
  if (typeof avatarUrl === "string") {
    const url = avatarUrl.trim();
    if (url === "") updates.avatarUrl = "";
    else if (/^https?:\/\/.+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(url) && url.length <= 500) updates.avatarUrl = url;
    else return res.status(400).json({ error: "Avatar URL must be an https image link (png/jpg/webp/gif)." });
  }
  if (typeof email === "string") {
    const e = email.trim().toLowerCase();
    if (e === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) updates.email = e;
    else return res.status(400).json({ error: "Invalid email." });
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
  const updated = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.user!.id)).returning();
  res.json({ user: privateProfile(updated[0]!) });
});

function actionResponse(res: any, r: any) {
  res.json({
    user: privateProfile(r.user),
    message: r.message,
    type: r.type,
    leveled: r.leveled,
    detail: r.detail,
  });
}

// --- Catalogs ---
router.get("/crimes", authMiddleware, (_req, res) => {
  res.json({ crimes: CRIMES });
});
router.get("/jobs", authMiddleware, (_req, res) => {
  res.json({ jobs: JOBS });
});
router.get("/cities", authMiddleware, (_req, res) => {
  res.json({ cities: CITIES, home: HOME_CITY });
});
router.get("/items", authMiddleware, (_req, res) => {
  res.json({ items: ITEMS });
});

// --- Actions ---
router.post("/crimes/:id", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await doCrime(req.user!, req.params.id!);
  actionResponse(res, r);
});

router.post("/jobs/:id", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await doJob(req.user!, req.params.id!);
  actionResponse(res, r);
});

router.post("/gym/:stat", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await doGym(req.user!, req.params.stat as any);
  actionResponse(res, r);
});

router.post("/heal", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await actHealPaid(req.user!);
  actionResponse(res, r);
});

router.post("/hospital/bust", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await bustHospital(req.user!);
  actionResponse(res, r);
});

// --- Travel ---
router.post("/travel", authMiddleware, async (req: AuthedRequest, res) => {
  const { city } = req.body || {};
  if (typeof city !== "string") return res.status(400).json({ error: "city required" });
  const r = await startTravel(req.user!, city);
  actionResponse(res, r);
});

// --- Shop & inventory ---
router.get("/shop", authMiddleware, (req: AuthedRequest, res) => {
  const u = req.user!;
  const stock = shopInventory(u.location).map((i) => ({
    ...i,
    buyPrice: shopPriceFor(i, u.location),
    sellPrice: sellbackPriceFor(i, u.location),
  }));
  res.json({ city: u.location, stock });
});

router.get("/inventory", authMiddleware, async (req: AuthedRequest, res) => {
  const inv = await getInventory(req.user!.id);
  res.json({ inventory: inv });
});

router.post("/shop/buy", authMiddleware, async (req: AuthedRequest, res) => {
  const { itemId, qty } = req.body || {};
  const r = await buyItem(req.user!, String(itemId || ""), Number(qty || 1));
  actionResponse(res, r);
});

router.post("/shop/sell", authMiddleware, async (req: AuthedRequest, res) => {
  const { itemId, qty } = req.body || {};
  const r = await sellItem(req.user!, String(itemId || ""), Number(qty || 1));
  actionResponse(res, r);
});

router.post("/items/use", authMiddleware, async (req: AuthedRequest, res) => {
  const { itemId } = req.body || {};
  const r = await useItem(req.user!, String(itemId || ""));
  actionResponse(res, r);
});

// --- PvP ---
router.post("/attack/:userId", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await attackPlayer(req.user!, req.params.userId!);
  res.json({
    user: privateProfile(r.user),
    message: r.message,
    type: r.type,
    leveled: r.leveled,
  });
});

export default router;
