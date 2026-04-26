// Static game catalogs: cities, crimes, jobs, items.

export interface City {
  id: string;
  name: string;
  flag: string;
  travelSeconds: number; // time to travel from home (Torn)
  travelCost: number;
}

export const HOME_CITY = "neo_torin";

export const CITIES: City[] = [
  { id: "neo_torin",     name: "Neo-Torin",      flag: "🌃", travelSeconds: 0,   travelCost: 0 },
  { id: "mexicantown",   name: "Mexicantown",    flag: "🌵", travelSeconds: 25,  travelCost: 150 },
  { id: "haven_isles",   name: "Haven Isles",    flag: "🏝️", travelSeconds: 35,  travelCost: 600 },
  { id: "north_dome",    name: "North Dome",     flag: "❄️", travelSeconds: 40,  travelCost: 750 },
  { id: "kahuna_strip",  name: "Kahuna Strip",   flag: "🌺", travelSeconds: 45,  travelCost: 1200 },
  { id: "old_londinium", name: "Old Londinium",  flag: "🌧️", travelSeconds: 55,  travelCost: 2000 },
  { id: "tango_quarter", name: "Tango Quarter",  flag: "💃", travelSeconds: 60,  travelCost: 1800 },
  { id: "alpine_vault",  name: "Alpine Vault",   flag: "🏔️", travelSeconds: 60,  travelCost: 3000 },
  { id: "neo_kyo",       name: "Neo-Kyo",        flag: "🏯", travelSeconds: 75,  travelCost: 3600 },
  { id: "shanghai_pit",  name: "Shanghai Pit",   flag: "🐉", travelSeconds: 80,  travelCost: 3500 },
  { id: "sand_emirate",  name: "Sand Emirate",   flag: "🏜️", travelSeconds: 85,  travelCost: 4200 },
  { id: "veld_station",  name: "Veld Station",   flag: "🦁", travelSeconds: 90,  travelCost: 5000 },
];

// --- Items ---

export type ItemCategory = "weapon" | "armor" | "consumable" | "trade";

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  basePrice: number;
  description: string;
  // weapon/armor
  attackPower?: number;
  defensePower?: number;
  // consumable effect
  effect?: { stat: "health" | "energy" | "nerve" | "happy"; amount: number };
  // for trade items: which city sells cheap (origin)
  origin?: string;
}

