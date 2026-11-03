// Downloads a script the first time it's needed, so the page itself opens quickly.
(function (global) {
  const started = {};
  global.loadScript = (url) => started[url] || (started[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => {
      delete started[url];
      reject(new Error("Part of the app couldn't be downloaded. Check the internet connection."));
    };
    document.head.append(s);
  }));
})(window);
