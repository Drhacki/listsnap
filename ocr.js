// Free on-device text reading with Tesseract.js. Images never leave the device.
(function (global) {
  let worker = null;
  let workerLang = null;
  let progressCb = () => {};
  const MAX_SIDE = 4000; // px; bigger pictures get slow to read, especially on phones
  const THIN_LINE = 10;  // px; anything thicker is a filled band, not a grid line

  async function getWorker(lang) {
    if (worker && workerLang === lang) return worker;
    if (worker) await worker.terminate();
    worker = await Tesseract.createWorker(lang, 1, {
      logger: (m) => progressCb(m),
    });
    // Treat the image as one block of lines, which suits lists.
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    workerLang = lang;
    return worker;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be opened as an image.")); };
      img.src = url;
    });
  }

  // Resize to a size Tesseract likes, convert to grayscale, and stretch the contrast.
  // Phone photos are often dim or low contrast, and this helps a lot.
  // `boost` enlarges the picture further when its text turned out to be small (see readImage).
  function prepare(img, boost = 1) {
    const longSide = Math.max(img.naturalWidth, img.naturalHeight);
    const target = Math.min(MAX_SIDE, Math.min(2400, Math.max(1400, longSide)) * boost);
    const scale = target / longSide;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      px[i] = g; hist[g]++;
    }
    // Use the 2nd and 98th percentiles as black and white.
    const total = w * h;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
    // On a mostly white screenshot the darkest 2% can be light gray (grid lines, shaded header cells),
    // and stretching that to black smudges the text. Never stretch more than a dim photo needs.
    lo = Math.min(lo, hi - 120);
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  async function readImage(file, lang, onProgress) {
    progressCb = onProgress || (() => {});
    const img = await loadImage(file);
    let canvas = prepare(img);
    const w = await getWorker(lang || "eng");
    let { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
    let lines = wordLines(data);
    // Small text (screenshots, a list photographed from far away) comes out garbled.
    // Tesseract reads best when words are about 30 px tall, so read it once more at that size.
    const h = median(lines.flatMap((l) => l.words).filter((wd) => wd.text.length >= 2).map((wd) => wd.y1 - wd.y0));
    if (!h || h < 22) {
      const bigger = prepare(img, h ? 30 / h : 2);
      if (bigger.width > canvas.width * 1.2) {
        canvas = bigger;
        ({ data } = await w.recognize(canvas, {}, { text: true, blocks: true }));
        lines = wordLines(data);
      }
    }
    return { text: data.text || "", lines, grid: findGridLines(canvas) };
  }

  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  // Grid lines of a table (spreadsheet screenshots, printed tables with borders): long, thin lines across the picture.
  // Returns their positions in canvas pixels: rows = y of the horizontal lines, cols = x of the vertical ones.
  function findGridLines(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(w * h);
    for (let j = 0; j < ink.length; j++) ink[j] = px[j * 4] < 235 ? 1 : 0;
    const rows = lineCentres(h, (a, b) => ink[a * w + b], 0, w, w * 0.45);
    if (rows.length < 3) return { rows: [], cols: [] };
    const top = Math.floor(rows[0]), bottom = Math.ceil(rows[rows.length - 1]);
    const cols = lineCentres(w, (a, b) => ink[b * w + a], top, bottom, (bottom - top) * 0.6);
    return { rows, cols };
  }

  // A pixel row (or column) is part of a line when it holds one long run of ink; gaps of 1-2 px are allowed.
  // Touching rows make one line. A thick band, like a shaded header bar, counts as two lines: its edges.
  function lineCentres(count, inkAt, from, to, minRun) {
    const on = new Uint8Array(count);
    for (let a = 0; a < count; a++) {
      let run = 0, gap = 0, best = 0;
      for (let b = from; b < to; b++) {
        if (inkAt(a, b)) { run += gap + 1; gap = 0; if (run > best) best = run; }
        else if (run && gap < 2) gap++;
        else { run = 0; gap = 0; }
      }
      on[a] = best >= minRun ? 1 : 0;
    }
    const out = [];
    for (let a = 0; a < count; a++) {
      if (!on[a]) continue;
      let b = a;
      while (b + 1 < count && on[b + 1]) b++;
      if (b - a < THIN_LINE) out.push((a + b) / 2);
      else out.push(a, b);
      a = b;
    }
    return out;
  }

  // Lines of words with their positions, so words can be lined up under the header they sit below.
  function wordLines(data) {
    let lines = data.lines;
    if (!lines || !lines.length) {
      lines = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
    }
    return lines
      .map((l) => ({
        words: (l.words || [])
          .filter((w) => w.text && w.text.trim())
          .map((w) => ({ text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 })),
      }))
      .filter((l) => l.words.length);
  }

  global.ListOCR = { readImage, loadImage };
})(window);