export const ITEMS: Item[] = [
  // Weapons
  { id: "combat_knife",  name: "Combat Knife",  category: "weapon", basePrice: 200,    attackPower: 6,  description: "Cheap, reliable, brutal." },
  { id: "neon_blade",    name: "Neon Blade",    category: "weapon", basePrice: 1200,   attackPower: 14, description: "Plasma-edged katana from Neo-Kyo." },
  { id: "pistol",        name: "9mm Pistol",    category: "weapon", basePrice: 2500,   attackPower: 22, description: "Standard issue street piece." },
  { id: "smg",           name: "Sub-Machine Gun", category: "weapon", basePrice: 6000, attackPower: 35, description: "Spray and pray, choom." },
  { id: "plasma_rifle",  name: "Plasma Rifle",  category: "weapon", basePrice: 18000,  attackPower: 60, description: "Melts armor like butter." },

  // Armor
  { id: "leather_jacket", name: "Leather Jacket", category: "armor", basePrice: 300,   defensePower: 5,  description: "Looks cool, blocks knives." },
  { id: "kevlar_vest",    name: "Kevlar Vest",    category: "armor", basePrice: 2000,  defensePower: 16, description: "Standard street defense." },
  { id: "exo_armor",      name: "Exo Armor",      category: "armor", basePrice: 9000,  defensePower: 35, description: "Powered combat suit." },

  // Consumables
  { id: "stim_pack",      name: "Stim Pack",      category: "consumable", basePrice: 250,  effect: { stat: "health", amount: 30 }, description: "Restores 30 HP." },
  { id: "nerve_booster",  name: "Nerve Booster",  category: "consumable", basePrice: 400,  effect: { stat: "nerve",  amount: 10 }, description: "Restores 10 nerve." },
  { id: "mood_pill",      name: "Mood Pill",      category: "consumable", basePrice: 600,  effect: { stat: "happy",  amount: 75 }, description: "Restores 75 happy." },
  { id: "energy_shot",    name: "Energy Shot",    category: "consumable", basePrice: 350,  effect: { stat: "energy", amount: 25 }, description: "Restores 25 energy." },

  // Trade items (cheap in origin city, sell anywhere else for profit)
  { id: "cigar_box",     name: "Hand-rolled Cigars", category: "trade", basePrice: 800,  origin: "mexicantown",   description: "Premium tobacco roll." },
  { id: "pearl_string",  name: "Pearl String",        category: "trade", basePrice: 2200, origin: "haven_isles",   description: "Rare deep-sea pearls." },
  { id: "syrup_jug",     name: "Maple Syrup Jug",     category: "trade", basePrice: 1500, origin: "north_dome",    description: "Smuggled from the frostlands." },
  { id: "tiki_idol",     name: "Tiki Idol",           category: "trade", basePrice: 2600, origin: "kahuna_strip",  description: "Hand-carved volcanic stone." },
  { id: "tea_chest",     name: "Tea Chest",           category: "trade", basePrice: 3400, origin: "old_londinium", description: "Old-world rare blend." },
  { id: "tango_shoes",   name: "Tango Shoes",         category: "trade", basePrice: 3000, origin: "tango_quarter", description: "Custom leatherwork." },
  { id: "chrono_watch",  name: "Chrono Watch",        category: "trade", basePrice: 5500, origin: "alpine_vault",  description: "Precision timepiece." },
  { id: "jade_carving",  name: "Jade Carving",        category: "trade", basePrice: 6000, origin: "shanghai_pit",  description: "Imperial-grade jade." },
  { id: "katana",        name: "Antique Katana",      category: "trade", basePrice: 6800, origin: "neo_kyo",       description: "Folded a thousand times." },
  { id: "oil_canister",  name: "Black Oil Canister",  category: "trade", basePrice: 7500, origin: "sand_emirate",  description: "Pre-collapse petroleum." },
  { id: "raw_diamond",   name: "Raw Diamond",         category: "trade", basePrice: 9000, origin: "veld_station",  description: "Uncut, untraceable." },
];

export function itemById(id: string): Item | undefined {
  return ITEMS.find((i) => i.id === id);
}

// Returns shop price for an item in a given city.
// Trade items are 40% cheaper in origin city, 60% pricier in foreign cities.
// Weapons/armor/consumables are standard price everywhere.
export function shopPriceFor(item: Item, cityId: string): number {
  if (item.category !== "trade") return item.basePrice;
  if (item.origin === cityId) return Math.round(item.basePrice * 0.6);
  return Math.round(item.basePrice * 1.6);
}

// What's sold in a given city's shop
export function shopInventory(cityId: string): Item[] {
  return ITEMS.filter((i) => {
    if (i.category === "trade") {
      // Origin sells own + maybe 1-2 others. Keep simple: each city sells own trade item only.
      return i.origin === cityId;
    }
    // Home sells weapons/armor/consumables; foreign cities sell consumables only.
    if (cityId === HOME_CITY) return i.category === "weapon" || i.category === "armor" || i.category === "consumable";
    return i.category === "consumable";
  });
}

// City buys (sell-back) prices: 90% of shop price for that city.
export function sellbackPriceFor(item: Item, cityId: string): number {
  return Math.round(shopPriceFor(item, cityId) * 0.9);
}

// --- Crimes ---

export interface Crime {
  id: string;
  name: string;
  description: string;
  levelReq: number;
  nerveCost: number;
  baseSuccess: number; // 0..1
  moneyMin: number;
  moneyMax: number;
  xpReward: number;
  jailRisk: number; // chance to land in jail on failure
}

