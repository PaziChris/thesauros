// Thesauros – Goldschmuck, Uhren & Münzen
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDS7khn4K8_cE2e3shxQf7bf04BgaiMwbQ",
  authDomain: "thesauros-4a242.firebaseapp.com",
  projectId: "thesauros-4a242",
  storageBucket: "thesauros-4a242.firebasestorage.app",
  messagingSenderId: "133466871225",
  appId: "1:133466871225:web:a1ca4858a19636df2b9268"
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
let db;
try { db = initializeFirestore(fb, { localCache: persistentLocalCache() }); }
catch (e) { db = initializeFirestore(fb, {}); }

// ---------- Zustand ----------
let user = null, unsubs = [], itemsReady = false;
let items = [], settings = null, history = [];
let tab = 'gold';
const photoCache = new Map();
let pend = {}, rm = {};          // neue Fotos / zu entfernende Fotos im offenen Formular
let editing = null;              // {type, id}

const OZ = 31.1034768;
const PUR_JEWEL = [333, 375, 585, 750, 916, 999];
const PUR_COIN = [999, 986, 925, 916, 900, 835, 800, 750, 720, 640, 625, 585, 500];
const TYPES = { gold: 'Gold', watch: 'Uhren', coin: 'Münzen' };
const C = { gold: '#ffb84a', watch: '#5ea8ff', coin: '#3ee0a6', paid: '#5ea8ff', val: '#ffb84a' };
const TAB_DEFAULT = 'gold';

// ---------- Hilfen ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n, dec) => n == null || isNaN(n) ? '–' : n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec ?? (Math.abs(n) >= 100 ? 0 : 2), maximumFractionDigits: dec ?? (Math.abs(n) >= 100 ? 0 : 2) });
const pct = n => (n > 0 ? '+' : '') + n.toLocaleString('de-AT', { maximumFractionDigits: 1 }) + ' %';
const sgn = n => (n >= 0 ? '+' : '') + eur(n);
const cls = n => n > 0.005 ? 'pos' : n < -0.005 ? 'neg' : '';
const isoToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const deDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const num = id => { const el = $(id); if (!el) return null; const v = el.value.replace(/\s/g, '').replace(',', '.'); return v === '' ? null : +v; };
const val = id => ($(id)?.value || '').trim();
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.remove('show'), 2400); }
const uref = (...p) => doc(db, 'users', user.uid, ...p);
const ucol = (...p) => collection(db, 'users', user.uid, ...p);

// ---------- Marktpreise Uhren (market.json, halbjährlich aktualisiert) ----------
let market = null;
fetch('market.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { market = j; render(); }).catch(() => {});
function marketFor(x) {
  if (x.type !== 'watch' || !market?.watches) return null;
  const hay = (x.name || '') + ' ' + (x.detail || '');
  return market.watches.find(w => { try { return new RegExp(w.match, 'i').test(hay); } catch (e) { return false; } }) || null;
}

// ---------- Kursverlauf (prices.json, täglich per GitHub Action) ----------
let priceHist = null, kv = { m: 'gold', r: '1J' };
fetch('prices.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { priceHist = j; if (tab === 'charts') render(); }).catch(() => {});
const RANGES = { '1M': 31, '6M': 183, '1J': 366, '5J': 1827, 'Max': 99999 };

// ---------- Werte ----------
const metalPrice = m => cur(m === 'silver' ? 'silver' : 'gold');
function material(x) {
  if (x.type === 'gold') return (x.weight || 0) * (x.purity || 0) / 1000 * metalPrice('gold');
  if (x.type === 'coin') return (x.count || 1) * (x.weight || 0) * (x.purity || 0) / 1000 * metalPrice(x.metal);
  return null;
}
function value(x) {
  if (x.type === 'gold') return material(x);
  if (x.type === 'watch') return x.value ?? marketFor(x)?.avg ?? x.paid ?? null;
  const m = material(x), c = x.collector != null ? x.collector * (x.count || 1) : null;
  return c != null ? Math.max(c, m) : m;
}
function paid(x) {
  if (x.type === 'coin') return x.paid != null ? x.paid * (x.count || 1) : null;
  return x.paid ?? null;
}
function totals(list = items) {
  let p = 0, v = 0;
  list.forEach(x => { const vv = value(x), pp = paid(x); if (vv == null && pp == null) return; v += vv || 0; p += pp || 0; });
  return { paid: p, val: v, diff: v - p };
}

// ---------- Login ----------
const GICON = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function renderLogin(msg) {
  $('app').innerHTML = `<div class="login"><img src="logo.svg" alt=""><h1>THESAUROS</h1>
  <div class="status"><span class="dot"></span>SCHATZKAMMER · GESICHERT</div>
  <p>Goldschmuck, Uhren und Münzen – mit Live-Preisen für Gold und Silber.</p>
  <button class="gbtn" id="gl">${GICON}Mit Google anmelden</button>
  ${msg ? `<p class="neg">${esc(msg)}</p>` : ''}</div>`;
  $('gl').onclick = login;
}
async function login() {
  const prov = new GoogleAuthProvider();
  prov.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, prov); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      try { await signInWithRedirect(auth, prov); } catch (e2) { renderLogin('Anmeldung fehlgeschlagen: ' + e2.code); }
    } else if (e.code !== 'auth/popup-closed-by-user') renderLogin('Anmeldung fehlgeschlagen: ' + (e.code || e.message));
  }
}
getRedirectResult(auth).catch(e => renderLogin('Anmeldung fehlgeschlagen: ' + e.code));

onAuthStateChanged(auth, u => {
  unsubs.forEach(f => f()); unsubs = [];
  user = u; items = []; settings = null; history = []; itemsReady = false;
  if (!u) { stopLive(); renderLogin(); return; }
  render();
  unsubs.push(onSnapshot(ucol('items'), { includeMetadataChanges: true }, s => { if (!s.metadata.fromCache) itemsReady = true; items = s.docs.map(d => ({ id: d.id, ...d.data() })); items.sort((a, b) => (a.created || 0) - (b.created || 0)); render(); }, err));
  unsubs.push(onSnapshot(ucol('history'), s => { history = s.docs.map(d => ({ d: d.id, ...d.data() })).sort((a, b) => a.d < b.d ? -1 : 1); render(); }, err));
  unsubs.push(onSnapshot(uref('meta', 'settings'), { includeMetadataChanges: true }, async s => {
    settings = s.exists() ? s.data() : {};
    render();
    if (s.metadata.fromCache) return;          // erst entscheiden, wenn der Server geantwortet hat
    if (!settings.seeded) await seed();
    checkImport();
  }, err));
  startLive();
});
function err(e) { console.error(e); toast(e.code === 'permission-denied' ? 'Kein Zugriff – Firestore-Regeln prüfen' : 'Fehler: ' + (e.code || e.message)); }

