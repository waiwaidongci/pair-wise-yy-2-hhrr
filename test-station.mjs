// 端到端规则测试：临时 DB + 真实 HTTP 服务
process.env.STATION_DB = new URL("./tmp-test/station.json", import.meta.url).pathname;
const { rmSync } = await import("node:fs");
rmSync(new URL("./tmp-test", import.meta.url), { recursive: true, force: true });

const server = (await import("./server.js")).default;
await new Promise(resolve => server.listen(3024, resolve));
const base = "http://localhost:3024";
let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failures.push(name); console.log("  ✗", name, detail || ""); }
}
async function req(method, path, payload) {
  const res = await fetch(base + path, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : {},
    body: payload ? JSON.stringify(payload) : undefined
  });
  const data = await res.json();
  return { status: res.status, data };
}
const get = path => req("GET", path);
const post = (path, payload) => req("POST", path, payload);

// 等端口就绪
await new Promise(r => setTimeout(r, 50));

console.log("1. 迁移：旧档案 → 鸽只 + 足环台账");
{
  const { status, data } = await get("/api/pigeons");
  check("列表 200", status === 200);
  check("3 羽迁移", data.length === 3);
  const p1 = data.find(p => p.id === "P-001");
  check("P-001 在役环 CHN-2026-001", p1.activeRingCode === "CHN-2026-001");
  check("血统/疫苗/转让/成绩保留", p1.fatherRing === "CHN-2022-188" && p1.vaccines.length === 1 && p1.transfers.length === 1 && p1.races.length === 1);
  check("历史成绩为 finished", p1.races[0].status === "finished");
  const rings = (await get("/api/rings")).data;
  check("台账 4 枚（3 在役 + 1 已刻印）", rings.length === 4 && rings.filter(r => r.status === "in_use").length === 3 && rings.find(r => r.code === "CHN-2026-002").status === "engraved");
}

console.log("2. 刻印：码唯一，并发只有一枚成功");
{
  const dup = await post("/api/rings/engrave", { code: "CHN-2026-001", batch: "B-2026" });
  check("重复刻印 409 ring_code_occupied", dup.status === 409 && dup.data.error === "ring_code_occupied");
  const results = await Promise.all(Array.from({ length: 10 }, () => post("/api/rings/engrave", { code: "CHN-2026-099", batch: "B-2026" })));
  check("10 并发刻印：恰好 1 成功", results.filter(r => r.status === 201).length === 1);
  check("其余 409", results.filter(r => r.status === 409).length === 9);
}

console.log("3. 发放：批次/鸽主/鸽只核对 + 同羽唯一在役");
{
  // 先建一羽无环新鸽
  const { data: np } = await post("/api/pigeons", { owner: "东风棚", color: "白", loft: "东风1号", fatherRing: "", motherRing: "" });
  check("新鸽无在役环", np.activeRingCode === null);

  const noCode = await post("/api/rings/issue", { code: "CHN-9999-000", batch: "B-2026", pigeonId: np.id, owner: "东风棚" });
  check("未刻印码 → 409 ring_code_occupied", noCode.status === 409 && noCode.data.error === "ring_code_occupied");
  const badBatch = await post("/api/rings/issue", { code: "CHN-2026-002", batch: "B-2099", pigeonId: np.id, owner: "东风棚" });
  check("批次不符 → 409 batch_mismatch", badBatch.status === 409 && badBatch.data.error === "batch_mismatch");
  const badOwner = await post("/api/rings/issue", { code: "CHN-2026-002", batch: "B-2026", pigeonId: np.id, owner: "冒领棚" });
  check("鸽主不符 → 409 owner_mismatch", badOwner.status === 409 && badOwner.data.error === "owner_mismatch");
  const active = await post("/api/rings/issue", { code: "CHN-2026-002", batch: "B-2026", pigeonId: "P-001", owner: "北岸棚" });
  check("已有在役环 → 409 active_ring_exists", active.status === 409 && active.data.error === "active_ring_exists");
  check("整单不写：备用环仍 engraved", (await get("/api/rings")).data.find(r => r.code === "CHN-2026-002").status === "engraved");

  const ok = await post("/api/rings/issue", { code: "CHN-2026-002", batch: "B-2026", pigeonId: np.id, owner: "东风棚" });
  check("核对全过 → 201 在役", ok.status === 201 && ok.data.ring.status === "in_use" && ok.data.pigeon.activeRingCode === "CHN-2026-002");
  const again = await post("/api/rings/issue", { code: "CHN-2026-002", batch: "B-2026", pigeonId: np.id, owner: "东风棚" });
  check("同羽再发 → 409 ring_not_available", again.status === 409);
}

