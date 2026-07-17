// Local dev server that simulates the Netlify Functions runtime so you can
// test the whole app (auth, chat, generate, claude, stripe stubs) without
// the Netlify CLI. Uses an in-memory shim for @netlify/blobs.
//
//   node local-dev.js
//   open http://localhost:8888

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const FUNC_DIR = path.join(ROOT, "netlify", "functions");
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = process.env.PORT || 8888;

// Load .env if present (for local testing without setting shell vars).
try {
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
  }
} catch {}

// ---- In-memory Blobs shim (mirrors the bits the functions use) ----
const stores = new Map();
function getStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const map = stores.get(name);
  return {
    async get(key, opts) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async set(key, value) {
      map.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    async setJSON(key, value) {
      map.set(key, JSON.stringify(value));
    },
  };
}

// Patch require so `require("@netlify/blobs")` returns our shim.
const Module = require("module");
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@netlify/blobs") return { getStore };
  return origLoad.apply(this, arguments);
};

// ---- cookie jar for the dev browser session (single user simulation) ----
// We just pass whatever cookies the browser sends; no cross-user needed locally.

function buildEvent(req, url, bodyBuf) {
  const cookie = req.headers.cookie || "";
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
  return {
    httpMethod: req.method,
    headers,
    cookie,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: bodyBuf ? bodyBuf.toString("utf8") : "",
    rawBody: bodyBuf,
  };
}

const MIME = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".css": "text/css" };

function serveStatic(req, res, url) {
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(p));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    const splat = url.pathname.replace(/^\/api\//, "").replace(/^\.netlify\/functions\//, "");
    const funcPath = path.join(FUNC_DIR, splat + ".js");
    if (!fs.existsSync(funcPath)) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "function not found: " + splat })); }

    let bodyBuf = Buffer.alloc(0);
    req.on("data", (c) => (bodyBuf = Buffer.concat([bodyBuf, c])));
    await new Promise((r) => req.on("end", r));

    try {
      const mod = require(funcPath);
      if (!mod.handler) throw new Error("no handler exported");
      const event = buildEvent(req, url, bodyBuf);
      const result = await mod.handler(event);
      const status = result.statusCode || 200;
      const headers = Object.assign({ "Content-Type": "application/json" }, result.headers || {});
      res.writeHead(status, headers);
      // Support streaming bodies (ReadableStream) for SSE responses.
      if (result.body && typeof result.body.getReader === "function") {
        const reader = result.body.getReader();
        const pump = () => reader.read().then(({ done, value }) => {
          if (done) return res.end();
          res.write(Buffer.from(value));
          return pump();
        });
        return pump().catch((e) => res.end());
      }
      res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "local dev error", detail: e.message, stack: e.stack }));
    }
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`\n  KurwaAI local dev → http://localhost:${PORT}\n  (in-memory Blobs, no real Ollama/ComfyUI/Claude/Stripe)\n`);
});
