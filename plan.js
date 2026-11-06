/* plan.js — 생산계획·실적 대시보드 (index.html 의 #viewPlan 에 렌더링)
 * 적용: index.html </body> 바로 위에  <script src="plan.js"></script>  한 줄 추가
 */
(function () {
  'use strict';

  // ===== 설정 (여기만 고치면 됨) =====
  const MACHINES = ['500-1','500-2','500-3','600-1','600-2','600-3','400-1','800-1','800-2','로봇라인','셔틀라인','동기화라인'];
  const PATTERNS = {                       // 근무 패턴별 가동시간(h)
    D:   { label: '주간(단근무) 8h',   h: 8 },
    DO:  { label: '주간+잔업 10h',      h: 10 },
    DN:  { label: '주간+야간 16h',      h: 16 },
    DON: { label: '주간+잔업+야간 18h', h: 18 }
  };
  const EFF = 0.8;                         // 목표 효율 80%
  const KEY = 'jw_plan_v1';
  console.log('[plan.js] v3 loaded');

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Math.round(n || 0).toLocaleString();
  const todayStr = () => new Date().toLocaleDateString('sv-SE');

  let S = load();            // {items, plans, actuals, pattern}
  let baseItems = [];        // GitHub의 items.json (품목 DB)
  let date = todayStr();
  let mode = 'week';         // 'day' | 'week'(월~일)
  let chart = null;

  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v) { v.hours = v.hours || {}; return v; } } catch (e) {}
    return { items: [], plans: [], actuals: [], hours: {}, pattern: 'DO' };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  // ===== 설비명 표준화: "대형 500톤 1호기" → "500-1", "로봇2라인 (250톤)" → "로봇라인" =====
  function norm(n) {
    n = String(n || '').replace(/\s/g, '');
    if (/로봇/.test(n)) return '로봇라인';
    if (/셔틀/.test(n)) return '셔틀라인';
    if (/동기화/.test(n)) return '동기화라인';
    const m = n.match(/(?<!\d)(\d{3})(?!\d)[^\d]{0,6}?(\d)/);
    return m ? m[1] + '-' + m[2] : n;
  }

  // ===== 업로드 파싱 =====
  const COLS = {
    date: ['날짜', '일자', 'date'], machine: ['설비', 'machine'],
    code: ['품번', '품목코드', 'itemcode', 'code'], name: ['품명', '품목명', 'itemname', 'name'],
    plan: ['계획', 'plan'], actual: ['실적', 'actual'],
    ct: ['c/t', '사이클', 'cycle'], cav: ['취수', '열수', 'cav'], shift: ['근무', 'shift'], hours: ['가동시간']
  };
  function pick(row, k) {
    for (const h in row) {
      const hh = h.replace(/\s/g, '').toLowerCase();
      if (COLS[k].some(a => hh.includes(a))) return row[h];
    }
    return '';
  }
  function nd(v) {
    if (typeof v === 'number' && v > 20000) return new Date(Math.round((v - 25569) * 86400e3)).toISOString().slice(0, 10);   // 엑셀 일련번호
    if (v instanceof Date) return new Date(v.getTime() + 12 * 3600e3).toLocaleDateString('sv-SE');
    const m = String(v).trim().replace(/[./]/g, '-').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  }
  function shiftOf(v) {          // 근무 칸: 주간 / 주간+잔업 / 주간+야간 / 주간+잔업+야간 (비우면 기본 근무)
    const s = String(v || '').replace(/\s/g, '').toUpperCase();
    if (!s) return '';
    if (PATTERNS[s]) return s;
    const n = /야간/.test(s), o = /잔업/.test(s);
    return n && o ? 'DON' : n ? 'DN' : o ? 'DO' : /주간/.test(s) ? 'D' : '';
  }
  const num = v => +String(v).replace(/,/g, '') || 0;

  // 시트 하나 → 계획/실적/품목DB 자동 판별
  function ingest(rows) {
    const cnt = { p: 0, a: 0, i: 0, h: 0 };
    if (!rows.length) return cnt;
    const h = Object.keys(rows[0]).join('|').replace(/\s/g, '').toLowerCase();
    const isHours = /가동시간/.test(h) && !/날짜|일자|date/.test(h);
    const isItems = !isHours && /c\/t|사이클|cycle/.test(h) && !/날짜|일자|date/.test(h);
    const hasP = /계획|plan/.test(h), hasA = /실적|actual/.test(h);
    const P = [], A = [], I = [];

    rows.forEach(r => {
      const mc = norm(pick(r, 'machine')), code = String(pick(r, 'code')).trim();
      if (isHours) {
        const hr = num(pick(r, 'hours'));
        if (mc && hr > 0) { S.hours[mc] = hr; cnt.h++; }
        return;
      }
      if (isItems) {
        if (code) I.push({ code, name: String(pick(r, 'name')).trim(), machine: mc, ct: num(pick(r, 'ct')), cav: num(pick(r, 'cav')) || 1 });
        return;
      }
      const d = nd(pick(r, 'date'));
      if (!d || !mc) return;
      const pq = hasP ? pick(r, 'plan') : '', aq = hasA ? pick(r, 'actual') : '';
      if (!code && pq === '' && aq === '') return;            // 비어있는 양식 줄은 무시
      if (code && num(pick(r, 'ct')) > 0) I.push({ code, name: String(pick(r, 'name')).trim(), machine: mc, ct: num(pick(r, 'ct')), cav: num(pick(r, 'cav')) || 1 });
      if (hasP && (code || pq !== '')) P.push({ date: d, machine: mc, code, qty: num(pq), shift: shiftOf(pick(r, 'shift')) });
      if (aq !== '') A.push({ date: d, machine: mc, code, qty: num(aq) });
    });

    if (P.length) { const ds = new Set(P.map(x => x.date)); S.plans = S.plans.filter(x => !ds.has(x.date)).concat(P); date = P[0].date; }
    if (A.length) {
      const ks = new Set(A.map(x => `${x.date}|${x.machine}`));
      S.actuals = S.actuals.filter(x => !ks.has(`${x.date}|${x.machine}`)).concat(A);
      if (!P.length) date = A[0].date;
    }
    if (I.length) {
      const ks = new Set(I.map(x => `${x.code}|${x.machine}`));
      S.items = S.items.filter(x => !ks.has(`${x.code}|${x.machine}`)).concat(I);
    }
    cnt.p = P.length; cnt.a = A.length; cnt.i = I.length;
    return cnt;
  }

  function finish(tot, detail) {
    save(); render();
    if (detail) console.log('[plan.js] 업로드 인식 내역', detail);
    const msg = [tot.p && `계획 ${tot.p}건`, tot.a && `실적 ${tot.a}건`, tot.i && `품목 ${tot.i}건`, tot.h && `설비기준 ${tot.h}건`].filter(Boolean).join(' · ');
    showToast(msg ? '업로드 완료: ' + msg : '인식된 데이터가 없습니다. 양식을 확인하세요.' + (detail ? ' (' + detail + ')' : ''));
  }

  function readFile(f) {
    const r = new FileReader();
    r.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const tot = { p: 0, a: 0, i: 0, h: 0 }, det = [];
        wb.SheetNames.forEach(n => {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
          const c = ingest(rows);
          tot.p += c.p; tot.a += c.a; tot.i += c.i; tot.h += c.h;
          det.push(`${n}: ${rows.length}행→계획${c.p}/실적${c.a}/품목${c.i}/설비${c.h}`);
        });
        finish(tot, det.join(' | '));
      } catch (err) { showToast('파일 읽기 실패: ' + err.message); }
    };
    r.readAsArrayBuffer(f);
  }

  // 엑셀에서 복사(Ctrl+C) → 화면에서 Ctrl+V
  document.addEventListener('paste', e => {
    const v = $('viewPlan');
    if (!v || v.classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const t = (e.clipboardData.getData('text') || '').trim();
    if (!t) return;
    const lines = t.split(/\r?\n/).map(l => l.split('\t'));
    const head = lines.shift();
    const rows = lines.map(c => Object.fromEntries(head.map((k, i) => [k, c[i] ?? ''])));
    finish(ingest(rows));
  });

  // ===== 계산 =====
  const WK = ['일', '월', '화', '수', '목', '금', '토'];
  const wkOf = d => WK[new Date(d + 'T12:00:00').getDay()];
  const wl = (a, b) => a === b ? wkOf(a) : wkOf(a) + '~' + wkOf(b);
  function itemTx(code, it) {
    const n = it && it.name ? String(it.name).trim() : '';
    return (n && n !== code ? code + ' ' + n : code).trim();
  }
  function ctOf(code, mc) {
    const all = S.items.concat(baseItems);
    return all.find(i => i.code === code && i.machine === mc) || all.find(i => i.code === code) || null;
  }
  const hrsOf = (p, mc) => p.shift ? PATTERNS[p.shift].h : (S.hours[mc] || PATTERNS[S.pattern].h);
  const capOf = (h, it) => it && it.ct > 0 ? h * 3600 * EFF / it.ct * (it.cav || 1) : 0;

  function mesActual() {
    const o = {};
    try { realtimeMesList.forEach(x => { const k = norm(x.machine); o[k] = (o[k] || 0) + (x.qty || 0); }); } catch (e) {}
    return o;
  }

  function range() {
    if (mode === 'day') return [date, date];
    const d = new Date(date + 'T12:00:00'), s0 = new Date(d), e0 = new Date(d);
    s0.setDate(d.getDate() - (d.getDay() + 6) % 7); e0.setDate(s0.getDate() + 6);
    const f = x => x.toLocaleDateString('sv-SE');
    return [f(s0), f(e0)];
  }

  function dayVal(mc, d, mes) {
    const ps = S.plans.filter(p => p.date === d && p.machine === mc);
    let plan = 0;
    ps.forEach(p => { plan += p.qty || capOf(hrsOf(p, mc), ctOf(p.code, mc)); });
    const upl = S.actuals.filter(a => a.date === d && a.machine === mc).reduce((a, b) => a + b.qty, 0);
    const act = d === todayStr() && mes[mc] !== undefined ? mes[mc] : upl;
    const tx = [...new Set(ps.map(p => itemTx(p.code, ctOf(p.code, mc))).filter(Boolean))].join(' + ');
    return { plan, act, tx };
  }

  function build() {
    const [from, to] = range(), inR = d => d >= from && d <= to;
    const t = todayStr(), useMes = inR(t), mes = useMes ? mesActual() : {};
    const names = MACHINES.slice();
    S.plans.filter(p => inR(p.date)).forEach(p => { if (!names.includes(p.machine)) names.push(p.machine); });

    return names.map(mc => {
      const ps = S.plans.filter(p => inR(p.date) && p.machine === mc);
      let plan = 0; const items = [], capDay = {}, byDay = {};
      ps.forEach(p => {
        const it = ctOf(p.code, mc), c = capOf(hrsOf(p, mc), it);
        plan += p.qty || c;                                   // 계획수량 비어있으면 능력치로 자동 산정
        if (capDay[p.date] === undefined) capDay[p.date] = c; // 하루 능력은 대표 품목 기준
        const tx = itemTx(p.code, it);
        if (tx && !items.includes(tx)) items.push(tx);
        if (tx) { const a = byDay[p.date] = byDay[p.date] || []; if (!a.includes(tx)) a.push(tx); }
      });
      const segs = [];                                      // 같은 품목이 이어지는 날짜 구간 (모델교체 감지)
      Object.keys(byDay).sort().forEach(d => {
        const t = byDay[d].join(' + '), last = segs[segs.length - 1];
        if (last && last.tx === t) last.to = d; else segs.push({ tx: t, from: d, to: d });
      });
      const cap = Object.values(capDay).reduce((a, b) => a + b, 0);
      const useM = useMes && mes[mc] !== undefined;           // 오늘 실적은 MES 우선
      const upl = S.actuals.filter(a => inR(a.date) && a.machine === mc && !(useM && a.date === t)).reduce((a, b) => a + b.qty, 0);
      const act = upl + (useM ? mes[mc] : 0);
      return { mc, items, segs, changed: segs.length > 1, plan, cap, act, hasPlan: ps.length > 0,
               rate: plan ? act / plan * 100 : null, load: cap ? plan / cap * 100 : null };
    });
  }

  // ===== 화면 =====
  function init() {
    const v = $('viewPlan'); if (!v) return;
    v.innerHTML = `
      <div class="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-bold text-white">프레스 라인 생산 계획 및 실적 관리</h2>
            <p class="text-xs text-slate-400 mt-1">목표 효율 80% 기준 생산능력 · 당일 실적은 MES 자동 반영 <span class="text-amber-400">· plan.js v3 (모델교체 표시)</span></p>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <input type="date" id="plDate" class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-amber-300 font-semibold">
            <select id="plMode" class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-semibold"><option value="week">주간 합계 (월~일)</option><option value="day">일간</option></select>
            <span id="plRange" class="text-slate-400"></span>
            <select id="plPattern" title="근무 칸이 비어있을 때 적용할 기본 근무" class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-semibold">
              ${Object.entries(PATTERNS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}
            </select>
            <button id="plTpl" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold">양식 다운로드</button>
            <button id="plClear" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-900 border border-slate-700 text-slate-400 font-semibold">데이터 초기화</button>
          </div>
        </div>
        <label id="plDrop" class="block cursor-pointer border-2 border-dashed border-slate-700 hover:border-amber-500 rounded-2xl p-5 text-center transition-colors">
          <input type="file" id="plFile" accept=".xlsx,.xls,.csv" multiple class="hidden">
          <div class="text-sm font-bold text-amber-300">엑셀/CSV를 여기에 끌어다 놓거나 클릭해서 선택</div>
          <div class="text-[11px] text-slate-500 mt-1">또는 엑셀 표를 복사(Ctrl+C)한 뒤 이 화면에서 붙여넣기(Ctrl+V) · 계획/실적/품목DB 자동 인식</div>
        </label>
      </div>
      <div id="plKpi" class="grid grid-cols-2 lg:grid-cols-4 gap-4"></div>
      <div class="bg-slate-900 p-5 rounded-2xl border border-slate-800">
        <h3 class="font-bold text-white text-sm mb-3">설비별 계획 vs 실적 (선: 80% 생산능력)</h3>
        <div class="relative w-full h-[280px]"><canvas id="plChart"></canvas></div>
      </div>
      <div id="plDaily"></div>
      <div class="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
        <div class="overflow-x-auto"><table class="w-full text-left text-xs border-collapse">
          <thead><tr class="bg-slate-800/80 text-slate-300 border-b border-slate-700">
            <th class="py-3 px-4">설비</th><th class="py-3 px-4">작업 품목</th>
            <th class="py-3 px-4 text-right">능력(EA)</th><th class="py-3 px-4 text-right">계획(EA)</th>
            <th class="py-3 px-4 text-right">실적(EA)</th><th class="py-3 px-4 text-right">부하율</th>
            <th class="py-3 px-4 w-48">달성률</th></tr></thead>
          <tbody id="plBody" class="divide-y divide-slate-800 text-slate-300"></tbody>
        </table></div>
      </div>
      <div id="plMesNote"></div>`;

    $('plPattern').value = S.pattern;
    $('plDate').value = date;
    $('plDate').onchange = e => { date = e.target.value || todayStr(); render(); };
    $('plMode').onchange = e => { mode = e.target.value; render(); };
    $('plPattern').onchange = e => { S.pattern = e.target.value; save(); render(); };
    $('plTpl').onclick = () => { const a = document.createElement('a'); a.href = '생산계획_주간업로드_표준양식.xlsx'; a.download = ''; a.click(); };
    $('plClear').onclick = () => { if (confirm('업로드한 계획/실적/품목 데이터를 모두 지울까요?')) { S = { items: [], plans: [], actuals: [], hours: {}, pattern: S.pattern }; save(); render(); } };
    $('plFile').onchange = e => { [...e.target.files].forEach(readFile); e.target.value = ''; };
    const dz = $('plDrop');
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('border-amber-500'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('border-amber-500'); }));
    dz.addEventListener('drop', e => [...e.dataTransfer.files].forEach(readFile));

    fetch('items.json').then(r => r.json()).then(a => { if (Array.isArray(a)) { baseItems = a.map(x => ({ ...x, machine: norm(x.machine) })); render(); } }).catch(() => {});
  }

  function render() {
    try { _render(); } catch (e) { console.error('[plan.js] render 오류', e); const n = $('plMesNote'); if (n) n.innerHTML = `<div class="text-xs text-rose-400 px-1">화면 오류: ${esc(e.message)} (F12 콘솔 확인)</div>`; }
  }
  function _render() {
    const v = $('viewPlan');
    if (!v || v.classList.contains('hidden') || !$('plBody')) return;
    $('plDate').value = date; $('plPattern').value = S.pattern; $('plMode').value = mode;
    const rg = range();
    const _ds = S.plans.map(x => x.date).sort(), _inR = _ds.filter(d => d >= rg[0] && d <= rg[1]).length;
    $('plRange').innerText = (mode === 'week' ? `${rg[0]} ~ ${rg[1]} · ` : '') + (_ds.length
      ? (_inR ? `계획 ${_inR}건` : `⚠ 이 기간엔 계획 없음 (저장된 계획: ${_ds[0]} ~ ${_ds[_ds.length - 1]} → 날짜를 그 주로 선택)`)
      : '저장된 계획 없음 (엑셀 업로드 필요)');
    const rows = build();
    const tp = rows.reduce((s, r) => s + r.plan, 0), ta = rows.filter(r => r.hasPlan || r.act).reduce((s, r) => s + r.act, 0);
    const rate = tp ? ta / tp * 100 : 0, active = rows.filter(r => r.hasPlan).length;
    const card = (t, val, unit, c) => `<div class="bg-slate-900 p-5 rounded-2xl border border-slate-800"><span class="text-xs text-slate-400 font-semibold">${t}</span><div class="mt-2 text-2xl sm:text-3xl font-black ${c}">${val} <span class="text-xs font-normal text-slate-400">${unit}</span></div></div>`;
    $('plKpi').innerHTML = card('총 계획 수량', fmt(tp), 'EA', 'text-white') + card('누적 실적', fmt(ta), 'EA', 'text-emerald-400')
      + card('전체 달성률', rate.toFixed(1), '%', rate >= 95 ? 'text-emerald-400' : rate >= 80 ? 'text-amber-400' : 'text-rose-400')
      + card('계획 등록 설비', `${active} / ${rows.length}`, '대', 'text-indigo-400');

    const itemCell = r => {
      if (!r.segs.length) return '계획 없음';
      if (!r.changed) return esc(r.segs[0].tx);
      return r.segs.map(g => `<span class="whitespace-nowrap"><span class="text-slate-200">${esc(g.tx)}</span> <span class="text-slate-500">(${wl(g.from, g.to)})</span></span>`).join(' <span class="text-amber-400 font-bold">→</span> ')
        + ' <span class="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">모델교체</span>';
    };
    const color = r => r >= 95 ? 'bg-emerald-500' : r >= 80 ? 'bg-amber-500' : 'bg-rose-500';
    $('plBody').innerHTML = rows.map(r => `
      <tr class="hover:bg-slate-800/40 ${r.hasPlan || r.act ? '' : 'opacity-40'}">
        <td class="py-3 px-4 font-bold text-white">${esc(r.mc)}</td>
        <td class="py-3 px-4 text-slate-400">${itemCell(r)}</td>
        <td class="py-3 px-4 text-right font-mono">${r.cap ? fmt(r.cap) : '-'}</td>
        <td class="py-3 px-4 text-right font-mono">${r.plan ? fmt(r.plan) : '-'}</td>
        <td class="py-3 px-4 text-right font-mono font-bold text-emerald-400">${r.act ? fmt(r.act) : '-'}</td>
        <td class="py-3 px-4 text-right font-mono ${r.load > 100 ? 'text-rose-400 font-bold' : ''}">${r.load ? r.load.toFixed(0) + '%' : '-'}</td>
        <td class="py-3 px-4">${r.rate === null ? '-' : `<div class="flex items-center gap-2"><div class="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden"><div class="h-full ${color(r.rate)}" style="width:${Math.min(r.rate, 100)}%"></div></div><span class="font-mono font-bold w-12 text-right">${r.rate.toFixed(1)}%</span></div>`}</td>
      </tr>`).join('');

    // ----- 일자별 (월~토/일) 표: 칸마다 실적 / 계획 -----
    const dv = $('plDaily');
    if (mode === 'week') {
      const wk = ['월', '화', '수', '목', '금', '토', '일'], days = [], b0 = new Date(rg[0] + 'T12:00:00');
      for (let i = 0; i < 7; i++) { const x = new Date(b0); x.setDate(b0.getDate() + i); days.push(x.toLocaleDateString('sv-SE')); }
      const mesD = days.includes(todayStr()) ? mesActual() : {};
      const grid = rows.map(r => days.map(d => dayVal(r.mc, d, mesD)));
      const nDays = grid.some(g => g[6].plan || g[6].act) ? 7 : 6;      // 일요일은 데이터 있을 때만
      const chgOf = g => { let prev = ''; return g.map(c => { const f = !!(c.tx && prev && c.tx !== prev); if (c.tx) prev = c.tx; return f; }); };
      const cell = (c, chg) => (!c.plan && !c.act ? '<span class="text-slate-700">-</span>'
        : `<span class="${c.plan ? (c.act / c.plan >= .95 ? 'text-emerald-400' : c.act / c.plan >= .8 ? 'text-amber-400' : 'text-rose-400') : 'text-emerald-400'} font-bold">${fmt(c.act)}</span><span class="text-slate-500"> / ${fmt(c.plan)}</span>`)
        + (c.tx ? `<div class="text-[10px] leading-tight mt-0.5 font-sans ${chg ? 'text-amber-300 font-bold' : 'text-slate-500'}">${chg ? '▶ ' : ''}${esc(c.tx)}</div>` : '');
      let h = `<tr class="bg-slate-800/80 text-slate-300 border-b border-slate-700"><th class="py-3 px-4">설비</th>`;
      for (let i = 0; i < nDays; i++) h += `<th class="py-3 px-3 text-center ${days[i] === todayStr() ? 'text-amber-300' : ''}">${wk[i]}<div class="text-[10px] font-normal text-slate-500">${days[i].slice(5)}</div></th>`;
      h += `<th class="py-3 px-3 text-center">주간 합계</th></tr>`;
      const body = rows.map((r, ri) => `<tr class="hover:bg-slate-800/40 ${r.hasPlan || r.act ? '' : 'opacity-40'}"><td class="py-2.5 px-4 font-bold text-white">${esc(r.mc)}</td>`
        + (cf => grid[ri].slice(0, nDays).map((c, i) => `<td class="py-2.5 px-3 text-center font-mono ${cf[i] ? 'bg-amber-500/10' : ''}">${cell(c, cf[i])}</td>`).join(''))(chgOf(grid[ri]))
        + `<td class="py-2.5 px-3 text-center font-mono">${cell({ plan: r.plan, act: r.act })}</td></tr>`).join('');
      const tot = days.slice(0, nDays).map((d, i) => grid.reduce((a, g) => ({ plan: a.plan + g[i].plan, act: a.act + g[i].act }), { plan: 0, act: 0 }));
      const foot = `<tr class="bg-slate-800/60 font-bold"><td class="py-3 px-4 text-white">합계</td>${tot.map(c => `<td class="py-3 px-3 text-center font-mono">${cell(c)}</td>`).join('')}<td class="py-3 px-3 text-center font-mono">${cell({ plan: tp, act: ta })}</td></tr>`;
      dv.innerHTML = `<div class="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden"><div class="p-4 border-b border-slate-800 flex items-center justify-between"><h3 class="font-bold text-white text-sm">일자별 현황 (실적 / 계획)</h3><span class="text-xs text-slate-400">단위: EA</span></div><div class="overflow-x-auto"><table class="w-full text-xs border-collapse"><thead>${h}</thead><tbody class="divide-y divide-slate-800 text-slate-300">${body}</tbody><tfoot>${foot}</tfoot></table></div></div>`;
    } else dv.innerHTML = '';

    // ----- 목록에 매칭 안 된 MES 설비 안내 -----
    let um = [];
    try { um = [...new Set(realtimeMesList.map(x => x.machine).filter(n => !MACHINES.includes(norm(n))))]; } catch (e) {}
    $('plMesNote').innerHTML = um.length ? `<div class="text-[11px] text-slate-500 px-1">MES 설비 중 설비 목록과 매칭되지 않아 실적에서 제외된 설비: ${esc(um.join(', '))}</div>` : '';

    const cr = rows.filter(r => r.hasPlan || r.act);
    if (chart) chart.destroy();
    Chart.defaults.color = '#94a3b8';
    chart = new Chart($('plChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: cr.map(r => r.mc),
        datasets: [
          { label: '계획', data: cr.map(r => r.plan), backgroundColor: 'rgba(99,102,241,.85)', borderRadius: 4 },
          { label: '실적', data: cr.map(r => r.act), backgroundColor: 'rgba(52,211,153,.85)', borderRadius: 4 },
          { type: 'line', label: '80% 생산능력', data: cr.map(r => r.cap), borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderWidth: 2, pointRadius: 3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: '#1e293b' } }, y: { grid: { color: '#1e293b' } } } }
    });
  }

  // 탭 전환 / MES 갱신 시 자동 재렌더
  const _sw = window.switchDashboardView;
  window.switchDashboardView = function (v) { _sw.apply(this, arguments); if (v === 'plan') render(); };
  const _rr = window.renderRealtimeDashboard;
  window.renderRealtimeDashboard = function () { _rr.apply(this, arguments); render(); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