console.log("4. 换环 happy path：旧环停用、新环启用、档案仍归鸽只");
{
  await post("/api/rings/engrave", { code: "CHN-2026-100", batch: "B-2026" });
  const r = await post("/api/replacements", { pigeonId: "P-001", oldCode: "CHN-2026-001", newCode: "CHN-2026-100", damageLevel: "严重", operator: "张三", verifier: "李四", oldCollected: true });
  check("换环 201 completed", r.status === 201 && r.data.replacement.state === "completed" && r.data.reused === false);
  const hist = (await get("/api/pigeons/P-001/history")).data;
  check("新环在役", hist.rings.find(x => x.code === "CHN-2026-100").status === "in_use");
  check("旧环 retired", hist.rings.find(x => x.code === "CHN-2026-001").status === "retired");
  check("pigeon.ringNo 已更新", hist.pigeon.ringNo === "CHN-2026-100" && hist.pigeon.activeRingCode === "CHN-2026-100");
  check("血统/疫苗/转让/成绩仍归鸽只", hist.pigeon.fatherRing === "CHN-2022-188" && hist.pigeon.vaccines.length === 1 && hist.pigeon.transfers.length === 1 && hist.pigeon.races.length === 1);
  check("履历含 retired/issued 事件", hist.rings.find(x => x.code === "CHN-2026-001").history.some(h => h.action === "retired"));

  const retired = await post("/api/replacements", { pigeonId: "P-001", oldCode: "CHN-2026-001", newCode: "CHN-2026-100", damageLevel: "严重", operator: "张三", verifier: "李四", oldCollected: true });
  check("相同请求重放 → 沿用首次完成结果", retired.status === 201 && retired.data.reused === true && retired.data.replacement.state === "completed");
  await post("/api/rings/engrave", { code: "CHN-2026-300", batch: "B-2026" });
  const retiredDiff = await post("/api/replacements", { requestId: "distinct-after-complete", pigeonId: "P-001", oldCode: "CHN-2026-001", newCode: "CHN-2026-300", damageLevel: "轻微", operator: "张三", verifier: "李四", oldCollected: true });
  check("异键再换已停用旧环 → 409 old_ring_retired", retiredDiff.status === 409 && retiredDiff.data.error === "old_ring_retired");
}

console.log("5. 换环阻断：未回收 / 同人核验 / 未结束赛事 → 只转待回收");
{
  await post("/api/rings/engrave", { code: "CHN-2026-101", batch: "B-2026" });
  await post("/api/rings/engrave", { code: "CHN-2026-102", batch: "B-2026" });
  await post("/api/rings/engrave", { code: "CHN-2026-103", batch: "B-2026" });

  // P-002: 未回收 + 同人核验
  const r1 = await post("/api/replacements", { pigeonId: "P-002", oldCode: "CHN-2022-188", newCode: "CHN-2026-101", damageLevel: "中度", operator: "王五", verifier: "王五", oldCollected: false });
  check("只转待回收 pending", r1.status === 201 && r1.data.replacement.state === "pending");
  check("带两个 blockers", r1.data.replacement.blockers.includes("old_ring_not_collected") && r1.data.replacement.blockers.includes("same_verifier"));
  const h2 = (await get("/api/pigeons/P-002/history")).data;
  check("旧环 pending_recycle", h2.rings.find(x => x.code === "CHN-2022-188").status === "pending_recycle");
  check("新环未被启用（仍 engraved）", (await get("/api/rings")).data.find(x => x.code === "CHN-2026-101").status === "engraved");
  check("鸽只暂不切换，无在役环", h2.pigeon.activeRingCode === null && h2.pigeon.ringNo === "CHN-2022-188");

  // 不同的新环再试 → 409 进行中
  const other = await post("/api/replacements", { pigeonId: "P-002", oldCode: "CHN-2022-188", newCode: "CHN-2026-102", damageLevel: "中度", operator: "王五", verifier: "李四", oldCollected: true });
  check("待回收期间别的换环 → 409 replacement_in_progress", other.status === 409 && other.data.error === "replacement_in_progress");
  check("预留新环不能被发放", (await post("/api/rings/issue", { code: "CHN-2026-101", batch: "B-2026", pigeonId: "P-003", owner: "育种棚" })).status === 409);

  // P-003: 报名赛事，未结束 → 待回收
  await post("/api/pigeons/P-003/races", { event: "500公里决赛", distance: 500 });
  const r2 = await post("/api/replacements", { pigeonId: "P-003", oldCode: "CHN-2023-512", newCode: "CHN-2026-102", damageLevel: "轻微", operator: "赵六", verifier: "钱七", oldCollected: true });
  check("未结束赛事 → pending + race_ongoing", r2.data.replacement.state === "pending" && r2.data.replacement.blockers.includes("race_ongoing"));
}

