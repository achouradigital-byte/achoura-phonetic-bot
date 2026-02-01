import express from "express";
import { transliterate } from "arabic-transliteration";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check
app.get("/", (req, res) => res.send("Achoura Phonetic Bot is running!"));

// Normalisation arabe
function normalizeArabic(text) {
  return text
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[ًٌٍَُِّْ]/g, "")
    .trim();
}

// Scientifique → phonétique lisible
function scientificToPhonetic(text) {
  return text
    .replace(/ḥ/g, "h")
    .replace(/ḍ/g, "d")
    .replace(/ṣ/g, "s")
    .replace(/ṭ/g, "t")
    .replace(/ẓ/g, "z")
    .replace(/ʿ/g, "a")
    .replace(/ʾ/g, "")
    .replace(/gh/g, "gh")
    .replace(/kh/g, "kh")
    .replace(/th/g, "th")
    .replace(/dh/g, "dh")
    .replace(/sh/g, "sh");
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
    [/^abd allh$/i, "Abdullah"],
    [/^abd al rhmn$/i, "Abd al-Rahman"],
    [/^abd al krym$/i, "Abd al-Karim"]
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
  const scientific = transliterate(normalized, { longVowels: true, hamza: false });
  let phonetic = scientificToPhonetic(scientific);
  phonetic = phonetic.replace(/-/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  phonetic = humanCorrections(phonetic);
  return phonetic.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Détection prénom / filiation / nom
function detectNameParts(arabicText) {
  const words = arabicText.split(" ");
  let firstName = [], lastName = [], binChain = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "بن" || w === "ابن") { binChain.push(w, words[i + 1] || ""); i++; }
    else if (w.startsWith("ال")) { lastName.push(w); }
    else if (firstName.length < 2) { firstName.push(w); }
    else { lastName.push(w); }
  }
  return {
    firstName: firstName.join(" ").trim(),
    bin: binChain.join(" ").trim(),
    lastName: lastName.join(" ").trim()
  };
}

// Endpoint Slack
app.post("/slack", (req, res) => {
  try {
    const input = req.body.text || "";
    if (!input.trim()) return res.json({ response_type: "ephemeral", text: "❌ Veuillez entrer un nom arabe." });
    const parts = detectNameParts(normalizeArabic(input));
    const first = smartTransliterate(parts.firstName || "Inconnu");
    const bin = parts.bin ? smartTransliterate(parts.bin) : "";
    const last = parts.lastName ? smartTransliterate(parts.lastName) : "";
    let message = `🧑 *Prénom* : ${first}`;
    if (bin) message += `\n👨‍👦 *Filiation* : ${bin}`;
    if (last) message += `\n👪 *Nom* : ${last}`;
    res.json({ response_type: "in_channel", text: message });
  } catch (error) {
    console.error("Erreur Slack:", error);
    res.json({ response_type: "ephemeral", text: "❌ Erreur interne du bot" });
  }
});

// Serveur Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Achoura Phonetic Bot running on port ${PORT}`));
