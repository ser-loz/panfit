'use strict';

/* PanFit — will the food fit in the pan?
 *
 * Pipeline: photo → tap the board's 4 corners → perspective-rectify to a
 * top-down view at a known px/cm scale → threshold against the board colour →
 * connected components → per-piece areas → compare against pan capacities.
 */

const $ = id => document.getElementById(id);

// Tap order matters: it pairs each tap with a known point in rectified space.
// Rectangle: the four corners. Round: the four rim extremes, which are where the
// circle touches its circumscribing square (the side midpoints) — so the same
// 4-point homography works for both shapes.
const RECT_TAPS = ['top-left corner of the board', 'top-right corner of the board',
  'bottom-right corner of the board', 'bottom-left corner of the board'];
const ROUND_TAPS = ['topmost point of the rim', 'rightmost point of the rim',
  'bottommost point of the rim', 'leftmost point of the rim'];
const MAX_PHOTO = 1600;  // px, longest side of the photo after downscale
const MAX_BOARD = 1200;  // px, longest side of the rectified board
const MIN_PIECE = 0.35;  // cm²; smaller blobs are treated as noise

const state = {
  photo: null,    // canvas: the (downscaled) photo
  corners: [],    // 4 tapped points in photo px, order = RECT_TAPS / ROUND_TAPS
  round: false,   // round board/plate mode
  rect: null,     // canvas: rectified top-down board
  rectData: null, // ImageData of rect
  pxPerCm: 0,
  bg: null,       // {r,g,b} estimated board colour
  labels: null,   // Int32Array: blob id per rectified pixel, 0 = background
  blobs: [],      // {id, px, cm2, cx, cy, off}
};

const store = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};

function show(stepId) {
  for (const s of document.querySelectorAll('.step')) s.hidden = s.id !== stepId;
  window.scrollTo(0, 0);
}

/* ---------- step 1: photo ---------- */

function applyShapeUI(shape) {
  $('wrap-w').hidden = $('wrap-h').hidden = shape === 'round';
  $('wrap-d').hidden = shape !== 'round';
}
for (const r of document.querySelectorAll('input[name=shape]')) {
  r.addEventListener('change', () => applyShapeUI(r.value));
}

$('photo-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file
  if (!file) return;
  const shape = document.querySelector('input[name=shape]:checked').value;
  let board;
  if (shape === 'round') {
    const d = +$('board-d').value;
    if (!(d > 0)) { alert('Enter the plate diameter first.'); return; }
    board = { shape, d };
  } else {
    const w = +$('board-w').value, h = +$('board-h').value;
    if (!(w > 0 && h > 0)) { alert('Enter the board width and height first.'); return; }
    board = { shape, w, h };
  }
  store.write('board', board);
  usePhoto(await loadBitmap(file));
});

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function usePhoto(source) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const k = Math.min(1, MAX_PHOTO / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  state.photo = c;
  state.corners = [];
  drawCorners();
  show('step-corners');
}

/* ---------- step 2: board corners ---------- */

const cornerCanvas = $('corner-canvas');

cornerCanvas.addEventListener('pointerdown', e => {
  if (state.corners.length >= 4) return;
  state.corners.push(canvasPos(cornerCanvas, e));
  drawCorners();
  if (state.corners.length === 4) setTimeout(analyze, 300);
});

$('corner-undo').onclick = () => { state.corners.pop(); drawCorners(); };
$('corner-back').onclick = () => show('step-photo');

function canvasPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * canvas.width / r.width,
    y: (e.clientY - r.top) * canvas.height / r.height,
  };
}

