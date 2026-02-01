import express from "express";
import { transliterate } from "arabic-transliteration";

const app = express();
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
  2. Scientifique → phonétique
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
  3. Corrections humaines
-------------------------- */
function humanCorrections(text) {
  const fixes = [
    [/^mhmmd$|^mhmd$/i, "Muhammad"],
    [/^ahmd$/i, "Ahmad"],
    [/^ywsf$/i, "Yusuf"],
    [/^aly$/i, "Ali"],
    [/^fAtmh$|^fatmh$/i, "Fatima"],
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
  4. Fonction principale
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

  return phonetic
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* -------------------------
  Slack endpoint
-------------------------- */
app.post("/slack", (req, res) => {
  const text = req.body.text || "";

  res.json({
    response_type: "in_channel",
    text: `🔤 *Phonétique :* ${smartTransliterate(text)}`
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Achoura Phonetic Bot running on port", PORT);
});
