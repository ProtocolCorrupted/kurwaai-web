// wipe users store so kurwaai can be re-registered
const fs = require("fs");
try {
  const txt = fs.readFileSync(".env", "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const { getStore } = require("@netlify/blobs");

// local bridge: build NETLIFY_BLOBS_CONTEXT from the Netlify account token
if (!process.env.NETLIFY_BLOBS_CONTEXT) {
  const SITE_ID = process.env.SITE_ID || "09db3bef-d74e-4d1a-80b9-ebbc739830f4";
  const TOKEN = process.env.NEW_TOKEN || "nfc_zsr2wpv6nWEp9xv9zGvK3PdQfKm622Et9e60";
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ siteID: SITE_ID, token: TOKEN })).toString("base64");
}

if (!process.env.NETLIFY_BLOBS_CONTEXT && process.env.NETLIFY_FUNCTIONS_TOKEN && process.env.SITE_ID) {
  const ctx = Buffer.from(JSON.stringify({ siteID: process.env.SITE_ID, token: process.env.NETLIFY_FUNCTIONS_TOKEN })).toString("base64");
  process.env.NETLIFY_BLOBS_CONTEXT = ctx;
}

(async () => {
  const store = getStore("kurwaai-users");
  const keys = await store.list();
  console.log("list shape:", JSON.stringify(keys).slice(0, 300));
  const arr = Array.isArray(keys) ? keys : (keys.blobs || keys.keys || []);
  console.log("total keys:", arr.length);
  let n = 0;
  for (const k of arr) {
    await store.delete(k.key);
    n++;
  }
  console.log("deleted:", n);
  const after = await store.list();
  console.log("remaining:", after.length);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
