// Optional, more accurate reading by an AI, picked under "Reader": Claude (Anthropic) or Gemini (Google).
// Good for printed forms, two-row headers, Amharic and handwriting. The photo is sent to that company,
// using the person's own API key (kept only on this device). The same AIs also proofread a table on request.
(function (global) {
  const MAX_SIDE = 2000; // px; phone photos are shrunk to this before sending
  const JPEG_QUALITY = 0.8; // writing stays sharp, and it's about 40% smaller than 0.9, so it uploads faster

  const READ_PROMPT = `This photo shows a table or a list. It may be printed or handwritten, in any language (often Amharic or English).
Copy it into the JSON format.

columns: the column names from the header row, left to right, written exactly as in the photo (same language and spelling).
- If a heading spans several columns above a second header row, name each of those columns "Group: Sub", for example "Morning: Sold".
- If there is no header row, choose short names for what the columns hold, in the list's language.

rows: one entry per row, top to bottom, with one value per column in the same order. A row's list can stop after its last filled cell.
- Text that wraps onto several lines inside one cell is one value.
- Copy text as written. In cells that hold numbers, write plain digits with a dot for decimals (Ethiopic numerals ፲፪ become 12, ½ becomes 0.5).
- Write a tick as ✓. Use "" for an empty cell.
- Skip rows that are empty apart from a printed row number, and skip any title above the table.

unsure: every cell that is hard to read (smudged, written over, or unclear handwriting), as { row, column }: row 1 is the first entry in rows, and column is the column's name. Still give your best reading in rows. Use an empty list if everything is clear.`;

  const fixedNote = (names) =>
    `\n\nUse exactly these columns, in this order, instead of the photo's own: ${names.join(", ")}. Put each value under the column it belongs to and leave the rest "".`;

  const proofPrompt = (table) => `This photo shows a table or a list. Below, as JSON, is the same table as it was typed up from the photo.

Compare them carefully, row by row and cell by cell, and find every mistake in the typed table: a wrong number or word, a value under the wrong column, a value that is missing, or one that isn't in the photo. Look closely at handwritten digits that are easy to confuse, such as 1 and 7, 3 and 8, 5 and 6, 0 and 6.

corrections: one entry per wrong cell: row (1 is the first entry in the typed rows), column (the column's name exactly as in the typed table), typed (what the typed table says) and correct (what the photo says, or "" if that cell should be empty).

Don't report differences in spacing or punctuation. Ignore columns that aren't in the photo. Ethiopic numerals in the photo are correct when typed as ordinary digits, and ✓ means a tick. Use an empty list if the typed table is right.

Typed table:
${JSON.stringify(table)}`;

  const READ_SCHEMA = {
    type: "object",
    properties: {
      columns: { type: "array", items: { type: "string" } },
      rows: { type: "array", items: { type: "array", items: { type: "string" } } },
      unsure: {
        type: "array",
        items: {
          type: "object",
          properties: { row: { type: "integer" }, column: { type: "string" } },
          required: ["row", "column"],
          additionalProperties: false,
        },
      },
    },
    required: ["columns", "rows", "unsure"],
    additionalProperties: false,
  };
  const PROOF_SCHEMA = {
    type: "object",
    properties: {
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: { row: { type: "integer" }, column: { type: "string" }, typed: { type: "string" }, correct: { type: "string" } },
          required: ["row", "column", "typed", "correct"],
          additionalProperties: false,
        },
      },
    },
    required: ["corrections"],
    additionalProperties: false,
  };

  // How carefully each AI works on each job. Measured on a filled-in form with Gemini 3.6 Flash (November 2026):
  // reading took 9.7 s on low and 74.5 s on medium with the same numbers right, and proofreading took 3.5 s on low
  // and 18.3 s on medium with the same mistakes caught. So Gemini stays on low. Claude hasn't been measured.
  const CARE = {
    read: { claude: "medium", gemini: "low" },
    proof: { claude: "medium", gemini: "low" },
  };

  // The browser turns phone photos upright when drawing them, so only the size needs fixing.
  async function photoAsJpeg(file) {
    const img = await ListOCR.loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
  }

  function problem(message, code) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  // How many rows have arrived so far in a table that is still being written, for the progress message.
  function countRows(text) {
    const at = text.indexOf('"rows"');
    if (at < 0) return 0;
    let depth = 0, inString = false, count = 0;
    for (let i = text.indexOf("[", at); i >= 0 && i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 1) count++;
        if (depth === 0) break;
      }
    }
    return count;
  }

  // ---------- Claude (Anthropic) ----------
  const CLAUDE_SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm";
  let Anthropic = null;
  async function loadClaude() {
    if (!Anthropic) Anthropic = (await import(CLAUDE_SDK_URL)).default;
    return Anthropic;
  }

  async function askClaude(image, text, apiKey, { schema, care, onText }) {
    await loadClaude();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    let response;
    try {
      const stream = client.beta.messages.stream({
        model: "claude-opus-5-5",
        max_tokens: 32000,
        // If the request is ever declined, the API retries it on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: care, format: { type: "json_schema", schema } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text },
          ],
        }],
      });
      let soFar = "";
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          soFar += event.delta.text;
          if (onText) onText(soFar);
        }
      }
      response = await stream.finalMessage();
    } catch (e) {
      const detail = e.error?.error?.message || e.message;
      if (e instanceof Anthropic.AuthenticationError) throw problem("The Claude API key wasn't accepted. Check it and enter it again.", "bad_key");
      if (e instanceof Anthropic.PermissionDeniedError) throw problem("This API key isn't allowed to use Claude: " + detail, "bad_key");
      if (e instanceof Anthropic.RateLimitError) throw problem("Too many requests right now. Wait a minute and try again.");
      if (e instanceof Anthropic.APIConnectionError) throw problem("Couldn't reach Claude. Check the internet connection.");
      if (e instanceof Anthropic.APIError) throw problem(`Claude returned an error (${e.status}): ${detail}`);
      throw e;
    }
    if (response.stop_reason === "refusal") throw problem("Claude declined to read this photo.");
    if (response.stop_reason === "max_tokens") throw problem("The table is too big to read in one go. Photograph it in two parts.");
    return response.content.filter((b) => b.type === "text").pop()?.text;
  }

  // ---------- Gemini (Google) ----------
  // A free key gets a daily allowance per model (20 requests when tested in November 2026), and a model can be
  // briefly overloaded, so a second model stands by.
  const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"];
  const geminiUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // When a model's allowance runs out, remember until when, so later photos don't waste a request on it.
  const LIMITS_KEY = "listsnap.geminiLimits";
  function loadLimits() {
    try { return JSON.parse(localStorage.getItem(LIMITS_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveLimits(limits) {
    try { localStorage.setItem(LIMITS_KEY, JSON.stringify(limits)); } catch (_) { /* it's only a saving, not essential */ }
  }
  function waitWords(until) {
    const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.round(minutes / 60);
    return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  // Gemini's own schema format: upper-case type names, and the order of the fields spelled out.
  function geminiSchema(s) {
    const out = { type: s.type.toUpperCase() };
    if (s.items) out.items = geminiSchema(s.items);
    if (s.properties) {
      out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]));
      out.required = s.required;
      out.propertyOrdering = Object.keys(s.properties);
    }
    return out;
  }

  // Tries the first model, then the backup. A busy model gets one more try after a short wait, a short limit is
  // waited out, and a used-up daily allowance is remembered and skipped.
  async function askGemini(image, text, apiKey, { schema, care, onText, onNote }) {
    const note = onNote || (() => {});
    const limits = loadLimits();
    let wasBusy = false;
    for (const model of GEMINI_MODELS) {
      if (limits[model] > Date.now()) continue;
      for (let attempt = 1; attempt <= 2; attempt++) {
        let res;
        try {
          res = await fetch(geminiUrl(model), {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: image } }, { text }] }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: geminiSchema(schema),
                thinkingConfig: { thinkingLevel: care },
              },
            }),
          });
        } catch (_) {
          throw problem("Couldn't reach Gemini. Check the internet connection.");
        }
        if (res.ok) return readGeminiAnswer(res, onText);

        const body = await res.json().catch(() => ({}));
        const err = (Array.isArray(body) ? body[0] : body)?.error || {};
        const details = err.details || [];
        const reason = details.map((d) => d.reason).find(Boolean) || "";
        // Google answers a wrong key with 400 and the reason API_KEY_INVALID, not with 401.
        if (/^API_KEY/.test(reason) || res.status === 401 || res.status === 403) throw problem("The Gemini API key wasn't accepted. Check it and enter it again.", "bad_key");
        if (res.status === 429) {
          const waitSecs = parseFloat(details.map((d) => d.retryDelay).find(Boolean)) || 0;
          if (attempt === 1 && waitSecs > 0 && waitSecs <= 60) {
            note(`Gemini asks to wait ${Math.ceil(waitSecs)} seconds…`);
            await sleep(waitSecs * 1000);
            continue;
          }
          limits[model] = Date.now() + (waitSecs > 60 ? waitSecs * 1000 : 3600000);
          saveLimits(limits);
          break;
        }
        if (res.status === 500 || res.status === 503) {
          wasBusy = true;
          if (attempt === 1) {
            note("Gemini is busy, trying again…");
            await sleep(3000);
            continue;
          }
          break;
        }
        throw problem(`Gemini returned an error (${res.status}): ${err.message || res.statusText}`);
      }
      if (model !== GEMINI_MODELS[GEMINI_MODELS.length - 1]) note("Trying Gemini's backup model…");
    }
    const until = GEMINI_MODELS.map((m) => limits[m]).filter((t) => t > Date.now());
    if (until.length === GEMINI_MODELS.length) {
      throw problem(`This Gemini key has used up today's free requests. They come back in ${waitWords(Math.min(...until))}. Until then you can use Claude or the free reader.`);
    }
    throw problem(wasBusy ? "Gemini is very busy right now. Try again in a few minutes." : "Gemini couldn't be reached. Try again in a few minutes.");
  }

  // The answer arrives in pieces, each on a "data: {...}" line.
  async function readGeminiAnswer(res, onText) {
    let answer = "", finish = "", blocked = "", buffer = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const readLine = (line) => {
      if (!line.startsWith("data:")) return;
      const piece = JSON.parse(line.slice(5));
      if (piece.promptFeedback?.blockReason) blocked = piece.promptFeedback.blockReason;
      const candidate = piece.candidates?.[0];
      if (candidate?.finishReason) finish = candidate.finishReason;
      for (const part of candidate?.content?.parts || []) if (part.text && !part.thought) answer += part.text;
      if (onText) onText(answer);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += done ? "\n" : decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          readLine(buffer.slice(0, nl).trim());
          buffer = buffer.slice(nl + 1);
        }
        if (done) break;
      }
    } catch (_) {
      throw problem("The connection to Gemini was lost. Try again.");
    }
    if (blocked) throw problem(`Gemini declined to read this photo (${blocked}).`);
    if (finish === "MAX_TOKENS") throw problem("The table is too big to read in one go. Photograph it in two parts.");
    if (!answer) throw problem(`Gemini didn't send back an answer (${finish || "empty reply"}).`);
    return answer;
  }

  const ASK = { claude: askClaude, gemini: askGemini };

  function parseAnswer(answer) {
    try { return JSON.parse(answer); } catch (_) { throw problem("The answer couldn't be understood. Try again."); }
  }

  const columnIndex = (columns, name) => {
    const n = String(name).trim().toLowerCase();
    return columns.findIndex((c) => String(c).trim().toLowerCase() === n);
  };

  // Returns { columns: [name…], rows: [[value…]…], unsure: [{ row, col }] }, with every row as long as `columns`.
  // fixedColumns: names to fill instead of the photo's own columns (when "Use the columns from the picture" is off).
  // onRows(count) is told how many rows have been read so far, and onNote(message) about retries.
  async function readTable(provider, file, apiKey, fixedColumns, { onRows, onNote } = {}) {
    const text = fixedColumns ? READ_PROMPT + fixedNote(fixedColumns) : READ_PROMPT;
    const answer = await ASK[provider](await photoAsJpeg(file), text, apiKey, {
      schema: READ_SCHEMA,
      care: CARE.read[provider],
      onText: onRows && ((soFar) => onRows(countRows(soFar))),
      onNote,
    });
    const { columns, rows, unsure } = parseAnswer(answer);
    return {
      columns,
      rows: rows.map((r) => columns.map((_, k) => (r[k] == null ? "" : String(r[k]).trim()))),
      unsure: (unsure || [])
        .map((u) => ({ row: u.row - 1, col: columnIndex(columns, u.column) }))
        .filter((u) => u.row >= 0 && u.row < rows.length && u.col >= 0),
    };
  }

  // Compares a table with its photo. Returns only what looks wrong, as [{ row, col, typed, correct }].
  async function proofread(provider, file, apiKey, columns, rows, { onNote } = {}) {
    const answer = await ASK[provider](await photoAsJpeg(file), proofPrompt({ columns, rows }), apiKey, {
      schema: PROOF_SCHEMA,
      care: CARE.proof[provider],
      onNote,
    });
    return (parseAnswer(answer).corrections || [])
      .map((c) => ({ row: c.row - 1, col: columnIndex(columns, c.column), typed: String(c.typed ?? ""), correct: String(c.correct ?? "").trim() }))
      .filter((c) => c.row >= 0 && c.row < rows.length && c.col >= 0);
  }

  // Fetch Claude's helper ahead of time when Claude is the chosen reader. A failure here doesn't matter.
  const preload = (provider) => { if (provider === "claude") loadClaude().catch(() => {}); };

  global.ListAI = { readTable, proofread, preload, countRows, geminiSchema };
})(window);
