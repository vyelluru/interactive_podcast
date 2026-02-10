// backend/server.js
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { HARDCODED_EPISODE_ID, transcriptSegments } from "./transcript.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sliceLastWindow(segments, t, windowSec = 120) {
  if (t == null || Number.isNaN(t)) t = 0;
  const startT = Math.max(0, t - windowSec);

  const slice = segments
    .filter((s) => s.end >= startT && s.start <= t)
    .sort((a, b) => a.start - b.start);

  const text = slice
    .map((s) => `[${Math.floor(s.start)}-${Math.floor(s.end)}] ${s.text}`)
    .join("\n");

  return { startT, endT: t, text, count: slice.length };
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/ask", async (req, res) => {
  try {
    const { episodeId, timestampSeconds, question } = req.body || {};
    if (!question || typeof question !== "string") {
      return res.status(400).send("Missing question");
    }

    if (episodeId !== HARDCODED_EPISODE_ID) {
      return res
        .status(400)
        .send(`Unsupported episodeId. Expected ${HARDCODED_EPISODE_ID}, got ${episodeId}`);
    }

    const t = Number(timestampSeconds ?? 0);
    const window = sliceLastWindow(transcriptSegments, t, 120);

    const system = [ "You are a podcast companion.", "Answer the user's question using the provided transcript window and supplement it with your knowledge of events. Don't just repeat what was said in the transcript directly.", "Keep the answer brief, under 30 words" ].join(" ");

    const input = [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `User question: ${question}\n\n` +
          `Transcript window (seconds ${window.startT}-${window.endT}):\n` +
          window.text
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5.2",
      input
    });

    res.json({
      answer: response.output_text,
      windowMeta: { start: window.startT, end: window.endT, segments: window.count }
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(err?.message || "server error");
  }
});

// ------------------- ElevenLabs TTS -------------------

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) console.warn("ELEVENLABS_API_KEY is not set");

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // replace with your chosen voice
const ELEVEN_BASE_URL = "https://api.elevenlabs.io";

app.post("/tts", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ ok: false, error: "ELEVENLABS_API_KEY not set" });
    }

    const url = `${ELEVEN_BASE_URL}/v1/text-to-speech/${VOICE_ID}`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(r.status).json({
        ok: false,
        error: `ElevenLabs error ${r.status}`,
        details: errText.slice(0, 500)
      });
    }

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "TTS failed" });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Backend listening on http://localhost:${port}`));
