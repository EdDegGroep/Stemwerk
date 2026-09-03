const express = require("express");
const textToSpeech = require("@google-cloud/text-to-speech");

const app = express();
const client = new textToSpeech.TextToSpeechClient();

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const maxTextLength = Number(process.env.MAX_TEXT_LENGTH || "5000");

app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/", (req, res) => {
  res.type("text/plain").send("Deg Google Text-to-Speech service is actief.");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/tts", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const voice = String(req.body?.voice || "nl-NL-Chirp3-HD-Puck");

    if (!text) {
      return res.status(400).type("text/plain").send("Geen tekst ontvangen.");
    }

    if (text.length > maxTextLength) {
      return res
        .status(400)
        .type("text/plain")
        .send(`Tekst is te lang. Maximum: ${maxTextLength} tekens.`);
    }

    const allowedVoices = new Set([
      "nl-NL-Chirp3-HD-Puck",
      "nl-NL-Chirp3-HD-Aoede"
    ]);

    if (!allowedVoices.has(voice)) {
      return res.status(400).type("text/plain").send("Niet-toegestane stem.");
    }

    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "nl-NL",
        name: voice
      },
      audioConfig: {
        audioEncoding: "MP3"
      }
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(response.audioContent);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .type("text/plain")
      .send(error?.message || "Google Text-to-Speech gaf een fout.");
  }
});

const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`Server luistert op poort ${port}`);
});
