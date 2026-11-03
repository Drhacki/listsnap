// Google sign-in and Google Drive storage. Files go in a "ListSnap" folder in the user's own Drive.
// The drive.file scope means the app can only see files it created itself.
(function (global) {
  const SCOPES = "https://www.googleapis.com/auth/drive.file openid email profile";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const TEMPLATES_FILE = "listsnap-templates.json";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

  let tokenClient = null;
  let token = null;
  let tokenExpires = 0;
  let pending = null;
  let folderId = null;
  let user = null;
  let listeners = [];

  const cfg = () => global.LISTSNAP_CONFIG || {};
  const configured = () => !!cfg().GOOGLE_CLIENT_ID;

  function emit() { listeners.forEach((fn) => fn({ signedIn: isSignedIn(), user })); }
  function onChange(fn) { listeners.push(fn); }
  function isSignedIn() { return !!token && Date.now() < tokenExpires; }

  function waitForGis() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function check() {
        if (global.google && google.accounts && google.accounts.oauth2) return resolve();
        if (Date.now() - started > 15000) return reject(new Error("Google sign-in did not load. Check your internet connection."));
        setTimeout(check, 100);
      })();
    });
  }

  async function init() {
    if (!configured()) return false;
    await loadScript("https://accounts.google.com/gsi/client"); // only needed when Google sign-in is set up
    await waitForGis();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg().GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: async (resp) => {
        const p = pending; pending = null;
        if (resp.error) { p && p.reject(new Error(resp.error_description || resp.error)); return; }
        token = resp.access_token;
        tokenExpires = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        try {
          const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) user = await r.json();
          if (user && user.email) localStorageSet("listsnap.lastEmail", user.email);
        } catch (_) { /* name is just for display */ }
        emit();
        p && p.resolve(token);
      },
      error_callback: (err) => {
        const p = pending; pending = null;
        p && p.reject(new Error(err && err.type === "popup_closed" ? "Sign-in was closed." : "Sign-in failed or the popup was blocked."));
      },
    });
    return true;
  }

  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lastEmail() { return localStorageGet("listsnap.lastEmail"); }

  // Call this straight from a click so the Google popup is allowed to open.
  function signIn() {
    if (!tokenClient) return Promise.reject(new Error("Google sign-in isn't set up yet. See README.md."));
    if (isSignedIn()) return Promise.resolve(token);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      const hint = lastEmail();
      tokenClient.requestAccessToken({ prompt: hint ? "" : "consent", login_hint: hint || undefined });
    });
  }

  function signOut() {
    if (token && global.google) google.accounts.oauth2.revoke(token, () => {});
    token = null; tokenExpires = 0; user = null; folderId = null;
    try { localStorage.removeItem("listsnap.lastEmail"); } catch (_) {}
    emit();
  }

  async function api(url, opts = {}) {
    if (!isSignedIn()) throw new Error("Your Google session expired. Tap “Sign in with Google” again.");
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if (r.status === 401) { token = null; emit(); throw new Error("Your Google session expired. Tap “Sign in with Google” again."); }
    if (!r.ok) {
      let msg = `Google Drive error ${r.status}`;
      try { const j = await r.json(); if (j.error && j.error.message) msg += `: ${j.error.message}`; } catch (_) {}
      throw new Error(msg);
    }
    return r;
  }

  const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  async function ensureFolder() {
    if (folderId) return folderId;
    const name = cfg().DRIVE_FOLDER_NAME || "ListSnap";
    const query = `name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
    const r = await api(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`);
    const j = await r.json();
    if (j.files && j.files.length) return (folderId = j.files[0].id);
    const c = await api(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    return (folderId = (await c.json()).id);
  }

  async function listFiles() {
    const parent = await ensureFolder();
    const query = `'${parent}' in parents and mimeType='${XLSX_MIME}' and trashed=false`;
    const r = await api(`${API}/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&pageSize=200&fields=files(id,name,modifiedTime,webViewLink)`);
    return (await r.json()).files || [];
  }

  async function download(fileId) {
    const r = await api(`${API}/files/${fileId}?alt=media`);
    return r.arrayBuffer();
  }

  async function upload({ fileId, name, data, mime }) {
    const boundary = "listsnap" + Math.random().toString(36).slice(2);
    const meta = fileId ? {} : { name, mimeType: mime, parents: [await ensureFolder()] };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      data,
      `\r\n--${boundary}--`,
    ]);
    const url = fileId
      ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,name,modifiedTime,webViewLink`
      : `${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime,webViewLink`;
    const r = await api(url, {
      method: fileId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return r.json();
  }

  const saveXlsx = (opts) => upload({ ...opts, mime: XLSX_MIME });

  // Templates (saved column setups) live in a small JSON file next to the spreadsheets, so they sync too.
  async function findTemplatesFile() {
    const parent = await ensureFolder();
    const query = `'${parent}' in parents and name='${TEMPLATES_FILE}' and trashed=false`;
    const r = await api(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)`);
    const j = await r.json();
    return j.files && j.files.length ? j.files[0].id : null;
  }

  async function loadTemplates() {
    const id = await findTemplatesFile();
    if (!id) return null;
    const r = await api(`${API}/files/${id}?alt=media`);
    try { return await r.json(); } catch (_) { return null; }
  }

  async function saveTemplates(templates) {
    const id = await findTemplatesFile();
    await upload({ fileId: id, name: TEMPLATES_FILE, data: JSON.stringify(templates), mime: "application/json" });
  }

  global.Drive = {
    configured, init, signIn, signOut, isSignedIn, onChange, lastEmail,
    listFiles, download, saveXlsx, loadTemplates, saveTemplates,
  };
})(window);
