/**
 * Fireflies GraphQL API: list recent transcripts and fetch full text + metadata.
 * Docs: https://api.fireflies.ai/graphql
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { getFirefliesApiKey } = require("../lib/env");

const FIREFLIES_GQL = "https://api.fireflies.ai/graphql";

/**
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 */
async function firefliesGraphql(query, variables) {
  const key = getFirefliesApiKey();
  if (!key) {
    const err = new Error("FIREFLIES_API_KEY is not set in .env");
    err.code = "NO_FIREFLIES_KEY";
    throw err;
  }
  const res = await fetch(FIREFLIES_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.errors && json.errors.length) {
    const e = new Error(json.errors[0].message || "Fireflies GraphQL error");
    e.code = "FIREFLIES_GQL";
    e.details = json.errors;
    throw e;
  }
  if (!res.ok) {
    const e = new Error("Fireflies HTTP " + res.status);
    e.code = "FIREFLIES_HTTP";
    throw e;
  }
  return json.data;
}

/** Fireflies `date` may be ms or seconds since epoch. */
function normalizeDateMs(d) {
  if (typeof d !== "number" || !d) return 0;
  return d < 1e12 ? d * 1000 : d;
}

function mapListItem(t) {
  return {
    id: t.id,
    title: t.title || "",
    date: normalizeDateMs(typeof t.date === "number" ? t.date : 0),
    transcript_url: t.transcript_url || "",
  };
}

/**
 * List transcripts in a time window. Paginates in steps of 50.
 * Falls back to a simple list + client-side time filter if date filters are rejected.
 * @param {{ fromIso: string, toIso: string }} param
 * @returns {Promise<Array<{ id: string, title: string, date: number, transcript_url: string }>>}
 */
async function listTranscriptsInWindow({ fromIso, toIso }) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();

  const query = `query ListTranscripts($fromDate: String, $toDate: String, $limit: Int, $skip: Int) {
    transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip) {
      id
      title
      date
      transcript_url
    }
  }`;

  try {
    const all = [];
    let skip = 0;
    const limit = 50;
    for (;;) {
      const data = await firefliesGraphql(query, {
        fromDate: fromIso,
        toDate: toIso,
        limit,
        skip,
      });
      const list = (data && data.transcripts) || [];
      if (list.length === 0) break;
      for (const t of list) {
        if (t && t.id) all.push(mapListItem(t));
      }
      if (list.length < limit) break;
      skip += limit;
    }
    return all;
  } catch (e) {
    console.warn("transcripts(fromDate/toDate) failed, using simple list + filter:", e.message);
    return listTranscriptsSimpleFilter(fromMs, toMs);
  }
}

/**
 * @param {number} fromMs
 * @param {number} toMs
 */
async function listTranscriptsSimpleFilter(fromMs, toMs) {
  const simpleQuery = `query T($limit: Int, $skip: Int) {
    transcripts(limit: $limit, skip: $skip) {
      id
      title
      date
      transcript_url
    }
  }`;
  const all = [];
  let skip = 0;
  const limit = 50;
  for (;;) {
    const data = await firefliesGraphql(simpleQuery, { limit, skip });
    const list = (data && data.transcripts) || [];
    if (list.length === 0) break;
    for (const t of list) {
      if (!t || !t.id) continue;
      const d = normalizeDateMs(typeof t.date === "number" ? t.date : 0);
      if (d >= fromMs && d <= toMs) {
        all.push(mapListItem(t));
      }
    }
    if (list.length < limit) break;
    skip += limit;
  }
  return all;
}

/**
 * Fetch a single transcript with sentence text.
 * @param {string} transcriptId
 */
async function fetchTranscriptDetail(transcriptId) {
  const query = `query GetTranscript($id: String!) {
    transcript(id: $id) {
      id
      title
      date
      transcript_url
      duration
      sentences {
        text
        speaker_name
      }
    }
  }`;

  const data = await firefliesGraphql(query, { id: transcriptId });
  const t = data && data.transcript;
  if (!t || !t.id) {
    const e = new Error("Transcript not found: " + transcriptId);
    e.code = "FIREFLIES_NOT_FOUND";
    throw e;
  }

  const parts = (t.sentences || []).map(function (s) {
    const speaker = s.speaker_name ? s.speaker_name + ": " : "";
    return speaker + (s.text || "");
  });
  const text = parts.join("\n").trim();

  const dateMs = normalizeDateMs(typeof t.date === "number" ? t.date : 0);
  const dateStr = dateMs ? new Date(dateMs).toISOString().slice(0, 10) : "";

  return {
    fireflies_transcript_id: t.id,
    title: t.title || "",
    meeting_date: dateStr,
    source_url: t.transcript_url || "",
    duration: t.duration,
    text,
  };
}

module.exports = {
  firefliesGraphql,
  listTranscriptsInWindow,
  fetchTranscriptDetail,
  FIREFLIES_GQL,
};
