const http = require("http");

const BACKENDS = {
  "/ollama": "http://127.0.0.1:11434",
  "/comfy": "http://127.0.0.1:8188",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  let target = null;
  let prefix = null;
  for (const p of Object.keys(BACKENDS)) {
    if (path === p || path.startsWith(p + "/")) {
      target = BACKENDS[p];
      prefix = p;
      break;
    }
  }

  if (!target) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  const stripped = path.slice(prefix.length) || "/";
  const backend = new URL(target);
  const options = {
    host: backend.hostname,
    port: backend.port,
    method: req.method,
    path: stripped + url.search,
    headers: req.headers,
  };
  options.headers.host = backend.host;

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("backend error: " + e.message);
  });

  req.pipe(proxyReq);
});

server.listen(9000, "127.0.0.1", () => {
  console.log("proxy listening on 9000 -> /ollama:11434 /comfy:8188");
});

// Keep the public ngrok tunnel warm so ngrok's edge never reports an
// "Inactivity Timeout" (ERR_NGROK_320) to the Netlify function. Ping the
// local backends every 30s through the tunnel host if known via env.
const KEEPALIVE_HOST = process.env.KEEPALIVE_HOST;
if (KEEPALIVE_HOST) {
  setInterval(() => {
    fetch(`${KEEPALIVE_HOST}/ollama/api/tags`, { signal: AbortSignal.timeout(8000) }).catch(() => {});
  }, 30000);
  console.log("tunnel keepalive enabled for " + KEEPALIVE_HOST);
}
