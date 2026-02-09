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
    .filter(s => s.end >= startT && s.start <= t)
    .sort((a, b) => a.start - b.start);

  const text = slice
    .map(s => `[${s.start.toFixed(0)}-${s.end.toFixed(0)}] ${s.text}`)
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

    // MVP: only one hardcoded episode
    if (episodeId !== HARDCODED_EPISODE_ID) {
      return res.status(400).send(
        `Unsupported episodeId for MVP. Expected ${HARDCODED_EPISODE_ID}, got ${episodeId}`
      );
    }

    const t = Number(timestampSeconds ?? 0);
    const window = sliceLastWindow(transcriptSegments, t, 120);

    const system = [
      "You are a podcast companion.",
      "Answer the user's question ONLY using the provided transcript window.",
      "If the answer isn't in the window, say you don't have enough context yet and ask ONE short follow-up question.",
      "Keep the answer brief (<= 6 sentences)."
    ].join(" ");

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

    // Responses API (recommended for new projects) :contentReference[oaicite:1]{index=1}
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

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Backend listening on http://localhost:${port}`));
