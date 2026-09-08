const express = require("express");
const textToSpeech = require("@google-cloud/text-to-speech");

const app = express();
const client = new textToSpeech.TextToSpeechClient();

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const maxTextBytes = Number(process.env.MAX_TEXT_BYTES || "4800");

app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Alle Chirp 3 HD-stemmen. De namen komen uit de stemmenlijst van Google;
// nl-NL heeft dezelfde set als de andere ondersteunde talen.
const CHIRP3_STEMMEN = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede",
  "Autonoe", "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome",
  "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda",
  "Orus", "Pulcherrima", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager",
  "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi"
];

const allowedVoices = new Set(CHIRP3_STEMMEN.map(n => `nl-NL-Chirp3-HD-${n}`));

// Chirp 3 kent drie pauzetags. Bewust zonder /g: een globale regex houdt
// lastIndex bij tussen aanroepen en geeft dan om de beurt false terug.
const PAUZETAG = /\[pause(?: short| long)?\]/;

const FONETIEK = new Set([
  "PHONETIC_ENCODING_IPA",
  "PHONETIC_ENCODING_X_SAMPA"
]);

app.get("/", (req, res) => {
  res.type("text/plain").send("Stemwerk Google Text-to-Speech service is actief.");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, versie: 3 });
});

app.get("/stemmen", (req, res) => {
  res.json({ stemmen: CHIRP3_STEMMEN });
});

app.post("/tts", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const voice = String(req.body?.voice || "nl-NL-Chirp3-HD-Charon");
    const pause = String(req.body?.pause || "none");
    const encoding = String(req.body?.encoding || "MP3").toUpperCase();
    const requestedRate = Number(req.body?.speakingRate ?? 1);
    const uitspraak = Array.isArray(req.body?.customPronunciations)
      ? req.body.customPronunciations
      : [];

    if (!text) {
      return res.status(400).type("text/plain").send("Geen tekst ontvangen.");
    }

    const textBytes = Buffer.byteLength(text, "utf8");
    if (textBytes > maxTextBytes) {
      return res
        .status(400)
        .type("text/plain")
        .send(`Tekst is te lang: ${textBytes} bytes. Maximum: ${maxTextBytes} bytes.`);
    }

    if (!allowedVoices.has(voice)) {
      return res.status(400).type("text/plain").send("Niet-toegestane stem.");
    }

    if (encoding !== "MP3" && encoding !== "LINEAR16") {
      return res.status(400).type("text/plain").send("Ongeldige audiocodering.");
    }

    const speakingRate = Math.min(2.0, Math.max(0.25, requestedRate));

    const allowedPauses = new Set(["none", "short", "normal", "long"]);
    if (!allowedPauses.has(pause)) {
      return res.status(400).type("text/plain").send("Ongeldige pauze-instelling.");
    }

    // Staan er al expliciete pauzetags in de tekst, dan is die tekst leidend
    // en voegen we niets toe op alinea-overgangen. Anders zou een script met
    // zorgvuldig geplaatste pauzes overspoeld raken.
    const heeftEigenTags = PAUZETAG.test(text);

    let inhoud = text;

    if (!heeftEigenTags && pause !== "none") {
      const pauseTag =
        pause === "short" ? "[pause short]" :
        pause === "long" ? "[pause long]" :
        "[pause]";

      inhoud = text.replace(/\n\s*\n/g, ` ${pauseTag} `);
    }

    // Pauzetags werken uitsluitend in het markup-veld. Staan ze in het
    // text-veld, dan spreekt Chirp 3 de blokhaken letterlijk uit.
    const input = PAUZETAG.test(inhoud) ? { markup: inhoud } : { text: inhoud };

    // Chirp 3 ondersteunt geen <phoneme>, maar wel een eigen uitspraakveld.
    const pronunciations = uitspraak
      .filter(r => r && typeof r.phrase === "string" && typeof r.pronunciation === "string")
      .filter(r => r.phrase.trim() && r.pronunciation.trim())
      .slice(0, 100)
      .map(r => ({
        phrase: String(r.phrase).slice(0, 100),
        pronunciation: String(r.pronunciation).slice(0, 200),
        phoneticEncoding: FONETIEK.has(r.phoneticEncoding)
          ? r.phoneticEncoding
          : "PHONETIC_ENCODING_IPA"
      }));

    if (pronunciations.length) {
      input.customPronunciations = { pronunciations };
    }

    const audioConfig = { audioEncoding: encoding, speakingRate };
    if (encoding === "LINEAR16") audioConfig.sampleRateHertz = 24000;

    const [response] = await client.synthesizeSpeech({
      input,
      voice: { languageCode: "nl-NL", name: voice },
      audioConfig
    });

    res.setHeader(
      "Content-Type",
      encoding === "LINEAR16" ? "audio/wav" : "audio/mpeg"
    );
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
  console.log(`Stemwerk v3 luistert op poort ${port}`);
});
