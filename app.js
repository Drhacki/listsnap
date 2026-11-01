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
  const TYPE_LABEL = { text: "text", number: "123", time: "AM/PM", check: "✓", date: "date" };

  const state = {
    columns: DEFAULT_COLUMNS(),
    rows: [],
    image: null,
    templates: [],
    saveMode: "new",
    existing: null, // { kind: "drive", id, name, wb } or { kind: "local", name, wb }
    files: [],
    editingCol: null,
  };

  // ---------- storage helpers ----------
  const ls = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  const saveDraft = () => ls.set("listsnap.draft", { columns: state.columns, rows: state.rows });

  function toast(msg, ms = 2600) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
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
      const b = document.createElement("button");
      b.className = "colhead"; b.type = "button";
      b.title = "Edit column";
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
  }

  function cellEditor(row, col) {
    const td = document.createElement("td");
    let el;
    const v = row[col.id];
    if (col.type === "check") {
      td.className = "check-cell";
      el = document.createElement("input"); el.type = "checkbox"; el.checked = !!v;
      el.onchange = () => { row[col.id] = el.checked; saveDraft(); };
    } else if (col.type === "time") {
      el = document.createElement("select");
      for (const opt of ["", "Morning", "Afternoon"]) {
        const o = document.createElement("option"); o.value = opt; o.textContent = opt || "–"; el.appendChild(o);
      }
      el.value = v || "";
      el.onchange = () => { row[col.id] = el.value; saveDraft(); };
    } else {
      el = document.createElement("input");
      el.type = col.type === "number" ? "number" : col.type === "date" ? "date" : "text";
      if (col.type === "number") { el.step = "any"; el.inputMode = "decimal"; }
      el.value = v == null ? "" : v;
      el.oninput = () => { row[col.id] = col.type === "number" && el.value !== "" ? Number(el.value) : el.value; saveDraft(); };
      if (col.role === "item") td.className = "item-cell";
    }
    el.setAttribute("aria-label", col.name);
    td.appendChild(el);
    return td;
  }

  // ---------- column dialog ----------
  function openColDialog(col) {
    state.editingCol = col;
    $("colDialogTitle").textContent = col ? "Edit column" : "New column";
    $("colName").value = col ? col.name : "";
    $("colType").value = col ? col.type : "text";
    $("colDelete").hidden = !col;
    $("colDialog").returnValue = "";
    $("colDialog").showModal();
    $("colName").focus();
  }

  $("colDialog").addEventListener("close", () => {
    const action = $("colDialog").returnValue;
    const col = state.editingCol;
    if (action === "delete" && col) {
      if (state.columns.length <= 1) { toast("A list needs at least one column."); return; }
      state.columns = state.columns.filter((c) => c !== col);
    } else if (action === "ok") {
      const name = $("colName").value.trim();
      if (!name) return;
      const type = $("colType").value;
      if (col) {
        if (col.type !== type) for (const r of state.rows) r[col.id] = convert(r[col.id], type);
        col.name = name; col.type = type;
      } else {
        const c = { id: uid(), name, type };
        state.columns.push(c);
        for (const r of state.rows) r[c.id] = type === "check" ? false : type === "date" ? today() : "";
      }
    } else return;
    saveDraft(); renderGrid();
  });

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

  $("readBtn").onclick = async () => {
    if (!state.image) return;
    const btn = $("readBtn");
    btn.disabled = true;
    $("progressWrap").hidden = false;
    setProgress(0, "Starting…");
    try {
      const { text, lines, grid } = await ListOCR.readImage(state.image, $("ocrLang").value, (m) => {
        if (m.status === "recognizing text") setProgress(m.progress, `Reading… ${Math.round(m.progress * 100)}%`);
        else if (/loading|initializ/i.test(m.status)) setProgress(m.progress || 0.05, "Getting the reader ready (first time only)…");
      });
      $("rawText").textContent = text.trim() || "(no text found)";
      $("rawWrap").hidden = false;
      const hadRows = state.rows.length;
      let count;
      if ($("imageColumns").checked) {
        const result = ListParser.analyze(text, lines, grid);
        count = result.rows.length;
        if (count) addImageRows(result);
      } else {
        const parsed = ListParser.parseListText(text);
        count = parsed.length;
        for (const p of parsed) state.rows.push(rowFromParsed(p));
      }
      if (!count) { toast("No list lines were found. Try a sharper, brighter photo taken straight on."); return; }
      saveDraft(); renderGrid(); renderTemplates();
      setProgress(1, `Found ${count} line${count === 1 ? "" : "s"}`);
      toast(hadRows && state.rows.length > count ? `Added ${count} rows under the ones already in the table.` : `Found ${count} rows. Please check them.`);
    } catch (err) {
      console.error(err);
      toast("Couldn't read the image: " + (err.message || err));
      $("progressWrap").hidden = true;
    } finally {
      btn.disabled = false;
    }
  };

  function setProgress(p, text) {
    $("progressBar").style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    $("progressText").textContent = text;
  }

  // Columns come from the picture. An empty table takes the picture's columns as they are.
  // A table that already has rows keeps its columns, and the picture's columns are matched to them by name
  // (or by meaning, e.g. "ብዛት" → Qty). Any new ones are added on the right.
  // If the picture's header is a different table altogether, ask before mixing the two.
  function addImageRows({ columns, rows, fromHeader }) {
    const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (state.rows.length && fromHeader) {
      const matching = columns.filter((c) => state.columns.some((o) => sameName(o.name, c.name))).length;
      if (matching < columns.length / 2 && confirm(
        `This picture has different columns (${columns.map((c) => c.name).join(", ")}) from your table (${state.columns.map((c) => c.name).join(", ")}).\n\n` +
        `OK: start a new table with the picture's columns. The ${state.rows.length} row${state.rows.length === 1 ? "" : "s"} now in the table will be removed.\n` +
        `Cancel: add the picture's rows under your current table.`)) {
        state.rows = [];
      }
    }
    let target;
    if (!state.rows.length) {
      state.columns = columns.map((c) => ({ id: uid(), name: c.name, type: c.type, role: c.role || undefined }));
      target = state.columns;
    } else {
      const used = new Set();
      target = columns.map((c) => {
        const hit = state.columns.find((o) => !used.has(o) && sameName(o.name, c.name))
          || (c.role && state.columns.find((o) => !used.has(o) && o.role === c.role));
        if (hit) { used.add(hit); return hit; }
        const col = { id: uid(), name: c.name, type: c.type, role: c.role || undefined };
        state.columns.push(col);
        for (const r of state.rows) r[col.id] = col.type === "check" ? false : "";
        return col;
      });
    }
    for (const values of rows) {
      const r = blankRow();
      target.forEach((col, k) => { r[col.id] = convert(values[k], col.type); });
      state.rows.push(r);
    }
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
    const cols = state.columns.map(({ name, type, role }) => ({ name, type, role }));
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
    for (const name of state.existing.wb.SheetNames) {
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
    const ws = state.existing.wb.Sheets[sel.value];
    const { headers } = ListExcel.readHeaders(ws);
    const names = headers.map((h) => h.name.toLowerCase());
    const missing = state.columns.filter((c) => !names.includes(c.name.trim().toLowerCase())).map((c) => c.name);
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
      state.existing = { kind: "drive", id: v, name: f.name, wb: ListExcel.readWorkbook(buf) };
      renderSheetSelect(); status("");
    } catch (e) { status(e.message, "err"); }
  };

  $("xlsxInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const wb = ListExcel.readWorkbook(await file.arrayBuffer());
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
    const wb = ListExcel.buildWorkbook($("newSheetName").value, state.columns, rows);
    if (Drive.isSignedIn()) {
      const f = await Drive.saveXlsx({ name: fileName, data: ListExcel.toArrayBuffer(wb) });
      if ($("alsoDownload").checked) ListExcel.download(wb, fileName);
      status(`Saved “${f.name}” to Google Drive (${rows.length} rows).`, "ok");
      await refreshFiles();
    } else {
      ListExcel.download(wb, fileName);
      status(`Downloaded “${fileName}” (${rows.length} rows).` + (Drive.configured() ? " Sign in to keep files in sync across your devices." : ""), "ok");
    }
    afterSave();
  }

  async function saveExisting(rows) {
    if (!state.existing) throw new Error("Choose a file first, or open one from this device.");
    let sheet = $("sheetSelect").value;
    if (sheet === "__new__") {
      sheet = ListExcel.safeSheetName($("newTabName").value || `List ${today()}`);
      if (state.existing.wb.SheetNames.includes(sheet)) throw new Error(`There's already a tab called “${sheet}”. Pick it from the list or use another name.`);
    }

    // Download a fresh copy from Drive so changes made on another device aren't overwritten.
    if (state.existing.kind === "drive") {
      state.existing.wb = ListExcel.readWorkbook(await Drive.download(state.existing.id));
    }
    const wb = state.existing.wb;
    const res = ListExcel.appendToWorkbook(wb, sheet, state.columns, rows);
    const extra = res.createdSheet ? ` in the new tab “${sheet}”` : res.newColumns.length ? `. Added columns: ${res.newColumns.join(", ")}` : "";

    if (state.existing.kind === "drive") {
      await Drive.saveXlsx({ fileId: state.existing.id, data: ListExcel.toArrayBuffer(wb) });
      if ($("alsoDownload").checked) ListExcel.download(wb, state.existing.name);
      status(`Added ${res.added} rows to “${state.existing.name}”${extra}.`, "ok");
    } else if (Drive.isSignedIn()) {
      const f = await Drive.saveXlsx({ name: state.existing.name, data: ListExcel.toArrayBuffer(wb) });
      if ($("alsoDownload").checked) ListExcel.download(wb, state.existing.name);
      await refreshFiles();
      state.existing = { kind: "drive", id: f.id, name: f.name, wb };
      renderFileSelect();
      $("fileSelect").value = f.id;
      status(`Added ${res.added} rows${extra} and uploaded “${f.name}” to Google Drive.`, "ok");
    } else {
      ListExcel.download(wb, state.existing.name);
      status(`Added ${res.added} rows${extra}. The updated “${state.existing.name}” was downloaded.`, "ok");
    }
    if (state.existing.kind === "drive") await refreshFiles();
    renderSheetSelect();
    $("sheetSelect").value = sheet;
    updateExistingInfo();
    afterSave();
  }

  function afterSave() {
    setTimeout(() => {
      if (confirm("Saved. Clear the table so it's ready for the next list?")) { state.rows = []; saveDraft(); renderGrid(); }
    }, 50);
  }

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