function drawCorners() {
  const c = cornerCanvas;
  c.width = state.photo.width;
  c.height = state.photo.height;
  const g = c.getContext('2d');
  g.drawImage(state.photo, 0, 0);

  const round = store.read('board', {}).shape === 'round';
  const pts = state.corners;
  const u = Math.max(3, c.width / 200); // ui scale
  g.strokeStyle = '#f97316';
  g.lineWidth = u * 0.8;
  if (round && pts.length === 4) {
    const [t, r, b, l] = pts;
    g.setLineDash([u * 2, u * 2]);
    g.beginPath();
    g.ellipse((l.x + r.x) / 2, (t.y + b.y) / 2,
      Math.abs(r.x - l.x) / 2, Math.abs(b.y - t.y) / 2, 0, 0, 7);
    g.stroke();
    g.setLineDash([]);
  } else if (pts.length > 1) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    if (pts.length === 4) g.closePath();
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${u * 2.6}px system-ui`;
  pts.forEach((p, i) => {
    g.fillStyle = '#f97316';
    g.beginPath();
    g.arc(p.x, p.y, u * 2.4, 0, 7);
    g.fill();
    g.fillStyle = '#1c1917';
    g.fillText(i + 1, p.x, p.y);
  });

  $('corner-prompt').textContent = pts.length < 4
    ? `Tap the ${(round ? ROUND_TAPS : RECT_TAPS)[pts.length]} (${pts.length + 1} of 4)`
    : 'Analyzing…';
}

/* ---------- rectification ---------- */

function analyze() {
  const board = store.read('board', { shape: 'rect', w: 40, h: 30 });
  state.round = board.shape === 'round';
  rectify(state.round ? board.d : board.w, state.round ? board.d : board.h);
  sampleBackground();
  detect();
  renderReview();
  show('step-review');
}

// Solve A·x = b (n×n) by Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

// Homography h mapping each of 4 points `from` onto `to`.
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  return solve(A, b);
}

function applyH(h, x, y) {
  const d = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}

// Warp the tapped points into a wCm×hCm rectangle at a known scale.
// Rectangle: taps are the corners. Round: taps are the rim extremes, i.e. the
// side midpoints of the circumscribing square (tangency survives the projection).
function rectify(wCm, hCm) {
  const s = Math.min(10, MAX_BOARD / Math.max(wCm, hCm));
  const W = Math.round(wCm * s), H = Math.round(hCm * s);
  state.pxPerCm = s;

  const dst = state.round
    ? [{ x: W / 2, y: 0 }, { x: W, y: H / 2 }, { x: W / 2, y: H }, { x: 0, y: H / 2 }]
    : [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const h = homography(dst, state.corners);

  const photo = state.photo;
  const src = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height).data;
  const out = new ImageData(W, H);
  const d = out.data;
  const cx = W / 2, cy = H / 2, r2 = (W / 2) ** 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [u, v] = applyH(h, x + 0.5, y + 0.5);
      const su = Math.min(photo.width - 1, Math.max(0, Math.round(u)));
      const sv = Math.min(photo.height - 1, Math.max(0, Math.round(v)));
      const i = (y * W + x) * 4, j = (sv * photo.width + su) * 4;
      const dim = state.round && (x - cx) ** 2 + (y - cy) ** 2 > r2 ? 0.25 : 1;
      d[i] = src[j] * dim; d[i + 1] = src[j + 1] * dim; d[i + 2] = src[j + 2] * dim;
      d[i + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d').putImageData(out, 0, 0);
  state.rect = c;
  state.rectData = out;
}

/* ---------- detection ---------- */

function median(a) { a.sort((p, q) => p - q); return a[a.length >> 1]; }

// Board colour = per-channel median of a thin band near the edge, where food
// rarely sits: the border of a rectangular board, or an annulus just inside a rim.
function sampleBackground() {
  const { width: W, height: H } = state.rect;
  const d = state.rectData.data;
  const band = Math.max(2, Math.round(Math.min(W, H) * 0.03));
  const cx = W / 2, cy = H / 2;
  const rInner = (0.86 * W / 2) ** 2, rOuter = (0.96 * W / 2) ** 2;
  const rs = [], gs = [], bs = [];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (state.round) {
        const q = (x - cx) ** 2 + (y - cy) ** 2;
        if (q < rInner || q > rOuter) continue;
      } else if (x >= band && x < W - band && y >= band && y < H - band) {
        continue;
      }
      const i = (y * W + x) * 4;
      rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
    }
  }
  state.bg = { r: median(rs), g: median(gs), b: median(bs) };
}

function detect() {
  const { width: W, height: H } = state.rect;
  const d = state.rectData.data;
  const n = W * H;
  const t = +$('sens').value, t2 = t * t;
  const { r: br, g: bg, b: bb } = state.bg;

  // In round mode only pixels on the plate count; 0.98 keeps the rim edge out.
  const cx = W / 2, cy = H / 2, r2 = (0.98 * W / 2) ** 2;
  const mask = new Uint8Array(n);
  for (let y = 0, i = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++, p += 4) {
      if (state.round && (x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const dr = d[p] - br, dg = d[p + 1] - bg, db = d[p + 2] - bb;
      if (dr * dr + dg * dg + db * db > t2) mask[i] = 1;
    }
  }

  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const blobs = [];
  const minPx = MIN_PIECE * state.pxPerCm ** 2;
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || labels[i]) continue;
    id++;
    let top = 0, px = 0, sx = 0, sy = 0;
    stack[top++] = i;
    labels[i] = id;
    while (top) {
      const j = stack[--top], x = j % W, y = (j - x) / W;
      px++; sx += x; sy += y;
      if (x > 0 && mask[j - 1] && !labels[j - 1]) { labels[j - 1] = id; stack[top++] = j - 1; }
      if (x < W - 1 && mask[j + 1] && !labels[j + 1]) { labels[j + 1] = id; stack[top++] = j + 1; }
      if (y > 0 && mask[j - W] && !labels[j - W]) { labels[j - W] = id; stack[top++] = j - W; }
      if (y < H - 1 && mask[j + W] && !labels[j + W]) { labels[j + W] = id; stack[top++] = j + W; }
    }
    if (px >= minPx) {
      blobs.push({ id, px, cm2: px / state.pxPerCm ** 2, cx: sx / px, cy: sy / px, off: false });
    }
  }
  state.labels = labels;
  state.blobs = blobs;
}

/* ---------- step 3: review ---------- */

const PALETTE = [
  [244, 114, 63], [52, 211, 153], [96, 165, 250], [250, 204, 21],
  [192, 132, 252], [45, 212, 191], [251, 146, 60], [163, 230, 53],
];

function blobById() { return new Map(state.blobs.map(b => [b.id, b])); }

function renderReview() {
  const { width: W, height: H } = state.rect;
  const c = $('review-canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(state.rect, 0, 0);

  const byId = blobById();
  const ov = new ImageData(W, H), o = ov.data, L = state.labels;
  for (let i = 0; i < W * H; i++) {
    const b = L[i] && byId.get(L[i]);
    if (!b) continue;
    const p = i * 4;
    if (b.off) {
      o[p] = o[p + 1] = o[p + 2] = 30; o[p + 3] = 150;
    } else {
      const [r, gg, bb] = PALETTE[b.id % PALETTE.length];
      o[p] = r; o[p + 1] = gg; o[p + 2] = bb; o[p + 3] = 110;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  tmp.getContext('2d').putImageData(ov, 0, 0);
  g.drawImage(tmp, 0, 0);

  const fs = Math.max(11, W / 34);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${fs}px system-ui`;
  for (const b of state.blobs) {
    if (b.off) continue;
    const label = b.cm2 >= 10 ? b.cm2.toFixed(0) : b.cm2.toFixed(1);
    g.lineWidth = fs / 5;
    g.strokeStyle = 'rgba(0,0,0,.75)';
    g.strokeText(label, b.cx, b.cy);
    g.fillStyle = '#fff';
    g.fillText(label, b.cx, b.cy);
  }
  updateTotal();
}

