import express from "express";
import { transliterate } from "arabic-transliteration";

const app = express();
app.use(express.urlencoded({ extended: true }));

function smartTransliterate(text) {
  if (!text) return "Nom vide";

  // translittération brute
  let result = transliterate(text, {
    hamza: true,
    longVowels: true
  });

  // corrections humaines (prononciation standard)
  const fixes = {
    "mHmd": "Muhammad",
    "mHammad": "Muhammad",
    "ywsf": "Yusuf",
    "Ely": "Ali",
    "AHmd": "Ahmad",
    "fATmT": "Fatima",
    "EbdAllh": "Abdullah"
  };

  return fixes[result] || result
    .replace(/H/g, "h")
    .replace(/E/g, "a")
    .replace(/T$/g, "h");
}

app.post("/slack", (req, res) => {
  const text = req.body.text?.trim();

  res.status(200).json({
    response_type: "in_channel",
    text: `🔤 Prononciation phonétique : *${smartTransliterate(text)}*`
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Achoura Phonetic Bot (smart) running on", PORT)
);
