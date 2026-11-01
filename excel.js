// Helpers for reading and writing .xlsx files with SheetJS.
// A column looks like { id, name, type: text|number|time|check|date, role?: item|qty|price|time|made|date }.
(function (global) {
  function cellValue(col, v) {
    if (col.type === "check") return v ? "Yes" : "No";
    if (col.type === "number") {
      if (v === "" || v == null) return "";
      const n = Number(v);
      return Number.isFinite(n) ? n : String(v);
    }
    return v == null ? "" : String(v);
  }

  function rowsToAoa(columns, rows) {
    return rows.map((r) => columns.map((c) => cellValue(c, r[c.id])));
  }

  function setWidths(ws, columns) {
    ws["!cols"] = columns.map((c) => ({ wch: c.role === "item" ? 28 : Math.max(10, c.name.length + 2) }));
  }

  function newSheet(columns, rows) {
    const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.name), ...rowsToAoa(columns, rows)]);
    setWidths(ws, columns);
    return ws;
  }

  function buildWorkbook(sheetName, columns, rows) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, newSheet(columns, rows), safeSheetName(sheetName));
    return wb;
  }

  function safeSheetName(name) {
    const s = String(name || "List").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
    return s || "List";
  }

  function readWorkbook(arrayBuffer) {
    return XLSX.read(arrayBuffer, { type: "array", cellDates: false });
  }

  // Header names in the first used row of a sheet, as [{ name, c }].
  function readHeaders(ws) {
    if (!ws || !ws["!ref"]) return { headers: [], range: null };
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const headers = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
      if (cell && cell.v !== "" && cell.v != null) headers.push({ name: String(cell.v).trim(), c });
    }
    return { headers, range };
  }

  // Add rows to the bottom of a sheet. Columns are matched to the headers by name (ignoring case),
  // and any column the sheet doesn't have yet gets a new header on the right.
  function appendToWorkbook(wb, sheetName, columns, rows) {
    const name = safeSheetName(sheetName);
    let ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) {
      if (!ws) XLSX.utils.book_append_sheet(wb, newSheet(columns, rows), name);
      else wb.Sheets[name] = newSheet(columns, rows);
      return { added: rows.length, newColumns: [], createdSheet: true };
    }

    const { headers, range } = readHeaders(ws);
    const headerRow = range.s.r;
    let nextCol = headers.length ? Math.max(...headers.map((h) => h.c)) + 1 : range.s.c;
    const newColumns = [];
    const colIndex = columns.map((col) => {
      const hit = headers.find((h) => h.name.toLowerCase() === col.name.trim().toLowerCase());
      if (hit) return hit.c;
      const c = nextCol++;
      ws[XLSX.utils.encode_cell({ r: headerRow, c })] = { t: "s", v: col.name };
      newColumns.push(col.name);
      return c;
    });

    // Start below the last row that has any value, so blank formatted rows at the end don't leave gaps.
    let lastRow = headerRow;
    for (const addr of Object.keys(ws)) {
      if (addr[0] === "!") continue;
      const cell = ws[addr];
      if (cell && cell.v !== "" && cell.v != null) lastRow = Math.max(lastRow, XLSX.utils.decode_cell(addr).r);
    }

    let r = lastRow + 1;
    for (const row of rows) {
      columns.forEach((col, i) => {
        const v = cellValue(col, row[col.id]);
        if (v === "") return;
        ws[XLSX.utils.encode_cell({ r, c: colIndex[i] })] = typeof v === "number" ? { t: "n", v } : { t: "s", v };
      });
      r++;
    }

    const maxCol = Math.max(range.e.c, nextCol - 1);
    ws["!ref"] = XLSX.utils.encode_range({ s: range.s, e: { r: Math.max(range.e.r, r - 1), c: maxCol } });
    return { added: rows.length, newColumns, createdSheet: false };
  }

  function toArrayBuffer(wb) {
    return XLSX.write(wb, { bookType: "xlsx", type: "array" });
  }

  function download(wb, fileName) {
    XLSX.writeFile(wb, ensureXlsxName(fileName));
  }

  function ensureXlsxName(name) {
    const base = String(name || "ListSnap").replace(/\.(xlsx|xls|csv)$/i, "").replace(/[\\/:*?"<>|]/g, " ").trim() || "ListSnap";
    return base + ".xlsx";
  }

  global.ListExcel = {
    buildWorkbook, appendToWorkbook, readWorkbook, readHeaders, toArrayBuffer, download,
    ensureXlsxName, safeSheetName, cellValue,
  };
})(typeof window !== "undefined" ? window : globalThis);
