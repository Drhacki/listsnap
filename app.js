(function () {
  const $ = (id) => document.getElementById(id);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const DEFAULT_COLUMNS = () => [
    { id: uid(), name: "Item", type: "text", role: "item" },
    { id: uid(), name: "Qty", type: "number", role: "qty" },
    { id: uid(), name: "Price", type: "number", role: "price" },
    { id: uid(), name: "Time", type: "time", role: "time" },
    { id: uid(), name: "Made", type: "check", role: "made" },
    { id: uid(), name: "Date", type: "date", role: "date" },
  ];
  const TYPE_LABEL = { text: "text", number: "123", time: "AM/PM", check: "✓", date: "date", calc: "=", lookup: "list" };
  // Columns that are worked out, not typed in or read from a photo.
  const isWorkedOut = (col) => col.type === "calc" || col.type === "lookup";

  const state = {
    columns: DEFAULT_COLUMNS(),
    rows: [],
    image: null,
    templates: [],
    saveMode: "new",
    existing: null, // { kind: "drive", id, name, wb } or { kind: "local", name, wb }
    files: [],
    editingCol: null,
    scan: { id: null, image: null }, // the last photo read; rows from it carry _scan, for proofreading
    corrections: [], // what proofreading suggests: [{ row, col, typed, correct }]
    checkAt: "", // the cell the Next button went to last
  };

  // ---------- storage helpers ----------
  const ls = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  const saveDraft = () => ls.set("listsnap.draft", { columns: state.columns, rows: state.rows });

  // action: optional { label, run } shown as a button in the message, e.g. Undo.
  function toast(msg, ms = 2600, action) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    if (action) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "toast-action"; b.textContent = action.label;
      b.onclick = () => { t.hidden = true; action.run(); };
      t.append(" ", b);
    }
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  function status(msg, kind = "") {
    const s = $("saveStatus");
    s.className = "status " + kind;
    s.textContent = msg;
  }

  // ---------- table ----------
  function blankRow() {
    const r = { _id: uid() };
    for (const c of state.columns) r[c.id] = c.type === "check" ? false : c.type === "date" ? today() : "";
    return r;
  }

  function renderGrid() {
    const thead = $("grid").tHead;
    const tbody = $("grid").tBodies[0];
    thead.innerHTML = ""; tbody.innerHTML = "";

    const hr = document.createElement("tr");
    for (const col of state.columns) {
      const th = document.createElement("th");
      if (col.role === "item") th.className = "item-cell";
      const b = document.createElement("button");
      b.className = "colhead"; b.type = "button";
      b.title = col.type === "calc" ? `= ${col.equation}` : col.type === "lookup" ? "Filled in from its price list" : "Edit column";
      b.textContent = col.name;
      const t = document.createElement("span");
      t.className = "type"; t.textContent = TYPE_LABEL[col.type] || "";
      b.appendChild(t);
      b.onclick = () => openColDialog(col);
      th.appendChild(b);
      hr.appendChild(th);
    }
    hr.appendChild(document.createElement("th"));
    thead.appendChild(hr);

    if (!state.rows.length) {
      const tr = document.createElement("tr");
      tr.className = "empty";
      const td = document.createElement("td");
      td.colSpan = state.columns.length + 1;
      td.textContent = "No rows yet. Scan a picture of a list, or tap “+ Row” to type one in.";
      tr.appendChild(td); tbody.appendChild(tr);
    }

    for (const row of state.rows) {
      const tr = document.createElement("tr");
      for (const col of state.columns) tr.appendChild(cellEditor(row, col));
      const del = document.createElement("td");
      del.className = "del-cell";
      const x = document.createElement("button");
      x.className = "icon-btn"; x.type = "button"; x.title = "Delete row"; x.setAttribute("aria-label", "Delete row");
      x.textContent = "✕";
      x.onclick = () => { state.rows = state.rows.filter((r) => r !== row); saveDraft(); renderGrid(); };
      del.appendChild(x); tr.appendChild(del);
      tbody.appendChild(tr);
    }
    $("rowCount").textContent = state.rows.length ? `${state.rows.length} row${state.rows.length === 1 ? "" : "s"}` : "";
    renderProofList();
    refreshChecks();
  }

  function cellEditor(row, col) {
    const td = document.createElement("td");
    td.dataset.row = row._id;
    td.dataset.col = col.id;
    let el;
    const v = row[col.id];
    // Changing a cell counts as checking it, so its marks go away.
    const edited = () => {
      if (row._flags) delete row._flags[col.id];
      if (state.corrections.some((c) => c.row === row && c.col === col)) {
        state.corrections = state.corrections.filter((c) => !(c.row === row && c.col === col));
        renderProofList();
      }
      saveDraft();
      refreshChecks();
    };
    if (isWorkedOut(col)) {
      td.className = "calc-cell";
      td.appendChild(document.createElement("output")); // filled in by refreshChecks
      return td;
    }
    if (col.type === "check") {
      td.className = "check-cell";
      el = document.createElement("input"); el.type = "checkbox"; el.checked = !!v;
      el.onchange = () => { row[col.id] = el.checked; edited(); };
    } else if (col.type === "time") {
      el = document.createElement("select");
      for (const opt of ["", "Morning", "Afternoon"]) {
        const o = document.createElement("option"); o.value = opt; o.textContent = opt || "–"; el.appendChild(o);
      }
      el.value = v || "";
      el.onchange = () => { row[col.id] = el.value; edited(); };
    } else {
      el = document.createElement("input");
      el.type = col.type === "number" ? "number" : col.type === "date" ? "date" : "text";
      if (col.type === "number") { el.step = "any"; el.inputMode = "decimal"; }
      el.value = v == null ? "" : v;
      el.oninput = () => { row[col.id] = col.type === "number" && el.value !== "" ? Number(el.value) : el.value; edited(); };
      if (col.role === "item") td.className = "item-cell";
      // The item column offers the closest remembered names while it's being edited.
      if (col === ListParser.itemColumnOf(state.columns)) {
        el.addEventListener("focus", () => showSuggestions(el));
        el.addEventListener("input", () => showSuggestions(el));
        el.addEventListener("blur", () => { $("suggestBar").hidden = true; });
      }
    }
    el.setAttribute("aria-label", col.name);
    td.appendChild(el);
    return td;
  }

  // ---------- checking the table ----------
  // Colours the cells to look at, and shows how many there are. Red: the row's numbers don't add up.
  // Yellow: the AI found the cell hard to read. Blue: proofreading suggests a different value.
  function refreshChecks() {
    const sums = ListParser.checkNumbers(state.columns, state.rows.map((r) => state.columns.map((c) => r[c.id])));
    const sumCells = new Set(sums.map((s) => `${state.rows[s.row]._id}|${state.columns[s.col].id}`));
    const rowsById = new Map(state.rows.map((r) => [r._id, r]));
    const colsById = new Map(state.columns.map((c) => [c.id, c]));
    let unsure = 0, fixes = 0, failedCalcs = 0, noPrice = 0, unknownNames = 0;
    const item = ListParser.itemColumnOf(state.columns);
    const known = namesOn() ? new Set(knownNames().map(ListParser.nameKey)) : null;
    for (const td of $("grid").tBodies[0].querySelectorAll("td[data-col]")) {
      const column = colsById.get(td.dataset.col);
      if (column && column.type === "lookup") {
        const row = rowsById.get(td.dataset.row);
        const price = ListParser.lookupValue(column, state.columns, row);
        // A row with an item but no matching name in the list is marked, so a missing price is noticed.
        const missing = price === null && !!item && !!String(row?.[item.id] ?? "").trim();
        td.firstChild.textContent = price === null ? "" : formatNumber(price);
        td.classList.toggle("flag-noprice", missing);
        td.title = missing ? `No price for “${String(row[item.id]).trim()}”. Add it to ${column.name}'s price list, or correct the name.` : "";
        if (missing) noPrice++;
        continue;
      }
      if (column && column.type === "calc") {
        const result = ListParser.equationValue(column, state.columns, rowsById.get(td.dataset.row));
        // Dividing by an empty or zero cell is left empty, as it is in the Excel file: on a form with
        // unfilled rows that's normal, not a mistake.
        const zero = result.error === ListParser.DIVIDES_BY_ZERO;
        const failed = !!result.error && !zero;
        td.firstChild.textContent = zero ? "" : failed ? "?" : formatNumber(result.value);
        td.classList.toggle("flag-calc", failed);
        td.title = result.error || "";
        if (failed) failedCalcs++;
        continue;
      }
      const flag = rowsById.get(td.dataset.row)?._flags?.[td.dataset.col];
      const isSum = sumCells.has(`${td.dataset.row}|${td.dataset.col}`);
      td.classList.toggle("flag-unsure", flag === "unsure");
      td.classList.toggle("flag-fix", flag === "fix");
      td.classList.toggle("flag-sum", isSum);
      td.title = flag === "fix" ? "Proofreading suggests a different value (see the list under the table)"
        : isSum ? "This row's numbers don't add up"
        : flag === "unsure" ? "Hard to read: please compare with the photo" : "";
      if (flag === "unsure") unsure++;
      if (flag === "fix") fixes++;
      // An item name that isn't on the remembered list is probably misread.
      const name = item && td.dataset.col === item.id ? String(rowsById.get(td.dataset.row)?.[item.id] ?? "").trim() : "";
      const unknown = !!known && !!name && !known.has(ListParser.nameKey(name));
      td.classList.toggle("flag-unknown", unknown);
      if (unknown && !td.title) td.title = "Not one of your remembered names: tap it to choose the closest one, or check it against the photo.";
      if (unknown) unknownNames++;
    }
    const badRows = new Set(sums.map((s) => s.row)).size;
    const parts = [];
    if (badRows) parts.push(`🟥 ${badRows === 1 ? "1 row doesn't" : `${badRows} rows don't`} add up`);
    if (fixes) parts.push(`🟦 ${fixes} suggested fix${fixes === 1 ? "" : "es"}`);
    if (failedCalcs) parts.push(`🟥 ${failedCalcs} can't be calculated`);
    if (unsure) parts.push(`🟨 ${unsure} hard to read`);
    if (noPrice) parts.push(`🟨 ${noPrice} without a price`);
    if (unknownNames) parts.push(`🟨 ${unknownNames} name${unknownNames === 1 ? "" : "s"} not on your list`);
    $("checkText").textContent = parts.join(" · ");
    $("checkBar").hidden = !parts.length;

    const canProof = !!state.scan.image && state.rows.some((r) => r._scan === state.scan.id);
    $("proofBtn").hidden = !canProof;
    $("photoPane").hidden = !canProof;
  }

  const formatNumber = (n) => Number(n.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });

  // For a name that isn't on the remembered list: its closest names, one tap to use one, or add it to the list.
  // Shown in the bar above the table, which stays in view and isn't covered by a phone's keyboard.
  function showSuggestions(input) {
    const bar = $("suggestBar");
    const value = input.value.replace(/\s+/g, " ").trim();
    const known = knownNames();
    if (!namesOn() || !value || known.some((n) => ListParser.nameKey(n) === ListParser.nameKey(value))) { bar.hidden = true; return; }
    bar.replaceChildren();
    const label = document.createElement("span");
    label.textContent = `“${value}” isn't on your list. Change to:`;
    bar.append(label);
    const button = (text, ghost, run) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = ghost ? "btn small ghost" : "btn small";
      b.textContent = text;
      b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the cell (and the keyboard) where it is
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.onclick = run;
      bar.append(b);
    };
    for (const name of ListParser.closestNames(value, known, 3)) {
      button(name, false, () => {
        input.value = name;
        input.dispatchEvent(new Event("input")); // saves it, clears its marks, refills the price
        bar.hidden = true;
      });
    }
    button(`+ Add “${value}” to my names`, true, () => {
      saveKnownNames([...knownNames(), value]);
      bar.hidden = true;
      toast(`“${value}” is now one of your remembered names.`);
    });
    bar.hidden = false;
  }

  function showCell(td) {
    state.checkAt = `${td.dataset.row}|${td.dataset.col}`;
    td.scrollIntoView({ block: "center", inline: "center" });
    const input = td.querySelector("input,select");
    if (input) input.focus({ preventScroll: true });
    // Bring the same part of the photo into view; the row's place in the table is a good guide to its place in the photo.
    const scanRows = state.rows.filter((r) => r._scan === state.scan.id);
    const i = scanRows.findIndex((r) => r._id === td.dataset.row);
    if (i >= 0 && !$("photoPane").hidden) {
      $("photoPane").open = true;
      const box = $("photoBox");
      box.scrollTop = (0.08 + (0.9 * (i + 0.5)) / scanRows.length) * $("checkPhoto").offsetHeight - box.clientHeight / 2;
    }
  }

  $("checkNext").onclick = () => {
    const cells = [...$("grid").tBodies[0].querySelectorAll("td.flag-unsure, td.flag-sum, td.flag-fix, td.flag-calc, td.flag-noprice, td.flag-unknown")];
    if (!cells.length) return;
    const at = cells.findIndex((td) => `${td.dataset.row}|${td.dataset.col}` === state.checkAt);
    showCell(cells[(at + 1) % cells.length]);
  };

  let photoZoom = 1;
  function setZoom(z) {
    photoZoom = Math.min(5, Math.max(1, z));
    $("checkPhoto").style.width = `${photoZoom * 100}%`;
  }
  $("zoomIn").onclick = () => setZoom(photoZoom + 0.5);
  $("zoomOut").onclick = () => setZoom(photoZoom - 0.5);

  function showScanPhoto() {
    const img = $("checkPhoto");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(state.scan.image);
    setZoom(1);
  }

  const photoColumns = () => state.columns.filter((c) => !isWorkedOut(c));

  // Proofreading: an AI compares the table with the photo and lists only what looks wrong.
  const cellText = (row, col) => {
    const v = row[col.id];
    return col.type === "check" ? (v ? "✓" : "") : v == null ? "" : String(v);
  };

  function clearCorrections() {
    for (const c of state.corrections) if (c.row._flags) delete c.row._flags[c.col.id];
    state.corrections = [];
  }

  $("proofBtn").onclick = async () => {
    const picked = $("reader").value;
    const ai = picked !== "free" ? picked : ["gemini", "claude"].find((p) => aiKey(p));
    if (!ai) { toast("Proofreading uses an AI. Choose Claude or Gemini in the Reader menu and enter its key.", 6000); return; }
    if (!aiKey(ai)) { openKeyDialog(ai); return; }
    const rows = state.rows.filter((r) => r._scan === state.scan.id);
    const cols = photoColumns(); // calculated columns aren't in the photo
    const btn = $("proofBtn");
    btn.disabled = true;
    $("proofStatus").textContent = `${AI[ai].name} is comparing the table with the photo…`;
    const started = performance.now();
    try {
      const found = await ListAI.proofread(ai, state.scan.image, aiKey(ai), cols.map((c) => c.name), rows.map((r) => cols.map((c) => cellText(r, c))), {
        onNote: (note) => { $("proofStatus").textContent = note; },
      });
      clearCorrections();
      for (const f of found) {
        const row = rows[f.row], col = cols[f.col];
        if (cellText(row, col) === f.correct) continue; // the AI repeated what's already there
        state.corrections.push({ row, col, typed: cellText(row, col), correct: f.correct });
        row._flags = row._flags || {};
        row._flags[col.id] = "fix";
      }
      const n = state.corrections.length;
      const secs = Math.round((performance.now() - started) / 1000);
      $("proofStatus").textContent = n
        ? `${AI[ai].name} found ${n} thing${n === 1 ? "" : "s"} to look at (${secs} s). Choose below.`
        : `${AI[ai].name} found no mistakes (${secs} s). It can miss things, so a quick look is still worthwhile.`;
      saveDraft();
      renderGrid();
    } catch (err) {
      console.error(err);
      if (err.code === "bad_key") ls.set(AI[ai].storeKey, "");
      $("proofStatus").textContent = "Couldn't proofread: " + (err.message || err);
    } finally {
      btn.disabled = false;
    }
  };

  function rowName(row) {
    const item = state.columns.find((c) => c.role === "item");
    return (item && cellText(row, item)) || `Row ${state.rows.indexOf(row) + 1}`;
  }

  function renderProofList() {
    const box = $("proofList");
    box.replaceChildren();
    state.corrections = state.corrections.filter((c) => state.rows.includes(c.row) && state.columns.includes(c.col));
    box.hidden = !state.corrections.length;
    const settle = (c, apply) => {
      if (apply) c.row[c.col.id] = convert(c.correct, c.col.type);
      if (c.row._flags) delete c.row._flags[c.col.id];
      state.corrections = state.corrections.filter((x) => x !== c);
      saveDraft();
      renderGrid();
    };
    for (const c of state.corrections) {
      const item = document.createElement("div");
      item.className = "proof-item";
      const where = document.createElement("button");
      where.type = "button";
      where.className = "proof-where";
      where.textContent = `${rowName(c.row)} · ${c.col.name}: ${c.typed || "(empty)"} → ${c.correct || "(empty)"}`;
      where.onclick = () => {
        const td = $("grid").tBodies[0].querySelector(`td[data-row="${c.row._id}"][data-col="${c.col.id}"]`);
        if (td) showCell(td);
      };
      const use = document.createElement("button");
      use.type = "button"; use.className = "btn small primary"; use.textContent = `Use ${c.correct || "empty"}`;
      use.onclick = () => settle(c, true);
      const keep = document.createElement("button");
      keep.type = "button"; keep.className = "btn small ghost"; keep.textContent = `Keep ${c.typed || "empty"}`;
      keep.onclick = () => settle(c, false);
      const buttons = document.createElement("div");
      buttons.className = "row";
      buttons.append(use, keep);
      item.append(where, buttons);
      box.append(item);
    }
  }

  // ---------- column dialog ----------
  function openColDialog(col) {
    state.editingCol = col;
    $("colDialogTitle").textContent = col ? "Edit column" : "New column";
    $("colName").value = col ? col.name : "";
    $("colType").value = col ? col.type : "text";
    $("colEquation").value = col && col.equation ? col.equation : "";
    $("colLookup").value = col && col.priceList ? col.priceList : "";
    $("colError").hidden = true;
    $("colDelete").hidden = !col;
    showEquationEditor();
    showPriceListEditor();
    $("colDialog").returnValue = "";
    $("colDialog").showModal();
    $("colName").focus();
  }

  // The equation editor: a button for each column that can be used, and a live preview on the first row.
  function showEquationEditor() {
    const on = $("colType").value === "calc";
    $("eqWrap").hidden = !on;
    if (!on) return;
    const box = $("eqColumns");
    box.replaceChildren();
    for (const c of state.columns) {
      if (c === state.editingCol || c.role === "item" || ["check", "time", "date"].includes(c.type)) continue;
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn small"; b.textContent = c.name;
      b.onclick = () => insertInEquation(`[${c.name}]`);
      box.append(b);
    }
    updateEquationPreview();
  }
  function insertInEquation(text) {
    const input = $("colEquation");
    const at = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? at;
    input.value = input.value.slice(0, at) + text + input.value.slice(end);
    const caret = at + text.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    updateEquationPreview();
  }
  function updateEquationPreview() {
    const source = $("colEquation").value;
    const check = source.trim() ? ListParser.validateEquation(source, state.columns, state.editingCol) : null;
    const line = $("eqPreview");
    line.classList.toggle("err", !!check && !check.ok);
    if (!check) { line.textContent = ""; return; }
    if (!check.ok) { line.textContent = check.error; return; }
    const first = state.rows[0];
    if (!first) { line.textContent = "✓ Looks right."; return; }
    const result = ListParser.equationValue({ equation: source }, state.columns, first);
    line.textContent = result.error ? `First row: ${result.error}` : `First row: ${formatNumber(result.value)}`;
  }
  // The price-list editor: which column is matched, a button to list the table's names, and how many rows get a price.
  function showPriceListEditor() {
    const on = $("colType").value === "lookup";
    $("lookupWrap").hidden = !on;
    if (!on) return;
    const item = ListParser.itemColumnOf(state.columns.filter((c) => c !== state.editingCol));
    $("lookupHelp").textContent = item
      ? `Each row gets the price of the name its “${item.name}” starts with. If two names fit, the longer one wins, so “ዳቦ ዱቄት 1 ኪሎ” beats “ዳቦ”.`
      : "There's no item column to match the names against yet. Read a list first, or add a text column.";
    updatePriceListPreview();
  }
  function updatePriceListPreview() {
    const line = $("lookupPreview");
    const list = ListParser.parsePriceList($("colLookup").value);
    line.classList.toggle("err", !list.ok);
    if (!list.ok) { line.textContent = list.error; return; }
    const item = ListParser.itemColumnOf(state.columns.filter((c) => c !== state.editingCol));
    const probe = { type: "lookup", priceList: $("colLookup").value };
    const withItem = item ? state.rows.filter((r) => String(r[item.id] ?? "").trim()) : [];
    const priced = withItem.filter((r) => ListParser.lookupValue(probe, state.columns, r) !== null).length;
    const parts = [`${list.entries.length} price${list.entries.length === 1 ? "" : "s"}`];
    if (list.unpriced.length) parts.push(`${list.unpriced.length} name${list.unpriced.length === 1 ? "" : "s"} still without a price`);
    if (withItem.length) parts.push(`${priced} of ${withItem.length} rows in the table get a price`);
    line.textContent = parts.join(" · ");
  }
  $("lookupFromTable").onclick = () => {
    const item = ListParser.itemColumnOf(state.columns.filter((c) => c !== state.editingCol));
    if (!item) return;
    const box = $("colLookup");
    const listed = (ListParser.parsePriceList(box.value).entries || []).map((e) => e.name)
      .concat(ListParser.parsePriceList(box.value).unpriced || []).map(ListParser.nameKey);
    const names = [];
    for (const r of state.rows) {
      const name = String(r[item.id] ?? "").trim();
      if (name && !listed.includes(ListParser.nameKey(name)) && !names.some((n) => ListParser.nameKey(n) === ListParser.nameKey(name))) names.push(name);
    }
    if (!names.length) { updatePriceListPreview(); return; }
    box.value = (box.value.trim() ? box.value.trimEnd() + "\n" : "") + names.map((n) => `${n} = `).join("\n");
    box.focus();
    // Put the cursor after the first new "=", ready to type its price.
    const at = box.value.indexOf(`${names[0]} = `) + names[0].length + 3;
    box.setSelectionRange(at, at);
    updatePriceListPreview();
  };
  $("colLookup").oninput = updatePriceListPreview;
  $("colType").onchange = () => { showEquationEditor(); showPriceListEditor(); };
  $("colEquation").oninput = updateEquationPreview;
  document.querySelectorAll("[data-eq]").forEach((b) => { b.onclick = () => insertInEquation(b.dataset.eq); });

  // Enter means OK. (Left alone, the browser would press the form's first button, which is "Delete column".)
  for (const id of ["colName", "colEquation"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      $("colDialog").querySelector("form").requestSubmit($("colOk"));
    });
  }

  // OK and Delete take effect the moment they're pressed. (Waiting for the dialog's "close" event instead would
  // depend on when the browser gets round to sending it.) A mistake keeps the dialog open so it can be fixed.
  $("colDialog").querySelector("form").addEventListener("submit", (e) => {
    const action = e.submitter?.value;
    if (action === "delete") { applyColumnDialog("delete"); return; }
    if (action !== "ok") return;
    const self = state.editingCol;
    const name = $("colName").value.trim();
    let error = "";
    if (state.columns.some((c) => c !== self && ListParser.sameColumnName(c.name, name))) {
      error = `There's already a column called “${name}”.`;
    } else if ($("colType").value === "calc") {
      const check = ListParser.validateEquation($("colEquation").value, state.columns, self);
      if (!check.ok) error = check.error;
    } else if ($("colType").value === "lookup") {
      const list = ListParser.parsePriceList($("colLookup").value);
      if (!list.ok) error = list.error;
      else if (!ListParser.itemColumnOf(state.columns.filter((c) => c !== self))) error = "There's no item column to match the names against yet.";
    }
    $("colError").textContent = error;
    $("colError").hidden = !error;
    if (error) e.preventDefault();
    else applyColumnDialog("ok");
  });

  const usesColumn = (c, name) => (ListParser.parseEquation(c.equation || "").refs || []).some((r) => ListParser.sameColumnName(r, name));

  function applyColumnDialog(action) {
    const col = state.editingCol;
    if (action === "delete" && col) {
      if (state.columns.length <= 1) { toast("A list needs at least one column."); return; }
      const users = state.columns.filter((c) => c.type === "calc" && usesColumn(c, col.name));
      if (users.length) { toast(`“${users[0].name}” uses this column in its equation. Change that equation first.`, 6000); return; }
      state.columns = state.columns.filter((c) => c !== col);
    } else if (action === "ok") {
      const name = $("colName").value.trim();
      if (!name) return;
      const type = $("colType").value;
      const equation = type === "calc" ? ListParser.validateEquation($("colEquation").value, state.columns, col).text : undefined;
      const priceList = type === "lookup" ? $("colLookup").value.trim() : undefined;
      if (col) {
        // Turning a price list into an ordinary column keeps its prices, so single rows can then be changed by hand.
        if (col.type === "lookup" && type !== "lookup") for (const r of state.rows) r[col.id] = ListParser.lookupValue(col, state.columns, r) ?? "";
        if (col.type !== type && !["calc", "lookup"].includes(type)) for (const r of state.rows) r[col.id] = convert(r[col.id], type);
        if (priceList !== undefined) col.priceList = priceList; else delete col.priceList;
        // Equations follow a column that gets renamed.
        if (col.name !== name) {
          for (const c of state.columns) if (c.type === "calc" && c.equation) c.equation = c.equation.split(`[${col.name}]`).join(`[${name}]`);
        }
        col.name = name; col.type = type;
        if (equation) col.equation = equation; else delete col.equation;
      } else {
        const c = { id: uid(), name, type, manual: true }; // added by hand, not read from a photo
        if (equation) c.equation = equation;
        if (priceList !== undefined) c.priceList = priceList;
        state.columns.push(c);
        for (const r of state.rows) r[c.id] = type === "check" ? false : type === "date" ? today() : "";
      }
    } else return;
    saveDraft(); renderGrid();
  }

  function convert(v, type) {
    if (type === "check") return v === true || /^(yes|true|1|x|✓)$/i.test(String(v || ""));
    if (type === "number") { const n = ListParser.toNumber(v); return n; }
    if (typeof v === "boolean") return v ? "Yes" : "";
    return v == null ? "" : String(v);
  }

  $("addColBtn").onclick = () => openColDialog(null);
  $("addRowBtn").onclick = () => {
    state.rows.push(blankRow()); saveDraft(); renderGrid();
    const inputs = $("grid").tBodies[0].lastElementChild.querySelectorAll("input,select");
    if (inputs[0]) inputs[0].focus();
  };
  $("clearBtn").onclick = () => {
    if (state.rows.length && !confirm("Remove all rows from the table?")) return;
    state.rows = []; saveDraft(); renderGrid();
  };

  // ---------- image + OCR ----------
  function setImage(file) {
    if (!file || !file.type.startsWith("image/")) { toast("Please choose an image file."); return; }
    state.image = file;
    const img = $("preview");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(file);
    img.hidden = false; $("dropHint").hidden = true;
    $("readBtn").disabled = false;
  }

  $("imageInput").onchange = (e) => setImage(e.target.files[0]);
  $("imageInputGallery").onchange = (e) => setImage(e.target.files[0]);
  const dz = $("dropZone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); setImage(e.dataTransfer.files[0]); });
  document.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) setImage(item.getAsFile());
  });

  $("imageColumns").checked = ls.get("listsnap.imageColumns", true);
  $("imageColumns").onchange = () => ls.set("listsnap.imageColumns", $("imageColumns").checked);
  $("ocrLang").value = ls.get("listsnap.lang", "eng");
  $("ocrLang").onchange = () => ls.set("listsnap.lang", $("ocrLang").value);

  // ---------- Reader: free on this device, or an AI with the person's own API key ----------
  const AI = {
    claude: {
      name: "Claude", company: "Anthropic", storeKey: "listsnap.claudeKey", placeholder: "sk-ant-…",
      keyUrl: "https://console.anthropic.com/settings/keys", keySite: "console.anthropic.com",
      keyHow: " (API keys), add a little credit, and paste the key here.",
      note: "More accurate for forms, Amharic and handwriting. The photo is sent to Anthropic, and each one costs a few US cents.",
    },
    gemini: {
      name: "Gemini", company: "Google", storeKey: "listsnap.geminiKey", placeholder: "AIza…",
      keyUrl: "https://aistudio.google.com/app/apikey", keySite: "aistudio.google.com",
      keyHow: " (Get API key) and paste the key here. A free key works.",
      note: "More accurate for forms, Amharic and handwriting. The photo is sent to Google. Free keys cost nothing but allow only about 20 requests a day per model, and Google may use those photos to improve its products. Paid keys cost about 1–3 US cents a photo.",
    },
  };
  const FREE_NOTE = "Reads on this device, so the photo never leaves it. Best for clear, printed lists.";
  const aiKey = (p) => ls.get(AI[p].storeKey, "");
  let keyFor = "claude"; // which AI the key dialog is for

  function openKeyDialog(p) {
    const ai = AI[p];
    keyFor = p;
    $("keyTitle").textContent = `${ai.name} API key`;
    $("keyHelp").textContent = `Reading with ${ai.name} uses your own ${ai.company} API key. Create one at`;
    $("keyLink").href = ai.keyUrl;
    $("keyLink").textContent = ai.keySite;
    $("keyHelpEnd").textContent = `${ai.keyHow} It is saved only on this device.`;
    $("keyPrivacy").textContent = ai.note;
    $("keyInput").placeholder = ai.placeholder;
    $("keyInput").value = aiKey(p);
    $("keyForget").hidden = !aiKey(p);
    $("keyDialog").returnValue = "";
    $("keyDialog").showModal();
    $("keyInput").focus();
  }
  // Enter in the key box means Save (the form's first button is "Remove key").
  $("keyInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("keyDialog").close("ok"); } });
  $("keyDialog").addEventListener("close", () => {
    const action = $("keyDialog").returnValue;
    if (action === "ok" && $("keyInput").value.trim()) ls.set(AI[keyFor].storeKey, $("keyInput").value.trim());
    else if (action === "forget") ls.set(AI[keyFor].storeKey, "");
    if ($("reader").value === keyFor && !aiKey(keyFor)) $("reader").value = "free"; // no key, no AI
    ls.set("listsnap.reader", $("reader").value);
    showReader();
  });
  function showReader() {
    const r = $("reader").value;
    $("langWrap").hidden = r !== "free"; // the AIs read any language by themselves
    $("aiKeyBtn").hidden = r === "free";
    if (r !== "free") $("aiKeyBtn").textContent = `${AI[r].name} API key`;
    $("readerNote").textContent = r === "free" ? FREE_NOTE : AI[r].note;
  }
  // Earlier versions had a "Read with Claude" tick box instead of the Reader menu.
  const savedReader = ls.get("listsnap.reader", ls.get("listsnap.useClaude", false) ? "claude" : "free");
  $("reader").value = AI[savedReader] && aiKey(savedReader) ? savedReader : "free";
  $("reader").onchange = () => {
    const r = $("reader").value;
    ls.set("listsnap.reader", r);
    if (r !== "free" && !aiKey(r)) openKeyDialog(r);
    ListAI.preload(r);
    showReader();
  };
  $("aiKeyBtn").onclick = () => openKeyDialog($("reader").value);
  showReader();
  setTimeout(() => ListAI.preload($("reader").value), 1500); // once the page is up, so it doesn't slow the opening

  let putAside = null; // the table that a new picture's own columns replaced, for Undo

  $("readBtn").onclick = async () => {
    if (!state.image) return;
    putAside = null;
    const reader = $("reader").value;
    if (reader !== "free" && !aiKey(reader)) { openKeyDialog(reader); return; }
    const btn = $("readBtn");
    btn.disabled = true;
    $("progressWrap").hidden = false;
    setProgress(0, "Starting…");
    const started = performance.now();
    const earlierScan = state.scan;
    state.scan = { id: uid(), image: state.image };
    try {
      const hadRows = state.rows.length;
      const count = reader === "free" ? await readWithScanner() : await readWithAI(reader);
      if (!count) {
        state.scan = earlierScan;
        toast("No list lines were found. Try a sharper, brighter photo taken straight on.");
        return;
      }
      clearCorrections();
      $("proofStatus").textContent = "";
      showScanPhoto();
      ListExcel.preload(); // saving is likely next
      saveDraft(); renderGrid(); renderTemplates();
      const secs = Math.round((performance.now() - started) / 1000);
      setProgress(1, `Found ${count} line${count === 1 ? "" : "s"} in ${secs} s`);
      const marked = state.rows.filter((r) => r._scan === state.scan.id).reduce((n, r) => n + Object.keys(r._flags || {}).length, 0);
      const toCheck = marked ? ` ${marked} hard-to-read cell${marked === 1 ? " is" : "s are"} marked yellow.` : "";
      if (putAside) {
        const old = putAside;
        const n = old.rows.length;
        toast(`Found ${count} row${count === 1 ? "" : "s"}.${toCheck} This picture has its own columns, so it got a new table. ${n} earlier row${n === 1 ? " was" : "s were"} put aside.`, 12000, {
          label: "Undo",
          run: () => { state.columns = old.columns; state.rows = old.rows; saveDraft(); renderGrid(); toast("The earlier table is back."); },
        });
      } else {
        const rowsWord = `${count} row${count === 1 ? "" : "s"}`;
        toast((hadRows && state.rows.length > count ? `Added ${rowsWord} under the ones already in the table.` : `Found ${rowsWord}. Please check them.`) + toCheck, toCheck ? 6000 : undefined);
      }
    } catch (err) {
      console.error(err);
      state.scan = earlierScan;
      if (err.code === "bad_key") ls.set(AI[reader].storeKey, "");
      toast("Couldn't read the image: " + (err.message || err), 8000);
      $("progressWrap").hidden = true;
    } finally {
      btn.disabled = false;
    }
  };

  // The free reader on this device. Returns how many rows were added.
  async function readWithScanner() {
    const { text, lines, grid } = await ListOCR.readImage(state.image, $("ocrLang").value, (m) => {
      if (m.status === "recognizing text") setProgress(m.progress, `Reading… ${Math.round(m.progress * 100)}%`);
      else if (/loading|initializ/i.test(m.status)) setProgress(m.progress || 0.05, "Getting the reader ready (first time only)…");
    });
    $("rawText").textContent = text.trim() || "(no text found)";
    $("rawWrap").hidden = false;
    if ($("imageColumns").checked) {
      const result = ListParser.analyze(text, lines, grid);
      if (result.rows.length) addImageRows(result);
      return result.rows.length;
    }
    const parsed = ListParser.parseListText(text);
    for (const p of parsed) {
      const r = rowFromParsed(p);
      r._scan = state.scan.id;
      state.rows.push(r);
    }
    return parsed.length;
  }

  // Marks the cells an AI found hard to read. cols: the table's column for each of the AI's columns.
  function markUnsure(r, i, unsure, cols) {
    for (const u of unsure || []) {
      if (u.row !== i || !cols[u.col]) continue;
      r._flags = r._flags || {};
      r._flags[cols[u.col].id] = "unsure";
    }
  }

  // An AI (Claude or Gemini) reads the photo on its company's computers: it may cost a little, but it handles
  // forms, Amharic and handwriting. The answer arrives bit by bit, so the message can show real progress.
  // Returns how many rows were added.
  async function readWithAI(ai) {
    const name = AI[ai].name;
    let msg = `${name} is looking at the photo…`;
    let p = 0.1;
    setProgress(p, msg);
    const creep = setInterval(() => setProgress((p = Math.min(0.9, p + 0.02)), msg), 1000);
    const onRows = (n) => {
      if (!n) return;
      msg = `${name} has read ${n} row${n === 1 ? "" : "s"}…`;
      setProgress(p, msg);
    };
    const onNote = (note) => { msg = note; setProgress(p, msg); };
    $("rawWrap").hidden = true;
    try {
      if ($("imageColumns").checked) {
        const { columns, rows, unsure } = await ListAI.readTable(ai, state.image, aiKey(ai), null, { onRows, onNote, knownNames: namesOn() ? knownNames() : [] });
        const result = ListParser.fromTable(columns, rows);
        if (result.rows.length) addImageRows({ ...result, unsure });
        return result.rows.length;
      }
      const cols = photoColumns();
      const { rows, unsure } = await ListAI.readTable(ai, state.image, aiKey(ai), cols.map((c) => c.name), { onRows, onNote, knownNames: namesOn() ? knownNames() : [] });
      rows.forEach((values, i) => {
        const r = blankRow();
        r._scan = state.scan.id;
        cols.forEach((col, k) => { if (values[k]) r[col.id] = convert(values[k], col.type); });
        markUnsure(r, i, unsure, cols);
        state.rows.push(r);
      });
      return rows.length;
    } finally {
      clearInterval(creep);
    }
  }

  function setProgress(p, text) {
    $("progressBar").style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    $("progressText").textContent = text;
  }

  // Columns come from the picture. An empty table takes the picture's columns as they are.
  // A picture with its own header row that doesn't match the table on screen starts a new table; the old one
  // is put aside so Undo can bring it back. Otherwise the rows go under the table: header columns are matched
  // by name only, and new ones are added on the right. Lists without a header (whose Item, Qty, … names
  // ListSnap chose itself) are also matched by meaning, so their Qty finds a "ብዛት" column.
  function addImageRows({ columns, rows, fromHeader, unsure }) {
    const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (state.rows.length && fromHeader) {
      const matching = columns.filter((c) => state.columns.some((o) => sameName(o.name, c.name))).length;
      if (matching < columns.length / 2) {
        putAside = { columns: state.columns, rows: state.rows };
        state.rows = [];
      }
    }
    let target;
    if (!state.rows.length) {
      target = columns.map((c) => ({ id: uid(), name: c.name, type: c.type, role: c.role || undefined }));
      // Calculated columns stay, so an equation set up once works for the next day's sheet too. It needs at least
      // one of its columns in the new picture (otherwise it's a different form); the rest must be columns the
      // person added themselves, like a Price the photo doesn't have, and those stay with it.
      const have = target.map((c) => c.name);
      const added = (name) => state.columns.find((o) => o.manual && o.type !== "calc" && sameName(o.name, name));
      const kept = [];
      // A price list stays too, whenever the new picture has item names to match.
      if (ListParser.itemColumnOf(target)) {
        for (const c of state.columns) {
          if (c.type === "lookup" && !have.some((n) => sameName(n, c.name))) { kept.push(c); have.push(c.name); }
        }
      }
      for (const c of state.columns) {
        if (c.type !== "calc" || have.some((n) => sameName(n, c.name))) continue;
        const refs = ListParser.parseEquation(c.equation || "").refs || [];
        const missing = refs.filter((ref) => !have.some((n) => sameName(n, ref)));
        if (missing.length === refs.length || !missing.every(added)) continue;
        for (const ref of missing) { kept.push(added(ref)); have.push(ref); }
        kept.push(c);
        have.push(c.name);
      }
      state.columns = [...target, ...kept];
    } else {
      const used = new Set();
      target = columns.map((c) => {
        const hit = state.columns.find((o) => !used.has(o) && sameName(o.name, c.name))
          || (!fromHeader && c.role && state.columns.find((o) => !used.has(o) && o.role === c.role));
        if (hit) {
          // A column that is still empty (say, from a blank form) takes the type the new values have.
          if (hit.type === "text" && c.type !== "text" && state.rows.every((r) => r[hit.id] === "" || r[hit.id] == null)) hit.type = c.type;
          used.add(hit);
          return hit;
        }
        const col = { id: uid(), name: c.name, type: c.type, role: c.role || undefined };
        state.columns.push(col);
        for (const r of state.rows) r[col.id] = col.type === "check" ? false : "";
        return col;
      });
    }
    rows.forEach((values, i) => {
      const r = blankRow();
      r._scan = state.scan.id;
      target.forEach((col, k) => { r[col.id] = convert(values[k], col.type); });
      markUnsure(r, i, unsure, target);
      state.rows.push(r);
    });
  }

  function rowFromParsed(p) {
    const r = blankRow();
    for (const c of state.columns) {
      if (!c.role) continue;
      if (c.role === "date") continue; // keep today's date
      const v = p[c.role];
      if (v === undefined) continue;
      r[c.id] = c.type === "check" ? !!v : c.type === "number" ? ListParser.toNumber(v) : v === false ? "" : String(v);
    }
    return r;
  }

  // ---------- templates (saved column setups) ----------
  function builtInTemplate() { return { name: "Standard (Item, Qty, Price, Time, Made, Date)", builtIn: true, columns: DEFAULT_COLUMNS() }; }

  function renderTemplates() {
    const sel = $("templateSelect");
    sel.innerHTML = "";
    const all = [builtInTemplate(), ...state.templates];
    all.forEach((t, i) => {
      const o = document.createElement("option");
      o.value = String(i); o.textContent = "Columns: " + t.name;
      sel.appendChild(o);
    });
    const placeholder = document.createElement("option");
    placeholder.value = ""; placeholder.textContent = "Columns: (current)"; placeholder.selected = true;
    sel.insertBefore(placeholder, sel.firstChild);
    $("deleteTemplateBtn").hidden = !state.templates.length;
  }

  $("templateSelect").onchange = () => {
    const i = $("templateSelect").value;
    if (i === "") return;
    const t = [builtInTemplate(), ...state.templates][Number(i)];
    if (state.rows.length && !confirm(`Switch to the “${t.name}” columns? Values in matching column names are kept.`)) { renderTemplates(); return; }
    applyColumns(t.columns);
    renderTemplates();
  };

  function applyColumns(cols) {
    const next = cols.map((c) => ({ ...c, id: uid() }));
    state.rows = state.rows.map((r) => {
      const nr = { _id: r._id };
      for (const c of next) {
        const old = state.columns.find((o) => o.name.toLowerCase() === c.name.toLowerCase());
        nr[c.id] = old ? convert(r[old.id], c.type) : c.type === "check" ? false : c.type === "date" ? today() : "";
      }
      return nr;
    });
    state.columns = next;
    saveDraft(); renderGrid();
  }

  $("saveTemplateBtn").onclick = async () => {
    const name = prompt("Name for this list template (for example “Bakery morning list”):");
    if (!name || !name.trim()) return;
    const cols = state.columns.map(({ name, type, role, equation, manual, priceList }) => ({ name, type, role, equation, manual, priceList }));
    const existing = state.templates.findIndex((t) => t.name.toLowerCase() === name.trim().toLowerCase());
    if (existing >= 0) state.templates[existing].columns = cols;
    else state.templates.push({ name: name.trim(), columns: cols });
    await persistTemplates();
    renderTemplates();
    toast(`Template “${name.trim()}” saved.`);
  };

  $("deleteTemplateBtn").onclick = async () => {
    const i = $("templateSelect").value;
    const idx = i === "" ? -1 : Number(i) - 1; // 0 is the built-in template
    if (idx < 0) { toast("Pick one of your own templates in the list first."); return; }
    const t = state.templates[idx];
    if (!confirm(`Delete the template “${t.name}”?`)) return;
    state.templates.splice(idx, 1);
    await persistTemplates();
    renderTemplates();
  };

  async function persistTemplates() {
    ls.set("listsnap.templates", state.templates);
    if (Drive.isSignedIn()) {
      try { await Drive.saveTemplates(state.templates); } catch (e) { toast("Template saved on this device only: " + e.message); }
    }
  }

  async function syncTemplatesFromDrive() {
    try {
      const remote = await Drive.loadTemplates();
      if (Array.isArray(remote)) {
        // Merge by name. Templates only on this device get uploaded too.
        const byName = new Map(remote.map((t) => [t.name.toLowerCase(), t]));
        let changed = false;
        for (const t of state.templates) if (!byName.has(t.name.toLowerCase())) { byName.set(t.name.toLowerCase(), t); changed = true; }
        state.templates = [...byName.values()];
        ls.set("listsnap.templates", state.templates);
        if (changed) await Drive.saveTemplates(state.templates);
      } else if (state.templates.length) {
        await Drive.saveTemplates(state.templates);
      }
      renderTemplates();
    } catch (e) { console.warn("template sync", e); }
  }

  // ---------- save ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      state.saveMode = tab.dataset.mode;
      $("modeNew").hidden = state.saveMode !== "new";
      $("modeExisting").hidden = state.saveMode !== "existing";
      status("");
      if (state.saveMode === "existing") ListExcel.preload();
      if (state.saveMode === "existing" && Drive.isSignedIn() && !state.files.length) refreshFiles();
    };
  });

  function renderFileSelect() {
    const sel = $("fileSelect");
    const keep = sel.value;
    sel.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = Drive.isSignedIn() ? (state.files.length ? "Choose a file from your Drive…" : "No ListSnap files in Drive yet") : "Sign in to see your Drive files, or open one from this device";
    sel.appendChild(o0);
    if (state.existing && state.existing.kind === "local") {
      const o = document.createElement("option"); o.value = "local"; o.textContent = `📱 ${state.existing.name} (this device)`; sel.appendChild(o);
    }
    for (const f of state.files) {
      const o = document.createElement("option"); o.value = f.id; o.textContent = `☁️ ${f.name}`; sel.appendChild(o);
    }
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;

    const list = $("fileList");
    list.innerHTML = "";
    $("filesCard").hidden = !Drive.isSignedIn();
    if (!state.files.length) {
      const li = document.createElement("li"); li.className = "muted"; li.textContent = "Nothing saved yet. Saved files show up here on all your devices.";
      list.appendChild(li);
    }
    for (const f of state.files) {
      const li = document.createElement("li");
      const a = document.createElement("a"); a.href = f.webViewLink || "#"; a.target = "_blank"; a.rel = "noopener"; a.textContent = f.name;
      const when = document.createElement("span"); when.className = "muted small"; when.textContent = new Date(f.modifiedTime).toLocaleString();
      li.append(a, when); list.appendChild(li);
    }
  }

  async function refreshFiles() {
    if (!Drive.isSignedIn()) { renderFileSelect(); return; }
    try { state.files = await Drive.listFiles(); } catch (e) { toast(e.message); }
    renderFileSelect();
  }
  $("refreshFilesBtn").onclick = () => { if (!Drive.isSignedIn() && Drive.configured()) Drive.signIn().catch((e) => toast(e.message)); else refreshFiles(); };

  function renderSheetSelect() {
    const sel = $("sheetSelect");
    sel.innerHTML = "";
    if (!state.existing) { sel.disabled = true; $("newTabName").hidden = true; $("existingInfo").textContent = ""; return; }
    for (const name of ListExcel.sheetNames(state.existing.wb)) {
      const o = document.createElement("option"); o.value = name; o.textContent = `Tab: ${name}`; sel.appendChild(o);
    }
    const n = document.createElement("option"); n.value = "__new__"; n.textContent = "+ New tab (a new list)"; sel.appendChild(n);
    sel.disabled = false;
    updateExistingInfo();
  }

  function updateExistingInfo() {
    const sel = $("sheetSelect");
    const isNew = sel.value === "__new__";
    $("newTabName").hidden = !isNew;
    if (isNew) { $("existingInfo").textContent = "A new tab is created with the columns in your table."; return; }
    const { headers } = ListExcel.readHeaders(state.existing.wb, sel.value);
    const names = headers.map((h) => ListExcel.normName(h.name));
    const missing = state.columns.filter((c) => !names.includes(ListExcel.normName(c.name))).map((c) => c.name);
    $("existingInfo").textContent = headers.length
      ? `This tab's columns: ${headers.map((h) => h.name).join(", ")}.` + (missing.length ? ` New columns that will be added: ${missing.join(", ")}.` : " Every column matches.")
      : "This tab is empty, so your columns become its headers.";
  }
  $("sheetSelect").onchange = updateExistingInfo;

  $("fileSelect").onchange = async () => {
    const v = $("fileSelect").value;
    if (!v) { state.existing = null; renderSheetSelect(); return; }
    if (v === "local") { renderSheetSelect(); return; }
    const f = state.files.find((x) => x.id === v);
    status("Opening file…");
    try {
      const buf = await Drive.download(v);
      state.existing = { kind: "drive", id: v, name: f.name, wb: await ListExcel.readWorkbook(buf) };
      renderSheetSelect(); status("");
    } catch (e) { status(e.message, "err"); }
  };

  $("xlsxInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      status("Opening file…");
      const wb = await ListExcel.readWorkbook(await file.arrayBuffer());
      state.existing = { kind: "local", name: ListExcel.ensureXlsxName(file.name), wb };
      renderFileSelect();
      $("fileSelect").value = "local";
      renderSheetSelect();
      status(Drive.isSignedIn() ? "When you save, this file is uploaded to your ListSnap Drive folder so your other devices can see it." : "When you save, the updated file is downloaded to this device.");
    } catch (err) { status("Couldn't open that file: " + err.message, "err"); }
    e.target.value = "";
  };

  function rowsToSave() {
    // Skip rows where every cell is empty (checkboxes and the date don't count).
    return state.rows.filter((r) => state.columns.some((c) => c.type !== "check" && c.type !== "date" && r[c.id] !== "" && r[c.id] != null));
  }

  $("saveBtn").onclick = async () => {
    const rows = rowsToSave();
    if (!rows.length) { status("There's nothing to save yet. Add or scan some rows first.", "err"); return; }

    // The Google popup has to open from the click itself, before any await.
    if (Drive.configured() && !Drive.isSignedIn() && Drive.lastEmail()) {
      try { await Drive.signIn(); } catch (_) { /* fall back to a device-only save */ }
    }

    const btn = $("saveBtn");
    btn.disabled = true;
    status("Saving…");
    try {
      if (state.saveMode === "new") await saveNew(rows);
      else await saveExisting(rows);
    } catch (e) {
      console.error(e);
      status(e.message || String(e), "err");
    } finally {
      btn.disabled = false;
    }
  };

  async function saveNew(rows) {
    const fileName = ListExcel.ensureXlsxName($("newFileName").value || `ListSnap ${today()}`);
    const wb = await ListExcel.buildWorkbook($("newSheetName").value, state.columns, rows);
    if (Drive.isSignedIn()) {
      const f = await Drive.saveXlsx({ name: fileName, data: await ListExcel.toArrayBuffer(wb) });
      if ($("alsoDownload").checked) await ListExcel.download(wb, fileName);
      status(`Saved “${f.name}” to Google Drive (${rows.length} rows).`, "ok");
      await refreshFiles();
    } else {
      await ListExcel.download(wb, fileName);
      status(`Downloaded “${fileName}” (${rows.length} rows).` + (Drive.configured() ? " Sign in to keep files in sync across your devices." : ""), "ok");
    }
    afterSave(rows);
  }

  async function saveExisting(rows) {
    if (!state.existing) throw new Error("Choose a file first, or open one from this device.");
    let sheet = $("sheetSelect").value;
    if (sheet === "__new__") {
      sheet = ListExcel.safeSheetName($("newTabName").value || `List ${today()}`);
      if (ListExcel.sheetNames(state.existing.wb).includes(sheet)) throw new Error(`There's already a tab called “${sheet}”. Pick it from the list or use another name.`);
    }

    // Download a fresh copy from Drive so changes made on another device aren't overwritten.
    if (state.existing.kind === "drive") {
      state.existing.wb = await ListExcel.readWorkbook(await Drive.download(state.existing.id));
    }
    const wb = state.existing.wb;
    const res = ListExcel.appendToWorkbook(wb, sheet, state.columns, rows);
    const added = `Added ${res.added} row${res.added === 1 ? "" : "s"}`;
    const extra = appendNotes(res, sheet);

    if (state.existing.kind === "drive") {
      await Drive.saveXlsx({ fileId: state.existing.id, data: await ListExcel.toArrayBuffer(wb) });
      if ($("alsoDownload").checked) await ListExcel.download(wb, state.existing.name);
      status(`${added} to “${state.existing.name}”${extra}.`, "ok");
    } else if (Drive.isSignedIn()) {
      const f = await Drive.saveXlsx({ name: state.existing.name, data: await ListExcel.toArrayBuffer(wb) });
      if ($("alsoDownload").checked) await ListExcel.download(wb, state.existing.name);
      await refreshFiles();
      state.existing = { kind: "drive", id: f.id, name: f.name, wb };
      renderFileSelect();
      $("fileSelect").value = f.id;
      status(`${added}${extra}. Uploaded “${f.name}” to Google Drive.`, "ok");
    } else {
      await ListExcel.download(wb, state.existing.name);
      status(`${added}${extra}. The updated “${state.existing.name}” was downloaded.`, "ok");
    }
    if (state.existing.kind === "drive") await refreshFiles();
    renderSheetSelect();
    $("sheetSelect").value = sheet;
    updateExistingInfo();
    afterSave(rows);
  }

  // What else happened while adding the rows, for the message after saving.
  function appendNotes(res, sheet) {
    if (res.createdSheet) return ` in the new tab “${sheet}”`;
    const notes = [];
    if (res.aboveTotal) notes.push("They're above the Total row, which now includes them");
    if (res.formulaColumns.length) notes.push(`Calculated by your formulas: ${res.formulaColumns.join(", ")}`);
    if (res.filledColumns.length) notes.push(`Filled in from earlier rows: ${res.filledColumns.join(", ")}`);
    if (res.newColumns.length) notes.push(`New columns: ${res.newColumns.join(", ")}`);
    return notes.length ? `. ${notes.join(". ")}` : "";
  }

  function afterSave(rows) {
    setTimeout(() => {
      if (confirm("Saved. Clear the table so it's ready for the next list?")) { state.rows = []; saveDraft(); renderGrid(); }
      offerToRemember(rows); // after the question, so the offer isn't hidden behind it
    }, 50);
  }

  // ---------- remembered names ----------
  // Item names the person has checked. Claude and Gemini are told them (it took misread names from 21 to none in
  // testing), and names in the table that aren't on the list are marked. Names are only added with the person's
  // OK, because the AI copies the list's spelling even over the photo.
  const knownNames = () => ls.get("listsnap.knownNames", []);
  const namesOn = () => $("useNames").checked && knownNames().length > 0;
  function showNames() {
    const n = knownNames().length;
    $("useNames").hidden = !n;
    $("namesLabel").textContent = n ? `Use my ${n} remembered name${n === 1 ? "" : "s"}` : "No remembered names yet";
    $("namesBtn").textContent = n ? "Edit names" : "Add names";
  }
  function saveKnownNames(names) {
    const seen = new Set();
    const clean = names.map((n) => String(n).replace(/\s+/g, " ").trim()).filter((n) => {
      const key = ListParser.nameKey(n);
      if (!n || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    ls.set("listsnap.knownNames", clean);
    showNames();
    refreshChecks();
  }
  // Item names in these rows that aren't remembered yet, in table order.
  function newNamesIn(rows) {
    const item = ListParser.itemColumnOf(state.columns);
    if (!item) return [];
    const known = new Set(knownNames().map(ListParser.nameKey));
    const fresh = [];
    for (const r of rows) {
      const name = String(r[item.id] ?? "").replace(/\s+/g, " ").trim();
      const key = ListParser.nameKey(name);
      if (name && !known.has(key)) { known.add(key); fresh.push(name); }
    }
    return fresh;
  }
  function offerToRemember(rows) {
    if (knownNames().length && !$("useNames").checked) return; // names are switched off for this kind of list
    const fresh = newNamesIn(rows);
    if (!fresh.length) return;
    const what = fresh.length === 1 ? `“${fresh[0]}”` : `these ${fresh.length} names`;
    toast(`Remember ${what} for next time? Claude and Gemini read names better when they know them.`, 20000, {
      label: "Remember",
      run: () => { saveKnownNames([...knownNames(), ...fresh]); toast(`Remembered. ${knownNames().length} names in all; “Edit names” shows them.`); },
    });
  }

  function updateNamesCount() {
    const n = $("namesList").value.split(/\r?\n/).filter((l) => l.trim()).length;
    $("namesCount").textContent = `${n} name${n === 1 ? "" : "s"}`;
  }
  $("namesBtn").onclick = () => {
    $("namesList").value = knownNames().join("\n");
    updateNamesCount();
    $("namesDialog").showModal();
  };
  $("namesList").oninput = updateNamesCount;
  $("namesFromTable").onclick = () => {
    const box = $("namesList");
    const listed = new Set(box.value.split(/\r?\n/).map(ListParser.nameKey).filter(Boolean));
    const fresh = newNamesIn(state.rows).filter((n) => !listed.has(ListParser.nameKey(n)));
    if (fresh.length) box.value = (box.value.trim() ? box.value.trimEnd() + "\n" : "") + fresh.join("\n");
    updateNamesCount();
  };
  // Saved the moment Save is pressed (not on the dialog's "close" event, which can come late).
  $("namesDialog").querySelector("form").addEventListener("submit", (e) => {
    if (e.submitter?.value === "ok") saveKnownNames($("namesList").value.split(/\r?\n/));
  });
  $("useNames").checked = ls.get("listsnap.useNames", true);
  $("useNames").onchange = () => { ls.set("listsnap.useNames", $("useNames").checked); refreshChecks(); };
  showNames();

  // ---------- account ----------
  function renderAccount({ signedIn, user }) {
    $("signInBtn").hidden = signedIn || !Drive.configured();
    $("signOutBtn").hidden = !signedIn;
    const last = Drive.lastEmail();
    $("userLabel").textContent = signedIn
      ? (user && (user.email || user.name)) || "Signed in"
      : !Drive.configured() ? "Saves to this device" : last ? "" : "Not signed in";
    $("signInBtn").textContent = last ? `Continue as ${last}` : "Sign in with Google";
    if (signedIn) { refreshFiles(); syncTemplatesFromDrive(); }
    else { state.files = []; if (state.existing && state.existing.kind === "drive") state.existing = null; renderFileSelect(); renderSheetSelect(); }
  }
  Drive.onChange(renderAccount);
  $("signInBtn").onclick = () => Drive.signIn().catch((e) => toast(e.message));
  $("signOutBtn").onclick = () => Drive.signOut();

  // ---------- start ----------
  const draft = ls.get("listsnap.draft", null);
  if (draft && Array.isArray(draft.columns) && draft.columns.length) { state.columns = draft.columns; state.rows = draft.rows || []; }
  state.templates = ls.get("listsnap.templates", []);
  renderGrid();
  renderTemplates();
  renderAccount({ signedIn: false, user: null });
  Drive.init().catch((e) => { console.warn(e); toast(e.message); });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  }
})();
