import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

function transliterateArabic(text) {
  const map = {
    "م": "m", "ح": "h", "م": "m", "د": "d",
    "ي": "y", "و": "w", "س": "s", "ف": "f",
    "ع": "a", "ل": "l", "ا": "a", "ر": "r",
    "ن": "n", "ب": "b", "ك": "k", "ت": "t"
  };

  return text.split("").map(c => map[c] || "").join("")
    .replace(/^mhmmd$/i, "Muhammad")
    .replace(/^ysf$/i, "Yusuf");
}

app.post("/slack", (req, res) => {
  const text = req.body.text || "";
  const result = transliterateArabic(text);

  res.json({
    response_type: "in_channel",
    text: `🔤 Prononciation phonétique : *${result || "Nom non reconnu"}*`
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot running"));
