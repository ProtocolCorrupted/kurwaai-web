(function () {
  "use strict";
  const canvas = document.getElementById("stars");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h, dpr, stars, raf;

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function makeStars() {
    const count = Math.min(160, Math.floor((w * h) / 12000));
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        z: rand(0.3, 1),            // depth -> speed + size
        r: rand(0.4, 1.6),
        tw: rand(0, Math.PI * 2),   // twinkle phase
        tws: rand(0.01, 0.04),     // twinkle speed
        hue: Math.random() < 0.25 ? 190 : 150, // mostly green, some cyan
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeStars();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.y += s.z * 0.45;               // fall
      if (s.y > h + 4) { s.y = -4; s.x = Math.random() * w; }
      s.tw += s.tws;
      const alpha = 0.35 + Math.sin(s.tw) * 0.35 + s.z * 0.2;
      const a = Math.max(0.05, Math.min(1, alpha));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (0.6 + s.z * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, 80%, 65%, ${a})`;
      ctx.shadowBlur = 6 * s.z;
      ctx.shadowColor = `hsla(${s.hue}, 90%, 60%, ${a * 0.8})`;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, 80%, 65%, 0.5)`;
      ctx.fill();
    }
  }

  resize();
  window.addEventListener("resize", resize);
  if (reduceMotion) { drawStatic(); }
  else { raf = requestAnimationFrame(draw); }

  document.addEventListener("visibilitychange", () => {
    if (reduceMotion) return;
    if (document.hidden) { cancelAnimationFrame(raf); }
    else { raf = requestAnimationFrame(draw); }
  });
})();
