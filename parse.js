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
    if (!columns.some((c) => c.role === "item") && !columns[0].role) columns[0].role = "item";

    const out = [], sections = [];
    let section = "";
    for (const r of rows) {
      const filled = r.filter(Boolean);
      const t = filled.length === 1 ? sectionTitle(filled[0]) : "";
      if (t) { section = t; continue; }
      if (hasHeader && r.filter(isHeaderWord).length >= 2 && r.every((v, k) => !v || v === names[k])) continue; // header repeated
      out.push(r); sections.push(section);
    }
    applySections(columns, out, sections);
    finishColumns(columns, out);
    return { columns, rows: out, fromHeader: hasHeader };
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

  global.ListParser = { parseListText, parseLine, toNumber, analyze };
})(typeof window !== "undefined" ? window : globalThis);
