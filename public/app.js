(function(){
  "use strict";
  const $ = (id) => document.getElementById(id);
  let currentUser = null;
  let mode = "chat";
  let busy = false;
  let currentAbort = null;

  // ---------- SVG icons (Lucide-style, 1.5 stroke) ----------
  const ICON = {
    login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m14.5-6.5-2 2m-7 7-2 2m11 0-2-2m-7-7-2-2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/></svg>',
  };

  // ---------- toasts ----------
  function toast(msg, kind){
    const wrap = $("toast-wrap");
    const t = document.createElement("div");
    t.className = "toast" + (kind === "error" ? " error" : "");
    t.setAttribute("role", "status");
    t.innerHTML = (kind === "error" ? ICON.alert : ICON.check) + `<span></span>`;
    t.querySelector("span").textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add("leaving");
      setTimeout(() => t.remove(), 220);
    }, 4000);
  }

  // ---------- upgrade modal ----------
  function openUpgrade(){
    const invite = (currentUser && currentUser.discordInvite) || "https://disboard.org/server/1504909141095874662";
    $("upgrade-discord").href = invite;
    const scrim = $("upgrade-modal");
    scrim.classList.add("open");
    $("upgrade-close").focus();
  }
  function closeUpgrade(){ $("upgrade-modal").classList.remove("open"); }

  // ---------- view switching ----------
  function showLanding(){
    $("landing").style.display = "block";
    $("auth-screen").style.display = "none";
    $("app").classList.remove("visible");
    $("nav-badge").style.display = "none";
    $("navlinks").innerHTML = `<button id="nav-login">${ICON.login}<span>Log in</span></button>`;
    $("nav-login").onclick = () => openAuth("login");
  }
  function showAuth(){
    $("landing").style.display = "none";
    $("auth-screen").style.display = "flex";
    $("app").classList.remove("visible");
  }
  function showApp(user){
    $("landing").style.display = "none";
    $("auth-screen").style.display = "none";
    $("app").classList.add("visible");
    $("nav-badge").style.display = "inline-block";
    $("nav-badge").textContent = user.tierLabel + (user.isAdmin ? " · admin" : "");
    renderLimits(user);
    setupModes(user);
    renderEmptyState();
    if(user.isAdmin) showAdmin();
    $("navlinks").innerHTML = `<span class="mono" style="font-size:12.5px;color:var(--fg-muted);">@${user.username}</span><button id="nav-logout">${ICON.logout}<span>Log out</span></button>`;
    $("nav-logout").onclick = logout;
  }

  function renderEmptyState(){
    const log = $("chat-log");
    if(log.children.length === 0){
      log.innerHTML = `<div class="empty-state">${ICON.bot}<h4>Start a conversation</h4><p>Chat is powered by OpenRouter's free models. By chatting, you acknowledge OpenRouter may collect prompts and outputs for service operation and research. Ask anything — it's free.</p></div>`;
    }
  }
  function clearEmptyState(){
    const es = $("chat-log").querySelector(".empty-state");
    if(es) es.remove();
  }

  function renderLimits(user){
    const l = user.local;
    let html = `tier <b>${user.tierLabel}</b> · <b>${l.dailyMsgMax - l.dailyMsgUsed}</b>/${l.dailyMsgMax} msgs left`;
    if(user.claude){
      const c = user.claude;
      html += ` · Claude <b>${c.msgMax - c.msgUsed}</b> left`;
    }
    $("limits").innerHTML = html;
  }

  function setupModes(user){
    const feats = user.features || {};
    // chat button
    $("mode-chat").innerHTML = ICON.chat + `<span>Chat</span>`;
    // image gen
    const genBtn = $("mode-generate");
    if(!feats.imageGen){ genBtn.style.display = "none"; }
    else { genBtn.innerHTML = ICON.image + `<span>Image</span>`; }
    // claude
    const claudeBtn = $("mode-claude");
    const sel = $("claude-model");
    if(!feats.claude){
      claudeBtn.style.display = "none";
    } else {
      const unlocked = !!user.claude;
      claudeBtn.innerHTML = (unlocked ? ICON.spark : ICON.lock) + `<span>Claude</span>`;
      if(unlocked){
        claudeBtn.classList.remove("locked");
        sel.innerHTML = user.claude.models.map(m=>`<option value="${m.id}">${m.label}</option>`).join("");
      }
      claudeBtn.onclick = () => {
        if(!unlocked){ openUpgrade(); return; }
        setMode("claude");
      };
    }
  }

  function showAdmin(){
    $("admin-panel").style.display = "block";
    $("admin-grant").onclick = async () => {
      const username = $("admin-user").value.trim();
      const tier = $("admin-tier").value;
      if(!username){ toast("Enter a username.", "error"); return; }
      $("admin-grant").disabled = true;
      try{
        const res = await fetch("/api/admin-set-tier", {
          method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
          body: JSON.stringify({username, tier})
        });
        const data = await res.json();
        if(res.ok) toast(`Granted ${tier} to @${username}.`);
        else toast(data.error || "Failed.", "error");
      }catch(e){ toast("Network error.", "error"); }
      finally{ $("admin-grant").disabled = false; }
    };
  }

  // ---------- auth ----------
  function openAuth(tab){ showAuth(); setTab(tab); }
  function setTab(tab){
    $("tab-login").classList.toggle("active", tab==="login");
    $("tab-register").classList.toggle("active", tab==="register");
    $("auth-submit").querySelector("span").textContent = tab==="login" ? "Log in" : "Create account";
    $("auth-form").dataset.mode = tab;
    $("auth-error").innerHTML = "";
    $("f-password").setAttribute("autocomplete", tab==="login" ? "current-password" : "new-password");
  }
  function authError(msg){
    $("auth-error").innerHTML = ICON.alert + `<span></span>`;
    $("auth-error").querySelector("span").textContent = msg;
  }

  $("tab-login").onclick = ()=>setTab("login");
  $("tab-register").onclick = ()=>setTab("register");
  $("cta-register").onclick = ()=>openAuth("register");
  $("cta-login").onclick = ()=>openAuth("login");

  $("auth-form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const m = e.target.dataset.mode || "login";
    const username = $("f-username").value.trim();
    const password = $("f-password").value;
    $("auth-error").innerHTML = "";
    $("auth-submit").disabled = true;
    try{
      const res = await fetch(`/api/${m}`, {
        method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
        body: JSON.stringify({username, password})
      });
      const data = await res.json();
      if(!res.ok){ authError(data.error || "Something went wrong."); return; }
      await loadSession();
    }catch(err){
      authError("Network error. Please try again.");
    }finally{
      $("auth-submit").disabled = false;
    }
  });

  async function logout(){
    try{ await fetch("/api/logout", {method:"POST", credentials:"include"}); }catch{}
    currentUser = null; showLanding();
  }

  async function loadSession(){
    try{
      const res = await fetch("/api/me", {credentials:"include"});
      if(res.ok){ currentUser = await res.json(); showApp(currentUser); }
      else { showLanding(); }
    }catch{ showLanding(); }
  }

  // ---------- modes ----------
  document.querySelectorAll(".mode-btn[data-mode]").forEach(btn=>{
    if(btn.id === "mode-claude") return;
    btn.onclick = ()=>setMode(btn.dataset.mode);
  });
  function setMode(m){
    mode = m;
    document.querySelectorAll(".mode-btn").forEach(b=>b.classList.remove("active"));
    const active = document.querySelector(`.mode-btn[data-mode="${m}"]`);
    active && active.classList.add("active");
    $("claude-model").style.display = m === "claude" ? "block" : "none";
    const hints = {
      chat: "Chat via OpenRouter (free model). OpenRouter may collect prompts & outputs.",
      generate: "Describe an image to generate.",
      claude: "Claude model (Plus / Max plans)."
    };
    $("mode-hint").textContent = hints[m] || "";
    const ph = { chat:"Ask anything…", generate:"Describe the image you want…", claude:"Message Claude…" };
    $("chat-input").placeholder = ph[m] || "Type a message…";
  }

  // ---------- markdown ----------
  function escapeHtml(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function renderMarkdown(text){
    const lines = text.split("\n");
    let html = "", i = 0, inList = false;
    const closeList = () => { if(inList){ html += "</ul>"; inList = false; } };
    while(i < lines.length){
      let line = lines[i];
      const codeMatch = line.match(/^```(\w*)\s*$/);
      if(codeMatch){
        closeList(); let code = ""; i++;
        while(i < lines.length && !/^```\s*$/.test(lines[i])){ code += lines[i] + "\n"; i++; }
        i++;
        html += `<pre><button class="copy-btn" type="button">copy</button><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
        continue;
      }
      if(/^\s*[-*]\s+/.test(line)){
        if(!inList){ html += "<ul>"; inList = true; }
        html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
        i++; continue;
      }
      if(line.trim() === ""){ closeList(); i++; continue; }
      closeList();
      html += `<p>${inline(line)}</p>`;
      i++;
    }
    closeList();
    return html;
  }
  function inline(s){
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function addMsg(who, opts={}){
    clearEmptyState();
    const log = $("chat-log");
    const div = document.createElement("div");
    div.className = "msg " + who + (opts.claude ? " claude" : "");
    const whoLabel = opts.claude ? "claude" : (who === "user" ? "you" : "kurwaai");
    div.innerHTML = `<div class="who">${whoLabel}</div><div class="bubble"></div>`;
    const bubble = div.querySelector(".bubble");
    if(opts.image){
      const img = document.createElement("img");
      img.src = opts.image; img.alt = "AI generated image"; img.loading = "lazy";
      bubble.appendChild(img);
    } else if(opts.html !== undefined){ bubble.innerHTML = opts.html; }
    else if(opts.text !== undefined){ bubble.textContent = opts.text; }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function setBusy(state){
    busy = state;
    $("chat-send").disabled = state;
    $("chat-input").disabled = state;
    $("chat-stop").style.display = state ? "inline-flex" : "none";
    $("chat-send").style.display = state ? "none" : "inline-flex";
  }
  function setStatus(el, html){ el.querySelector(".bubble").innerHTML = html; }

  async function send(){
    if(busy) return;
    const input = $("chat-input");
    const text = input.value.trim();
    if(!text) return;
    addMsg("user", {text});
    input.value = "";
    if(mode === "chat"){ await doChat(text); }
    else if(mode === "generate"){ await doGenerate(text); }
    else if(mode === "claude"){ await doClaude(text); }
  }

  async function doChat(text){
    const waiting = addMsg("bot", {html:`<span class="typing"><span></span><span></span><span></span></span>`});
    setBusy(true);
    currentAbort = new AbortController();
    let acc = "";
    const bubble = waiting.querySelector(".bubble");
    try{
      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
        body: JSON.stringify({message:text}), signal: currentAbort.signal
      });
      if(!res.ok){
        const data = await res.json().catch(()=>({}));
        bubble.textContent = data.error || ("Error " + res.status);
        return;
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if(ct.includes("application/json")){
        const data = await res.json().catch(()=>({}));
        if(data.response){ bubble.innerHTML = renderMarkdown(data.response); }
        else if(data.error){ bubble.textContent = data.error; }
        else { bubble.textContent = "(empty)"; }
        return;
      }
      bubble.innerHTML = '<span class="cursor"></span>';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while(true){
        const {done, value} = await reader.read();
        if(done) break;
        buf += decoder.decode(value, {stream:true});
        let nl;
        while((nl = buf.indexOf("\n")) >= 0){
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if(!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if(!payload) continue;
          try{
            const obj = JSON.parse(payload);
            if(obj.token){ acc += obj.token; bubble.innerHTML = renderMarkdown(acc) + '<span class="cursor"></span>'; $("chat-log").scrollTop = $("chat-log").scrollHeight; }
            else if(obj.error){ bubble.textContent = obj.error; }
          }catch{}
        }
      }
      bubble.innerHTML = renderMarkdown(acc);
    }catch(e){
      if(e.name === "AbortError"){ bubble.innerHTML = renderMarkdown(acc) + "\n\n_— stopped_"; }
      else { bubble.textContent = "Network error. Try again."; }
    }finally{ currentAbort = null; setBusy(false); refreshLimits(); }
  }

  async function doGenerate(text){
    const waiting = addMsg("bot", {html:`<span class="spinner"></span>Generating image…`});
    setBusy(true);
    currentAbort = new AbortController();
    try{
      const res = await fetch("/api/generate", {
        method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
        body: JSON.stringify({prompt:text}), signal: currentAbort.signal
      });
      const data = await res.json();
      if(!res.ok){ setStatus(waiting, escapeHtml(data.error || "Error.")); return; }
      setStatus(waiting, "Here you go:");
      addMsg("bot", {image:data.image});
    }catch(e){
      if(e.name === "AbortError"){ setStatus(waiting, "— stopped"); }
      else { setStatus(waiting, "Network error. Try again."); }
    }finally{ currentAbort = null; setBusy(false); refreshLimits(); }
  }

  async function doClaude(text){
    const model = $("claude-model").value;
    const waiting = addMsg("bot", {html:`<span class="typing"><span></span><span></span><span></span></span>`, claude:true});
    setBusy(true);
    currentAbort = new AbortController();
    try{
      const res = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
        body: JSON.stringify({message:text, model}), signal: currentAbort.signal
      });
      const data = await res.json();
      if(!res.ok){ setStatus(waiting, escapeHtml(data.error || "Error.")); return; }
      waiting.querySelector(".bubble").innerHTML = renderMarkdown(data.response || "(empty)");
    }catch(e){
      if(e.name === "AbortError"){ setStatus(waiting, "— stopped"); }
      else { setStatus(waiting, "Network error. Try again."); }
    }finally{ currentAbort = null; setBusy(false); refreshLimits(); }
  }

  async function refreshLimits(){
    try{
      const res = await fetch("/api/me", {credentials:"include"});
      if(res.ok){ currentUser = await res.json(); renderLimits(currentUser); }
    }catch{}
  }

  // ---------- events ----------
  $("chat-send").onclick = send;
  $("chat-input").addEventListener("keydown", (e)=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); send(); } });
  $("chat-stop").onclick = () => { if(currentAbort) currentAbort.abort(); };

  $("chat-log").addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if(!btn) return;
    const code = btn.parentElement.querySelector("code");
    if(code){
      navigator.clipboard.writeText(code.textContent).then(() => {
        const old = btn.textContent; btn.textContent = "copied";
        setTimeout(() => (btn.textContent = old), 1200);
      });
    }
  });

  // modal
  $("upgrade-close").onclick = closeUpgrade;
  $("upgrade-modal").addEventListener("click", (e)=>{ if(e.target === $("upgrade-modal")) closeUpgrade(); });
  document.addEventListener("keydown", (e)=>{ if(e.key === "Escape") closeUpgrade(); });

  // set icons on static buttons
  $("cta-register").innerHTML = `<span>Create free account</span>` + ICON.arrow;
  $("chat-send").innerHTML = ICON.send + `<span>Send</span>`;
  $("chat-stop").innerHTML = ICON.stop + `<span>Stop</span>`;
  $("upgrade-icon").innerHTML = ICON.spark;

  setMode("chat");
  loadSession();
})();
