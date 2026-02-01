const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");

// tentative d'interop quel que soit l'export du paquet
let arabicTranslitPkg = null;
try {
  arabicTranslitPkg = require("arabic-transliteration");
} catch (e) {
  // will handle below with fallback
  arabicTranslitPkg = null;
}
const transliterateLib = (arabicTranslitPkg && (arabicTranslitPkg.transliterate || arabicTranslitPkg.default || arabicTranslitPkg)) || null;

const app = express();

// capture raw body for Slack signature verification if needed
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.get("/", (req, res) => res.send("Achoura Phonetic Bot is running!"));

// Optional Slack signature verification
function isValidSlackRequest(req) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true; // disabled if not provided

  const ts = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!ts || !sig) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (age > 60 * 5) return false;

  const base = `v0:${ts}:${req.rawBody ? req.rawBody.toString() : ""}`;
  const hmac = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const computed = `v0=${hmac}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
  } catch (e) {
    return false;
  }
}

// --- Normalisation arabe (on conserve temporairement la shadda si présente pour heuristiques) ---
function normalizeArabicKeepShadda(text) {
  if (!text) return "";
  return String(text)
    // collapse whitespace
    .replace(/\u200F/g, "") // remove rtl mark if present
    .replace(/\s+/g, " ")
    .trim();
}

// Remove diacritics (but do not remove shadda here; we'll check original for it)
function stripDiacritics(text) {
  if (!text) return "";
  return text
    // remove short vowel diacritics and other signs but keep shadda (ّ)
    .replace(/[\u064B-\u064E\u064F-\u0652\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ة") // keep taa marbuta for handling later
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Map Arabic letters to a basic Latin translit used for heuristics and doubling
const arabicToLatin = {
  "ا": "a", "أ": "a", "إ": "a", "آ": "a",
  "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
  "د": "d", "ذ": "dh", "ر": "r", "ز": "z",
  "س": "s", "ش": "sh", "ص": "s", "ض": "d",
  "ط": "t", "ظ": "z", "ع": "a", "غ": "gh",
  "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n",
  "ه": "h", "و": "w", "ي": "y", "ء": "'", "ئ": "y", "ؤ": "w", "ة": "a",
  "ى": "a"
};

// lettres solaires (sun letters) en arabe — si après 'ال' -> assimilation
const sunLetters = new Set(["ت","ث","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ل","ن"]);

// utilitaires
function capitalizeWord(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// fallback simple transliteration (very conservative) when library missing
function fallbackTransliterate(text) {
  if (!text) return "";
  const s = stripDiacritics(text);
  let out = "";
  for (const ch of s) {
    if (arabicToLatin[ch]) out += arabicToLatin[ch];
    else if (ch === " ") out += " ";
    else out += ""; // drop unknowns
  }
  // normalize spacing and capitalize words
  return out.split(/\s+/).map(capitalizeWord).join(" ");
}

// convert scientific translit (from lib) to friendly phonetic Latin
function scientificToPhonetic(scientific) {
  if (!scientific) return "";
  // replace common scientific chars with friendly ones:
  let s = scientific;
  // handle long vowels (macrons) if present
  s = s.replace(/ā/g, "aa").replace(/ī/g, "ii").replace(/ū/g, "uu");
  // map emphatics and special diacritics
  s = s.replace(/ḥ/g, "h").replace(/ḍ/g, "d").replace(/ṣ/g, "s").replace(/ṭ/g, "t").replace(/ẓ/g, "z");
  s = s.replace(/ʿ/g, "a").replace(/ʾ/g, "'").replace(/’/g, "'").replace(/ˁ/g, "a");
  // unify digraphs and remove hyphens
  s = s.replace(/-/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  // simple human corrections / common names
  const corrections = {
    "mhmd": "Muhammad",
    "muhammad": "Muhammad",
    "mohammad": "Muhammad",
    "mohamed": "Muhammad",
    "ahmad": "Ahmad",
    "ali": "Ali",
    "yusuf": "Yusuf",
    "fatima": "Fatima",
    "abd": "Abd",
    "bin": "bin"
  };

  return s.split(" ").map(w => {
    if (!w) return "";
    if (corrections[w]) return corrections[w];
    return capitalizeWord(w);
  }).join(" ");
}

// Heuristiques contextuelles (assimilation article défini, shadda doubling, taa marbuta)
function applyContextualRules(originalArabic, phoneticLatin) {
  if (!originalArabic || !phoneticLatin) return phoneticLatin;
  let out = phoneticLatin;

  const raw = originalArabic.trim();

  // 1) Assimilation de l'article défini "ال" devant lettre solaire
  if (raw.startsWith("ال") && raw.length >= 2) {
    const secondLetter = raw[2] || raw[1]; // si espace improbable
    if (sunLetters.has(secondLetter)) {
      // tokenise phonetic Latin: chercher un premier token "Al" ou "Al-..." ou "Al"
      // ex: "Al Shams" ou "Al-Shams" ou "Alshams"
      // on remplace l'article par "A" + son translit + "-" + reste
      // obtenir la translit latine de la lettre solaire (via map)
      const mapped = arabicToLatin[secondLetter] || "";
      // find first space or hyphen
      // build replacement prefix (ex "Ash-" si mapped == "sh")
      const prefix = "A" + mapped;
      // replace beginning "Al" (cas-insensitive)
      out = out.replace(/^al[-\s]?/i, prefix + "-");
      // si replacement n'a pas eu lieu car lib a rendu autre chose, essayer remonter:
      // If still starts with 'Al' (capitalized) then replace
      out = out.replace(/^Al[-\s]?/i, prefix + "-");
    }
  }

  // 2) Doublage pour shadda (ّ) : si orig contient shadda, try to double corresponding latin consonant(s)
  if (raw.includes("ّ")) {
    // for each occurrence of shadda, find the Arabic letter before it and double its translit in the output (first occurrence)
    // simple approach: iterate over raw, when see letter + shadda, map letter -> translit token and double its first occurrence in out
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === "ّ") continue;
      const next = raw[i + 1];
      if (next === "ّ") {
        const mapped = arabicToLatin[ch];
        if (mapped) {
          // double mapped token in output: replace first occurrence of mapped (case-insensitive) with doubled form
          const regex = new RegExp(mapped, "i");
          // doubled token: e.g., 's' -> 'ss', 'sh' -> 'shsh'
          const doubled = mapped + mapped;
          out = out.replace(regex, doubled);
        }
      }
    }
  }

  // 3) taa marbuta final -> often pronounced -a or -ah; ensure phonetic ends with 'a' if original ends with 'ة'
  if (raw.endsWith("ة")) {
    // if phonetic doesn't already end with 'a' or 'ah', append 'a'
    if (!/[aA]$/.test(out)) {
      out = out + "a";
    }
  }

  // cleanup: normalize spacing and hyphens, capitalize words
  out = out.replace(/\s+/g, " ").replace(/-+/g, "-").trim();
  out = out.split(" ").map(w => capitalizeWord(w)).join(" ");
  return out;
}

// Main transliteration function that uses library if available then applies heuristics
function smartTransliterate(arabicText) {
  if (!arabicText) return "Nom vide";

  const rawKeep = normalizeArabicKeepShadda(arabicText); // keep shadda marker
  const stripped = stripDiacritics(rawKeep); // normalized letters without short vowel diacritics

  let scientific = "";
  if (transliterateLib && typeof transliterateLib === "function") {
    try {
      // try calling transliterate with some common options (library APIs vary)
      scientific = transliterateLib(stripped, { longVowels: true, hamza: true });
      if (!scientific || typeof scientific !== "string") {
        // fallback to calling without options
        scientific = transliterateLib(stripped);
      }
    } catch (e) {
      try { scientific = transliterateLib(stripped); } catch (e2) { scientific = ""; }
    }
  } else {
    // no lib available: use fallback conservative transliteration
    scientific = fallbackTransliterate(stripped);
  }

  // Convert scientific to friendly phonetic
  let phonetic = scientificToPhonetic(scientific);

  // Apply contextual heuristics based on original Arabic (rawKeep contains shadda if present)
  phonetic = applyContextualRules(rawKeep, phonetic);

  return phonetic;
}

// /phon endpoint: expects Slack slash command form-encoded 'text'
app.post("/phon", async (req, res) => {
  try {
    if (!isValidSlackRequest(req)) {
      return res.status(400).send("Invalid Slack request signature");
    }

    const text = (req.body && req.body.text) ? String(req.body.text).trim() : "";
    if (!text) {
      return res.json({
        response_type: "ephemeral",
        text: "❌ Veuillez fournir un nom arabe. Exemple: /phon أحمد بن محمد"
      });
    }

    // Try to detect basic name parts (preserve 'بن' tokens)
    const normalized = stripDiacritics(text).replace(/\s+/g, " ").trim();
    const tokens = normalized.split(" ").filter(Boolean);

    // Build transliteration per token with context: handle 'بن' and tokens starting with 'ال'
    const translitTokens = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === "بن" || tok === "ابن") {
        translitTokens.push("bin");
        continue;
      }
      // if token begins with 'ال' (definite article)
      if (tok.startsWith("ال") && tok.length > 2) {
        // transliterate full token but keep original raw for contextual rule
        const originalPieceIndex = text.indexOf(tok); // approximate
        const origPiece = (originalPieceIndex >= 0) ? text.substr(originalPieceIndex, tok.length) : tok;
        const translitFull = smartTransliterate(origPiece);
        translitTokens.push(translitFull);
      } else {
        translitTokens.push(smartTransliterate(tok));
      }
    }

    const output = translitTokens.filter(Boolean).join(" ");

    return res.json({
      response_type: "in_channel",
      text: `🔤 Phonetic: *${output}*`
    });
  } catch (err) {
    console.error("Error /phon:", err);
    return res.json({
      response_type: "ephemeral",
      text: "❌ Erreur interne lors de la translittération."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Achoura Phonetic Bot running on port ${PORT}`));
