// Turns OCR text into rows: { item, qty, price, time, made }.
// Pure functions only (no DOM) so they can be tested on their own (see test.html).
(function (global) {
  const CURRENCY = "[$€£₪¥₱₹]";
  const CURRENCY_WORDS = "(?:nis|ils|usd|eur|gbp|php|inr|rs|birr|br|etb)";
  const NUM = "\\d{1,6}(?:[.,]\\d{1,2})?";

  // A sign before the number ("$3.50") is checked first, because in "12 $3.50" the "12 $" would also look like a price.
  const RE_PRICE_SYMBOL_BEFORE = new RegExp(`${CURRENCY}\\s*(${NUM})`);
  const RE_PRICE_SYMBOL_AFTER = new RegExp(`(${NUM})\\s*${CURRENCY}`);
  const RE_PRICE_WORD_BEFORE = new RegExp(`\\b${CURRENCY_WORDS}\\.?\\s*(${NUM})\\b`, "i");
  const RE_PRICE_WORD_AFTER = new RegExp(`\\b(${NUM})\\s*${CURRENCY_WORDS}\\b`, "i");
  // Ethiopian birr written in Amharic: "45 ብር" or "ብር 45". (\b doesn't work next to Ethiopic letters.)
  const RE_PRICE_BIRR_BEFORE = new RegExp(`ብር\\s*(${NUM})`);
  const RE_PRICE_BIRR_AFTER = new RegExp(`(${NUM})\\s*ብር`);
  const RE_PRICE_AT = new RegExp(`@\\s*(${NUM})`);
  const RE_PRICE_DECIMAL = /\b(\d{1,6}[.,]\d{2})\b/;

  // Amharic words match the whole word they appear in, so prefixes and suffixes are removed too (e.g. "በጠዋት", "ተሰርቷል").
  const RE_MORNING = /\b(?:mornings?|am|a\.m)\b\.?|[^\s\d]*(?:ጠዋት|ማለዳ)[^\s\d]*/i;
  const RE_AFTERNOON = /\b(?:afternoons?|pm|p\.m)\b\.?|[^\s\d]*(?:ከሰዓት|ከሰአት|ከሠዓት|ከቀትር)[^\s\d]*(?:\s+በኋላ)?/i;
  const RE_MADE = /\b(made|done|ready)\b|[✓✔☑]|\[x\]|[^\s\d]*(?:ተሰር|ተሠር|ተሰራ|ተሠራ|ተዘጋጅ|ዝግ[ጁጂጅ]|ተጠናቅ|ተጠናቋ)[^\s\d]*/i;

  const UNITS = "pcs|pc|pieces|piece|kg|kgs|g|gr|grams|lb|lbs|oz|l|lt|ltr|ml|dozen|doz|box|boxes|pack|packs|trays?|units?|bags?|bottles?|cans?";
  const RE_QTY_X = new RegExp(`(?:^|\\s)(?:x\\s*(\\d{1,5}(?:[.,]\\d+)?)|(\\d{1,5}(?:[.,]\\d+)?)\\s*x)(?=\\s|$)`, "i");
  const RE_QTY_UNIT = new RegExp(`(?:^|\\s)(\\d{1,5}(?:[.,]\\d+)?)\\s*(${UNITS})\\b\\.?`, "i");
  const RE_QTY_UNIT_AM = /(?:^|\s)(\d{1,5}(?:[.,]\d+)?)\s*(ኪሎ|ኪ\.ግ|ግራም|ሊትር|ፍሬ|ካርቶን|ፓኬት|ደርዘን|እስር|ጆንያ)/;
  const RE_NUMBER = /(?:^|[^\w.,])(\d{1,6}(?:[.,]\d+)?)(?![\w])/;
  const RE_ENUMERATOR = /^\s*(?:\d{1,2}[.)]\s+|[-•*·▪>]+\s*)/;
  const RE_HEADER = /\b(item|items|product|description|name)\b.*\b(qty|quantity|amount|price|cost)\b|\b(qty|quantity)\b.*\b(price|item|cost)\b|(ዕቃ|እቃ|ስም).*(ብዛት|ዋጋ)|ብዛት.*ዋጋ/i;

  // Ethiopic numerals (፩ ፪ … ፲ … ፻ ፼) to ordinary numbers, e.g. ፲፪ → 12, ፪፻፶ → 250.
  const ETH_VALUES = { "፩": 1, "፪": 2, "፫": 3, "፬": 4, "፭": 5, "፮": 6, "፯": 7, "፰": 8, "፱": 9,
    "፲": 10, "፳": 20, "፴": 30, "፵": 40, "፶": 50, "፷": 60, "፸": 70, "፹": 80, "፺": 90, "፻": 100, "፼": 10000 };
  function ethiopicToNumber(run) {
    let total = 0, hundreds = 0, small = 0;
    for (const ch of run) {
      const v = ETH_VALUES[ch];
      if (v === undefined) continue;
      if (v < 100) small += v;
      else if (v === 100) { hundreds += (small || 1) * 100; small = 0; }
      else { total += (hundreds + small || 1) * 10000; hundreds = 0; small = 0; }
    }
    return total + hundreds + small;
  }

  function toNumber(s) {
    if (s == null || s === "") return "";
    const n = parseFloat(String(s).replace(",", "."));
    return Number.isFinite(n) ? n : "";
  }

  function cut(str, match) {
    return (str.slice(0, match.index) + " " + str.slice(match.index + match[0].length)).replace(/\s+/g, " ").trim();
  }

  function cleanItem(s) {
    return s
      .replace(/[|_~=]+/g, " ")
      .replace(/\s*[-–—:;,.።፣፤፥፦፡]+\s*$/g, "")
      .replace(/^\s*[-–—:;,.።፣፤፥፦፡]+\s*/g, "")
      .replace(/\s+[-–—:;,።፣፤፥፦፡]+\s+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalize(raw) {
    return String(raw)
      .replace(/[፩-፼]+/g, (run) => ` ${ethiopicToNumber(run)} `)
      .replace(/፡(?!፡)/g, " ") // the old Ethiopic word separator; "፡፡" is a full stop
      // The scanner often reads a 0 after a digit as the look-alike letter ዐ (or O/o): "3ዐ" → "30".
      .replace(/(?<=\d)[ዐOo]+(?=[\d\s.,]|$)/g, (z) => "0".repeat(z.length))
      .replace(/\t/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseLine(raw, state) {
    let s = normalize(raw);
    if (!s) return null;
    if (RE_HEADER.test(s)) return null;

    let time = "";
    let m;
    if ((m = s.match(RE_MORNING))) { time = "Morning"; s = cut(s, m); }
    else if ((m = s.match(RE_AFTERNOON))) { time = "Afternoon"; s = cut(s, m); }

    let made = false;
    if ((m = s.match(RE_MADE))) { made = true; s = cut(s, m); }

    // A line that is only "Morning:" or "AFTERNOON" is a section title for the lines under it.
    if (time && !/[\p{L}\d]/u.test(s.replace(/[:\-–—]/g, ""))) {
      state.section = time;
      return null;
    }
    if (!/\p{L}/u.test(s)) return null; // no letters, so no item name: noise or a lone total

    // Drop "1." / "2)" / "-" list markers, but only when the line has another number to use as the qty.
    const en = s.match(RE_ENUMERATOR);
    if (en) {
      const rest = s.slice(en[0].length);
      if (!/^\d/.test(en[0].trim()) || /\d/.test(rest)) s = rest;
    }

    let price = "";
    for (const re of [RE_PRICE_SYMBOL_BEFORE, RE_PRICE_WORD_BEFORE, RE_PRICE_BIRR_BEFORE, RE_PRICE_SYMBOL_AFTER, RE_PRICE_WORD_AFTER, RE_PRICE_BIRR_AFTER, RE_PRICE_AT, RE_PRICE_DECIMAL]) {
      if ((m = s.match(re))) {
        price = toNumber(m[1]);
        s = cut(s, m);
        break;
      }
    }

    let qty = "";
    let unit = "";
    if ((m = s.match(RE_QTY_X))) { qty = toNumber(m[1] ?? m[2]); s = cut(s, m); }
    else if ((m = s.match(RE_QTY_UNIT))) { qty = toNumber(m[1]); unit = m[2].toLowerCase(); s = cut(s, m); }
    else if ((m = s.match(RE_QTY_UNIT_AM))) { qty = toNumber(m[1]); unit = m[2]; s = cut(s, m); }
    else if ((m = s.match(RE_NUMBER))) { qty = toNumber(m[1]); s = cut(s, m); }

    // Two plain numbers and no marked price: treat the second one as the price ("Eggs 12 30").
    if (price === "" && (m = s.match(RE_NUMBER))) { price = toNumber(m[1]); s = cut(s, m); }

    let item = cleanItem(s);
    if (!item || !/\p{L}/u.test(item)) return null;
    if (unit) item += ` (${unit})`;

    return { item, qty, price, time: time || state.section || "", made };
  }

  function parseListText(text) {
    const state = { section: "" };
    const rows = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const row = parseLine(line, state);
      if (row) rows.push(row);
    }
    return rows;
  }

  // ---------- Columns decided by the picture ----------
  // If the picture has a header row ("Product  Qty  Price  Supplier"), those become the columns, and every word below
  // is put under the header it lines up with. Without a header, only the kinds of values the list actually has
  // (item, qty, price, time, made) become columns.

  const HEADER_ROLES = [
    ["item", /^(items?|products?|names?|descriptions?|articles?|goods|tasks?|action\s*items?|activit(?:y|ies)|ዕቃ|እቃ|ስም|የዕቃ\s*ስም|ምርት)$/i],
    ["qty", /^(qty|qnty|quantity|quantities|pcs|count|no\.?|ብዛት|መጠን)$/i],
    ["price", /^((unit\s*)?price|cost|rate|ዋጋ|የአንዱ\s*ዋጋ)$/i],
    ["time", /^(time|shift|period|session|ሰዓት|ጊዜ|ፈረቃ)$/i],
    ["made", /^(made|done|ready|status|✓|ተሰርቷል|ሁኔታ)$/i],
    ["date", /^(date|day|ቀን)$/i],
  ];
  const OTHER_HEADER_WORDS = /^(total|amount|sum|unit|units|supplier|customer|notes?|remarks?|category|size|weight|owner|assigned\s*to|priority|progress|comments?|deadline|(?:start|finish|end|due)\s*date|ድምር|ጠቅላላ|ማስታወሻ|ደንበኛ|አቅራቢ|ክብደት|መለኪያ)$/i;
  // The type a column must have for its role to make sense. "Status" sounds like Made, but holding "Not Started" it's plain text.
  const ROLE_TYPE = { qty: "number", price: "number", time: "time", made: "check" };

  const cleanHeader = (s) => s.replace(/^[\s|:;.,\-–—#*]+|[\s|:;.,\-–—*]+$/g, "").trim();
  function headerRole(name) {
    const n = cleanHeader(name).replace(/^\((.*)\)$/, "$1").toLowerCase();
    for (const [role, re] of HEADER_ROLES) if (re.test(n)) return role;
    return null;
  }
  const isHeaderWord = (name) => !!headerRole(name) || OTHER_HEADER_WORDS.test(cleanHeader(name));

  // Plain text (no word positions) becomes fake positions, one character = 10 units wide.
  // Two or more spaces then count as a column gap and one space does not.
  function pseudoLines(text) {
    return String(text || "").split(/\r?\n/).map((line) => {
      const words = [];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(line))) words.push({ text: m[0], x0: m.index * 10, x1: (m.index + m[0].length) * 10, y0: 0, y1: 12 });
      return { words };
    }).filter((l) => l.words.length);
  }

  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  // Group the words of a line into cells: a gap wider than about the text height starts a new cell. "|" also splits.
  function cellsOf(line) {
    const words = [...line.words].sort((a, b) => a.x0 - b.x0);
    const h = median(words.map((w) => w.y1 - w.y0)) || 12;
    const cells = [];
    let cur = null;
    for (const w of words) {
      if (/^[|¦]+$/.test(w.text)) { cur = null; continue; }
      if (cur && w.x0 - cur.x1 < h) { cur.text += " " + w.text; cur.x1 = w.x1; }
      else { cur = { text: w.text, x0: w.x0, x1: w.x1 }; cells.push(cur); }
    }
    return cells;
  }

  function findHeader(lines) {
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      let cells = cellsOf(lines[i]);
      const words = lines[i].words.filter((w) => !/^[|¦]+$/.test(w.text));
      const hasDigit = words.some((w) => /\d/.test(w.text));
      // Header words written close together ("Item Qty Price"): treat each word as its own column.
      if (cells.length < 2 && !hasDigit && words.length >= 2 && words.every((w) => isHeaderWord(w.text))) {
        cells = words.map((w) => ({ text: w.text, x0: w.x0, x1: w.x1 }));
      }
      if (cells.length < 2) continue;
      const hits = cells.filter((c) => isHeaderWord(c.text)).length;
      if (hits >= 2 || (hits >= 1 && !hasDigit)) return { index: i, cells };
      if (!hasDigit && hits === 0) {
        // No known header words: still a header if the lines under it look like data rows.
        const next = lines.slice(i + 1, i + 6).map(cellsOf).filter((c) => c.length >= 2);
        const dataLike = next.filter((c) => c.some((x) => /\d/.test(x.text))).length;
        if (next.length >= 2 && dataLike / next.length >= 0.6) return { index: i, cells };
      }
    }
    return null;
  }

  function numericValue(v) {
    let s = String(v).replace(/[$€£₪¥₱₹]|ብር|\b(?:birr|br|etb|usd|eur|gbp|nis|ils|php|inr|rs)\b\.?/gi, "").replace(/\s+/g, "");
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    return /^-?\d+([.,]\d+)?$/.test(s) ? toNumber(s) : null;
  }
  const timeValue = (v) => (RE_MORNING.test(v) ? "Morning" : RE_AFTERNOON.test(v) ? "Afternoon" : null);
  const RE_NO = /^(no|n|-|–|✗|✘|የለም|አልተሰራም)$/i;
  const isYes = (v) => /^(yes|y|x|ok|✓|✔|☑|አዎ)$/i.test(v) || (RE_MADE.test(v) && !RE_NO.test(v));

  // Pick each column's type from its values and convert them.
  function finishColumns(columns, rows) {
    columns.forEach((col, k) => {
      const vals = rows.map((r) => r[k]).filter((v) => v !== "" && v != null);
      if (col.role === "item" || !vals.length) { col.type = col.type || ROLE_TYPE[col.role] || "text"; return; }
      if (vals.every((v) => isYes(v) || RE_NO.test(v))) {
        col.type = "check";
        rows.forEach((r) => { r[k] = isYes(r[k] || ""); });
        return;
      }
      if (vals.every((v) => timeValue(v))) {
        col.type = "time";
        rows.forEach((r) => { r[k] = r[k] ? timeValue(r[k]) : ""; });
        return;
      }
      if (vals.every((v) => numericValue(v) !== null)) {
        col.type = "number";
        rows.forEach((r) => { r[k] = r[k] === "" || r[k] == null ? "" : numericValue(r[k]); });
        return;
      }
      col.type = "text";
    });
    for (const col of columns) if (ROLE_TYPE[col.role] && ROLE_TYPE[col.role] !== col.type) col.role = null;
  }

  // "MORNING" / "ከሰዓት በኋላ" on its own is a section title for the rows under it.
  function sectionTitle(text) {
    const t = timeValue(text);
    return t && !/[\p{L}\d]/u.test(text.replace(t === "Morning" ? RE_MORNING : RE_AFTERNOON, "").replace(/[:\-–—]/g, "")) ? t : "";
  }

  // Section titles fill the Time column, and add one if the header doesn't have it.
  function applySections(columns, out, sections) {
    if (!sections.some(Boolean)) return;
    let k = columns.findIndex((c) => c.role === "time");
    if (k < 0) { columns.push({ name: "Time", role: "time" }); out.forEach((r) => r.push("")); k = columns.length - 1; }
    out.forEach((r, i) => { if (!r[k]) r[k] = sections[i]; });
  }

  function fromHeader(lines, header) {
    const hc = header.cells;
    const columns = hc.map((c) => {
      const name = cleanHeader(normalize(c.text)) || "Column";
      return { name, role: headerRole(name) };
    });
    // Each column owns the x range halfway to its neighbours.
    const bounds = hc.map((c, k) => [k === 0 ? -Infinity : (hc[k - 1].x1 + c.x0) / 2, k === hc.length - 1 ? Infinity : (c.x1 + hc[k + 1].x0) / 2]);
    const columnOf = (w) => {
      let best = 0, bestOverlap = -Infinity;
      bounds.forEach(([a, b], k) => {
        const overlap = Math.min(w.x1, b) - Math.max(w.x0, a);
        if (overlap > bestOverlap) { best = k; bestOverlap = overlap; }
      });
      return best;
    };

    const rows = [];
    let section = "";
    for (const line of lines.slice(header.index + 1)) {
      const words = line.words.filter((w) => !/^[|¦]+$/.test(w.text));
      const whole = normalize(words.map((w) => w.text).join(" "));
      if (!whole || !/[\p{L}\d]/u.test(whole)) continue;
      const t = sectionTitle(whole);
      if (t) { section = t; continue; }
      if (cellsOf(line).filter((c) => isHeaderWord(c.text)).length >= 2) continue; // header repeated on a new page

      const row = columns.map(() => "");
      for (const w of [...words].sort(readingOrder)) {
        const k = columnOf(w);
        row[k] = row[k] ? `${row[k]} ${w.text}` : w.text;
      }
      rows.push({ cells: row.map((v) => cleanItem(normalize(v))), section });
    }

    const out = rows.map((r) => r.cells);
    applySections(columns, out, rows.map((r) => r.section));
    finishColumns(columns, out);
    return { columns, rows: out, fromHeader: true };
  }

  // Words of one cell can sit on several text lines (long text wraps inside the cell): read line by line.
  const readingOrder = (a, b) => (a.li ?? 0) - (b.li ?? 0) || a.x0 - b.x0;

  // ---------- Tables with grid lines (spreadsheet screenshots, printed tables) ----------
  // The lines show where every cell starts and ends, so text that wraps onto several lines stays in one cell,
  // and words are never put in the wrong column.

  // Grid lines are trusted only if they don't run through the middle of words.
  function usableGrid(lines, grid) {
    if (!grid || !grid.rows || grid.rows.length < 3) return null;
    const words = lines.flatMap((l) => l.words);
    const crosses = (edges, a, b) => edges.some((e) => e > a + (b - a) * 0.25 && e < b - (b - a) * 0.25);
    const tooMany = (edges, lo, hi) => words.filter((w) => crosses(edges, w[lo], w[hi])).length > words.length * 0.1;
    if (tooMany(grid.rows, "y0", "y1")) return null;
    const cols = grid.cols && grid.cols.length >= 2 && !tooMany(grid.cols, "x0", "x1") ? grid.cols : [];
    return { rows: grid.rows, cols };
  }

  const slotOf = (edges, v) => { let k = 0; while (k < edges.length && v > edges[k]) k++; return k; };
  const isLetterBar = (cells) => { const f = cells.filter(Boolean); return f.length >= 3 && f.every((v) => v.length <= 2 && !/\d/.test(v)); };
  const isRowNumbers = (vals) => {
    const f = vals.filter(Boolean);
    return f.length >= 2 && f.every((v) => v.length <= 3) && f.filter((v) => /^\d+$/.test(v)).length >= f.length * 0.6;
  };
  const looksLikeHeader = (cells) => {
    const f = cells.filter(Boolean);
    return f.length >= 2 && (!f.some((v) => /\d/.test(v)) || f.filter(isHeaderWord).length >= 2);
  };

  function fromGrid(lines, grid) {
    // Keep each word's line number so the text inside a cell stays in reading order.
    const words = lines.flatMap((l, li) => l.words.filter((w) => !/^[|¦]+$/.test(w.text)).map((w) => ({ ...w, li })));
    const bands = new Map();
    for (const w of words) {
      const b = slotOf(grid.rows, (w.y0 + w.y1) / 2);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(w);
    }
    const bandWords = [...bands.keys()].sort((a, b) => a - b).map((b) => bands.get(b));

    // Only horizontal lines (a ruled page, or a table without column lines): every band becomes one line,
    // and the header row decides the columns as usual.
    if (!grid.cols.length) {
      const merged = bandWords.map((ws) => ({ words: ws }));
      const header = findHeader(merged);
      return header ? fromHeader(merged, header) : null;
    }

    const nCols = grid.cols.length + 1;
    let table = bandWords.map((ws) => {
      const cells = Array.from({ length: nCols }, () => []);
      for (const w of ws) cells[slotOf(grid.cols, (w.x0 + w.x1) / 2)].push(w);
      return cells.map((c) => cleanItem(normalize(c.sort(readingOrder).map((w) => w.text).join(" "))));
    });
    // Spreadsheet screenshots: drop the A B C … bar at the top, the empty columns and the 1 2 3 … row numbers.
    // (A printed table's own "No." column is kept: its top cell is the word "No.", not a row number.)
    const before = table.length;
    table = table.filter((r, i) => !(i < 2 && isLetterBar(r)));
    const keep = [...Array(nCols).keys()].filter((c) => table.some((r) => r[c]));
    const left = keep.length > 1 ? table.map((r) => r[keep[0]]) : [];
    if (isRowNumbers(left) && (table.length < before || /^\d+$/.test(left.find(Boolean)))) keep.shift();
    let rows = table.map((r) => keep.map((c) => r[c])).filter((r) => r.some(Boolean));
    if (!rows.length) return null;

    // The header is the first row that looks like one; a title above it (one cell) is skipped.
    const hi = rows.slice(0, 3).findIndex(looksLikeHeader);
    const hasHeader = hi >= 0 && rows.slice(0, hi).every((r) => r.filter(Boolean).length <= 1);
    const names = hasHeader ? rows[hi] : rows[0].map(() => "");
    if (hasHeader) rows = rows.slice(hi + 1);
    const columns = names.map((n, k) => {
      const name = cleanHeader(n) || `Column ${k + 1}`;
      return { name, role: headerRole(name) };
    });

    const out = [], sections = [];
    let section = "";
    for (const r of rows) {
      const filled = r.filter(Boolean);
      const t = filled.length === 1 ? sectionTitle(filled[0]) : "";
      if (t) { section = t; continue; }
      if (hasHeader && r.filter(isHeaderWord).length >= 2 && r.every((v, k) => !v || v === names[k])) continue; // header repeated
      out.push(r); sections.push(section);
    }
    markItemColumn(columns, out);
    applySections(columns, out, sections);
    finishColumns(columns, out);
    return { columns, rows: out, fromHeader: hasHeader };
  }

  // Without an Item-like header, the item column is the first one that holds words rather than numbers
  // (so a form's "No." column isn't taken for it).
  function markItemColumn(columns, rows) {
    if (columns.some((c) => c.role === "item")) return;
    const k = columns.findIndex((c, i) => {
      const vals = rows.map((r) => r[i]).filter(Boolean);
      return !c.role && vals.length && vals.filter((v) => /\p{L}/u.test(v)).length >= vals.length * 0.6;
    });
    if (k >= 0) columns[k].role = "item";
  }

  // A table whose cells are already known (read by Claude or Gemini): name the columns and pick their types.
  function fromTable(names, rows) {
    const columns = names.map((n, k) => {
      const name = cleanHeader(normalize(n)) || `Column ${k + 1}`;
      return { name, role: headerRole(name) };
    });
    const out = rows.map((r) => columns.map((_, k) => cleanItem(normalize(r[k] ?? ""))));
    markItemColumn(columns, out);
    finishColumns(columns, out);
    return { columns, rows: out, fromHeader: true };
  }

  function fromList(text) {
    const parsed = parseListText(text);
    const all = [["item", "Item", "text"], ["qty", "Qty", "number"], ["price", "Price", "number"], ["time", "Time", "time"], ["made", "Made", "check"]];
    const used = all.filter(([role]) => role === "item" || parsed.some((p) => (role === "made" ? p.made : p[role] !== "")));
    return {
      columns: used.map(([role, name, type]) => ({ name, role, type })),
      rows: parsed.map((p) => used.map(([role]) => p[role])),
      fromHeader: false,
    };
  }

  // lines: [{ words: [{ text, x0, x1, y0, y1 }] }] from the OCR (optional; plain text works too).
  // grid: { rows: [y…], cols: [x…] } table lines found in the picture (optional).
  function analyze(text, lines, grid) {
    const ls = lines && lines.length ? lines : pseudoLines(text);
    const g = usableGrid(ls, grid);
    if (g) {
      const res = fromGrid(ls, g);
      if (res && res.rows.length) return res;
    }
    const header = findHeader(ls);
    if (header) {
      const res = fromHeader(ls, header);
      if (res.rows.length) return res;
    }
    return fromList(text);
  }

  // ---------- Equations: a column worked out from other columns ----------
  // "[Qty] × [Price]", "([ጠዋት የተሰራ: ድምር] − [ጠዋት የተሰራ: የተበላሸ]) * [Price]", "[Total] * 15%".
  // Column names go in [ ]; a name without [ ] also works if it has no + - * / or brackets in it.
  // This reads the equation itself rather than using eval(), so it can only ever do arithmetic.
  const EQ_OPS = { "+": "+", "-": "-", "−": "-", "–": "-", "—": "-", "*": "*", "×": "*", "/": "/", "÷": "/", "(": "(", ")": ")", "%": "%" };
  const EQ_SHOW = { "-": "−", "*": "×", "/": "÷" };
  const sameColumnName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  function equationTokens(source) {
    const s = String(source).trim().replace(/^=/, "");
    const tokens = [];
    for (let i = 0; i < s.length;) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === "[") {
        const end = s.indexOf("]", i);
        if (end < 0) throw new Error("A column name is missing its closing ].");
        const name = s.slice(i + 1, end).trim();
        if (!name) throw new Error("There's an empty [ ] in the equation.");
        tokens.push({ ref: name });
        i = end + 1;
      } else if (EQ_OPS[ch]) {
        tokens.push({ op: EQ_OPS[ch] });
        i++;
      } else if (ch === "]") {
        throw new Error("There's a ] without a [ before it.");
      } else {
        const word = s.slice(i).match(/^[^+\-−–—*×/÷()%[\]]+/)[0];
        // A lone x means ×, so "Price x 2" is three parts, not one long name.
        word.trim().split(/(?:^|\s+)x(?:\s+|$)/i).forEach((part, k) => {
          if (k > 0) tokens.push({ op: "*" });
          if (!part) return;
          if (/^\d*\.?\d+$/.test(part)) tokens.push({ num: Number(part), text: part });
          else tokens.push({ ref: part });
        });
        i += word.length;
      }
    }
    return tokens;
  }

  // Returns { ok: true, tree, refs, text, hasDivision } or { ok: false, error }. `text` is the tidy form, like "[Qty] × [Price]".
  function parseEquation(source) {
    try {
      const tokens = equationTokens(source);
      if (!tokens.length) throw new Error("The equation is empty.");
      let at = 0;
      const refs = [];
      let hasDivision = false;
      const peek = () => tokens[at] && tokens[at].op;
      const primary = () => {
        const t = tokens[at];
        if (!t) throw new Error("The equation stops too early.");
        at++;
        if (t.num !== undefined) return { num: t.num };
        if (t.ref !== undefined) {
          if (!refs.some((r) => sameColumnName(r, t.ref))) refs.push(t.ref);
          return { ref: t.ref };
        }
        if (t.op === "(") {
          const inside = sum();
          if (peek() !== ")") throw new Error("A ( is missing its closing ).");
          at++;
          return inside;
        }
        throw new Error(t.op === ")" ? "There's a ) without a ( before it, or something missing before it." : "Two signs are next to each other, or something is missing.");
      };
      const percent = () => {
        let node = primary();
        while (peek() === "%") { at++; node = { pct: node }; }
        return node;
      };
      const unary = () => {
        if (peek() === "-") { at++; return { neg: unary() }; }
        if (peek() === "+") { at++; return unary(); }
        return percent();
      };
      const product = () => {
        let node = unary();
        while (peek() === "*" || peek() === "/") {
          const op = tokens[at++].op;
          if (op === "/") hasDivision = true;
          node = { op, a: node, b: unary() };
        }
        return node;
      };
      const sum = () => {
        let node = product();
        while (peek() === "+" || peek() === "-") {
          const op = tokens[at++].op;
          node = { op, a: node, b: product() };
        }
        return node;
      };
      const tree = sum();
      if (at < tokens.length) throw new Error("Something is missing between two parts, like a + or ×.");
      const text = tokens
        .map((t) => (t.ref !== undefined ? `[${t.ref}]` : t.num !== undefined ? t.text : EQ_SHOW[t.op] || t.op))
        .join(" ")
        .replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ %/g, "%");
      return { ok: true, tree, refs, text, hasDivision };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  const DIVIDES_BY_ZERO = "It divides by zero.";

  // valueOf(columnName) gives a number. Returns { value } or { error }.
  function evalEquation(tree, valueOf) {
    const run = (n) => {
      if (n.num !== undefined) return n.num;
      if (n.ref !== undefined) return valueOf(n.ref);
      if (n.neg) return -run(n.neg);
      if (n.pct) return run(n.pct) / 100;
      const a = run(n.a), b = run(n.b);
      if (n.op === "+") return a + b;
      if (n.op === "-") return a - b;
      if (n.op === "*") return a * b;
      if (b === 0) throw new Error(DIVIDES_BY_ZERO);
      return a / b;
    };
    try { return { value: run(tree) }; } catch (e) { return { error: e.message }; }
  }

  // The value of a calculated column in one row (row: values by column id). A blank cell counts as 0, as in Excel.
  function equationValue(col, columns, row, seen = []) {
    if (seen.includes(col)) return { error: "The equation uses its own result." };
    const eq = parseEquation(col.equation || "");
    if (!eq.ok) return { error: eq.error };
    return evalEquation(eq.tree, (name) => {
      const other = columns.find((c) => sameColumnName(c.name, name));
      if (!other) throw new Error(`There's no column called “${name}”.`);
      if (other.type === "calc") {
        const result = equationValue(other, columns, row, [...seen, col]);
        if (result.error) throw new Error(result.error);
        return result.value;
      }
      const v = row[other.id];
      if (isBlank(v)) return 0;
      const n = asNumber(v);
      if (n === null) throw new Error(`“${v}” in ${other.name} isn't a number.`);
      return n;
    });
  }

  // Checks an equation for the column `self` (null for a new one). Returns { ok, text } with the columns' real
  // names filled in, or { ok: false, error }.
  function validateEquation(source, columns, self) {
    const eq = parseEquation(source);
    if (!eq.ok) return eq;
    let text = eq.text;
    for (const ref of eq.refs) {
      const col = columns.find((c) => sameColumnName(c.name, ref));
      if (!col) return { ok: false, error: `There's no column called “${ref}”. Tap a column below to add it.` };
      if (col === self) return { ok: false, error: `The equation can't use its own column, “${col.name}”.` };
      if (["check", "time", "date"].includes(col.type)) return { ok: false, error: `“${col.name}” doesn't hold numbers, so it can't be used in an equation.` };
      text = text.split(`[${ref}]`).join(`[${col.name}]`);
    }
    // A calculated column it uses mustn't, somewhere along the way, use this one.
    const reaches = (col, seen = []) => {
      if (seen.includes(col) || col.type !== "calc") return false;
      const refs = parseEquation(col.equation || "").refs || [];
      return refs.some((name) => {
        if (self && sameColumnName(name, self.name)) return true;
        const next = columns.find((c) => sameColumnName(c.name, name));
        return !!next && reaches(next, [...seen, col]);
      });
    };
    for (const ref of eq.refs) {
      if (reaches(columns.find((c) => sameColumnName(c.name, ref)))) return { ok: false, error: `“${ref}” already uses this column, so they would go round in a circle.` };
    }
    return { ok: true, text, tree: eq.tree, refs: eq.refs };
  }

  // The equation as an Excel formula; refOf(columnName) gives the cell, like "C2".
  function equationToExcel(tree, refOf) {
    const LEVEL = { "+": 1, "-": 1, "*": 2, "/": 2 };
    const show = (n, outer = 0, rightSide = false) => {
      if (n.num !== undefined) return String(n.num);
      if (n.ref !== undefined) return refOf(n.ref);
      if (n.neg) return `-${show(n.neg, 3)}`;
      if (n.pct) return `${show(n.pct, 3)}%`;
      const level = LEVEL[n.op];
      const body = `${show(n.a, level)}${n.op}${show(n.b, level, true)}`;
      return level < outer || (rightSide && level === outer) ? `(${body})` : body;
    };
    return show(tree);
  }

  // ---------- Do the numbers add up? ----------
  // A column named like a total ("ድምር", "Total") should be the sum of the number columns just before it in the
  // same group ("ጠዋት የተሰራ: ያደረ" + "ጠዋት የተሰራ: አዲስ የተመረተ" = "ጠዋት የተሰራ: ድምር"), or Qty × Price. A rule only
  // counts if most of the table's own rows follow it, so an unusual "Total" column doesn't flag every row.
  const TOTAL_NAME = /(?:^|[\s:])(?:ድምር|ጠቅላላ|total|subtotal|sum)\s*$/i;
  const isBlank = (v) => v === "" || v == null;
  const asNumber = (v) => {
    if (typeof v === "number") return v;
    const s = String(v ?? "").trim();
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  };
  const groupOf = (name) => (String(name).includes(":") ? String(name).split(":")[0].trim() : "");

  // columns: [{ name }], rows: [[value…]]. Returns the cells of rows that don't add up, as [{ row, col }].
  function checkNumbers(columns, rows) {
    const flagged = new Map();
    columns.forEach((col, t) => {
      if (!TOTAL_NAME.test(String(col.name).trim())) return;
      // The number columns right before the total, nearest first. Empty ones are passed over.
      const parts = [];
      for (let k = t - 1; k >= 0 && groupOf(columns[k].name) === groupOf(col.name); k--) {
        const vals = rows.map((r) => r[k]).filter((v) => !isBlank(v));
        if (!vals.length) continue;
        if (vals.some((v) => asNumber(v) === null)) break;
        parts.push(k);
      }
      if (parts.length < 2) return;

      const rules = [];
      for (let n = 2; n <= parts.length; n++) rules.push({ cols: parts.slice(0, n), blankIsZero: true, calc: (xs) => xs.reduce((a, b) => a + b, 0) });
      rules.push({ cols: parts.slice(0, 2), blankIsZero: false, calc: ([a, b]) => a * b });

      let best = null;
      for (const rule of rules) {
        const wrong = [];
        let right = 0;
        rows.forEach((r, i) => {
          const total = asNumber(r[t]);
          if (total === null || rule.cols.every((k) => isBlank(r[k]))) return;
          const xs = rule.cols.map((k) => (isBlank(r[k]) && rule.blankIsZero ? 0 : asNumber(r[k])));
          if (xs.some((x) => x === null)) return;
          if (Math.abs(rule.calc(xs) - total) < 0.01) right++;
          else wrong.push(i);
        });
        if (!best || right > best.right) best = { rule, right, wrong };
      }
      if (best.right < 2 || best.right / (best.right + best.wrong.length) < 0.6) return;
      for (const i of best.wrong) {
        for (const k of [t, ...best.rule.cols]) if (!isBlank(rows[i][k])) flagged.set(`${i}|${k}`, { row: i, col: k });
      }
    });
    return [...flagged.values()];
  }

  global.ListParser = {
    parseListText, parseLine, toNumber, analyze, fromTable, checkNumbers,
    parseEquation, evalEquation, equationValue, validateEquation, equationToExcel, sameColumnName, DIVIDES_BY_ZERO,
  };
})(typeof window !== "undefined" ? window : globalThis);
