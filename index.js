import express from "express";
import { transliterate } from "arabic-transliteration";

const app = express();

// Slack envoie les données en x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

/* -------------------------
  1. Normalisation arabe
-------------------------- */
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

/* -------------------------
  2. Conversion scientifique → phonétique
-------------------------- */
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

/* -------------------------
  3. Corrections humaines pour prénoms connus
-------------------------- */
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

/* -------------------------
  4. Fonction principale de translittération
-------------------------- */
function smartTransliterate(text) {
  if (!text) return "Nom vide";

  const normalized = normalizeArabic(text);

  const scientific = transliterate(normalized, {
    longVowels: true,
    hamza: false
  });

  let phonetic = scientificToPhonetic(scientific);

  phonetic = phonetic
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  phonetic = humanCorrections(phonetic);

  // Capitalisation des mots
  return phonetic
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* -------------------------
  5. Détection prénom / filiation / nom
-------------------------- */
function detectNameParts(arabicText) {
  const words = arabicText.split(" ");

  let firstName = [];
  let lastName = [];
  let binChain = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    if (w === "بن" || w === "ابن") {
      binChain.push(w, words[i + 1] || "");
      i++;
    } 
    else if (w.startsWith("ال")) {
      lastName.push(w);
    } 
    else if (firstName.length < 2) {
      firstName.push(w);
    } 
    else {
      lastName.push(w);
    }
  }

  return {
    firstName: firstName.join(" "),
    bin: binChain.join(" "),
    lastName: lastName.join(" ")
  };
}

/* -------------------------
  6. Endpoint Slack
-------------------------- */
app.post("/slack", (req, res) => {
  const input = req.body.text || "";

  if (!input.trim()) {
    return res.json({
      response_type: "ephemeral",
      text: "❌ Veuillez entrer un nom arabe."
    });
  }

  const parts = detectNameParts(normalizeArabic(input));

  const first = smartTransliterate(parts.firstName);
  const bin = parts.bin ? smartTransliterate(parts.bin) : "";
  const last = parts.lastName ? smartTransliterate(parts.lastName) : "";

  let message = `🧑 *Prénom* : ${first}`;
  if (bin) message += `\n👨‍👦 *Filiation* : ${bin}`;
  if (last) message += `\n👪 *Nom* : ${last}`;

  res.json({
    response_type: "in_channel",
    text: message
  });
});

/* -------------------------
  7. Health check
-------------------------- */
app.get("/", (_, res) => res.send("Achoura Phonetic Bot is running!"));

/* -------------------------
  8. Démarrage serveur
-------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Achoura Phonetic Bot running on port", PORT);
});
