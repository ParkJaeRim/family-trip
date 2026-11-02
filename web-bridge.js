'use strict';
// TODO: photos-script 배포 후 받은 웹 앱 URL을 넣는다. 비어 있으면 로그인할 수 없다.
const SCRIPT_URL = '';
const TOKEN = 'lZFI9oLNB47unpvI7smWmrNSNvezVpVQ';
const STORE = 'europe-trip-v1', INITIAL = 'web-initial';

const realFetch = window.fetch.bind(window);
async function post(body) {
  if (!SCRIPT_URL) return { ok: false, error: 'not-ready' };
  try {
    const r = await realFetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ ...body, token: TOKEN }) });
    return JSON.parse(await r.text());
  } catch (e) { return { ok: false, error: 'network' }; }
}

window.fetch = (url, opt) => {
  const u = String(url);
  if (u.startsWith('/weather')) {
    const q = new URLSearchParams(u.split('?')[1]);
    return realFetch('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({ latitude: q.get('lat'), longitude: q.get('lon'), daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code', timezone: 'auto', start_date: q.get('start'), end_date: q.get('end') }));
  }
  if (u.startsWith('/fx')) return realFetch('https://api.frankfurter.dev/v1/latest?from=EUR&to=KRW,CHF');
  if (u.startsWith('/')) return Promise.resolve(new Response('', { status: 404 }));
  return realFetch(url, opt);
};

function readStore() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } }

// 사진 고르기·올리기: 안드로이드 앱의 네이티브 기능을 브라우저로 대신한다.
const files = new Map(), queue = [];
let pumping = false;
function pickFile(accept, multiple) {
  return new Promise(res => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = () => res([...input.files]);
    input.click();
  });
}
async function exifDate(file) {
  try {
    const v = new DataView(await file.slice(0, 196608).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return '';
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const u16 = p => v.getUint16(t + p, le), u32 = p => v.getUint32(t + p, le);
        const ascii = (p, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(t + p + i); if (!c) break; s += String.fromCharCode(c); } return s; };
        const scan = (ifd, want) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === want) return e; } return -1; };
        const ifd0 = u32(4);
        let found = '';
        const exifPtr = scan(ifd0, 0x8769);
        if (exifPtr >= 0) { const e = scan(u32(exifPtr + 8), 0x9003); if (e >= 0) found = ascii(u32(e + 8), 19); }
        if (!found) { const e = scan(ifd0, 0x0132); if (e >= 0) found = ascii(u32(e + 8), 19); }
        const m = found.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/);
        return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : '';
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
  } catch (e) {}
  return '';
}
async function photoId(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return [...d.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function base64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const p = queue[0], file = files.get(p.id);
      if (!file) { queue.shift(); window.photoUploadFailed?.(p.id, true); continue; }
      const r = await post({ pw: p.pw, id: p.id, day: p.day, time: p.time, takenAt: p.takenAt, name: p.name, mime: p.mime, data: await base64(file) });
      if (r.ok) { queue.shift(); files.delete(p.id); window.photoUploaded?.(p.id); continue; }
      if (r.error === 'password' || r.error === 'bad request') { queue.shift(); window.photoUploadFailed?.(p.id, true); continue; }
      window.photoUploadFailed?.(p.id, false);
      break;
    }
  } finally { pumping = false; }
}

