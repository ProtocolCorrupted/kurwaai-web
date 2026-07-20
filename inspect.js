const { getStore } = require("@netlify/blobs");
(async () => {
  const s = getStore("kurwaai-users");
  const { blobs } = await s.list();
  const users = blobs.filter(b => b.key.startsWith("user:"));
  const limits = blobs.filter(b => b.key.startsWith("limits:"));
  for (const u of users) {
    const name = u.key.replace("user:","");
    const lim = await s.get("limits:"+name, { type:"json" }).catch(()=>null);
    const used = lim && lim.msgCount ? lim.msgCount : 0;
    const date = lim && lim.date ? lim.date : "-";
    console.log(name.padEnd(12), "msgs:", String(used).padStart(5), " date:", date);
  }
})();