async function seed() {
  if (seed._done) return; seed._done = true;
  const b = writeBatch(db), t = Date.now();
  const w = [
    ['Omega Constellation', 'Ref. 1302.30, Bicolor, Chronometer', 1450],
    ['Omega Genève Automatic', 'vergoldet, Vintage', 430],
    ['Omega x Swatch MoonSwatch', 'Mission to Moonphase', null],
    ['Sowjetische Uhr', 'Ikonen-Zifferblatt', null],
    ['Fossil GMT', 'Lünette rot/schwarz, Stahlband', null]
  ];
  w.forEach(([name, detail, p], i) => b.set(doc(ucol('items')), { type: 'watch', name, detail, paid: p, value: null, valueDate: '', created: t + i }));
  b.set(uref('meta', 'settings'), { seeded: true }, { merge: true });
  await b.commit().catch(err);
}

// ---------- Import vorbereiteter Daten (verschlüsselt, import.json) ----------
async function checkImport() {
  if (checkImport._done) return; checkImport._done = true;
  let pkg; try { const r = await fetch('import.json', { cache: 'no-store' }); if (!r.ok) return; pkg = await r.json(); } catch (e) { return; }
  if (!pkg?.id || (settings?.imports || []).includes(pkg.id)) return;
  openM(`<h2>Neue Daten bereit</h2>
   <div class="note" style="margin:0 0 12px">Claude hat <b>${esc(pkg.title || 'Daten')}</b> für dich vorbereitet. Gib das Passwort aus dem Chat ein, um sie in deine Schatzkammer zu übernehmen.</div>
   <div class="f"><label>Passwort</label><input id="ipw" autocomplete="off" autocapitalize="characters" placeholder="z. B. A1B2C3"></div>
   <div class="acts"><button class="cancel" data-a="close">Später</button><button class="ok" id="ido">Übernehmen</button></div>`);
  $('ido').onclick = async () => {
    const btn = $('ido'); btn.disabled = true; btn.textContent = 'Übernehme …';
    try { const data = await decryptPkg(pkg, val('ipw').toUpperCase()); await applyImport(data); closeM(); toast('Übernommen ✓'); }
    catch (e) { console.error(e); btn.disabled = false; btn.textContent = 'Übernehmen'; toast(e.name === 'OperationError' ? 'Falsches Passwort' : 'Fehler: ' + (e.code || e.message)); }
  };
}
async function decryptPkg(pkg, pw) {
  const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(pkg.salt), iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(pkg.iv) }, key, b(pkg.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function applyImport(data) {
  for (let i = 0; i < 50 && !itemsReady; i++) await new Promise(r => setTimeout(r, 200));
  if (!itemsReady) throw new Error('Daten noch nicht geladen – bitte nochmal versuchen');
  let t = Date.now();
  for (const w of data.items || []) {
    const re = new RegExp(w.match, 'i');
    const ex = items.find(x => x.type === 'watch' && re.test((x.name || '') + ' ' + (x.detail || '')));
    let photo = ex?.photo || null;
    if (w.photoData) { const r = await addDoc(ucol('photos'), { data: w.photoData, created: Date.now() }); photoCache.set(r.id, Promise.resolve(w.photoData)); if (ex?.photo) deleteDoc(uref('photos', ex.photo)).catch(() => {}); photo = r.id; }
    if (ex) await updateDoc(uref('items', ex.id), { ...w.set, photo });
    else await addDoc(ucol('items'), { type: 'watch', paid: null, value: null, valueDate: '', ...w.set, photo, created: t++ });
  }
  await setDoc(uref('meta', 'settings'), { imports: [...(settings?.imports || []), data.id] }, { merge: true });
}

// ---------- Live-Preise ----------
// gold-api.com liefert den Spotpreis in USD je Feinunze (laufend aktualisiert),
// frankfurter.app den EZB-Wechselkurs USD→EUR (einmal täglich).
let live = null, liveTimer = null, fx = null, liveErr = false;
const LIVE_MS = 60000, SAVE_MS = 30 * 60000;
function startLive() { stopLive(); fetchLive(); liveTimer = setInterval(() => { if (!document.hidden) fetchLive(); }, LIVE_MS); }
function stopLive() { if (liveTimer) clearInterval(liveTimer); liveTimer = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && user && (!live || Date.now() - live.at > LIVE_MS)) fetchLive(); });
async function fetchLive(manual) {
  if (fetchLive._busy) return; fetchLive._busy = true;
  try {
    const j = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    if (!fx || Date.now() - fx.at > 3600000) { const r = await j('https://api.frankfurter.app/latest?from=USD&to=EUR'); fx = { rate: r.rates.EUR, at: Date.now() }; }
    const [xau, xag] = await Promise.all([j('https://api.gold-api.com/price/XAU'), j('https://api.gold-api.com/price/XAG')]);
    if (!xau?.price || !xag?.price) throw new Error('Antwort unvollständig');
    const goldOz = xau.price * fx.rate, silverOz = xag.price * fx.rate;
    live = { goldOz, silverOz, gold: goldOz / OZ, silver: silverOz / OZ, at: Date.now(), src: xau.updatedAt || null };
    liveErr = false;
    paintLive();
    const today = isoToday();
    if (settings && (settings.date !== today || !settings.savedAt || Date.now() - settings.savedAt > SAVE_MS)) {
      await savePrices(+live.gold.toFixed(2), +live.silver.toFixed(3), true);
    }
    if (manual) toast('Preise aktualisiert');
  } catch (e) {
    console.warn('Preis-Abruf fehlgeschlagen', e); liveErr = true; paintLive();
    if (manual) toast('Live-Preise nicht erreichbar – bitte manuell eintragen');
  } finally { fetchLive._busy = false; }
}
async function savePrices(gold, silver, auto) {
  const d = isoToday();
  await setDoc(uref('meta', 'settings'), { gold, silver, date: d, auto: !!auto, savedAt: Date.now() }, { merge: true });
  await setDoc(uref('history', d), { gold, silver }, { merge: true });
}
function editPrices() {
  openM(`<h2>Preise eintragen</h2>
  <div class="two"><div class="f"><label>Gold 999 · € / g</label><input id="pg" inputmode="decimal" value="${(cur('gold') || '') && cur('gold').toFixed(2)}"></div>
  <div class="f"><label>Silber 999 · € / g</label><input id="ps" inputmode="decimal" value="${(cur('silver') || '') && cur('silver').toFixed(3)}"></div></div>
  <div class="note" style="margin:0 0 12px">Normalerweise kommen die Preise live. Wenn die Preisquelle einmal nicht erreichbar ist, kannst du sie hier selbst eintragen.</div>
  <div class="acts"><button class="cancel" data-a="close">Abbrechen</button><button class="ok" id="sp">Speichern</button></div>`);
  $('sp').onclick = async () => { const g = num('pg'), s = num('ps'); if (!g || !s) return toast('Bitte beide Preise eintragen'); live = null; closeM(); await savePrices(g, s, false).catch(err); toast('Gespeichert'); };
}
// aktueller Preis €/g: live, sonst zuletzt gespeichert
function cur(m) { return live ? live[m] : (settings?.[m] || 0); }
function prevClose(m) { const t = isoToday(); return [...history].reverse().find(x => x.d < t && x[m]) || null; }
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function paintLive() {
  const box = $('mk'); if (!box) return;
  box.innerHTML = marketsHTML();
  const r = $('rf'); if (r) r.onclick = () => fetchLive(true);
  const e = $('ep'); if (e) e.onclick = editPrices;
  const kb = $('kvb'); if (kb) kb.onclick = () => { tab = 'charts'; render(); setTimeout(() => $('c0')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const hv = $('heroVal'); if (hv) { const t = totals(); hv.textContent = eur(t.val); }
}
function marketsHTML() {
  const one = (m, name, cls2) => {
    const g = cur(m), ph = prevClose(m), pc = ph ? ph[m] : null, ch = g && pc ? (g - pc) / pc * 100 : null;
    const since = ph ? (ph.d === yesterday() ? 'seit gestern' : 'seit ' + deDate(ph.d).slice(0, 6)) : '';
    return `<div class="mk ${cls2}"><div class="nm">${name} · 999</div>
      <div class="pg">${g ? eur(g, 2) : '–'}<small>/ g</small></div>
      <div class="oz">${g ? eur(g * OZ, 0) : '–'} <small>/ Unze</small></div>
      <div class="ch ${ch == null ? 'mut' : cls(ch)}">${ch == null ? 'Verlauf startet heute' : (ch >= 0 ? '▲ ' : '▼ ') + pct(ch) + ' ' + since}</div></div>`;
  };
  const when = live ? 'Live · ' + new Date(live.at).toLocaleTimeString('de-AT') : settings?.date ? 'Stand ' + deDate(settings.date) + (settings.auto ? '' : ' · manuell') : 'Lade Preise …';
  return `<div class="mk-head"><span class="lbl">Märkte · Spotpreis</span><span class="live"><span class="dot ${live && !liveErr ? '' : 'off'}"></span>${live && !liveErr ? 'LIVE' : liveErr ? 'OFFLINE' : '…'}</span></div>
   <div class="markets">${one('gold', 'GOLD', 'g')}${one('silver', 'SILBER', 's')}</div>
   <div class="mk-foot"><small>${when}</small><div style="display:flex;gap:8px"><button class="btn" id="kvb">Verlauf</button><button class="btn" id="rf">Aktualisieren</button><button class="btn" id="ep">Manuell</button></div></div>`;
}

// ---------- Fotos ----------
function loadPhoto(id) {
  if (!id) return Promise.resolve(null);
  if (photoCache.has(id)) return photoCache.get(id);
  const p = getDoc(uref('photos', id)).then(s => s.exists() ? s.data().data : null).catch(() => null);
  photoCache.set(id, p); return p;
}
function hydratePhotos(root = document) {
  root.querySelectorAll('img[data-photo]').forEach(img => {
    const id = img.dataset.photo; if (!id) return;
    loadPhoto(id).then(src => { if (src) img.src = src; });
  });
}
function shrink(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const m = 800, s = Math.min(1, m / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      let q = 0.75, d = c.toDataURL('image/jpeg', q);
      while (d.length > 600000 && q > 0.35) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
      res(d);
    };
    img.onerror = () => rej(new Error('Bild nicht lesbar'));
    img.src = u;
  });
}
function photoField(key, label, x) {
  const id = x?.[key];
  return `<div class="phbox"><span class="mut" style="font-size:12px">${label}</span>
   <img id="pv-${key}" ${id ? `data-photo="${id}"` : ''} alt="" style="${id ? '' : 'display:none'}">
   <label class="phbtn">${id ? 'Ändern' : 'Foto wählen'}<input type="file" accept="image/*" data-pk="${key}"></label>
   <button type="button" class="lnk" id="rm-${key}" data-rm="${key}" style="${id ? '' : 'display:none'}">Entfernen</button></div>`;
}
function wirePhotoInputs() {
  document.querySelectorAll('input[data-pk]').forEach(inp => inp.onchange = async () => {
    const k = inp.dataset.pk, f = inp.files?.[0]; if (!f) return;
    try { const d = await shrink(f); pend[k] = d; rm[k] = false; const pv = $('pv-' + k); pv.removeAttribute('data-photo'); pv.src = d; pv.style.display = ''; $('rm-' + k).style.display = ''; }
    catch (e) { toast(e.message); }
  });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const k = b.dataset.rm; pend[k] = null; rm[k] = true; const pv = $('pv-' + k); pv.style.display = 'none'; pv.removeAttribute('src'); b.style.display = 'none';
  });
}