export const CRIMES: Crime[] = [
  { id: "search_cash",   name: "Search for Loose Cash", description: "Comb the alleys for credits dropped by drunk corpos.",          levelReq: 1,  nerveCost: 1,  baseSuccess: 0.92, moneyMin: 5,    moneyMax: 18,    xpReward: 2,  jailRisk: 0.02 },
  { id: "pickpocket",    name: "Pickpocket",            description: "Lift a wallet off a distracted commuter on the maglev.",       levelReq: 2,  nerveCost: 2,  baseSuccess: 0.82, moneyMin: 25,   moneyMax: 70,    xpReward: 5,  jailRisk: 0.05 },
  { id: "shoplift",      name: "Shoplifting",           description: "Walk out of a noodle stand with stuff that wasn't paid for.",  levelReq: 4,  nerveCost: 3,  baseSuccess: 0.74, moneyMin: 50,   moneyMax: 140,   xpReward: 8,  jailRisk: 0.08 },
  { id: "hotwire",       name: "Hotwire a Hover-bike",  description: "Lift somebody's joyride from outside a netcafe.",              levelReq: 6,  nerveCost: 5,  baseSuccess: 0.66, moneyMin: 100,  moneyMax: 280,   xpReward: 14, jailRisk: 0.12 },
  { id: "burglary",      name: "Apartment Burglary",    description: "Crack a low-rent unit while the owner's at work.",             levelReq: 9,  nerveCost: 7,  baseSuccess: 0.60, moneyMin: 200,  moneyMax: 520,   xpReward: 22, jailRisk: 0.16 },
  { id: "atm_hack",      name: "ATM Hack",              description: "Splice the comm-port and drain a back-alley terminal.",        levelReq: 12, nerveCost: 10, baseSuccess: 0.55, moneyMin: 380,  moneyMax: 900,   xpReward: 32, jailRisk: 0.20 },
  { id: "drug_run",      name: "Drug Run",              description: "Move chrome-grade product across two precincts.",              levelReq: 15, nerveCost: 12, baseSuccess: 0.55, moneyMin: 550,  moneyMax: 1300,  xpReward: 42, jailRisk: 0.22 },
  { id: "armed_robbery", name: "Armed Robbery",         description: "Stick up a noodle joint after closing time.",                  levelReq: 18, nerveCost: 15, baseSuccess: 0.50, moneyMin: 900,  moneyMax: 2200,  xpReward: 58, jailRisk: 0.28 },
  { id: "cyber_heist",   name: "Cyber Heist",           description: "Break into a low-tier corp's data vault and bleed it dry.",    levelReq: 22, nerveCost: 20, baseSuccess: 0.45, moneyMin: 1800, moneyMax: 4400,  xpReward: 90, jailRisk: 0.32 },
  { id: "kidnap",        name: "Kidnap an Exec",        description: "Grab a mid-tier executive and ransom them to their corp.",     levelReq: 28, nerveCost: 25, baseSuccess: 0.40, moneyMin: 3500, moneyMax: 8500,  xpReward: 140, jailRisk: 0.38 },
];

export function crimeById(id: string): Crime | undefined {
  return CRIMES.find((c) => c.id === id);
}

// --- Jobs ---

export interface Job {
  id: string;
  name: string;
  energyCost: number;
  basePay: number;
  baseXp: number;
  description: string;
}

export const JOBS: Job[] = [
  { id: "noodle_cook",  name: "Noodle Stand Cook",     energyCost: 10, basePay: 18,  baseXp: 3, description: "Greasy work, honest pay." },
  { id: "courier",      name: "Synth-Bike Courier",    energyCost: 12, basePay: 32,  baseXp: 4, description: "Race packages across the grid." },
  { id: "bouncer",      name: "Club Bouncer",          energyCost: 15, basePay: 55,  baseXp: 6, description: "Throw scraps out of the dance floor." },
  { id: "mechanic",     name: "Cyber-Mechanic",        energyCost: 18, basePay: 90,  baseXp: 8, description: "Patch chrome for paying punks." },
  { id: "hacker_temp",  name: "Freelance Hacker",      energyCost: 22, basePay: 150, baseXp: 12, description: "Find exploits for shady fixers." },
];

export function jobById(id: string): Job | undefined {
  return JOBS.find((j) => j.id === id);
}
