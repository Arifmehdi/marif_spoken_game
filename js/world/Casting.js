/**
 * Casting - who an NPC is. One answer, used by both the body and the voice.
 *
 * These two decisions used to be made in different files from different tables:
 * the 3D model came from a gendered pool keyed on role (in Game), the voice came
 * from a per-role table (in SpeechOutput). Nothing kept them in step, so the
 * guide - declared male, given a male body - spoke with a woman's voice. Every
 * caller now asks npcGender() instead of deciding for itself.
 */
import { MODELS } from "./ModelLibrary.js";

/** What a role implies when nothing more specific is known. */
export const ROLE_GENDER = {
  teacher: "female",
  mother: "female",
  doctor: "female",
  friend: "female",
  shopkeeper: "male",
  waiter: "male",
  police: "male"
};

/**
 * A title in the character's name outranks the role: a lesson can introduce
 * "Mr. Verma, the teacher" without also having to spell out a gender field.
 * Neutral titles (Dr., Officer) are deliberately absent so they fall through
 * to the role.
 */
const TITLES = [
  [/^(mr|mister|sir|master|uncle|bhaiya)\b/i, "male"],
  [/^(mrs|ms|miss|madam|ma'am|aunty|auntie|didi)\b/i, "female"],
  [/^(mummy|mommy|mum|mom|amma|maa)\b/i, "female"],
  [/^(papa|daddy|dad|baba|appa)\b/i, "male"]
];

/** @returns {"male"|"female"} */
export function npcGender(def = {}) {
  if (def.gender === "male" || def.gender === "female") return def.gender;

  const name = String(def.name || "").trim();
  for (const [title, gender] of TITLES) {
    if (title.test(name)) return gender;
  }

  return ROLE_GENDER[def.role] || "female";
}

export const NPC_POOLS = {
  female: ["npcWoman1", "npcWoman2"],
  male: ["npcMan1", "npcMan2"]
};

export const NPC_MODEL_FALLBACK = "npcWoman2";

/** Stable per-location casting: same inputs always give the same character. */
export function pickNpcModel(def, locationId) {
  if (def.model && MODELS[def.model]) return def.model;

  const pool = NPC_POOLS[npcGender(def)] || NPC_POOLS.female;

  const seed = (def.id || def.role || "npc") + "@" + locationId;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}
