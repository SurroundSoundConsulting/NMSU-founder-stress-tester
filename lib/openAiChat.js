/**
 * Shared OpenAI Chat Completions helpers (JSON + plain text).
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {string} system
 * @param {string} user
 * @param {number} [temperature]
 */
async function openAiChatJson(apiKey, model, system, user, temperature) {
  const t = temperature != null ? temperature : 0.2;
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: t,
    }),
  });
  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    const err = new Error("OpenAI returned non-JSON.");
    err.code = "OPENAI_BAD";
    throw err;
  }
  if (!response.ok) {
    const msg = payload?.error?.message || rawText;
    const err = new Error(String(msg));
    err.code = "OPENAI_ERR";
    throw err;
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    const err = new Error("OpenAI returned no content.");
    err.code = "OPENAI_EMPTY";
    throw err;
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    const err = new Error("Could not parse model JSON: " + String(e && e.message));
    err.code = "JSON_PARSE";
    err.rawContent = content.slice(0, 8000);
    throw err;
  }
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {string} system
 * @param {string} user
 * @param {number} [temperature]
 */
async function openAiChatText(apiKey, model, system, user, temperature) {
  const t = temperature != null ? temperature : 0.3;
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: t,
    }),
  });
  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    const err = new Error("OpenAI returned non-JSON wrapper.");
    err.code = "OPENAI_BAD";
    throw err;
  }
  if (!response.ok) {
    const msg = payload?.error?.message || rawText;
    const err = new Error(String(msg));
    err.code = "OPENAI_ERR";
    throw err;
  }
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

module.exports = {
  OPENAI_URL,
  openAiChatJson,
  openAiChatText,
};
