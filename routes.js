// 入口层：HTTP 路由与页面。只做请求解析、状态码映射和渲染，不含业务判定。
import http from "node:http";
import {
  HttpError, fullState, relationOf, createPigeon, addTransfer, addVaccine, addRace, finishRace,
  engrave, issue, replaceRing, confirmReplace
} from "./service.js";

const port = Number(process.env.PORT || 3024);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "invalid_json"); }
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>足环刻印发放与换环核验台</title>
<style>
:root{--bg:#eef1f4;--panel:#fff;--ink:#1f2833;--muted:#68778;--line:#d2dbe3;--accent:#2f5f86;--warn:#9a6b1f;--red:#9b3f35;--green:#2f6d4f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Arial,"PingFang SC",sans-serif}
header{padding:20px 26px;background:#fff;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:14px}
h1{margin:0;font-size:23px}h2{margin:0 0 10px;font-size:16px}h3{margin:0;font-size:15px}
main{padding:18px 24px;display:grid;grid-template-columns:370px 1fr;gap:16px;align-items:start}
.panel,form,.card,.row{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}
.col{display:grid;gap:14px}.stack{display:grid;gap:12px}
label{display:block;margin:8px 0 4px;color:var(--muted);font-size:12px}
input,select{width:100%;border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}
button{border:0;border-radius:6px;background:var(--accent);color:#fff;padding:8px 12px;font-weight:700;cursor:pointer}
button.ghost{background:#eef3f7;color:var(--accent)}button.warn{background:var(--warn)}button.small{padding:5px 9px;font-size:12px}
.meta{color:var(--muted);font-size:12px}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:12px;margin:2px 4px 2px 0}
.pill.active{background:#e7f3ec;border-color:var(--green);color:var(--green)}
.pill.engraved{background:#eef3f7;color:var(--accent);border-color:var(--accent)}
.pill.reserved{background:#faf2e2;color:var(--warn);border-color:var(--warn)}
.pill.recycled{background:#f3f3f3;color:var(--muted)}
.pill.pending_recycle{background:#faf2e2;color:var(--warn);border-color:var(--warn)}
.pill.completed{background:#e7f3ec;color:var(--green);border-color:var(--green)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:11px}
.card{display:grid;gap:7px}.itemline{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.toast{position:fixed;right:18px;bottom:18px;max-width:380px;background:#22303c;color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;display:none}
.toast.err{background:var(--red)}
.issue-item{border:1px dashed var(--line);border-radius:6px;padding:8px;margin-bottom:8px}
.history{max-height:150px;overflow:auto;background:#f8fafb;border-radius:6px;padding:8px;font-size:12px}
@media(max-width:960px){main{grid-template-columns:1fr;padding:12px}}
</style>
</head>
<body>
<header><div><h1>足环刻印发放与换环核验台</h1><div class="meta">刻印码唯一 · 发放核批次鸽主鸽只 · 换环回收旧环 + 他人按损伤等级核验</div></div><button id="reload">刷新</button></header>
<main>
<div class="stack">
  <form id="engraveForm" class="panel">
    <h2>① 足环刻印</h2>
    <label>刻印码（多码用逗号或换行）</label><input name="codes" required placeholder="CHN-2026-100, CHN-2026-101">
    <label>批次</label><input name="batch" required placeholder="2026秋-第一批">
    <label>备注</label><input name="note">
    <button>刻印入库</button>
  </form>

  <form id="issueForm" class="panel">
    <h2>② 足环发放（逐项核对批次/鸽主/鸽只）</h2>
    <div id="issueItems"></div>
    <button type="button" class="ghost small" id="addIssue">+ 加一枚</button>
    <label>经办人</label><input name="operator" placeholder="发放员">
    <button style="margin-top:10px">整单发放</button>
  </form>

  <form id="replaceForm" class="panel">
    <h2>③ 换环核验</h2>
    <label>旧环（在役）</label><input name="oldCode" required>
    <label>新环（已刻印）</label><input name="newCode" required>
    <div class="itemline"><div><label>经办人</label><input name="operator" required></div><div><label>核验人（须另一人）</label><input name="verifier" required></div></div>
    <div class="itemline"><div><label>损伤等级</label><select name="damage"><option>完好</option><option>轻微磨损</option><option>严重损伤</option></select></div>
    <div><label>旧环已回收</label><select name="recycled"><option value="true">已回收</option><option value="false">未回收</option></select></div></div>
    <label style="display:flex;align-items:center;gap:6px;color:var(--ink)"><input type="checkbox" name="raceopen" style="width:auto"> 存在未结束参赛记录（模拟占用）</label>
    <button>提交核验换环</button>
  </form>
</div>

<div class="col">
  <section class="panel" id="pendingPanel"><h2>④ 待回收 / 处理中换环单</h2><div id="pending" class="meta">无</div></section>
  <section class="panel"><h2>⑤ 足环总览（码/批次/状态）</h2><div class="meta" style="margin-bottom:8px">同羽只允许一枚 active；点卡片看履历</div><div class="grid" id="rings"></div></section>
  <section class="panel"><h2>⑥ 鸽只档案（血统/疫苗/转让/成绩归鸽只，不随换环走）</h2><div class="grid" id="pigeons" style="margin-top:8px"></div></section>
  <section class="panel" id="detailPanel"><h2>履历</h2><div id="detail" class="meta">点击任意足环或鸽只查看。</div></section>
</div>
</main>
<div class="toast" id="toast"></div>

<script>
const $=s=>document.querySelector(s);
let state={rings:[],pigeons:[],replaceOrders:[],issueOrders:[]};
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function toast(msg,isErr){const t=$("#toast");t.textContent=msg;t.className="toast"+(isErr?" err":"");t.style.display="block";clearTimeout(t._h);t._h=setTimeout(()=>t.style.display="none",3500);}
async function api(path,opt){
  const res=await fetch(path,opt?{method:opt.method||"POST",headers:{"Content-Type":"application/json"},body:opt.body?JSON.stringify(opt.body):undefined}:undefined);
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(data.error||"请求失败"),{detail:data});
  return data;
}
function ringPill(status){return '<span class="pill '+status+'">'+({active:"在役",engraved:"已刻印",reserved:"已预留",recycled:"已回收停用"}[status]||status)+"</span>";}

function issueItemHtml(){
  return '<div class="issue-item"><label>足环码</label><input class="i-code"><label>批次</label><input class="i-batch"><div class="itemline"><div><label>鸽主</label><input class="i-owner"></div><div><label>鸽只（档案ID或环码）</label><input class="i-pigeon"></div></div></div>';
}
function renderIssueRows(){const box=$("#issueItems");if(!box.children.length)box.innerHTML=issueItemHtml();}
$("#addIssue").onclick=()=>{$("#issueItems").insertAdjacentHTML("beforeend",issueItemHtml());};

function renderPending(){
  const orders=state.replaceOrders.filter(o=>o.status!=="completed");
  $("#pending").innerHTML=orders.length?orders.map(o=>
    '<div class="row" style="margin-bottom:8px"><b>'+o.id+'</b> <span class="pill '+o.status+'">待回收</span> '+
    esc(o.oldCode)+' → '+esc(o.newCode)+'<div class="meta">阻塞原因：'+(o.blockedReasons||[]).join("、")+'</div>'+
    '<div class="meta">经办 '+esc(o.operator)+' / 核验 '+esc(o.verifier)+' / 损伤 '+esc(o.damage)+' / '+(o.recycled?"旧环已回收":"旧环未回收")+'</div>'+
    '<div class="itemline" style="margin-top:6px"><input class="p-verify" placeholder="换一位核验人" value="'+esc(o.verifier)+'"><select class="p-recycled"><option value="true">旧环已回收</option><option value="false">旧环未回收</option></select></div>'+
    '<button class="small warn" data-confirm="'+o.id+'">再次核验并确认</button></div>').join(""):"<span class=meta>无待回收单据</span>";
  document.querySelectorAll("[data-confirm]").forEach(b=>b.onclick=async()=>{
    const box=b.closest(".row");
    try{ await api("/api/replace-rings/"+b.dataset.confirm+"/confirm",{body:{verifier:box.querySelector(".p-verify").value,recycled:box.querySelector(".p-recycled").value==="true",damage:"轻微磨损",operator:state.replaceOrders.find(o=>o.id===b.dataset.confirm).operator}}); await load(); toast("已再次核验"); }
    catch(e){toast(e.message,1);}
  });
}

function renderRings(){
  $("#rings").innerHTML=state.rings.map(r=>
    '<article class="card" data-ring="'+esc(r.code)+'" style="cursor:pointer"><h3>'+esc(r.code)+'</h3><div>'+ringPill(r.status)+'</div>'+
    '<div class="meta">批次：'+esc(r.batch)+'</div><div class="meta">鸽主：'+esc(r.pigeonOwner||"—")+'</div></article>').join("");
  document.querySelectorAll("[data-ring]").forEach(el=>el.onclick=()=>showRing(el.dataset.ring));
}
function renderPigeons(){
  $("#pigeons").innerHTML=state.pigeons.map(p=>
    '<article class="card" data-pid="'+esc(p.id)+'" style="cursor:pointer"><h3>'+esc(p.id)+' · '+esc(p.activeRingCode||p.ringNo)+'</h3>'+
    ringPill(p.activeRingStatus==="none"?"recycled":p.activeRingStatus)+
    '<span class="pill">'+esc(p.owner)+'</span><div class="meta">'+esc(p.color)+' · '+esc(p.loft)+'</div>'+
    '<div class="meta">父 '+esc(p.fatherRing||"未登记")+' / 母 '+esc(p.motherRing||"未登记")+'</div>'+
    '<div class="meta">疫苗 '+p.vaccines.length+' · 转让 '+p.transfers.length+' · 成绩 '+p.races.length+'</div>'+
    '<button class="small ghost" data-rel="'+esc(p.activeRingCode||p.ringNo)+'">血统/履历</button></article>').join("");
  document.querySelectorAll("[data-rel]").forEach(b=>b.onclick=e=>{e.stopPropagation();showRelation(b.dataset.rel);});
  document.querySelectorAll("[data-pid]").forEach(el=>el.onclick=e=>{if(!e.target.dataset.rel)showPigeon(el.dataset.pid);});
}
function hLine(h){return "["+esc(h.at||"")+"] "+({engrave:"刻印入库",issue:"发放上脚",deactivate:"旧环停用",recycle:"旧环回收"}[h.type]||h.type)+" "+esc(h.ring)+(h.batch?"（"+esc(h.batch)+"）":"")+(h.owner?" → "+esc(h.owner):"");}
function showRing(code){
  const r=state.rings.find(x=>x.code===code), p=r&&state.pigeons.find(x=>x.id===r.pigeonId);
  $("#detail").innerHTML='<b>'+esc(r.code)+'</b> '+ringPill(r.status)+'<div class="meta">批次 '+esc(r.batch)+(p?' · 绑定鸽只 '+esc(p.id):"")+'</div>'+
    '<div class="meta">刻印 '+(r.engravedAt||"—")+' · 发放 '+(r.issuedAt||"—")+' · 停用 '+(r.deactivatedAt||"—")+' · 回收 '+(r.recycledAt||"—")+'</div>'+
    (p?'<div class="meta">鸽只全部记录仍归 <b>'+esc(p.id)+'</b>：疫苗/转让/成绩不随换环迁移</div>':"");
}
function showPigeon(id){
  const p=state.pigeons.find(x=>x.id===id);
  $("#detail").innerHTML='<b>'+esc(p.id)+'</b> 在役环：'+esc(p.activeRingCode||"无")+
    '<div class="history">'+(p.ringHistory.length?p.ringHistory.map(hLine).join("<br>"):"暂无环履历")+'</div>'+
    '<div class="meta">疫苗：'+(p.vaccines.map(v=>esc(v.date)+" "+esc(v.name)).join("、")||"无")+'</div>'+
    '<div class="meta">转让：'+(p.transfers.map(t=>esc(t.from)+"→"+esc(t.to)).join("、")||"无")+'</div>'+
    '<div class="meta">成绩：'+(p.races.map(r=>esc(r.event)+" 第"+r.rank+"名 ["+(r.status==="finished"?"已结束":"未结束")+"]").join("、")||"无")+'</div>';
}
async function showRelation(code){
  try{
    const d=await api("/api/pigeons/"+encodeURIComponent(code)+"/relation");
    $("#detail").innerHTML='<b>'+esc(d.pigeon.id)+' · '+esc(d.pigeon.activeRingCode)+' 血统</b>'+
      '<div class="meta">父：'+esc(d.father?.activeRingCode||d.pigeon.fatherRing||"未登记")+' / 母：'+esc(d.mother?.activeRingCode||d.pigeon.motherRing||"未登记")+'</div>'+
      '<div class="meta">子代：'+(d.children.map(c=>esc(c.id)+"@"+esc(c.activeRingCode)).join("、")||"无")+'</div>'+
      '<div class="history">'+(d.pigeon.ringHistory.map(hLine).join("<br>")||"暂无环履历")+'</div>';
  }catch(e){toast(e.message,1);}
}

async function load(){state=await api("/api/state");renderPending();renderRings();renderPigeons();}
$("#reload").onclick=()=>load().then(()=>toast("已刷新，状态与服务端一致"));

$("#engraveForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);
  try{await api("/api/rings/engrave",{body:{codes:f.get("codes").split(/[,，\\n]/).map(s=>s.trim()).filter(Boolean),batch:f.get("batch"),note:f.get("note")}});e.target.reset();await load();toast("刻印完成");}catch(err){toast(err.message+(err.detail&&err.detail.code?"："+err.detail.code:""),1);}};

$("#issueForm").onsubmit=async e=>{e.preventDefault();
  const items=[...document.querySelectorAll("#issueItems .issue-item")].map(box=>({code:box.querySelector(".i-code").value,batch:box.querySelector(".i-batch").value,owner:box.querySelector(".i-owner").value,pigeon:box.querySelector(".i-pigeon").value})).filter(x=>x.code);
  try{await api("/api/rings/issue",{body:{items,operator:e.target.operator.value}});await load();toast("发放成功");}catch(err){toast(err.message+(Object.keys(err.detail||{}).length?"："+JSON.stringify(err.detail):""),1);}};

$("#replaceForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const oldCode=f.get("oldCode");
  try{
    if(f.get("raceopen")==="on"){ // 先给该鸽只挂一条未结束参赛记录，再提交换环
      const p=state.pigeons.find(x=>x.activeRingCode===oldCode);
      if(p)await api("/api/pigeons/"+p.id+"/races",{body:{event:"500公里联赛",distance:500,rank:0,status:"open"}});
    }
    const r=await api("/api/rings/replace",{body:{oldCode,newCode:f.get("newCode"),operator:f.get("operator"),verifier:f.get("verifier"),damage:f.get("damage"),recycled:f.get("recycled")==="true"}});
    toast(r.status===200||r.reused?"重复请求：沿用首次结果 "+r.id:"换环完成 "+r.id+"（"+r.status+"）");
    if(r.status==="pending_recycle"||r.blockedReasons&&r.blockedReasons.length)toast("只转待回收："+r.blockedReasons.join("、"));
    await load();
  }catch(err){toast(err.message+(Object.keys(err.detail||{}).length?"："+JSON.stringify(err.detail):""),1);}
};

renderIssueRows();load();
</script>
</body>
</html>`;

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  if (req.method === "GET" && p === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (req.method === "GET" && p === "/api/state") return sendJson(res, 200, await fullState());

  if (req.method === "POST" && p === "/api/rings/engrave") {
    const out = await engrave(await readBody(req));
    return sendJson(res, out.status, out.value);
  }
  if (req.method === "POST" && p === "/api/rings/issue") {
    const out = await issue(await readBody(req));
    return sendJson(res, out.status, out.value);
  }
  if (req.method === "POST" && p === "/api/rings/replace") {
    const out = await replaceRing(await readBody(req));
    return sendJson(res, out.status, { ...out.value, reused: out.reused });
  }
  const confirmMatch = p.match(/^\/api\/replace-rings\/([^/]+)\/confirm$/);
  if (confirmMatch && req.method === "POST") {
    const out = await confirmReplace(decodeURIComponent(confirmMatch[1]), await readBody(req));
    return sendJson(res, out.status, { ...out.value, reused: out.reused });
  }

  if (req.method === "GET" && p === "/api/pigeons") return sendJson(res, 200, (await fullState()).pigeons);
  if (req.method === "POST" && p === "/api/pigeons") {
    const out = await createPigeon(await readBody(req));
    return sendJson(res, out.status, out.value);
  }
  const relMatch = p.match(/^\/api\/pigeons\/(.+)\/relation$/);
  if (relMatch && req.method === "GET") return sendJson(res, 200, await relationOf(decodeURIComponent(relMatch[1])));

  const actMatch = p.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
  if (actMatch && req.method === "POST") {
    const id = decodeURIComponent(actMatch[1]);
    const input = await readBody(req);
    const out = actMatch[2] === "transfers" ? await addTransfer(id, input)
      : actMatch[2] === "vaccines" ? await addVaccine(id, input)
      : await addRace(id, input);
    return sendJson(res, out.status, out.value);
  }
  const finishMatch = p.match(/^\/api\/pigeons\/(.+)\/races\/([^/]+)\/finish$/);
  if (finishMatch && req.method === "POST") {
    const out = await finishRace(decodeURIComponent(finishMatch[1]), decodeURIComponent(finishMatch[2]));
    return sendJson(res, out.status, out.value);
  }

  sendJson(res, 404, { error: "not_found" });
}

export function start() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.error, detail: error.detail });
      sendJson(res, 500, { error: error.message });
    });
  });
  server.listen(port, () => console.log(`足环刻印发放与换环核验台 listening on http://localhost:${port}`));
  return server;
}
