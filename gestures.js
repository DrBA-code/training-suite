// Training Suite hand gestures on the live screen (webcam, MediaPipe, all in the browser).
// Right palm sweeping left = next; left palm sweeping right = back. Two hands apart = zoom, clap = full view,
// pinch and drag = move while zoomed. Fist = grab the slide, open the hand towards the room = throw it to phones.
// There is no "hold your palm still" gesture: it fired by accident in real sessions.
window.TSG = (() => {
  "use strict";
  const WASM = new URL("vendor/mediapipe-wasm", location.href.split("#")[0]).href;
  const MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
  const WINDOW_MS = 600, COOLDOWN_MS = 700, DROPOUT_MS = 300, RECOIL_MS = 1300;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  let o = null, recognizer = null, stream = null, running = false, paused = false;
  let handCal = null; try { handCal = JSON.parse(store.get("ts_handcal")); } catch {}
  let calib = null, history = [], handSince = 0, cooldownUntil = 0, lastVideoTime = -1, lastProcess = 0, lastSeen = 0, lastDir = null, lastDirAt = 0;
  let grab = {}, zoom = 1, tx = 0, ty = 0, zoomGesture = null, pinchPrev = null, zoomCooldown = 0;
  const sens = () => [0.26, 0.21, 0.16, 0.12, 0.09][(+store.get("ts_gsens") || 3) - 1];
  const majority = arr => { const c = {}; arr.forEach(v => { if (v != null) c[v] = (c[v] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null; };
  const palmZ = lm => (lm[5].x - lm[0].x) * (lm[17].y - lm[0].y) - (lm[5].y - lm[0].y) * (lm[17].x - lm[0].x);
  const swap = () => store.get("ts_gswap") === "1";
  function whichHand(label) {
    if (!label) return null;
    let h = handCal?.rightLabel ? (label === handCal.rightLabel ? "right" : "left") : (label === "Left" ? "left" : "right");
    return swap() ? (h === "right" ? "left" : "right") : h;
  }
  const palmFacing = (lm, hand) => palmZ(lm) * (hand === "right" ? (handCal?.rightSign || -1) : -(handCal?.rightSign || -1)) > 0;
  const note = t => o?.note(t);

  async function start(opts) {
    o = opts; running = true; paused = false;
    o.label("Starting camera…");
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false }); }
    catch (e) { o.label("No camera"); note(e?.name === "NotAllowedError" ? "Camera blocked. Allow the camera for this site to use gestures. Keys and the phone remote still work." : "The camera couldn't start. Keys and the phone remote still work."); running = false; return false; }
    o.video.srcObject = stream; await o.video.play().catch(() => {});
    if (!recognizer) {
      o.label("Loading hand tracking…");
      try {
        const { FilesetResolver, GestureRecognizer } = await import(new URL("vendor/vision_bundle.mjs", location.href.split("#")[0]).href);
        const fs = await FilesetResolver.forVisionTasks(WASM);
        const make = d => GestureRecognizer.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: "VIDEO", numHands: 2 });
        try { recognizer = await make("GPU"); } catch { recognizer = await make("CPU"); }
      } catch (e) { console.error(e); o.label("Tracking unavailable"); note("Hand tracking couldn't load. Check the internet connection. Keys still work."); return false; }
    }
    if (!running) return false;
    o.label("Watching for gestures"); note("");
    if (!handCal) checkHands();
    loop();
    return true;
  }
  function stop() { running = false; if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } grab = {}; o?.onGrab(false); resetZoom(); }
  function pause(on) { paused = on; if (on && stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } else if (!on && running && !stream && o) { running = false; start(o); } }
  function checkHands() { if (!running) return; calib = { start: performance.now(), labels: [], signs: [] }; note("Checking your hands: raise your RIGHT hand, palm facing the camera, and hold it there…"); }
  function calFrame(lm, label, now) {
    if (lm && label) { calib.labels.push(label); const z = palmZ(lm); if (Math.abs(z) > 1e-4) calib.signs.push(z > 0 ? 1 : -1); }
    if (calib.labels.length >= 25 && calib.signs.length >= 15) {
      handCal = { rightLabel: majority(calib.labels), rightSign: calib.signs.reduce((a, b) => a + b, 0) > 0 ? 1 : -1 };
      store.set("ts_handcal", JSON.stringify(handCal)); calib = null;
      note("Hands checked ✓  Right palm sweep left = next · Left palm sweep right = back"); setTimeout(() => note(""), 3500);
    } else if (now - calib.start > 15000) { calib = null; note("Couldn't see your hand clearly. Press H to try again."); setTimeout(() => note(""), 5000); }
  }

  function loop() {
    if (!running || !stream || paused) return;
    requestAnimationFrame(loop);
    const v = o.video, now = performance.now();
    if (v.readyState < 2 || v.currentTime === lastVideoTime || now - lastProcess < 33) return;
    lastVideoTime = v.currentTime; lastProcess = now;
    let res; try { res = recognizer.recognizeForVideo(v, now); } catch { return; }
    const hands = res.landmarks || [], lm = hands[0];
    drawHands(hands);
    if (calib) { calFrame(hands.length === 1 ? lm : null, hands.length === 1 ? res.handedness?.[0]?.[0]?.categoryName : null, now); return; }
    if (o.zoomable() && hands.length === 2) { history = []; handSince = 0; pinchPrev = null; twoHandZoom(hands, now); return; }
    zoomGesture = null;
    if (!lm && history.length && now - lastSeen < DROPOUT_MS) { if (zoom <= 1) trySwipe(now); return; }
    if (!lm && grab.active && now - (grab.last || 0) > 1500) { grab = {}; o.onGrab(false); }
    if (!lm) { history = []; handSince = 0; o.label("Watching for gestures"); return; }
    lastSeen = now; if (!handSince) handSince = now;
    const pts = [0, 5, 9, 13, 17].map(i => lm[i]);
    const x = pts.reduce((a, p) => a + p.x, 0) / 5, y = pts.reduce((a, p) => a + p.y, 0) / 5;
    const hand = whichHand(res.handedness?.[0]?.[0]?.categoryName), front = hand ? palmFacing(lm, hand) : false;
    history.push({ t: now, x, y, hand, front });
    o.label(hand ? `${hand === "right" ? "Right" : "Left"} hand · ${front ? "palm" : "back"}` : "Hand seen");
    while (history.length && now - history[0].t > WINDOW_MS) history.shift();
    const g = res.gestures?.[0]?.[0], palm = g && g.categoryName === "Open_Palm" && g.score > 0.6;
    // zoomed: pinch and drag to move; swipes wait until you clap back to full view
    if (zoom > 1) {
      const size = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 0.1;
      if (Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / size < 0.35) {
        const p = { x: (1 - (lm[4].x + lm[8].x) / 2) * innerWidth, y: ((lm[4].y + lm[8].y) / 2) * innerHeight };
        if (pinchPrev) { tx += (p.x - pinchPrev.x) * 1.8; ty += (p.y - pinchPrev.y) * 1.8; applyZoom(); }
        pinchPrev = p;
      } else pinchPrev = null;
      history = []; return;
    }
    // grab (fist) and throw (open the hand): towards your left = Group A, right = Group B, straight = everyone
    if (o.canThrow()) {
      const fist = g && g.categoryName === "Closed_Fist" && g.score > 0.6;
      if (fist) {
        if (!grab.since) { grab.since = now; grab.x = x; }
        if (!grab.active && now - grab.since > 350) { grab.active = true; grab.x = x; o.onGrab(true); }
        grab.last = now;
      } else if (grab.active && palm) {
        const dx = x - grab.x, target = dx > 0.12 ? "A" : dx < -0.12 ? "B" : "all";
        grab = {}; o.onGrab(false); history = []; cooldownUntil = now + COOLDOWN_MS;
        o.onThrow(target); return;
      } else { grab.since = 0; if (grab.active && now - grab.last > 1500) { grab = {}; o.onGrab(false); } }
      if (grab.active) { history = []; return; }
    }
    trySwipe(now);
  }
  function trySwipe(now) {
    if (now < cooldownUntil || history.length < 3 || (handSince && now - handSince < 200)) return;
    const xs = history.map(h => h.x), ys = history.map(h => h.y);
    const sgn = (arr, mn, mx) => (arr.indexOf(mx) > arr.indexOf(mn) ? 1 : -1);
    const dx = (Math.max(...xs) - Math.min(...xs)) * sgn(xs, Math.min(...xs), Math.max(...xs));
    const dy = (Math.max(...ys) - Math.min(...ys)) * sgn(ys, Math.min(...ys), Math.max(...ys));
    let dir = null;
    if (Math.abs(dx) >= sens() && Math.abs(dy) < 0.8 * Math.abs(dx)) dir = dx > 0 ? "left" : "right";   // camera image is not mirrored
    if (!dir) return;
    const hand = majority(history.map(h => h.hand)), front = history.filter(h => h.front).length >= history.length / 2;
    if (!(dir === "left" ? hand === "right" && front : hand === "left" && front)) { history = []; return; }
    if (lastDir && dir !== lastDir && now - lastDirAt < RECOIL_MS) { history = []; return; }   // the hand coming back
    o.onCmd(dir === "left" ? "next" : "prev");
    lastDir = dir; lastDirAt = now; cooldownUntil = now + COOLDOWN_MS; history = [];
  }
  function twoHandZoom(hands, now) {
    const centre = lm => { const p = [0, 5, 9, 13, 17].map(i => lm[i]); return { x: 1 - p.reduce((a, q) => a + q.x, 0) / 5, y: p.reduce((a, q) => a + q.y, 0) / 5 }; };
    const a = centre(hands[0]), b = centre(hands[1]), d = Math.hypot(a.x - b.x, (a.y - b.y) * 0.75);
    const fx = ((a.x + b.x) / 2 - 0.5) * innerWidth, fy = ((a.y + b.y) / 2 - 0.5) * innerHeight;
    if (now < zoomCooldown) return;
    if (d < 0.08) { if (zoom > 1) { resetZoom(); o.flash("⤢"); } zoomGesture = null; zoomCooldown = now + 800; return; }   // clap: full view
    if (!zoomGesture) { zoomGesture = { since: now, d0: d, z0: zoom }; return; }
    if (now - zoomGesture.since < 200) { zoomGesture.d0 = d; zoomGesture.z0 = zoom; return; }
    let z = Math.max(1, Math.min(5, zoomGesture.z0 * (d / zoomGesture.d0)));
    if (z < 1.04) { z = 1; tx = 0; ty = 0; } else { tx = fx - (fx - tx) * (z / zoom); ty = fy - (fy - ty) * (z / zoom); }
    zoom = z; applyZoom();
  }
  function applyZoom(smooth) {
    const c = o?.slideEl(); if (!c) return;
    const w = c.clientWidth, h = c.clientHeight, maxX = Math.max(0, (w * zoom - w) / 2), maxY = Math.max(0, (h * zoom - h) / 2);
    tx = Math.max(-maxX, Math.min(maxX, tx)); ty = Math.max(-maxY, Math.min(maxY, ty));
    c.style.transition = smooth ? "transform .35s cubic-bezier(.2,.8,.2,1)" : "none";
    c.style.transform = zoom === 1 ? "" : `translate(${tx}px,${ty}px) scale(${zoom})`;
  }
  function resetZoom() { zoom = 1; tx = 0; ty = 0; zoomGesture = null; pinchPrev = null; if (o) applyZoom(true); }
  const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  function drawHands(hands) {
    const c = o.canvas, v = o.video;
    if (c.width !== v.videoWidth) { c.width = v.videoWidth || 640; c.height = v.videoHeight || 480; }
    const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
    hands.forEach(lm => {
      g.strokeStyle = "rgba(63,185,138,.95)"; g.lineWidth = 3; g.beginPath();
      BONES.forEach(([a, b]) => { g.moveTo(lm[a].x * c.width, lm[a].y * c.height); g.lineTo(lm[b].x * c.width, lm[b].y * c.height); });
      g.stroke(); g.fillStyle = "#F4B400";
      lm.forEach(p => { g.beginPath(); g.arc(p.x * c.width, p.y * c.height, 4, 0, 7); g.fill(); });
    });
  }
  // ---------- finger vote: count raised fingers on every hand the webcam sees ----------
  const FMODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  let flm = null;
  function fingersUp(p) {
    const d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
    let n = 0;
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (d(0, tip) > d(0, pip) * 1.12) n++;
    if (d(4, 17) > d(2, 17) * 1.22 && d(4, 5) > d(3, 5)) n++;   // thumb out, away from the palm
    return n;
  }
  // fingers({ video, canvas, options: () => n, colors, onCounts(counts, hands), onMsg(text) }) → { stop() }
  function fingers(f) {
    let on = true, fstream = null, raf = 0, last = 0; const hist = [];
    (async () => {
      try { fstream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
      catch (e) { f.onMsg(e?.name === "NotReadableError" ? "The camera is busy: close other apps using it." : "Camera blocked. Allow the camera for this site, then open this question again."); return; }
      if (!on) { fstream.getTracks().forEach(t => t.stop()); return; }
      f.video.srcObject = fstream; await f.video.play().catch(() => {});
      if (!flm) {
        f.onMsg("Loading hand tracking…");
        try {
          const { FilesetResolver, HandLandmarker } = await import(new URL("vendor/vision_bundle.mjs", location.href.split("#")[0]).href);
          const fs = await FilesetResolver.forVisionTasks(WASM);
          const make = d => HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: FMODEL, delegate: d }, runningMode: "VIDEO", numHands: 16, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4 });
          try { flm = await make("GPU"); } catch { flm = await make("CPU"); }
        } catch { f.onMsg("Couldn't load hand tracking. Check the internet connection."); return; }
      }
      const frame = () => {
        if (!on) return;
        raf = requestAnimationFrame(frame);
        const v = f.video, c = f.canvas; if (v.readyState < 2) return;
        const now = performance.now(); if (now - last < 90) return; last = now;
        const res = flm.detectForVideo(v, now), n = f.options(), cnt = Array(n).fill(0);
        c.width = v.videoWidth; c.height = v.videoHeight;
        const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
        (res.landmarks || []).forEach(p => {
          const k = fingersUp(p); if (k >= 1 && k <= n) cnt[k - 1]++;
          const col = k >= 1 && k <= n ? f.colors[k - 1] : "#8FA69B";
          g.fillStyle = col; p.forEach(q => { g.beginPath(); g.arc(q.x * c.width, q.y * c.height, 5, 0, 7); g.fill(); });
          const w = p[9]; g.font = "800 52px 'Bricolage Grotesque', sans-serif"; g.textAlign = "center";
          g.save(); g.translate(w.x * c.width, w.y * c.height - 70); g.scale(-1, 1); g.fillText(String(k), 0, 0); g.restore();
        });
        hist.push(cnt); if (hist.length > 12) hist.shift();
        const smooth = cnt.map((_, j) => { const a = hist.map(h => h[j] || 0).sort((x, y) => x - y); return a[Math.floor(a.length * 0.6)] || 0; });
        const hands = (res.landmarks || []).length;
        f.onMsg(hands ? `${hands} hand${hands > 1 ? "s" : ""} in view. Hold them up high and still.` : "Waiting for hands… hold them up facing the camera.");
        f.onCounts(smooth, hands);
      };
      frame();
    })();
    return { stop() { on = false; cancelAnimationFrame(raf); if (fstream) fstream.getTracks().forEach(t => t.stop()); fstream = null; }, reset() { hist.length = 0; } };
  }
  return { start, stop, pause, checkHands, resetZoom, fingers, get on() { return running; }, get zoomed() { return zoom > 1; } };
})();
