import express from "express";
import transliterate from "arabic-transliteration";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check
app.get("/", (req, res) => res.send("Achoura Phonetic Bot is running!"));

// Normalisation arabe
function normalizeArabic(text) {
  if (!text) return "";
  return text
    .replace(/\u064B|\u064C|\u064D|\u064E|\u064F|\u0650|\u0652|\u0651/g, "") // suppress diacritics
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Scientifique → phonétique lisible
function scientificToPhonetic(text) {
  if (!text) return text;
  // 1) Handle common digraphs first so they are not split by single-char replacements
  const digraphs = {
    "sh": "sh",
    "kh": "kh",
    "gh": "gh",
    "th": "th",
    "dh": "dh"
  };
  Object.entries(digraphs).forEach(([k, v]) => {
    text = text.replace(new RegExp(k, "g"), v);
  });

  // 2) Replace single scientific characters (Unicode) using a map
  const singleMap = {
    "ḥ": "h",
    "ḍ": "d",
    "ṣ": "s",
    "ṭ": "t",
    "ẓ": "z",
    "ʿ": "a",
    "ʾ": ""
  };
  text = text.replace(/[ḥḍṣṭẓʿʾ]/g, (ch) => singleMap[ch] || ch);

  return text;
}

// Corrections humaines
function humanCorrections(text) {
  const fixes = [
    [/^mhmd$/i, "Muhammad"],
    [/^muhammad$/i, "Muhammad"],
    [/^ahmd$/i, "Ahmad"],
    [/^ywsf$/i, "Yusuf"],
    [/^aly$/i, "Ali"],
    [/^fatmh$/i, "Fatima"],
    [/^abd(?: |-|)allh$/i, "Abdullah"],
    [/^abd(?: |-|)al(?: |-|)r?hmn$/i, "Abd al-Rahman"],
    [/^abd(?: |-|)al(?: |-|)krym$/i, "Abd al-Karim"]
  ];
  for (const [pattern, value] of fixes) {
    if (pattern.test(text)) return value;
  }
  return text;
}

// Translittération principale
function smartTransliterate(text) {
  if (!text) return "Nom vide";
  const normalized = normalizeArabic(text);
  // transliterate peut lever une erreur, on protège
  let scientific;
  try {
    // options dépendant du paquet; si ceux-ci ne sont pas supportés, la fonction retournera quand même une string
    scientific = transliterate(normalized, { longVowels: true, hamza: false });
  } catch (e) {
    // fallback: appeler sans options
    scientific = transliterate(normalized);
  }
  let phonetic = scientificToPhonetic(scientific || "");
  phonetic = phonetic.replace(/-/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  phonetic = humanCorrections(phonetic);
  // Capitalize each word
  return phonetic
    .split(" ")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Détection prénom / filiation / nom
function detectNameParts(arabicText) {
  if (!arabicText) return { firstName: "", bin: "", lastName: "" };
  const words = arabicText.trim().split(/\s+/);
  const firstName = [];
  const lastName = [];
  const binChain = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "بن" || w === "ابن") {
      // add "بن <name>" as a unit in filiation
      const next = words[i + 1] || "";
      binChain.push(`${w} ${next}`.trim());
      i++; // skip next word
    } else if (w.startsWith("ال") && firstName.length >= 1) {