window.TripNative = {
  load: () => localStorage.getItem(STORE) || '',
  save: v => { try { localStorage.setItem(STORE, v); return true; } catch (e) { return false; } },
  theme() {},
  open: url => window.open(url, '_blank', 'noopener'),
  exportData(raw) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    a.download = '엄마와유럽-백업.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importData() { pickFile('.json,application/json', false).then(async ([f]) => { if (f && f.size < 2000000) window.receiveBackup(await f.text()); }); },
  photoReady: () => !!SCRIPT_URL,
  pickPhotos() {
    pickFile('image/*', true).then(async list => {
      const out = []; let tooBig = 0;
      for (const f of list) {
        if (f.size > 35000000) { tooBig++; continue; }
        const takenAt = await exifDate(f), id = await photoId(`${f.name}|${f.size}|${takenAt}`);
        files.set(id, f);
        out.push({ id, uri: 'web:' + id, name: f.name, mime: f.type || 'image/jpeg', takenAt, local: URL.createObjectURL(f) });
      }
      window.photosPicked?.(out, tooBig);
    });
  },
  queueState: () => JSON.stringify(queue.map(({ id, day, time, name, local }) => ({ id, day, time, name, local }))),
  queuePhotos(json) {
    try {
      for (const p of JSON.parse(json)) {
        if (files.has(p.id) && /^2027-\d\d-\d\d$/.test(p.day) && !queue.some(q => q.id === p.id)) queue.push(p);
      }
    } catch (e) {}
    pump();
  },
  retryUploads: () => pump(),
  download: fileId => { if (/^[\w-]{10,100}$/.test(fileId)) window.open('https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId), '_blank', 'noopener'); },
  api(id, body) { post(JSON.parse(body)).then(r => window.apiResult(id, JSON.stringify(r))); },
};

window.TripWeb = { logout() { localStorage.removeItem(STORE); localStorage.removeItem(INITIAL); location.reload(); } };

// 일정 뼈대(날짜·도시·숙소 도시)를 코드에 넣지 않고, 로그인한 뒤 시트에서 만든다.
function skeleton(schedRaw, bookRaw) {
  const sched = TripSheet.rows(schedRaw), book = TripSheet.rows(bookRaw), header = sched.find(r => r[0] === '시간') || [];
  const days = [];
  header.forEach((h, i) => { const m = i > 0 && String(h).match(/(\d{1,2})\/(\d{1,2})/); if (m) days.push({ date: `2027-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, city: String(h).split('\n')[0].trim(), events: [] }); });
  const hotels = []; let head = null;
  for (const r of book) {
    if (r.includes('숙소명')) { head = r; continue; }
    if (r.includes('출발 도시')) { head = null; continue; }
    const city = head && /2027/.test(r[head.indexOf('체크인')] || '') ? r[head.indexOf('지역')] : '';
    if (city && !city.includes('합계') && !hotels.some(x => x.city === city)) hotels.push({ id: 'h' + hotels.length, city, name: '', checkin: '2027-01-01', checkout: '2027-01-02' });
  }
  return { version: 1, days, hotels, checklist: [], notes: '', flights: [] };
}
async function bootstrap(pw) {
  const [s, b, c] = await Promise.all(['schedule', 'bookings', 'checklist'].map(kind => post({ action: 'sheet', kind, pw })));
  if (!s.ok || !b.ok) throw Error(s.error === 'password' || b.error === 'password' ? 'password' : 'network');
  const data = TripSheet.parse(s.text, b.text, skeleton(s.text, b.text), x => x);
  if (c.ok) { try { data.checklist = TripSheet.checklist(c.text); } catch (e) {} }
  return data;
}
function loadApp() { const s = document.createElement('script'); s.src = 'app.js'; document.body.appendChild(s); }
function gate(message) {
  document.documentElement.classList.toggle('dark', (readStore()?.prefs?.theme || 'dark') !== 'light');
  document.querySelector('#app').innerHTML = `<main class="gate"><div class="gate-card"><div class="brand">엄마와 유럽</div><p class="sub">${message || '비밀번호를 넣으면 일정을 볼 수 있어요.'}</p><form id="gate-form"><label for="gate-pw">비밀번호</label><input id="gate-pw" type="password" autocomplete="current-password" required maxlength="100"><div class="buttons"><button class="primary">들어가기</button></div></form></div></main>`;
  document.querySelector('#gate-form').onsubmit = async ev => {
    ev.preventDefault();
    const pw = document.querySelector('#gate-pw').value, btn = ev.target.querySelector('button');
    btn.disabled = true; btn.textContent = '확인 중…';
    const r = await post({ action: 'login', pw });
    if (!r.ok) { btn.disabled = false; btn.textContent = '들어가기'; gate(r.error === 'password' ? '비밀번호가 맞지 않아요.' : r.error === 'locked' ? '여러 번 틀려서 10분 동안 잠겼어요. 잠시 뒤 다시 해 주세요.' : r.error === 'not-ready' ? '아직 연결 설정이 끝나지 않았어요.' : '인터넷 연결을 확인해 주세요.'); return; }
    await start(pw, r.role, r.sheetUrl || '');
  };
}
async function start(pw, role, sheetUrl) {
  document.querySelector('#app').innerHTML = '<main class="gate"><p class="sub">일정을 불러오는 중…</p></main>';
  let data;
  try { data = await bootstrap(pw); localStorage.setItem(INITIAL, JSON.stringify(data)); }
  catch (e) {
    if (e.message === 'password') { localStorage.removeItem(STORE); gate('비밀번호가 바뀌었어요. 다시 넣어 주세요.'); return; }
    try { data = JSON.parse(localStorage.getItem(INITIAL) || 'null'); } catch (x) { data = null; }
    if (!data) { gate('인터넷 연결을 확인해 주세요.'); return; }
  }
  window.INITIAL_DATA = data;
  const saved = readStore();
  const prefs = { theme: 'dark', ...(saved?.prefs || {}), auth: { pw, role }, sheetLastSync: new Date().toISOString(), ...(sheetUrl ? { sheetUrl } : {}) };
  localStorage.setItem(STORE, JSON.stringify({ data: saved?.data || data, prefs }));
  loadApp();
}

const saved = readStore()?.prefs?.auth;
if (saved && typeof saved.pw === 'string') start(saved.pw, saved.role, '');
else gate();
