const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");

const app = express();

// We capture the raw body for Slack signature verification
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// Health check
app.get("/", (req, res) => res.send("Achoura Phonetic Bot is running!"));

// --- Slack signature verification (optional, enable by setting SLACK_SIGNING_SECRET) ---
function isValidSlackRequest(req) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true; // disabled if secret not provided

  const timestamp = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!timestamp || !sig) return false;

  const FIVE_MINUTES = 60 * 5;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > FIVE_MINUTES) {
    return false;
  }

  const base = `v0:${timestamp}:${req.rawBody ? req.rawBody.toString() : ""}`;
  const hmac = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const computed = `v0=${hmac}`;

  // constant-time compare
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
}

// --- Arabic normalization ---
function normalizeArabic(text) {
  if (!text) return "";
  return String(text)
    // remove diacritics
    .replace(/[\u064B-\u0652\u0670]/g, "")
    // normalize alef forms
    .replace(/[إأآ]/g, "ا")
    // alef maksura -> ya-like but pronounce often 'a' at end; keep as 'ى' -> 'a' later
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "a") // taa marbuta often pronounced "a" or "ah" in names
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Transliteration mapping (simple, rule-based) ---
function transliterateArabic(text) {
  if (!text) return "";

  let s = normalizeArabic(text);

  // Keep "بن" as special token to map to "bin"
  // We'll replace tokens like "بن <name>" later; for now transliterate per-letter.
  // Digraphs and common clusters first (no risk of partial replacement):
  const replacements = [
    // digraphs / common consonants
    [/ش/g, "sh"],
    [/خ/g, "kh"],
    [/غ/g, "gh"],
    [/ث/g, "th"],
    [/ذ/g, "dh"],
    [/صح/g, "sah"], // small heuristic for 'صح' sequences (not needed but safe)
    // single letters
    [/ح/g, "h"],
    [/ص/g, "s"],
    [/ض/g, "d"],
    [/ط/g, "t"],
    [/ظ/g, "z"],
    [/ع/g, "a"],   // approximate `ʿ` by 'a' (keeps a vowel break)
    [/ء/g, "'"],
    [/أ|إ|آ|ا/g, "a"],
    [/ب/g, "b"],
    [/ت/g, "t"],
    [/ث/g, "th"],
    [/ج/g, "j"],
    [/د/g, "d"],
    [/ذ/g, "dh"],
    [/ر/g, "r"],
    [/ز/g, "z"],
    [/س/g, "s"],
    [/ش/g, "sh"],
    [/ص/g, "s"],
    [/ض/g, "d"],
    [/ط/g, "t"],
    [/ظ/g, "z"],
    [/ع/g, "a"],
    [/غ/g, "gh"],
    [/ف/g, "f"],
    [/ق/g, "q"],
    [/ك/g, "k"],
    [/ل/g, "l"],
    [/م/g, "m"],
    [/ن/g, "n"],
    [/ه/g, "h"],
    [/و/g, "w"],
    [/ي/g, "y"],
    // numbers or punctuation -> preserve spaces
    [/[^a-z0-9'\- ]+/gi, " "]
  ];

  for (const [pat, repl] of replacements) {
    s = s.replace(pat, repl);
  }

  // Handle definite article "ال" as "al-"
  s = s.replace(/\bal-/g, "al-"); // already transliterated forms
  // Map the Arabic token "بن" (if left) to "bin"
  s = s.replace(/\bبن\b/g, "bin");

  // Collapse multiple spaces / hyphens into single space
  s = s.replace(/-+/g, "-").replace(/\s+/g, " ").trim();

  // Post-process for readability:
  // - make lowercase, then capitalize each word
  s = s.toLowerCase();
  const words = s.split(" ").filter(Boolean).map(w => {
    // human-friendly fixes for common names (short list)
    const fixes = {
      "mhmd": "Muhammad",
      "mohammad": "Muhammad",
      "muhammad": "Muhammad",
      "ahmad": "Ahmad",
      "yusuf": "Yusuf",
      "ali": "Ali",
      "fatima": "Fatima",
      "abd": "Abd",
      "bin": "bin",
      "al-": "Al-"
    };
    if (fixes[w]) return fixes[w];
    return w.charAt(0).toUpperCase() + w.slice(1);
  });

  return words.join(" ");
}

// /phon endpoint: expects Slack slash command (application/x-www-form-urlencoded) with 'text'
app.post("/phon", async (req, res) => {
  try {
    if (!isValidSlackRequest(req)) {
      return res.status(400).send("Invalid Slack request signature");
    }

    const text = (req.body && req.body.text) ? String(req.body.text).trim() : "";
    if (!text) {
      return res.json({
        response_type: "ephemeral",
        text: "❌ Veuillez fournir un nom arabe à translittérer. Exemple: /phon أحمد بن محمد"
      });
    }

    // If user sends multiple words, we'll attempt to split and transliterate each segment, preserving "bin"/"ben"
    const normalizedInput = normalizeArabic(text);
    // Splitting on spaces is OK because normalized collapsed multiple spaces
    const parts = normalizedInput.split(" ");
    // Build transliterated string by mapping tokens; keep "بن" as "bin" etc.
    const translitParts = parts.map(token => {
      if (token === "بن" || token === "ابن") return "bin";
      if (token.startsWith("ال")) {
        // treat as al- + rest
        const rest = token.slice(2);
        const transl = transliterateArabicSimple(rest);
        return "Al-" + capitalize(transl);
      }
      return transliterateArabicSimple(token);
    });

    // Join and format nicely
    const output = translitParts.filter(Boolean).join(" ");

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

// helper: small wrapper to transliterate single token and capitalize
function transliterateArabicSimple(token) {
  const t = transliterateArabic(token);
  return t.split(" ").map(capitalize).join(" ");
}
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Server (Railway reads PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Achoura Phonetic Bot running on port ${PORT}`));