$('review-canvas').addEventListener('pointerdown', e => {
  const { x, y } = canvasPos($('review-canvas'), e);
  const { width: W, height: H } = state.rect;
  const byId = blobById();
  const r = Math.max(4, Math.round(state.pxPerCm * 0.7)); // finger-sized slack
  let hit = null, best = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const b = byId.get(state.labels[py * W + px]);
      const d2 = dx * dx + dy * dy;
      if (b && d2 < best) { best = d2; hit = b; }
    }
  }
  if (hit) { hit.off = !hit.off; renderReview(); }
});

$('sens').addEventListener('input', () => { detect(); renderReview(); });
$('review-back').onclick = () => { state.corners = []; drawCorners(); show('step-corners'); };
$('to-pans').onclick = () => { renderVerdict(); show('step-pans'); };

function totalArea() { return state.blobs.reduce((s, b) => s + (b.off ? 0 : b.cm2), 0); }
function activeCount() { return state.blobs.filter(b => !b.off).length; }

function updateTotal() {
  $('total-area').textContent = `${activeCount()} pieces · ${totalArea().toFixed(0)} cm²`;
}

/* ---------- step 4: pans & verdict ---------- */

function pans() { return store.read('pans', []); }

function renderPans() {
  const ul = $('pan-list');
  ul.innerHTML = '';
  pans().forEach((p, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = `${p.name} — ⌀ ${p.d} cm`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.className = 'del';
    del.onclick = () => {
      const list = pans();
      list.splice(i, 1);
      store.write('pans', list);
      renderPans();
      renderVerdict();
    };
    li.append(span, del);
    ul.appendChild(li);
  });
}