// ---------- Ansicht ----------
function ringSVG(parts, total) {
  const R = 100, cx = 125, cy = 125, C2 = 2 * Math.PI * R, gap = 6;
  let off = 0, segs = '';
  const used = parts.filter(p => p.v > 0);
  if (total > 0) used.forEach(p => {
    const len = Math.max(0, p.v / total * C2 - (used.length > 1 ? gap : 0));
    segs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C[p.k]}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${len} ${C2}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})" style="filter:drop-shadow(0 0 6px ${C[p.k]}88)"/>`;
    off += p.v / total * C2;
  });
  else segs = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(79,214,255,.18)" stroke-width="7"/>`;
  let ticks = '';
  for (let i = 0; i < 72; i++) { const a = i * 5 * Math.PI / 180, l = i % 6 === 0 ? 7 : 3, r1 = 117, r2 = r1 + l; ticks += `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}"/>`; }
  return `<svg viewBox="0 0 250 250" aria-hidden="true">
   <g class="spin" stroke="#4fd6ff" stroke-opacity=".45" stroke-width="1">${ticks}</g>
   <g class="spin2"><circle cx="${cx}" cy="${cy}" r="88" fill="none" stroke="#4fd6ff" stroke-opacity=".25" stroke-width="1" stroke-dasharray="2 6"/>
    <path d="M ${cx - 88} ${cy} A 88 88 0 0 1 ${cx - 62} ${cy - 62}" fill="none" stroke="#4fd6ff" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M ${cx + 88} ${cy} A 88 88 0 0 1 ${cx + 62} ${cy + 62}" fill="none" stroke="#4fd6ff" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round"/></g>
   <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="7"/>
   ${segs}</svg>`;
}
function render() {
  if (!user) return;
  const t = totals();
  const list = items.filter(x => x.type === tab);
  const counts = { gold: 0, watch: 0, coin: 0 }; items.forEach(x => counts[x.type] = (counts[x.type] || 0) + 1);
  const parts = ['gold', 'watch', 'coin'].map(k => ({ k, v: items.filter(x => x.type === k).reduce((a, x) => a + (value(x) || 0), 0) }));
  let body;
  if (tab === 'charts') body = '<div id="charts"></div>';
  else if (!list.length) body = `<div class="empty">${{ gold: 'Noch kein Goldschmuck erfasst.', watch: 'Noch keine Uhren erfasst.', coin: 'Noch keine Münzen erfasst.' }[tab]}<br>Tippe unten auf „+ Hinzufügen“.</div>`;
  else body = '<div class="grid">' + list.map(tileHTML).join('') + '</div>';
  const scrollY = window.scrollY;
  $('app').innerHTML = `<div class="wrap">
  <div class="top"><div class="brand"><img src="logo.svg" alt=""><div><h1>THESAUROS</h1><div class="status"><span class="dot"></span><span id="clk">SYSTEM ONLINE</span></div></div></div>
   <img class="avatar" id="av" src="${esc(user.photoURL || 'logo.svg')}" alt="Konto" referrerpolicy="no-referrer"></div>
  <div class="menu" id="menu"><div>${esc(user.email || '')}</div><button id="lo">Abmelden</button></div>
  <div class="panel hud hero">
   <span class="lbl">Gesamtwert</span>
   <div class="ring">${ringSVG(parts, t.val)}<div class="center"><span class="val" id="heroVal">${eur(t.val)}</span>
     <span class="gain ${cls(t.diff)}">${sgn(t.diff)}${t.paid ? ' · ' + pct(t.diff / t.paid * 100) : ''}</span>
     <span class="lbl" style="margin-top:6px">${items.length} Objekte</span></div></div>
   <div class="legend3">${parts.map(p => `<span><i style="background:${C[p.k]}"></i>${TYPES[p.k]}</span>`).join('')}</div>
   <div class="stats"><div class="stat"><span class="lbl">Bezahlt</span><b>${eur(t.paid)}</b></div>
    <div class="stat"><span class="lbl">Gewinn</span><b class="${cls(t.diff)}">${sgn(t.diff)}</b></div>
    <div class="stat"><span class="lbl">Rendite</span><b class="${cls(t.diff)}">${t.paid ? pct(t.diff / t.paid * 100) : '–'}</b></div></div>
  </div>
  <div class="panel hud" id="mk">${marketsHTML()}</div>
  <div class="tabs">${['gold', 'watch', 'coin'].map(k => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${TYPES[k]} · ${counts[k] || 0}</button>`).join('')}<button class="${tab === 'charts' ? 'on' : ''}" data-tab="charts">Analyse</button></div>
  ${body}
  <div class="note">Goldwert = Gewicht × Feingehalt × Spotpreis (reiner Materialwert); Händler zahlen beim Ankauf meist 5–15 % weniger. Münzen zählen mit dem höheren Wert aus Material- und Sammlerwert. Uhren- und Sammlerwerte sind deine eigenen Schätzungen. Preise: gold-api.com, Wechselkurs EZB via frankfurter.app.</div>
  </div>
  ${tab === 'charts' ? '' : '<button class="fab" id="add">+ Hinzufügen</button>'}`;
  window.scrollTo(0, scrollY);
  $('av').onclick = e => { e.stopPropagation(); $('menu').classList.toggle('open'); };
  $('lo').onclick = () => signOut(auth);
  paintLive();
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  document.querySelectorAll('[data-item]').forEach(el => el.onclick = () => editItem(el.dataset.item));
  if ($('add')) $('add').onclick = () => editItem(null);
  if (tab === 'charts') drawCharts();
  hydratePhotos();
}
document.addEventListener('click', () => $('menu')?.classList.remove('open'));
setInterval(() => { const c = $('clk'); if (c) c.textContent = 'SYSTEM ONLINE · ' + new Date().toLocaleTimeString('de-AT'); }, 1000);

function tileHTML(x) {
  const v = value(x), p = paid(x), d = (v != null && p != null) ? v - p : null, mk = marketFor(x);
  let sub;
  if (x.type === 'gold') sub = `${x.weight} g · ${x.purity}er`;
  else if (x.type === 'watch') sub = esc(x.detail || '');
  else sub = `${(x.count || 1) > 1 ? x.count + '× · ' : ''}${x.metal === 'silver' ? 'Silber' : 'Gold'} ${x.purity} · ${x.weight} g`;
  let pill;
  if (d != null && p) pill = `<span class="pill ${cls(d)}">${d >= 0 ? '▲' : '▼'} ${sgn(d)} · ${pct(d / p * 100)}</span>`;
  else pill = `<span class="pill">${x.type === 'watch' && x.paid == null ? 'Kaufpreis eintragen' : 'Kaufpreis fehlt'}</span>`;
  const tag = { gold: 'GOLD', watch: 'UHR', coin: x.metal === 'silver' ? 'SILBER' : 'GOLDMÜNZE' }[x.type];
  const media = x.photo ? `<img class="ph" data-photo="${x.photo}" alt="">` : `<div class="noph" style="--acc:${C[x.type]}">${esc((x.name || '?').trim()[0] || '?')}</div>`;
  return `<div class="tile" data-item="${x.id}">${media}<span class="tag">${tag}</span>${mk && x.value == null ? '<span class="mkt">MARKT</span>' : ''}
   <div class="bd"><div class="n">${esc(x.name)}</div><div class="d">${sub}</div><div class="v">${eur(v)}</div>${pill}</div></div>`;
}
function rowHTML(x) {
  const v = value(x), p = paid(x), d = (v != null && p != null) ? v - p : null;
  let sub, extra = '';
  if (x.type === 'gold') sub = `${x.weight} g · ${x.purity}er${x.date ? ' · ' + esc(x.date) : ''}`;
  else if (x.type === 'watch') {
    sub = `${esc(x.detail)}${x.valueDate && x.value != null ? ' · Schätzung vom ' + deDate(x.valueDate) : ''}`;
    const mk = marketFor(x);
    if (mk) extra = `<div class="dual">MARKT Ø ${eur(mk.avg)} · ${eur(mk.min)}–${eur(mk.max)} · ${mk.points?.length || 0} QUELLEN${x.value != null ? ' · DEINE SCHÄTZUNG ZÄHLT' : ''}</div>`;
  }
  else {
    sub = `${(x.count || 1) > 1 ? x.count + '× · ' : ''}${x.metal === 'silver' ? 'Silber' : 'Gold'} ${x.purity} · ${x.weight} g${x.origin ? ' · ' + esc(x.origin) : ''}`;
    extra = `<div class="dual">MATERIAL ${eur(material(x))}${x.collector != null ? ' · SAMMLER ' + eur(x.collector * (x.count || 1)) : ''}</div>`;
  }
  let st;
  if (d != null && p) st = `<span class="${cls(d)}">${sgn(d)} · ${pct(d / p * 100)}</span>`;
  else if (x.type === 'watch' && x.paid == null) st = '<span class="mut">Preis eintragen</span>';
  else if (x.type === 'watch' && x.value == null && !marketFor(x)) st = '<span class="mut">Schätzwert fehlt</span>';
  else st = '<span class="mut">Kaufpreis fehlt</span>';
  return `<div class="item" data-item="${x.id}" style="--acc:${C[x.type]}"><div class="lft">${x.photo ? `<img class="th" data-photo="${x.photo}" alt="">` : ''}<div><div class="n">${esc(x.name)}</div><div class="d">${sub}</div>${extra}</div></div>
   <div class="v"><b>${eur(v)}</b>${st}</div></div>`;
}

// ---------- Formular ----------
function openM(html) { $('sh').innerHTML = html; $('m').classList.add('open'); $('sh').querySelectorAll('[data-a=close]').forEach(b => b.onclick = closeM); hydratePhotos($('sh')); }
function closeM() { $('m').classList.remove('open'); pend = {}; rm = {}; editing = null; }
$('m').onclick = e => { if (e.target.id === 'm') closeM(); };
const opt = (arr, cur, lab) => arr.map(v => `<option value="${v}" ${+cur === v ? 'selected' : ''}>${lab ? lab(v) : v}</option>`).join('');
const karat = { 333: '8 Kt', 375: '9 Kt', 585: '14 Kt', 750: '18 Kt', 916: '22 Kt', 999: '24 Kt' };

function editItem(id) {
  const x = id ? items.find(i => i.id === id) : null;
  const type = x?.type || tab; pend = {}; rm = {}; editing = { type, id };
  let f = '';
  if (type === 'gold') f = `
    <div class="f"><label>Bezeichnung</label><input id="nm" value="${esc(x?.name)}" placeholder="z. B. Goldkette Panzer"></div>
    <div class="two"><div class="f"><label>Gewicht (g)</label><input id="wt" inputmode="decimal" value="${x?.weight ?? ''}"></div>
    <div class="f"><label>Feingehalt (Stempel)</label><select id="pu">${opt(PUR_JEWEL, x?.purity ?? 585, v => `${v} (${karat[v]})`)}</select></div></div>
    <div class="two"><div class="f"><label>Kaufpreis (€)</label><input id="pd" inputmode="decimal" value="${x?.paid ?? ''}"></div>
    <div class="f"><label>Kaufdatum</label><input id="dt" value="${esc(x?.date)}" placeholder="z. B. 03/2024"></div></div>
    <div class="f"><label>Foto</label><div class="phrow">${photoField('photo', '', x)}</div></div>`;
  else if (type === 'watch') f = `
    <div class="f"><label>Modell</label><input id="nm" value="${esc(x?.name)}" placeholder="z. B. Omega Seamaster"></div>
    <div class="f"><label>Details</label><input id="de" value="${esc(x?.detail)}" placeholder="Referenz, Material …"></div>
    <div class="two"><div class="f"><label>Kaufpreis (€)</label><input id="pd" inputmode="decimal" value="${x?.paid ?? ''}"></div>
    <div class="f"><label>Eigene Schätzung (€)</label><input id="vl" inputmode="decimal" value="${x?.value ?? ''}" placeholder="${x && marketFor(x) ? 'leer = Marktpreis' : 'optional'}"></div></div>
    ${x && marketFor(x) ? (() => { const mk = marketFor(x); return `<div class="note" style="margin:-4px 0 12px">Marktpreis Ø ${eur(mk.avg)} (Spanne ${eur(mk.min)}–${eur(mk.max)}), Stand ${deDate(market.updated)}:<br>${mk.points.map(p => `· ${esc(p.kind)}: ${eur(p.eur)} – <a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:var(--cyan2)">${esc(p.src)}</a>`).join('<br>')}<br>Lass das Feld leer, damit automatisch der Marktpreis zählt.</div>`; })() : ''}
    <div class="f"><label>Foto</label><div class="phrow">${photoField('photo', '', x)}</div></div>`;
  else f = `
    <div class="f"><label>Münze</label><input id="nm" value="${esc(x?.name)}" placeholder="z. B. Wiener Philharmoniker 1 oz"></div>
    <div class="two"><div class="f"><label>Jahr / Land</label><input id="og" value="${esc(x?.origin)}" placeholder="z. B. 2015, Österreich"></div>
    <div class="f"><label>Anzahl</label><input id="ct" inputmode="numeric" value="${x?.count ?? 1}"></div></div>
    <div class="two"><div class="f"><label>Metall</label><select id="mt"><option value="silver" ${x?.metal !== 'gold' ? 'selected' : ''}>Silber</option><option value="gold" ${x?.metal === 'gold' ? 'selected' : ''}>Gold</option></select></div>
    <div class="f"><label>Feingehalt</label><select id="pu">${opt(PUR_COIN, x?.purity ?? 999)}</select></div></div>
    <div class="f"><label>Gewicht pro Stück (g) – 1 Unze = 31,1 g</label><input id="wt" inputmode="decimal" value="${x?.weight ?? ''}"></div>
    <div class="two"><div class="f"><label>Kaufpreis pro Stück (€)</label><input id="pd" inputmode="decimal" value="${x?.paid ?? ''}"></div>
    <div class="f"><label>Sammlerwert pro Stück (€)</label><input id="cv" inputmode="decimal" value="${x?.collector ?? ''}" placeholder="optional"></div></div>
    <div class="f"><label>Fotos</label><div class="phrow">${photoField('photo', 'Vorderseite', x)}${photoField('photo2', 'Rückseite', x)}</div></div>`;
  const title = { gold: x ? 'Schmuckstück bearbeiten' : 'Goldschmuck hinzufügen', watch: x ? 'Uhr bearbeiten' : 'Uhr hinzufügen', coin: x ? 'Münze bearbeiten' : 'Münze hinzufügen' }[type];
  openM(`<h2>${title}</h2>${f}
   <div class="acts">${x ? '<button class="del" id="dl">Löschen</button>' : ''}<button class="cancel" data-a="close">Abbrechen</button><button class="ok" id="sv">Speichern</button></div>`);
  wirePhotoInputs();
  $('sv').onclick = saveItem;
  if ($('dl')) $('dl').onclick = () => delItem(x);
}

async function saveItem() {
  const { type, id } = editing; const x = id ? items.find(i => i.id === id) : null;
  const name = val('nm'); if (!name) return toast('Bitte einen Namen eintragen');
  let o;
  if (type === 'gold') { const w = num('wt'); if (!w || w <= 0) return toast('Bitte das Gewicht eintragen'); o = { type, name, weight: w, purity: +val('pu'), paid: num('pd'), date: val('dt') }; }
  else if (type === 'watch') { const v = num('vl'); o = { type, name, detail: val('de'), paid: num('pd'), value: v, valueDate: (v != null && v !== x?.value) ? isoToday() : (x?.valueDate || '') }; }
  else { const w = num('wt'); if (!w || w <= 0) return toast('Bitte das Gewicht eintragen'); o = { type, name, origin: val('og'), count: Math.max(1, Math.round(num('ct') || 1)), metal: val('mt'), purity: +val('pu'), weight: w, paid: num('pd'), collector: num('cv') }; }
  const btn = $('sv'); btn.disabled = true; btn.textContent = 'Speichere …';
  try {
    for (const k of ['photo', 'photo2']) {
      const old = x?.[k] || null; o[k] = old;
      if (pend[k]) { const r = await addDoc(ucol('photos'), { data: pend[k], created: Date.now() }); photoCache.set(r.id, Promise.resolve(pend[k])); o[k] = r.id; if (old) deleteDoc(uref('photos', old)).catch(() => {}); }
      else if (rm[k]) { o[k] = null; if (old) deleteDoc(uref('photos', old)).catch(() => {}); }
    }
    if (type !== 'coin') delete o.photo2;
    if (x) await updateDoc(uref('items', x.id), o);
    else await addDoc(ucol('items'), { ...o, created: Date.now() });
    closeM(); toast('Gespeichert');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Speichern'; }
}
async function delItem(x) {
  if (!$('dl').dataset.sure) { $('dl').dataset.sure = 1; $('dl').textContent = 'Wirklich?'; return; }
  try {
    for (const k of ['photo', 'photo2']) if (x[k]) deleteDoc(uref('photos', x[k])).catch(() => {});
    await deleteDoc(uref('items', x.id)); closeM(); toast('Gelöscht');
  } catch (e) { err(e); }
}

// ---------- Diagramme ----------
function tipAt(card, ev, html) {
  const t = card.querySelector('.tip'), b = card.getBoundingClientRect();
  t.innerHTML = html; t.style.opacity = 1;
  let x = ev.clientX - b.left + 12, y = ev.clientY - b.top - 10; const w = t.offsetWidth;
  if (x + w > b.width - 6) x = ev.clientX - b.left - w - 12;
  t.style.left = Math.max(6, x) + 'px'; t.style.top = Math.max(6, y) + 'px';
}
const hideTip = card => { card.querySelector('.tip').style.opacity = 0; };
const txt = (x, y, s, o = '') => `<text x="${x}" y="${y}" fill="#8796a6" font-size="11" font-family="Inter,sans-serif" ${o}>${s}</text>`;

function drawCharts() {
  const box = $('charts'); if (!box) return;
  const W = Math.max(260, box.clientWidth - 30);
  const R = items.map(x => ({ x, v: value(x), p: paid(x) })).filter(r => r.v != null || r.p != null);
  // 1) Kaufpreis vs Wert
  let h1 = '<div class="card" id="c1"><h3>Kaufpreis vs. Wert heute</h3><div class="cs">Pro Stück, in Euro</div>';
  if (!R.length) h1 += '<div class="empty">Noch keine Stücke mit Preis.</div>';
  else {
    h1 += `<div class="legend"><span><i style="background:${C.paid}"></i>Bezahlt</span><span><i style="background:${C.val}"></i>Wert heute</span></div>`;
    const max = Math.max(...R.map(r => Math.max(r.p || 0, r.v || 0)), 1), rowH = 42, H = R.length * rowH;
    const sc = v => Math.max(4, v / max * (W - 64));
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kaufpreis und Wert pro Stück">`;
    R.forEach((r, i) => {
      const y = i * rowH, n = r.x.name.length > 36 ? r.x.name.slice(0, 35) + '…' : r.x.name;
      s += `<text x="0" y="${y + 12}" fill="#e9f1f7" font-size="12" font-family="Inter,sans-serif">${esc(n)}</text>`;
      if (r.p) s += `<rect x="0" y="${y + 18}" width="${sc(r.p)}" height="8" rx="4" fill="${C.paid}"/>`;
      if (r.v) s += `<rect x="0" y="${y + 28}" width="${sc(r.v)}" height="8" rx="4" fill="${C.val}"/>` + txt(sc(r.v) + 6, y + 36, eur(r.v));
      s += `<rect class="hit" data-i="${i}" x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`;
    });
    h1 += s + '</svg>';
  }
  h1 += '<div class="tip"></div></div>';
  // 2) Aufteilung
  const part = ['gold', 'watch', 'coin'].map(k => ({ k, v: items.filter(x => x.type === k).reduce((a, x) => a + (value(x) || 0), 0) }));
  const tv = part.reduce((a, p) => a + p.v, 0);
  let h2 = '<div class="card"><h3>Aufteilung des Werts</h3><div class="cs">Gold, Uhren und Münzen</div>';
  if (tv <= 0) h2 += '<div class="empty">Noch keine Werte.</div>';
  else h2 += `<div class="split">${part.filter(p => p.v > 0).map(p => `<div style="flex:${p.v};background:${C[p.k]}"></div>`).join('')}</div>
    <div class="legend" style="margin:0">${part.map(p => `<span><i style="background:${C[p.k]}"></i>${TYPES[p.k]} · ${eur(p.v)} · ${Math.round(p.v / tv * 100)} %</span>`).join('')}</div>`;
  h2 += '</div>';
  // 3) Verlauf Metallwert
  const fineG = items.filter(x => x.type === 'gold').reduce((a, x) => a + x.weight * x.purity / 1000, 0) + items.filter(x => x.type === 'coin' && x.metal === 'gold').reduce((a, x) => a + (x.count || 1) * x.weight * x.purity / 1000, 0);
  const fineS = items.filter(x => x.type === 'coin' && x.metal === 'silver').reduce((a, x) => a + (x.count || 1) * x.weight * x.purity / 1000, 0);
  const P = history.filter(h => h.gold).map(h => ({ d: h.d, g: h.gold, s: h.silver || 0, v: fineG * h.gold + fineS * (h.silver || 0) }));
  let h3 = '<div class="card" id="c3"><h3>Metallwert im Verlauf</h3><div class="cs">Gold und Silber deiner Stücke zum jeweiligen Tagespreis</div>';
  if (!(fineG + fineS)) h3 += '<div class="empty">Trag zuerst Goldschmuck oder Münzen ein.</div>';
  else if (P.length < 2) h3 += `<div class="empty">Der Verlauf entsteht automatisch: Jeden Tag, an dem du die App öffnest, kommt ein Punkt dazu.<br><span class="mut">Bisher ${P.length} Messpunkt${P.length === 1 ? '' : 'e'}.</span></div>`;
  else {
    const H = 180, pl = 4, pr = 4, pt = 18, pb = 22;
    let mn = Math.min(...P.map(p => p.v)), mx = Math.max(...P.map(p => p.v)); const pad = (mx - mn) * 0.15 || mx * 0.05; mn -= pad; mx += pad;
    const t0 = new Date(P[0].d).getTime(), t1 = new Date(P[P.length - 1].d).getTime() || t0 + 1;
    const X = i => pl + ((new Date(P[i].d).getTime() - t0) / ((t1 - t0) || 1)) * (W - pl - pr), Y = v => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
    const sd = iso => { const [, m, d] = iso.split('-'); return d + '.' + m + '.'; };
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Metallwert im Verlauf">`;
    [0, 0.5, 1].forEach(f => { const yy = pt + f * (H - pt - pb); s += `<line x1="0" x2="${W}" y1="${yy}" y2="${yy}" stroke="rgba(79,214,255,.12)"/>`; if (f !== 0.5) s += txt(W, yy - 4, eur(mx - f * (mx - mn)), 'text-anchor="end" font-size="10"'); });
    s += `<path d="${P.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ')}" fill="none" stroke="${C.val}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<line id="xh" y1="${pt}" y2="${H - pb}" stroke="#8796a6" opacity="0"/>`;
    [0, P.length - 1].forEach(i => s += `<circle cx="${X(i)}" cy="${Y(P[i].v)}" r="4" fill="${C.val}" stroke="#070b11" stroke-width="2"/>`);
    s += `<circle id="hd" r="5" fill="${C.val}" stroke="#070b11" stroke-width="2" opacity="0"/>`;
    s += txt(0, H - 6, sd(P[0].d)) + txt(W, H - 6, sd(P[P.length - 1].d), 'text-anchor="end"');
    s += `<rect id="hz" width="${W}" height="${H}" fill="transparent"/></svg>`;
    const d = P[P.length - 1].v - P[0].v;
    h3 += s + `<div class="cs" style="margin:6px 0 0">Seit ${deDate(P[0].d)}: <span class="${cls(d)}">${sgn(d)} (${pct(d / P[0].v * 100)})</span></div>`;
    drawCharts._line = { P, X, Y };
  }
  h3 += '<div class="tip"></div></div>';
  // 4) Uhren am Markt
  const WM = items.filter(x => x.type === 'watch').map(x => ({ x, mk: marketFor(x) })).filter(r => r.mk);
  let h4 = '<div class="card" id="c4"><h3>Uhren am Markt</h3><div class="cs">Spanne der Online-Preise, Durchschnitt und dein Kaufpreis' + (market?.updated ? ' · Stand ' + deDate(market.updated) : '') + '</div>';
  if (!WM.length) h4 += '<div class="empty">Für deine Uhren liegen noch keine Marktpreise vor.</div>';
  else {
    h4 += `<div class="legend"><span><i style="background:rgba(79,214,255,.35)"></i>Spanne</span><span><i style="background:${C.val}"></i>Markt Ø</span><span><i style="background:${C.paid}"></i>Dein Kaufpreis</span></div>`;
    const hi = Math.max(...WM.map(r => Math.max(r.mk.max, r.x.paid || 0))) * 1.08, rowH = 58, H = WM.length * rowH;
    const sx = v => 4 + v / hi * (W - 8);
    let s4 = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Marktpreise der Uhren">`;
    WM.forEach((r, i) => {
      const y = i * rowH, cy = y + 42;
      s4 += `<text x="0" y="${y + 12}" fill="#e9f1f7" font-size="12" font-family="Inter,sans-serif">${esc(r.x.name)}</text>`;
      s4 += `<rect x="${sx(r.mk.min)}" y="${cy - 5}" width="${Math.max(4, sx(r.mk.max) - sx(r.mk.min))}" height="10" rx="5" fill="rgba(79,214,255,.22)" stroke="rgba(79,214,255,.5)"/>`;
      if (r.x.paid) s4 += `<line x1="${sx(r.x.paid)}" x2="${sx(r.x.paid)}" y1="${cy - 10}" y2="${cy + 10}" stroke="${C.paid}" stroke-width="3" stroke-linecap="round"/>`;
      s4 += `<circle cx="${sx(r.mk.avg)}" cy="${cy}" r="6" fill="${C.val}" stroke="#070b11" stroke-width="2"/>`;
      s4 += `<text x="${Math.min(W - 30, Math.max(30, sx(r.mk.avg)))}" y="${cy - 11}" text-anchor="middle" fill="#ffe2a3" font-size="11" font-weight="600" font-family="Inter,sans-serif">Ø ${eur(r.mk.avg)}</text>`;
      s4 += `<rect class="hit4" data-i="${i}" x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`;
    });
    h4 += s4 + '</svg>';
  }
  h4 += '<div class="tip"></div></div>';
  box.innerHTML = kursCard(W) + h1 + h4 + h2 + h3;
  wireKurs();
  const c4 = $('c4');
  if (c4) c4.querySelectorAll('.hit4').forEach(el => {
    const r = WM[+el.dataset.i];
    const show = ev => { const d = r.x.paid ? r.mk.avg - r.x.paid : null; tipAt(c4, ev, `<b>${esc(r.mk.label)}</b><br>Markt Ø ${eur(r.mk.avg)} · ${eur(r.mk.min)}–${eur(r.mk.max)}<br>Dein Kaufpreis: ${eur(r.x.paid)}${d != null ? `<br><span class="${cls(d)}">${sgn(d)} zum Markt Ø</span>` : ''}`); };
    el.addEventListener('pointermove', show); el.addEventListener('pointerdown', show); el.addEventListener('pointerleave', () => hideTip(c4));
  });

  const c1 = $('c1');
  c1.querySelectorAll('.hit').forEach(el => {
    const r = R[+el.dataset.i];
    const show = ev => { const d = r.p != null && r.v != null ? r.v - r.p : null; tipAt(c1, ev, `<b>${esc(r.x.name)}</b><br>Bezahlt: ${eur(r.p)}<br>Wert: ${eur(r.v)}${d != null ? `<br><span class="${cls(d)}">${sgn(d)}</span>` : ''}`); };
    el.addEventListener('pointermove', show); el.addEventListener('pointerdown', show); el.addEventListener('pointerleave', () => hideTip(c1));
  });
  const hz = $('hz'), c3 = $('c3');
  if (hz) {
    const { P, X, Y } = drawCharts._line;
    const mv = ev => {
      const b = hz.getBoundingClientRect(), x = ev.clientX - b.left; let bi = 0, bd = 1e9;
      P.forEach((p, i) => { const dd = Math.abs(X(i) - x); if (dd < bd) { bd = dd; bi = i; } });
      $('xh').setAttribute('x1', X(bi)); $('xh').setAttribute('x2', X(bi)); $('xh').setAttribute('opacity', 1);
      $('hd').setAttribute('cx', X(bi)); $('hd').setAttribute('cy', Y(P[bi].v)); $('hd').setAttribute('opacity', 1);
      tipAt(c3, ev, `<b>${deDate(P[bi].d)}</b><br>Metallwert: ${eur(P[bi].v)}<br><span class="mut">Gold ${eur(P[bi].g, 2)}/g · Silber ${eur(P[bi].s, 2)}/g</span>`);
    };
    hz.addEventListener('pointermove', mv); hz.addEventListener('pointerdown', mv);
    hz.addEventListener('pointerleave', () => { hideTip(c3); $('xh').setAttribute('opacity', 0); $('hd').setAttribute('opacity', 0); });
  }
}
function kursData() {
  if (!priceHist?.days?.length) return [];
  const idx = kv.m === 'gold' ? 1 : 2, cut = new Date(Date.now() - RANGES[kv.r] * 864e5).toISOString().slice(0, 10);
  const P = priceHist.days.filter(d => d[0] >= cut).map(d => ({ d: d[0], v: d[idx] }));
  const lv = cur(kv.m); if (lv && live) { const t = isoToday(); if (P.length && P[P.length - 1].d === t) P[P.length - 1].v = lv; else P.push({ d: t, v: lv }); }
  return P;
}
function kursCard(W) {
  const btn = (k, l, on) => `<button class="btn" data-${k}="${l}" style="${on ? 'background:rgba(79,214,255,.18);color:#fff' : ''}">${l}</button>`;
  let h = `<div class="card" id="c0"><h3>Kursverlauf ${kv.m === 'gold' ? 'Gold' : 'Silber'} 999</h3><div class="cs">Euro pro Gramm${priceHist?.updated ? ' · Verlauf vom ' + deDate(priceHist.updated.slice(0, 10)) + ', heute live' : ''}</div>
   <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px"><div style="display:flex;gap:6px">${btn('km', 'Gold', kv.m === 'gold')}${btn('km', 'Silber', kv.m === 'silver')}</div>
   <div style="display:flex;gap:6px">${Object.keys(RANGES).map(r => btn('kr', r, kv.r === r)).join('')}</div></div>`;
  const P = kursData();
  if (P.length < 2) { h += `<div class="empty">${priceHist ? 'Für diesen Zeitraum gibt es noch keine Daten.' : 'Der Kursverlauf wird gerade erstellt und ist in wenigen Minuten da.'}</div><div class="tip"></div></div>`; return h; }
  const H = 200, pt = 18, pb = 22, col = kv.m === 'gold' ? '#e8b44c' : '#c9d3dd';
  let mn = Math.min(...P.map(p => p.v)), mx = Math.max(...P.map(p => p.v)); const pad = (mx - mn) * 0.1 || mx * 0.02; mn -= pad; mx += pad;
  const X = i => 2 + i / (P.length - 1) * (W - 4), Y = v => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
  const line = P.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  const dec = kv.m === 'gold' ? 2 : 2;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kursverlauf"><defs><linearGradient id="kg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
  [0, 0.5, 1].forEach(f => { const yy = pt + f * (H - pt - pb); s += `<line x1="0" x2="${W}" y1="${yy}" y2="${yy}" stroke="rgba(79,214,255,.12)"/>` + txt(W, yy - 4, eur(mx - f * (mx - mn), dec), 'text-anchor="end" font-size="10"'); });
  s += `<path d="${line} L ${X(P.length - 1)} ${H - pb} L ${X(0)} ${H - pb} Z" fill="url(#kg)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
  s += `<circle cx="${X(P.length - 1)}" cy="${Y(P[P.length - 1].v)}" r="4" fill="${col}" stroke="#070b11" stroke-width="2"/>`;
  s += `<line id="kxh" y1="${pt}" y2="${H - pb}" stroke="#8796a6" opacity="0"/><circle id="khd" r="5" fill="${col}" stroke="#070b11" stroke-width="2" opacity="0"/>`;
  s += txt(0, H - 6, deDate(P[0].d)) + txt(W, H - 6, deDate(P[P.length - 1].d), 'text-anchor="end"') + `<rect id="khz" width="${W}" height="${H}" fill="transparent"/></svg>`;
  const d = P[P.length - 1].v - P[0].v;
  h += s + `<div class="cs" style="margin:6px 0 0">Im Zeitraum: <span class="${cls(d)}">${d >= 0 ? '+' : ''}${eur(d, 2)} / g (${pct(d / P[0].v * 100)})</span> · Unze heute ${eur(P[P.length - 1].v * OZ, 0)}</div><div class="tip"></div></div>`;
  drawCharts._kurs = { P, X, Y };
  return h;
}
function wireKurs() {
  document.querySelectorAll('[data-km]').forEach(b => b.onclick = () => { kv.m = b.dataset.km === 'Gold' ? 'gold' : 'silver'; drawCharts(); });
  document.querySelectorAll('[data-kr]').forEach(b => b.onclick = () => { kv.r = b.dataset.kr; drawCharts(); });
  const hz = $('khz'), c0 = $('c0'); if (!hz) return;
  const { P, X, Y } = drawCharts._kurs;
  const mv = ev => { const b = hz.getBoundingClientRect(), x = ev.clientX - b.left; const i = Math.max(0, Math.min(P.length - 1, Math.round((x - 2) / (b.width - 4) * (P.length - 1))));
    $('kxh').setAttribute('x1', X(i)); $('kxh').setAttribute('x2', X(i)); $('kxh').setAttribute('opacity', 1); $('khd').setAttribute('cx', X(i)); $('khd').setAttribute('cy', Y(P[i].v)); $('khd').setAttribute('opacity', 1);
    tipAt(c0, ev, `<b>${deDate(P[i].d)}</b><br>${eur(P[i].v, 2)} / g<br><span class="mut">${eur(P[i].v * OZ, 0)} / Unze</span>`); };
  hz.addEventListener('pointermove', mv); hz.addEventListener('pointerdown', mv);
  hz.addEventListener('pointerleave', () => { hideTip(c0); $('kxh').setAttribute('opacity', 0); $('khd').setAttribute('opacity', 0); });
}
window.addEventListener('resize', () => { if (tab === 'charts' && user) drawCharts(); });
