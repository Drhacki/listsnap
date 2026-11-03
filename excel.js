// Helpers for reading and writing .xlsx files with ExcelJS, which keeps a file's look (fonts, colours,
// money formats, column widths, merged cells) and its formulas when rows are added.
// SheetJS is only used to open old .xls and .csv files, which are turned into .xlsx first.
// A column looks like { id, name, type: text|number|time|check|date, role?: item|qty|price|time|made|date }.
(function (global) {
  const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  // ExcelJS is big (about 1 MB), so it's only loaded when a file is opened or saved, not for scanning.
  const lib = () => loadScript(EXCELJS_URL).then(() => global.ExcelJS);
  // Fetch it ahead of time once saving is likely, so Save doesn't have to wait for it. A failure here doesn't matter.
  const preload = () => { lib().catch(() => {}); };

  function cellValue(col, v) {
    if (col.type === "check") return v ? "Yes" : "No";
    if (col.type === "number") {
      if (v === "" || v == null) return "";
      const n = Number(v);
      return Number.isFinite(n) ? n : String(v);
    }
    return v == null ? "" : String(v);
  }

  // Column names match when they're the same apart from capitals and spacing ("Group:Sub" = "group : sub").
  const normName = (s) => String(s ?? "").replace(/\s*:\s*/g, ": ").replace(/\s+/g, " ").trim().toLowerCase();
  const textOf = (cell) => String(cell.text ?? "").trim();
  const hasValue = (cell) => cell.value !== null && cell.value !== undefined && cell.value !== "";
  // A merged cell shows its first cell's content in every part; only the first part really holds it.
  const isOwn = (cell) => !cell.isMerged || cell.master.address === cell.address;
  const isFormula = (cell) => isOwn(cell) && !!(cell.value && typeof cell.value === "object" && (cell.value.formula || cell.value.sharedFormula));
  const copyStyle = (style) => JSON.parse(JSON.stringify(style || {}));

  function colNumber(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  }
  function colLetters(n) {
    let s = "";
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  function parseRange(range) {
    const [a, b = a] = range.split(":");
    const [, c1, r1] = a.match(/([A-Z]+)(\d+)/);
    const [, c2, r2] = b.match(/([A-Z]+)(\d+)/);
    return { top: +r1, left: colNumber(c1), bottom: +r2, right: colNumber(c2) };
  }
  const rangeText = (m) => `${colLetters(m.left)}${m.top}:${colLetters(m.right)}${m.bottom}`;

  // Rows and columns that hold something (styled but empty cells don't count).
  function usedArea(ws) {
    let first = 0, last = 0, width = 0;
    ws.eachRow((row, r) => {
      row.eachCell((cell, c) => {
        if (!hasValue(cell)) return;
        if (!first) first = r;
        last = r;
        width = Math.max(width, c);
      });
    });
    return { first, last, width };
  }

  // ---------- formula references ----------
  // A1-style references, with an optional sheet name and as a range: A1, $F$2:F3, Sheet1!A1, 'Daily sales'!B2.
  // Text in "quotes" is skipped, and function names like LOG10( are not references.
  const REF = /(?<![\w.$'])(?:'((?:[^']|'')+)'!|([A-Za-z_][\w.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![\w(!])/g;

  // fn(sheetName or null, start, end or null) returns the new [startRow, endRow]; start/end are { row, abs }.
  function mapRefs(formula, fn) {
    return formula.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(REF,
      (m, quoted, plain, ca, col, ra, row, cb, col2, rb, row2) => {
        const sheet = quoted != null ? quoted.replace(/''/g, "'") : plain || null;
        const start = { row: +row, abs: ra === "$" };
        const end = row2 ? { row: +row2, abs: rb === "$" } : null;
        const [r1, r2] = fn(sheet, start, end);
        const prefix = quoted != null ? `'${quoted}'!` : plain ? `${plain}!` : "";
        return `${prefix}${ca}${col}${ra}${r1}` + (end ? `:${cb}${col2}${rb}${r2}` : "");
      }))).join("");
  }

  // The same formula one or more rows further down, the way Excel fills a formula down ($ rows stay put).
  const fillDown = (formula, by) =>
    mapRefs(formula, (sheet, s, e) => [s.abs ? s.row : s.row + by, e ? (e.abs ? e.row : e.row + by) : 0]);

  // A Total row: a SUM (or similar) over the rows right above it.
  const TOTAL_FUNCS = /\b(SUM|SUBTOTAL|AGGREGATE|AVERAGEA?|COUNTA?|MIN|MAX|SUMIFS?|SUMPRODUCT)\s*\(/i;
  function isTotalRow(ws, r) {
    let found = false;
    ws.getRow(r).eachCell((cell) => {
      if (!isFormula(cell) || !TOTAL_FUNCS.test(cell.formula)) return;
      mapRefs(cell.formula, (sheet, s, e) => {
        if (e && e.row === r - 1 && s.row < r - 1 && (!sheet || sheet === ws.name)) found = true;
        return [s.row, e ? e.row : 0];
      });
    });
    return found;
  }

  // Make room for n rows at row `at` by moving the Total row (the sheet's last row) down. Every formula in the
  // workbook that points at it is updated, and its own SUM ranges grow to take in the new rows.
  function moveTotalRow(wb, ws, at, n, width) {
    const sameSheet = (formulaSheet, refSheet) => (refSheet || formulaSheet).toLowerCase() === ws.name.toLowerCase();
    for (const sheet of wb.worksheets) {
      sheet.eachRow((row, r) => row.eachCell((cell) => {
        if (!isFormula(cell)) return;
        const inTotalRow = sheet === ws && r === at;
        const before = cell.formula;
        const after = mapRefs(before, (refSheet, s, e) => {
          if (!sameSheet(sheet.name, refSheet)) return [s.row, e ? e.row : 0];
          const move = (x) => (x >= at ? x + n : x);
          let end = e ? move(e.row) : 0;
          if (inTotalRow && e && e.row === at - 1 && s.row < at) end = e.row + n; // SUM(F2:F3) becomes SUM(F2:F5)
          return [move(s.row), end];
        });
        if (after !== before || inTotalRow) cell.value = { formula: after, result: cell.value.result };
      }));
    }
    const merges = (ws.model.merges || []).map(parseRange).filter((m) => m.top === at && m.bottom === at);
    for (const m of merges) ws.unMergeCells(rangeText(m));
    const from = ws.getRow(at), to = ws.getRow(at + n);
    for (let c = 1; c <= width; c++) {
      const a = from.getCell(c), b = to.getCell(c);
      b.value = a.value;
      b.style = copyStyle(a.style);
      a.value = null;
      a.style = {};
    }
    if (from.height) to.height = from.height;
    for (const m of merges) ws.mergeCells(rangeText({ ...m, top: at + n, bottom: at + n }));
  }

  // ---------- headers ----------
  // The header names of a sheet, as [{ name, c }], and the row they end on. A two-row header like the paper
  // form (a group heading merged across its columns, with the column names under it) gives names like
  // "ጠዋት የተሰራ: ድምር", the same names the AI readers give such columns.
  function readHeaders(wb, sheetName) {
    const ws = wb.getWorksheet(sheetName);
    const { first: top, width } = ws ? usedArea(ws) : {};
    if (!top) return { headers: [], headerRow: 0 };
    const groups = (ws.model.merges || []).map(parseRange).filter((m) => m.top === top && m.bottom === top && m.right > m.left);
    const sub = top + 1;
    const twoRows = groups.some((g) => {
      for (let c = g.left; c <= g.right; c++) if (textOf(ws.getCell(sub, c))) return true;
      return false;
    });
    const headers = [];
    for (let c = 1; c <= width; c++) {
      const upper = textOf(ws.getCell(top, c)); // a merged cell gives its heading's text
      let name = upper;
      if (twoRows) {
        const below = ws.getCell(sub, c);
        const lower = below.isMerged && below.master.row === top ? "" : textOf(below); // a heading over both rows
        name = upper && lower && upper !== lower ? `${upper}: ${lower}` : upper || lower;
      }
      if (name) headers.push({ name, c });
    }
    return { headers, headerRow: twoRows ? sub : top };
  }

  // ---------- equations ----------
  // A calculated column as an Excel formula for row r. lettersOf(columnName) gives that column's letters.
  function equationFormula(col, lettersOf, r) {
    const eq = ListParser.parseEquation(col.equation || "");
    if (!eq.ok || !eq.refs.every((name) => lettersOf(name))) return null;
    const body = ListParser.equationToExcel(eq.tree, (name) => `${lettersOf(name)}${r}`);
    // Dividing by an empty cell would show #DIV/0! and spoil any total, so such a cell stays empty instead.
    return eq.hasDivision ? `IFERROR(${body},"")` : body;
  }

  // The formula plus its worked-out value, so previews that don't calculate still show the number.
  function equationCell(col, columns, row, lettersOf, r) {
    const formula = equationFormula(col, lettersOf, r);
    if (!formula) return null;
    const result = ListParser.equationValue(col, columns, row);
    return result.error ? { formula } : { formula, result: result.value };
  }

  const columnsInEquations = (columns) => new Set(columns
    .filter((c) => c.type === "calc")
    .flatMap((c) => ListParser.parseEquation(c.equation || "").refs || [])
    .map(normName));

  // Numbers typed into a text column are saved as real numbers if an equation uses that column.
  function valueToWrite(col, v, used) {
    const out = cellValue(col, v);
    return typeof out === "string" && used.has(normName(col.name)) && /^-?\d+(\.\d+)?$/.test(out.trim()) ? Number(out) : out;
  }

  // ---------- writing ----------
  function writeNewSheet(ws, columns, rows) {
    const used = columnsInEquations(columns);
    const lettersOf = (name) => {
      const k = columns.findIndex((c) => ListParser.sameColumnName(c.name, name));
      return k < 0 ? null : colLetters(k + 1);
    };
    ws.addRow(columns.map((c) => c.name)).font = { bold: true };
    rows.forEach((row, i) => {
      ws.addRow(columns.map((c) => {
        if (c.type === "calc") return equationCell(c, columns, row, lettersOf, i + 2);
        const v = valueToWrite(c, row[c.id], used);
        return v === "" ? null : v;
      }));
    });
    columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.role === "item" ? 28 : Math.max(10, c.name.length + 2); });
    if (columns.some((c) => c.type === "calc")) ws.workbook.calcProperties.fullCalcOnLoad = true;
  }

  async function buildWorkbook(sheetName, columns, rows) {
    const ExcelJS = await lib();
    const wb = new ExcelJS.Workbook();
    writeNewSheet(wb.addWorksheet(safeSheetName(sheetName)), columns, rows);
    return wb;
  }

  function safeSheetName(name) {
    const s = String(name || "List").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
    return s || "List";
  }

  const sheetNames = (wb) => wb.worksheets.map((ws) => ws.name);

  // Add rows to the bottom of a sheet, or above its Total row. Columns are matched to the headers by name
  // (ignoring capitals), and any column the sheet doesn't have yet gets a new header on the right.
  // The new rows copy the look of the row above, its formulas (adjusted to each row, so a Total sales
  // formula keeps working), and, for columns the photo doesn't have, numbers like the price from the last
  // row with the same item.
  function appendToWorkbook(wb, sheetName, columns, rows) {
    const name = safeSheetName(sheetName);
    let ws = wb.getWorksheet(name);
    const report = { added: rows.length, newColumns: [], createdSheet: false, formulaColumns: [], filledColumns: [], aboveTotal: false };
    if (!ws || !usedArea(ws).last) {
      writeNewSheet(ws || wb.addWorksheet(name), columns, rows);
      report.createdSheet = true;
      return report;
    }

    const { headers, headerRow } = readHeaders(wb, name);
    const area = usedArea(ws);
    let nextCol = Math.max(area.width, ...headers.map((h) => h.c)) + 1;
    const colIndex = columns.map((col) => {
      const hit = headers.find((h) => normName(h.name) === normName(col.name));
      if (hit) return hit.c;
      const c = nextCol++;
      const cell = ws.getCell(headerRow, c);
      cell.value = col.name;
      if (c > 1) cell.style = copyStyle(ws.getCell(headerRow, c - 1).style);
      ws.getColumn(c).width = Math.max(16, col.name.length + 2); // wide enough that numbers don't show as ####
      report.newColumns.push(col.name);
      return c;
    });
    const width = nextCol - 1;
    const headerName = (c) => (headers.find((h) => h.c === c) || {}).name || colLetters(c);

    // Where the rows go: under the last row, or in place of a Total row, which moves down.
    const total = area.last > headerRow + 1 && isTotalRow(ws, area.last) ? area.last : 0;
    const lastData = total ? total - 1 : area.last;
    const start = total || area.last + 1;
    const hasData = lastData > headerRow;

    // Per column: the nearest row above with a formula to fill down (looking a few rows up).
    const formulaFrom = {};
    if (hasData) {
      for (let c = 1; c <= width; c++) {
        for (let r = lastData; r > Math.max(headerRow, lastData - 5); r--) {
          const cell = ws.getCell(r, c);
          if (!hasValue(cell)) continue;
          if (isFormula(cell)) formulaFrom[c] = r;
          break;
        }
      }
    }
    // The last row for each item, for columns the photo doesn't have (like the price).
    const itemK = columns.findIndex((c) => c.role === "item");
    const itemRow = new Map();
    if (itemK >= 0) {
      for (let r = headerRow + 1; r <= lastData; r++) {
        const t = normName(textOf(ws.getCell(r, colIndex[itemK])));
        if (t) itemRow.set(t, r);
      }
    }

    const used = columnsInEquations(columns);
    const lettersOf = (colName) => {
      const k = columns.findIndex((c) => ListParser.sameColumnName(c.name, colName));
      return k < 0 ? null : colLetters(colIndex[k]);
    };
    // A calculated column that's new to this sheet is also worked out for the rows already there.
    const newCalc = columns.map((c, k) => ({ c, at: colIndex[k] })).filter(({ c }) => c.type === "calc" && report.newColumns.includes(c.name));
    for (const { c, at } of newCalc) {
      const refs = ListParser.parseEquation(c.equation || "").refs || [];
      const refCols = refs.map((n) => columns.findIndex((x) => ListParser.sameColumnName(x.name, n))).filter((k) => k >= 0).map((k) => colIndex[k]);
      for (let r = headerRow + 1; r <= lastData; r++) {
        if (!refCols.some((rc) => hasValue(ws.getCell(r, rc)))) continue;
        const formula = equationFormula(c, lettersOf, r);
        if (!formula) continue;
        const cell = ws.getCell(r, at);
        cell.style = copyStyle(ws.getCell(r, at - 1).style);
        cell.value = { formula };
      }
    }

    if (total) {
      moveTotalRow(wb, ws, total, rows.length, width);
      report.aboveTotal = true;
    }

    const formulaCols = new Set(), filledCols = new Set();
    rows.forEach((row, i) => {
      const r = start + i;
      const sameItem = itemK >= 0 ? itemRow.get(normName(row[columns[itemK].id])) : undefined;
      for (let c = 1; c <= width; c++) {
        const cell = ws.getCell(r, c);
        if (hasData) cell.style = copyStyle(ws.getCell(lastData, c).style);
        const k = colIndex.indexOf(c);
        const isCalc = k >= 0 && columns[k].type === "calc";
        const v = k >= 0 && !isCalc ? valueToWrite(columns[k], row[columns[k].id], used) : "";
        if (formulaFrom[c]) {
          // The sheet calculates this column, so its formula wins over a value from the photo or an equation here.
          cell.value = { formula: fillDown(ws.getCell(formulaFrom[c], c).formula, r - formulaFrom[c]) };
          formulaCols.add(headerName(c));
        } else if (isCalc) {
          const value = equationCell(columns[k], columns, row, lettersOf, r);
          if (value) { cell.value = value; formulaCols.add(columns[k].name); }
        } else if (v !== "") {
          cell.value = v;
        } else if ((k < 0 || columns[k].manual) && sameItem) {
          // A column the photo doesn't have (or an empty one added by hand), like the price.
          const earlier = ws.getCell(sameItem, c).value;
          if (typeof earlier === "number") { cell.value = earlier; filledCols.add(headerName(c)); }
        }
      }
    });
    // A Total row gets a SUM for a new calculated column too, looking like the row's other totals.
    if (total) {
      const totalRow = start + rows.length;
      for (const { c, at } of newCalc) {
        if (ListParser.parseEquation(c.equation || "").hasDivision) continue; // adding up per-item figures means nothing
        const letters = colLetters(at);
        const cell = ws.getCell(totalRow, at);
        cell.value = { formula: `SUM(${letters}${headerRow + 1}:${letters}${totalRow - 1})` };
        for (let left = at - 1; left >= 1; left--) {
          if (hasValue(ws.getCell(totalRow, left))) { cell.style = copyStyle(ws.getCell(totalRow, left).style); break; }
        }
        const format = ws.getCell(totalRow - 1, at).numFmt; // the same number format as the rows above it
        if (format) cell.numFmt = format;
      }
    }
    report.formulaColumns = [...formulaCols];
    report.filledColumns = [...filledCols];
    wb.calcProperties.fullCalcOnLoad = true; // Excel works out the new formulas when the file is opened
    return report;
  }

  // ---------- files ----------
  async function readWorkbook(arrayBuffer) {
    const ExcelJS = await lib();
    let data = arrayBuffer;
    const head = new Uint8Array(arrayBuffer, 0, 2);
    if (!(head[0] === 0x50 && head[1] === 0x4b)) {
      // Not an .xlsx (which is a zip file starting with "PK"): an old .xls or a .csv file.
      await loadScript(SHEETJS_URL);
      data = XLSX.write(XLSX.read(arrayBuffer, { type: "array" }), { bookType: "xlsx", type: "array" });
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data);
    return wb;
  }

  const toArrayBuffer = (wb) => wb.xlsx.writeBuffer();

  async function download(wb, fileName) {
    const blob = new Blob([await toArrayBuffer(wb)], { type: XLSX_MIME });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ensureXlsxName(fileName);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function ensureXlsxName(name) {
    const base = String(name || "ListSnap").replace(/\.(xlsx|xls|csv)$/i, "").replace(/[\\/:*?"<>|]/g, " ").trim() || "ListSnap";
    return base + ".xlsx";
  }

  global.ListExcel = {
    preload, buildWorkbook, appendToWorkbook, readWorkbook, readHeaders, sheetNames, toArrayBuffer, download,
    ensureXlsxName, safeSheetName, cellValue, normName, fillDown,
  };
})(typeof window !== "undefined" ? window : globalThis);