$('pan-form').addEventListener('submit', e => {
  e.preventDefault();
  const d = +$('pan-d').value;
  if (!(d > 0)) return;
  const name = $('pan-name').value.trim() || `${d} cm pan`;
  store.write('pans', [...pans(), { name, d }]);
  $('pan-name').value = '';
  $('pan-d').value = '';
  renderPans();
  renderVerdict();
});

$('factor').addEventListener('input', () => {
  store.write('factor', +$('factor').value);
  $('factor-val').textContent = `${$('factor').value} %`;
  renderVerdict();
});

function renderVerdict() {
  const el = $('verdict');
  el.innerHTML = '';
  const total = totalArea();
  const f = store.read('factor', 70) / 100;
  const list = pans();

  const head = document.createElement('p');
  head.className = 'big';
  head.textContent = `Food to fry: ${activeCount()} pieces, ${total.toFixed(0)} cm²`;
  el.appendChild(head);

  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Add your pans below to get a verdict.';
    el.appendChild(p);
    return;
  }

  const cap = p => f * Math.PI * (p.d / 2) ** 2;
  const options = [];
  for (const p of list) options.push({ who: [p], c: cap(p) });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      options.push({ who: [list[i], list[j]], c: cap(list[i]) + cap(list[j]) });
    }
  }
  for (const o of options) {
    o.rounds = Math.max(1, Math.ceil(total / o.c - 1e-9));
    o.fill = total / (o.c * o.rounds);
  }
  // fewest frying rounds, then fewest pans, then the smallest pan that does it
  options.sort((a, b) => a.rounds - b.rounds || a.who.length - b.who.length || a.c - b.c);

  for (const o of options.slice(0, 6)) {
    const div = document.createElement('div');
    div.className = 'option' + (o === options[0] ? ' best' : '');
    const strong = document.createElement('strong');
    strong.textContent = o.who.map(p => `${p.name} (${p.d} cm)`).join(' + ');
    const text = document.createElement('div');
    const pct = Math.round(o.fill * 100);
    if (o.rounds === 1 && o.who.length === 1) text.textContent = `✓ Fits in one batch — ${pct}% of usable space`;
    else if (o.rounds === 1) text.textContent = `✓ One round with both pans going at once — ${pct}% full`;
    else if (o.who.length === 1) text.textContent = `${o.rounds} batches, about ${pct}% full each`;
    else text.textContent = `${o.rounds} rounds with both pans going`;
    div.append(strong, text);
    el.appendChild(div);
  }
}

$('pans-back').onclick = () => show('step-review');
$('restart').onclick = () => { state.corners = []; show('step-photo'); };

/* ---------- init ---------- */

function init() {
  const board = store.read('board', null);
  if (board) {
    if (board.w) $('board-w').value = board.w;
    if (board.h) $('board-h').value = board.h;
    if (board.d) $('board-d').value = board.d;
    const shape = board.shape || 'rect';
    document.querySelector(`input[name=shape][value=${shape}]`).checked = true;
    applyShapeUI(shape);
  }
  const f = store.read('factor', 70);
  $('factor').value = f;
  $('factor-val').textContent = `${f} %`;
  renderPans();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js');
  }
}
init();

// Debug hooks for testing from the console; not used by the UI.
window.PF = { state, store, usePhoto, analyze, detect, renderReview, renderVerdict, totalArea, show };