console.log("6. 待回收单转正式：补齐条件后确认");
{
  const list = (await get("/api/replacements?state=pending")).data;
  const p2 = list.find(o => o.pigeonId === "P-002");
  const p3 = list.find(o => o.pigeonId === "P-003");

  // 条件未补齐（仍不回收、仍同人）→ 保持 pending
  const still = await post(`/api/replacements/${p2.id}/confirm`, { verifier: "王五", oldCollected: false });
  check("确认时条件仍缺 → 200 仍 pending", still.data.replacement.state === "pending");

  // 补齐回收 + 他人核验
  const ok2 = await post(`/api/replacements/${p2.id}/confirm`, { verifier: "李四", oldCollected: true });
  check("P-002 转正式 completed", ok2.data.replacement.state === "completed" && ok2.data.replacement.blockers.length === 0);
  const h = (await get("/api/pigeons/P-002/history")).data;
  check("新环启用 / 旧环停用", h.rings.find(x => x.code === "CHN-2026-101").status === "in_use" && h.rings.find(x => x.code === "CHN-2022-188").status === "retired");
  check("activeRingCode 已切换", h.pigeon.activeRingCode === "CHN-2026-101");

  // P-003 赛事未结束时确认 → 仍 pending
  const blocked = await post(`/api/replacements/${p3.id}/confirm`, { verifier: "钱七", oldCollected: true });
  check("赛事未结束 → 仍 pending", blocked.data.replacement.state === "pending" && blocked.data.replacement.blockers.includes("race_ongoing"));
  await post("/api/pigeons/P-003/races/finish", { event: "500公里决赛", finishTime: "13:20", rank: 9 });
  const ok3 = await post(`/api/replacements/${p3.id}/confirm`, { verifier: "钱七", oldCollected: true });
  check("赛事结束后确认 → completed", ok3.data.replacement.state === "completed");
  const h3 = (await get("/api/pigeons/P-003/history")).data;
  check("成绩仍归鸽只且随环保留", h3.pigeon.races.length === 1 && h3.pigeon.races[0].status === "finished" && h3.pigeon.races[0].rank === 9);
  check("新环在役", h3.pigeon.activeRingCode === "CHN-2026-102");
}

console.log("7. 重复/并发换环沿用首次结果");
{
  await post("/api/rings/engrave", { code: "CHN-2026-200", batch: "B-2026" });
  await post("/api/rings/engrave", { code: "CHN-2026-201", batch: "B-2026" });
  // P-004 = 第四羽（东风棚，持 002）
  const all = await get("/api/pigeons");
  const p4 = all.data.find(p => p.owner === "东风棚");

  // 相同请求连发两次（旧环未回收 → pending）
  const payload = { requestId: "fixed-key-1", pigeonId: p4.id, oldCode: "CHN-2026-002", newCode: "CHN-2026-200", damageLevel: "中度", operator: "甲", verifier: "乙", oldCollected: false };
  const first = await post("/api/replacements", payload);
  const second = await post("/api/replacements", payload);
  check("重复请求返回同一单号", first.data.replacement.id === second.data.replacement.id);
  check("第二次标记 reused", second.data.reused === true);
  check("两次均 pending", first.data.replacement.state === "pending" && second.data.replacement.state === "pending");

  // 10 个并发的新换环（不同 requestId，环不同）应 1 个 409（in_progress）之外——实际：首个 pending 后其余 409
  const conc = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    post("/api/replacements", { requestId: `k-${i}`, pigeonId: p4.id, oldCode: "CHN-2026-002", newCode: "CHN-2026-201", damageLevel: "轻微", operator: "甲", verifier: "乙", oldCollected: true })));
  check("并发异键换环：0 次新写、全部 409", conc.every(r => r.status === 409));

  // 确认首个 pending 单后，再用原 key 重放 → 沿用 completed
  await post(`/api/replacements/${first.data.replacement.id}/confirm`, { verifier: "乙", oldCollected: true });
  const replay = await post("/api/replacements", payload);
  check("完成后原 key 重放 → 同一单且 completed", replay.data.replacement.id === first.data.replacement.id && replay.data.replacement.state === "completed");
}

console.log("8. 转让/疫苗归鸽只，刷新后一致");
{
  await post("/api/pigeons/P-001/transfers", { to: "西水棚" });
  await post("/api/pigeons/P-001/vaccines", { name: "禽流感" });
  const fresh = (await get("/api/pigeons/P-001/history")).data;
  check("换环后转让仍生效", fresh.pigeon.owner === "西水棚" && fresh.pigeon.transfers.length === 2);
  check("疫苗挂鸽只", fresh.pigeon.vaccines.length === 2);
  check("在役环发放鸽主不影响现归属", fresh.rings.find(r => r.code === "CHN-2026-100").status === "in_use");
  const listView = (await get("/api/pigeons")).data.find(p => p.id === "P-001");
  check("列表与履历一致（同一在役环）", listView.activeRingCode === fresh.pigeon.activeRingCode);
}

console.log("9. 异常输入");
{
  check("缺鸽主 400", (await post("/api/pigeons", { color: "灰", loft: "x" })).status === 400);
  check("非法 JSON 400", await new Promise(async resolve => {
    const r = await fetch(base + "/api/pigeons", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
    resolve(r.status === 400);
  }));
  check("未知路由 404", (await get("/api/nope")).status === 404);
  check("鸽只不存在 404", (await get("/api/pigeons/P-999/history")).status === 404);
  check("损伤等级非法 400", (await post("/api/replacements", { pigeonId: "P-001", oldCode: "x", newCode: "y", damageLevel: "报废", verifier: "乙" })).status === 400);
}

console.log("");
console.log(`通过 ${passed} 项`);
if (failures.length) { console.error("失败：", failures); process.exitCode = 1; }
process.exit(process.exitCode || 0);
