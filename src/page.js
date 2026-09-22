// 页面：足环刻印发放与换环核验台（展示层，不属于入口/判定/存储三个业务文件）
export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>足环刻印发放与换环核验台</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --warn:#b07a1f; --red:#9b3f35; --green:#2e6b4f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:20px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 12px; font-size:17px; } h3 { margin:0; font-size:15px; }
    nav { display:flex; gap:8px; padding:14px 28px 0; } nav button { background:#fff; color:var(--muted); border:1px solid var(--line); border-bottom:0; border-radius:8px 8px 0 0; padding:10px 18px; font-weight:700; cursor:pointer; }
    nav button.on { color:var(--accent); box-shadow:0 -2px 0 var(--accent) inset; }
    main { padding:18px 28px; display:grid; grid-template-columns:400px 1fr; gap:18px; align-items:start; }
    form,.panel,.card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:15px; }
    label { display:block; margin:9px 0 4px; color:var(--muted); font-size:13px; }
    input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; }
    button.act { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 13px; font-weight:700; cursor:pointer; margin-top:12px; }
    button.mini { border:1px solid var(--line); background:#f8fafb; border-radius:6px; padding:5px 9px; font-size:12px; cursor:pointer; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .meta { color:var(--muted); font-size:13px; } .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:6px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:12px; }
    .pill.in_use { color:var(--green); border-color:var(--green); } .pill.engraved { color:var(--accent); border-color:var(--accent); }
    .pill.retired { color:var(--muted); } .pill.pending_recycle { color:var(--warn); border-color:var(--warn); }
    .pill.pending { color:var(--warn); border-color:var(--warn); } .pill.completed { color:var(--green); border-color:var(--green); }
    table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; }
    th,td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; font-size:13px; } th { background:#f4f7f9; color:var(--muted); }
    #flash { margin:0 28px; min-height:20px; font-size:13px; } #flash.ok { color:var(--green); } #flash.err { color:var(--red); }
    .tab { display:none; } .tab.on { display:contents; }
    .blocker { color:var(--red); font-size:12px; } .check { display:flex; gap:7px; align-items:center; margin-top:10px; } .check input { width:auto; }
    .stack { display:grid; gap:12px; align-content:start; }
    @media (max-width:960px){ header{display:block;padding:16px;} nav{padding:12px 16px 0;} main{grid-template-columns:1fr;padding:16px;} #flash{margin:0 16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>足环刻印发放与换环核验台</h1><div class="meta">刻印唯一 · 发放核对批次/鸽主/鸽只 · 换环回收并由他人按损伤等级核验</div></div>
    <button class="act" id="reload">刷新状态</button>
  </header>
  <nav>
    <button data-tab="pigeons" class="on">鸽只档案</button>
    <button data-tab="rings">刻印与发放</button>
    <button data-tab="replace">换环核验</button>
  </nav>
  <div id="flash"></div>

  <div class="tab on" data-panel="pigeons">
    <main>
      <form id="pigeonForm" class="stack">
        <h2>创建鸽只档案</h2>
        <div><label>鸽主 *</label><input name="owner" required></div>
        <div><label>羽色 *</label><input name="color" required></div>
        <div><label>出生棚号 *</label><input name="loft" required></div>
        <div><label>父鸽足环号</label><input name="fatherRing"></div>
        <div><label>母鸽足环号</label><input name="motherRing"></div>
        <button class="act">保存档案（暂无在役环）</button>
      </form>
      <div class="stack">
        <div class="panel" id="pigeonDetail"><h2>鸽只履历</h2><div class="meta">点卡片上的“查看履历”，展示足环台账、换环单、血统、疫苗、转让与成绩。</div></div>
        <div class="grid" id="pigeonCards"></div>
      </div>
    </main>
  </div>

  <div class="tab" data-panel="rings">
    <main>
      <div class="stack">
        <form id="engraveForm" class="panel">
          <h2>足环刻印</h2>
          <label>刻印码 *（全局唯一）</label><input name="code" placeholder="CHN-2026-003" required>
          <label>批次</label><input name="batch" placeholder="留空按年份生成 B-2026">
          <button class="act">刻印入库</button>
        </form>
        <form id="issueForm" class="panel">
          <h2>足环发放</h2>
          <label>刻印码 *</label><input name="code" required>
          <label>批次 *（与刻印记录核对）</label><input name="batch" required>
          <label>鸽只编号 *（P-xxx）</label><input name="pigeonId" required>
          <label>鸽主 *（与登记核对）</label><input name="owner" required>
          <button class="act">核对并发环</button>
          <div class="meta" style="margin-top:8px">码占用、批次/鸽主不符或该鸽已有在役环时返回 409，整单不写。</div>
        </form>
      </div>
      <div class="panel"><h2>足环台账</h2><table id="ringsTable"></table></div>
    </main>
  </div>

  <div class="tab" data-panel="replace">
    <main>
      <form id="replaceForm" class="panel stack">
        <h2>换环核验申请</h2>
        <div><label>鸽只编号 *</label><input name="pigeonId" placeholder="P-001" required></div>
        <div><label>旧环码 *（在役环）</label><input name="oldCode" required></div>
        <div><label>新环码 *（已刻印未发放）</label><input name="newCode" required></div>
        <div><label>旧环损伤等级 *</label><select name="damageLevel"><option>轻微</option><option>中度</option><option>严重</option></select></div>
        <div><label>经办人</label><input name="operator"></div>
        <div><label>核验人 *（须与经办人不同）</label><input name="verifier" required></div>
        <div class="check"><input type="checkbox" name="oldCollected" id="oldCollected"><label for="oldCollected" style="margin:0">旧环已实物回收</label></div>
        <div><label>幂等键（可选，并发/重复时沿用首次结果）</label><input name="requestId"></div>
        <button class="act">提交换环</button>
      </form>
      <div class="stack">
        <div class="panel"><h2>换环单</h2><div id="replaceList"></div></div>
      </div>
    </main>
  </div>

  <script>
    var RING_STATUS = { engraved: '已刻印', in_use: '在役', retired: '已停用', pending_recycle: '待回收' };
    var BLOCKER_TEXT = { old_ring_not_collected: '旧环未回收', same_verifier: '核验人与经办人相同', race_ongoing: '存在未结束参赛记录' };
    var state = { pigeons: [], rings: [], replacements: [] };
    var flashEl = document.getElementById('flash');
    function flash(msg, ok) { flashEl.textContent = msg || ''; flashEl.className = ok ? 'ok' : 'err'; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function fd(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = (typeof v === 'string') ? v.trim() : v; }); return o; }
    function api(path, opts) {
      return fetch(path, opts && opts.body ? { method: opts.method || 'POST', headers: { 'Content-Type': 'application/json' }, body: opts.body } : opts)
        .then(function (res) { return res.json().then(function (data) { if (!res.ok) throw new Error((data.message || data.error || '请求失败') + '（' + (data.error || res.status) + '）'); return data; }); });
    }
    function pill(cls, text) { return '<span class="pill ' + cls + '">' + text + '</span>'; }

    function renderPigeons() {
      document.getElementById('pigeonCards').innerHTML = state.pigeons.map(function (p) {
        var tags = p.activeRingCode ? pill('in_use', '在役 ' + p.activeRingCode) : pill('engraved', '无在役环');
        (p.pendingRecycleRings || []).forEach(function (c) { tags += ' ' + pill('pending_recycle', '待回收 ' + c); });
        if (p.hasOngoingRace) tags += ' ' + pill('pending_recycle', '参赛中');
        return '<article class="card"><h3>' + p.id + ' · ' + esc(p.owner) + '</h3><div class="row">' + tags + '</div>'
          + '<div class="meta">' + esc(p.color) + ' · ' + esc(p.loft) + '</div>'
          + '<div class="meta">父 ' + esc(p.fatherRing || '未登记') + ' / 母 ' + esc(p.motherRing || '未登记') + '</div>'
          + '<div class="row"><button class="mini" data-history="' + p.id + '">查看履历</button>'
          + '<button class="mini" data-transfer="' + p.id + '">登记转让</button>'
          + '<button class="mini" data-vaccine="' + p.id + '">登记疫苗</button>'
          + '<button class="mini" data-race="' + p.id + '">报名赛事</button>'
          + (p.hasOngoingRace ? '<button class="mini" data-finish="' + p.id + '">结束赛事</button>' : '')
          + '</div></article>';
      }).join('');
    }

    function renderRings() {
      document.getElementById('ringsTable').innerHTML = '<tr><th>刻印码</th><th>批次</th><th>状态</th><th>鸽只</th><th>发放时鸽主</th><th>发放时间</th></tr>'
        + state.rings.map(function (r) {
          return '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.batch) + '</td><td>' + pill(r.status, RING_STATUS[r.status]) + '</td>'
            + '<td>' + esc(r.pigeonId || '—') + (r.heldBy ? ' / ' + esc(r.heldBy) : '') + '</td><td>' + esc(r.ownerAtIssue || '—') + '</td>'
            + '<td class="meta">' + (r.issuedAt ? esc(r.issuedAt.replace('T', ' ').slice(0, 16)) : '—') + '</td></tr>';
        }).join('');
    }

    function renderReplacements() {
      if (!state.replacements.length) { document.getElementById('replaceList').innerHTML = '<div class="meta">暂无换环单。</div>'; return; }
      document.getElementById('replaceList').innerHTML = state.replacements.map(function (o) {
        var html = '<div class="card" style="margin-bottom:10px"><div class="row"><b>' + o.id + '</b> ' + pill(o.state, o.state === 'completed' ? '已完成' : '待回收')
          + '<span class="meta">' + esc(o.oldCode) + ' → ' + esc(o.newCode) + ' · ' + esc(o.damageLevel) + ' · 经办 ' + esc(o.operator || '—') + ' / 核验 ' + esc(o.verifier) + '</span></div>';
        if (o.blockers && o.blockers.length) {
          html += '<div class="row">' + o.blockers.map(function (b) { return '<span class="blocker">⚠ ' + BLOCKER_TEXT[b] + '</span>'; }).join('') + '</div>';
        }
        if (o.state === 'pending') {
          html += '<div class="row" style="margin-top:8px"><label style="margin:0">补录核验人</label><input style="width:120px" data-cv="' + o.id + '" placeholder="另一人姓名">'
            + '<label class="check" style="margin:0"><input type="checkbox" data-cc="' + o.id + '">旧环已回收</label>'
            + '<button class="mini" data-confirm="' + o.id + '">条件已补齐，转正式</button></div>'
            + '<div class="meta" style="margin-top:6px">未结束赛事需先在“鸽只档案”中结束。</div>';
        }
        return html + '</div>';
      }).join('');
    }

    function showHistory(id) {
      api('/api/pigeons/' + encodeURIComponent(id) + '/history').then(function (d) {
        var p = d.pigeon;
        var rings = d.rings.map(function (r) {
          return '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.batch) + '</td><td>' + pill(r.status, RING_STATUS[r.status]) + '</td><td class="meta">'
            + r.history.map(function (h) { return h.action + '@' + esc(h.at.slice(0, 10)); }).join('；') + '</td></tr>';
        }).join('');
        var rpl = d.replacements.map(function (o) {
          return o.id + '：' + esc(o.oldCode) + ' → ' + esc(o.newCode) + '（' + (o.state === 'completed' ? '已完成' : '待回收') + '）';
        }).join('<br>') || '暂无';
        document.getElementById('pigeonDetail').innerHTML =
          '<h2>' + p.id + ' 履历 <span class="meta">' + esc(p.owner) + ' · ' + esc(p.color) + ' · ' + esc(p.loft) + '</span></h2>'
          + '<div class="meta">当前在役环：<b>' + esc(p.activeRingCode || '无') + '</b>'
          + (p.pendingRecycleRings.length ? '；待回收：' + esc(p.pendingRecycleRings.join('、')) : '') + '</div>'
          + '<div class="meta" style="margin-top:6px">血统：父 ' + esc(p.fatherRing || '未登记') + ' / 母 ' + esc(p.motherRing || '未登记') + '</div>'
          + '<h3 style="margin-top:10px">足环台账</h3><table><tr><th>环码</th><th>批次</th><th>状态</th><th>环履历</th></tr>' + rings + '</table>'
          + '<h3 style="margin-top:10px">换环单</h3><div class="meta">' + rpl + '</div>'
          + '<h3 style="margin-top:10px">疫苗</h3><div class="meta">' + p.vaccines.map(function (v) { return v.date + ' ' + esc(v.name); }).join('；') || '暂无' + '</div>'
          + '<h3 style="margin-top:10px">转让</h3><div class="meta">' + p.transfers.map(function (t) { return t.date + ' ' + esc(t.from) + '→' + esc(t.to); }).join('；') || '暂无' + '</div>'
          + '<h3 style="margin-top:10px">成绩</h3><div class="meta">' + p.races.map(function (r) {
              return r.date + ' ' + esc(r.event) + ' ' + r.distance + '公里 ' + (r.status === 'ongoing' ? '【参赛中】' : ('第' + (r.rank == null ? '?' : r.rank) + '名'));
            }).join('；') || '暂无' + '</div>';
      }).catch(function (e) { flash(e.message); });
    }

    function load() {
      Promise.all([api('/api/pigeons'), api('/api/rings'), api('/api/replacements')]).then(function (all) {
        state.pigeons = all[0]; state.rings = all[1]; state.replacements = all[2];
        renderPigeons(); renderRings(); renderReplacements();
      }).catch(function (e) { flash(e.message); });
    }

    document.querySelectorAll('nav button').forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll('nav button').forEach(function (b) { b.className = ''; });
        btn.className = 'on';
        document.querySelectorAll('.tab').forEach(function (t) { t.className = t.dataset.panel === btn.dataset.tab ? 'tab on' : 'tab'; });
      };
    });
    document.getElementById('reload').onclick = load;

    document.getElementById('pigeonForm').onsubmit = function (e) {
      e.preventDefault();
      api('/api/pigeons', { body: JSON.stringify(fd(this))) }).then(function () { flash('档案已创建：发放足环后即在役', true); load(); }).catch(function (err) { flash(err.message); });
    };
    document.getElementById('engraveForm').onsubmit = function (e) {
      e.preventDefault();
      api('/api/rings/engrave', { body: JSON.stringify(fd(this))) }).then(function (r) { flash('已刻印：' + r.code + ' / ' + r.batch, true); load(); }).catch(function (err) { flash(err.message); });
    };
    document.getElementById('issueForm').onsubmit = function (e) {
      e.preventDefault();
      api('/api/rings/issue', { body: JSON.stringify(fd(this))) }).then(function (r) { flash('发环成功：' + r.ring.code + ' → ' + r.pigeon.id, true); load(); }).catch(function (err) { flash(err.message); });
    };
    document.getElementById('replaceForm').onsubmit = function (e) {
      e.preventDefault();
      var input = fd(this); input.oldCollected = this.elements.oldCollected.checked;
      api('/api/replacements', { body: JSON.stringify(input) }).then(function (r) {
        flash((r.reused ? '重复请求，沿用首次结果：' : '换环单 ' + r.replacement.id + '：') + (r.replacement.state === 'completed' ? '新环已启用、旧环已停用' : '仅转待回收（' + r.replacement.blockers.map(function (b) { return BLOCKER_TEXT[b]; }).join('、') + '）'), true);
        load();
      }).catch(function (err) { flash(err.message); });
    };

    document.addEventListener('click', function (e) {
      var t = e.target;
      var run = function (path, opts, ok) { api(path, opts).then(function () { flash(ok, true); load(); }).catch(function (err) { flash(err.message); }); };
      if (t.dataset.history) return showHistory(t.dataset.history);
      if (t.dataset.transfer) { var to = prompt('新归属鸽主'); if (to) run('/api/pigeons/' + t.dataset.transfer + '/transfers', { body: JSON.stringify({ to: to }) }, '转让已登记，归属仍随鸽只'); }
      if (t.dataset.vaccine) { var name = prompt('疫苗名称'); if (name) run('/api/pigeons/' + t.dataset.vaccine + '/vaccines', { body: JSON.stringify({ name: name }) }, '疫苗已登记'); }
      if (t.dataset.race) { var ev = prompt('赛事名称 / 距离，如 300公里训放/300'); if (ev) { var a = ev.split('/'); run('/api/pigeons/' + t.dataset.race + '/races', { body: JSON.stringify({ event: a[0], distance: Number(a[1] || 0) }) }, '已报名，赛事结束前换环仅转待回收'); } }
      if (t.dataset.finish) { var fin = prompt('归巢时间 / 名次，如 12:35/6'); if (fin !== null) { var b = fin.split('/'); run('/api/pigeons/' + t.dataset.finish + '/races/finish', { body: JSON.stringify({ finishTime: b[0] || '', rank: b[1] == null ? null : Number(b[1]) }) }, '赛事已结束'); } }
      if (t.dataset.confirm) {
        var id = t.dataset.confirm;
        var verifier = document.querySelector('[data-cv="' + id + '"]').value;
        var collected = document.querySelector('[data-cc="' + id + '"]').checked;
        run('/api/replacements/' + encodeURIComponent(id) + '/confirm', { body: JSON.stringify({ verifier: verifier, oldCollected: collected }) }, '已处理确认，结果以单据状态为准');
      }
    });

    load();
  </script>
</body>
</html>`;
