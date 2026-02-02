const express = require("express");
const bodyParser = require("body-parser");

let translit;
try {
  translit = require("arabic-transliteration").transliterate;
} catch (e) {
  translit = null;
}

const app = express();

// Slack envoie en x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

/* ==========================
   PAGE RACINE (test Railway)
========================== */
app.get("/", (req, res) => {
  res.send("Achoura Phonetic Bot is running!");
});

/* ==========================
   UTILITAIRES TRANSLITTÉRATION
========================== */

// fallback simple (sécurisé)
const basicMap = {
  ا:"a", ب:"b", ت:"t", ث:"th", ج:"j", ح:"h", خ:"kh",
  د:"d", ذ:"dh", ر:"r", ز:"z", س:"s", ش:"sh",
  ص:"s", ض:"d", ط:"t", ظ:"z", ع:"a", غ:"gh",
  ف:"f", ق:"q", ك:"k", ل:"l", م:"m", ن:"n",
  ه:"h", و:"w", ي:"y", ة:"a", ى:"a", ء:""
};

function fallback(ar) {
  return ar
    .split("")
    .map(c => basicMap[c] || "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function humanize(text) {
  return text
    .replace(/ā/g, "aa")
    .replace(/ī/g, "ii")
    .replace(/ū/g, "uu")
    .replace(/ḥ|ḍ|ṣ|ṭ|ẓ/g, m => ({
      "ḥ":"h","ḍ":"d","ṣ":"s","ṭ":"t","ẓ":"z"
    })[m])
    .replace(/ʿ/g, "a")
    .toLowerCase()
    .replace(/\b\w/g, l => l.toUpperCase());
}

function smartTransliterate(arabic) {
  if (!arabic) return "";

  let sci = "";
  if (translit) {
    try {
      sci = translit(arabic);
    } catch {
      sci = fallback(arabic);
    }
  } else {
    sci = fallback(arabic);
  }

  let phon = humanize(sci);

  // corrections connues (noms fréquents)
  phon = phon
    .replace(/\bMhmd\b/i, "Muhammad")
    .replace(/\bMohamed\b/i, "Muhammad")
    .replace(/\bYwsf\b/i, "Yusuf")
    .replace(/\bAhmd\b/i, "Ahmad");

  return phon;
}

/* ==========================
   SLASH COMMAND /phon
========================== */
app.post("/phon", (req, res) => {
  res.setHeader("Content-Type", "application/json");

  const text = req.body?.text?.trim();

  if (!text) {
    return res.json({
      response_type: "ephemeral",
      text: "❌ Exemple : `/phon محمد بن أحمد`"
    });
  }

  const words = text.split(/\s+/);
  const result = words.map(w => {
    if (w === "بن" || w === "ابن") return "bin";
    return smartTransliterate(w);
  }).join(" ");

  return res.json({
    response_type: "in_channel",
    text: `🔤 Phonetic : *${result}*`
  });
});

/* ==========================
   START SERVER
========================== */
app.listen(PORT, () => {
  console.log("Achoura Phonetic Bot running on port", PORT);
});
