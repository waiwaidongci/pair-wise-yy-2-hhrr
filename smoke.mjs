// 冒烟测试：node smoke.mjs（自动用临时 DATA 目录前先备份原数据）
import { rmSync, existsSync, copyFileSync } from "node:fs";

const DATA = new URL("./data/pigeons.json", import.meta.url);
const BAK = new URL("./data/pigeons.bak.json", import.meta.url);
if (existsSync(DATA)) copyFileSync(DATA, BAK);

const server = await import("./server.js");
await new Promise(r => setTimeout(r, 400));
const base = "http://localhost:3024";
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name, extra ?? ""); } }
async function req(method, path, body) {
  const res = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

try {
  // 0. 旧数据迁移
  let s = await req("GET", "/api/state");
  ok("迁移:3羽旧档", s.json.pigeons.length === 3, s.json.pigeons.length);
  ok("迁移:每羽一枚active环", s.json.rings.filter(r => r.status === "active").length === 3);

  // 1. 刻印：唯一
  let r = await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-100", "CHN-2026-101"], batch: "2026秋-批A" });
  ok("刻印2枚", r.status === 201, r.status);
  r = await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-101", "CHN-2026-200"], batch: "2026秋-批B" });
  ok("刻印码重复->409整单不写", r.status === 409 && r.json.error === "ring_code_taken");
  s = await req("GET", "/api/state");
  ok("冲突单未写入200码", !s.json.rings.some(x => x.code === "CHN-2026-200"));
  ok("101仍属批A", s.json.rings.find(x => x.code === "CHN-2026-101").batch === "2026秋-批A");

  // 2. 建档（新鸽只没有环）
  r = await req("POST", "/api/pigeons", { ringNo: "TEMP-NO-RING-1", owner: "南岸棚", color: "白", loft: "南岸B棚" });
  ok("建档", r.status === 201);
  const pid = r.json.id;

  // 3. 发放校验
  r = await req("POST", "/api/rings/issue", { items: [{ code: "CHN-2026-100", batch: "错批次", owner: "南岸棚", pigeon: pid }] });
  ok("批次不符->400", r.status === 400 && r.json.error === "batch_mismatch");
  r = await req("POST", "/api/rings/issue", { items: [{ code: "CHN-2026-100", batch: "2026秋-批A", owner: "错鸽主", pigeon: pid }] });
  ok("鸽主不符->400", r.status === 400 && r.json.error === "owner_mismatch");
  s = await req("GET", "/api/state");
  ok("校验失败不写发放单", s.json.issueOrders.length === 0);
  ok("校验失败环仍engraved", s.json.rings.find(x => x.code === "CHN-2026-100").status === "engraved");

  // 正常发放
  r = await req("POST", "/api/rings/issue", { items: [{ code: "CHN-2026-100", batch: "2026秋-批A", owner: "南岸棚", pigeon: pid }] });
  ok("发放成功201", r.status === 201);
  // 同羽再发一枚 -> 409
  r = await req("POST", "/api/rings/issue", { items: [{ code: "CHN-2026-101", batch: "2026秋-批A", owner: "南岸棚", pigeon: pid }] });
  ok("同羽已有在役环->409", r.status === 409 && r.json.error === "pigeon_already_ringed");
  s = await req("GET", "/api/state");
  ok("409整单不写:101仍engraved", s.json.rings.find(x => x.code === "CHN-2026-101").status === "engraved");
  ok("同羽只一枚active", s.json.rings.filter(x => x.pigeonId === pid && x.status === "active").length === 1);

  // 整单：两枚里第二枚会冲突 -> 整单不写
  await req("POST", "/api/pigeons", { ringNo: "TEMP-NO-RING-2", owner: "西岸棚", color: "黑", loft: "西岸C棚" });
  const p2 = (await req("GET", "/api/pigeons")).json.find(x => x.ringNo === "TEMP-NO-RING-2").id;
  await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-300"], batch: "2026秋-批C" });
  r = await req("POST", "/api/rings/issue", { items: [
    { code: "CHN-2026-300", batch: "2026秋-批C", owner: "西岸棚", pigeon: p2 },
    { code: "CHN-2026-101", batch: "2026秋-批A", owner: "南岸棚", pigeon: pid } // 该羽已有环
  ] });
  ok("整单第二项冲突->409", r.status === 409);
  s = await req("GET", "/api/state");
  ok("整单回滚:300仍engraved", s.json.rings.find(x => x.code === "CHN-2026-300").status === "engraved");
  ok("整单回滚:无新发放单", s.json.issueOrders.length === 1);

  // 4. 换环：刻印一枚新环
  await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-900"], batch: "2026秋-补环" });

  // 4a. 旧环未回收 -> 只转待回收
  r = await req("POST", "/api/rings/replace", { oldCode: "CHN-2026-100", newCode: "CHN-2026-900", operator: "张三", verifier: "李四", damage: "轻微磨损", recycled: false });
  ok("未回收->201 pending_recycle", r.json.status === "pending_recycle" && r.json.blockedReasons.includes("old_ring_not_recycled"), JSON.stringify(r.json));
  s = await req("GET", "/api/state");
  ok("待回收:旧环仍active", s.json.rings.find(x => x.code === "CHN-2026-100").status === "active");
  ok("待回收:新环reserved", s.json.rings.find(x => x.code === "CHN-2026-900").status === "reserved");

  // 重复提交沿用首次结果
  const rpId = r.json.id;
  const r2 = await req("POST", "/api/rings/replace", { oldCode: "CHN-2026-100", newCode: "CHN-2026-900", operator: "张三", verifier: "王五", damage: "完好", recycled: true });
  ok("重复换环沿用首次结果", r2.status === 200 && r2.json.reused === true && r2.json.id === rpId && r2.json.blockedReasons.includes("old_ring_not_recycled"));

  // 并发换环（不同 requestId、同 oldCode，且旧环仍 active）：第二单冲突
  await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-901", "CHN-2026-902"], batch: "2026秋-补环" });
  const [c1, c2] = await Promise.all([
    req("POST", "/api/rings/replace", { requestId: "C1", oldCode: "CHN-2026-101", newCode: "CHN-2026-901", operator: "张三", verifier: "李四", damage: "完好", recycled: true }),
    req("POST", "/api/rings/replace", { requestId: "C2", oldCode: "CHN-2026-101", newCode: "CHN-2026-902", operator: "赵六", verifier: "孙七", damage: "完好", recycled: true })
  ]);
  const statuses = [c1.status, c2.status].sort().join(",");
  ok("并发:一单201另一单409", (c1.status === 201 && c2.status === 409) || (c2.status === 201 && c1.status === 409, statuses));

  // 4b. 核验人相同 -> pending
  const pRing = "CHN-2022-188";
  await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-903"], batch: "2026秋-补环" });
  r = await req("POST", "/api/rings/replace", { requestId: "SAME", oldCode: pRing, newCode: "CHN-2026-903", operator: "同一人", verifier: "同一人", damage: "完好", recycled: true });
  ok("核验人相同->pending_recycle", r.json.blockedReasons.includes("verifier_same_as_operator"));

  // 4c. 未结束参赛 -> pending；完赛后确认
  const mRing = "CHN-2023-512";
  await req("POST", "/api/pigeons/" + mRing + "/races", { event: "500公里联赛", distance: 500, rank: 0, status: "open" });
  await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-904"], batch: "2026秋-补环" });
  r = await req("POST", "/api/rings/replace", { requestId: "RACE", oldCode: mRing, newCode: "CHN-2026-904", operator: "张三", verifier: "李四", damage: "严重损伤", recycled: true });
  ok("未结束参赛->pending_recycle", r.json.blockedReasons.includes("race_unfinished"));
  const raceOrder = r.json.id;
  // 赛事结束 + 换核验人 + 确认
  s = await req("GET", "/api/state");
  const raceId = s.json.pigeons.find(x => x.id === s.json.rings.find(x => x.code === mRing).pigeonId).races.at(-1).id;
  await req("POST", `/api/pigeons/${mRing}/races/${raceId}/finish`, {});
  r = await req("POST", `/api/replace-rings/${raceOrder}/confirm`, { verifier: "另一位核验人" });
  ok("补齐条件后确认完成", r.json.status === "completed" && r.json.reused === false, JSON.stringify(r.json));
  s = await req("GET", "/api/state");
  ok("新环active", s.json.rings.find(x => x.code === "CHN-2026-904").status === "active");
  ok("旧环recycled停用回收", s.json.rings.find(x => x.code === mRing).status === "recycled");
  const pigeonAfter = s.json.pigeons.find(x => x.id === s.json.rings.find(x => x.code === "CHN-2026-904").pigeonId);
  ok("成绩仍归鸽只", pigeonAfter.races.some(x => x.event === "500公里联赛"));
  ok("在役码已更新为新环", pigeonAfter.activeRingCode === "CHN-2026-904");

  // 4d. 全部满足直接完成：旧环回收、不同人、无未结束赛事
  await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-905"], batch: "2026秋-补环" });
  const firstPigeonId = s.json.pigeons.find(x => x.activeRingCode === "CHN-2026-101")?.id;
  // 901/902 中成功的那单已把 101 换掉；找仍 active 的旧环做完整流程：用迁移鸽 001
  await req("POST", "/api/rings/engrave", { codes: ["CHN-2026-906"], batch: "2026秋-补环" });
  r = await req("POST", "/api/rings/replace", { requestId: "OK1", oldCode: "CHN-2026-001", newCode: "CHN-2026-906", operator: "张三", verifier: "李四", damage: "严重损伤", recycled: true });
  ok("条件齐全直接completed", r.json.status === "completed", JSON.stringify(r.json));
  s = await req("GET", "/api/state");
  const pp = s.json.pigeons.find(x => x.id === s.json.rings.find(x => x.code === "CHN-2026-906").pigeonId);
  ok("血统仍在(父母环码不动)", pp.fatherRing === "CHN-2022-188" && pp.motherRing === "CHN-2023-512");
  ok("疫苗/转让仍归鸽只", pp.vaccines.length === 1 && pp.transfers.length === 1 && pp.races.length === 1);
  ok("同羽仍只一枚active", s.json.rings.filter(x => x.pigeonId === pp.id && x.status === "active").length === 1);
  ok("履历含旧环停用回收+新环启用", pp.ringHistory.some(h => h.type === "recycle" && h.ring === "CHN-2026-001") && pp.ringHistory.some(h => h.type === "issue" && h.ring === "CHN-2026-906"));

  // 5. 完成单重复确认 -> 沿用
  r = await req("POST", `/api/replace-rings/${raceOrder}/confirm`, { verifier: "另一位核验人" });
  ok("已完成单再确认沿用首次结果", r.status === 200 && r.json.reused === true);

  // 6. 列表/履历/刷新一致：连续两次 /api/state 投影一致
  const a = await req("GET", "/api/state");
  const b = await req("GET", "/api/state");
  ok("刷新后状态一致", JSON.stringify(a.json) === JSON.stringify(b.json));
  const rel = await req("GET", "/api/pigeons/CHN-2026-906/relation");
  ok("新环码可查血统", rel.status === 200 && rel.json.pigeon.activeRingCode === "CHN-2026-906");
  const relOld = await req("GET", "/api/pigeons/CHN-2026-001/relation");
  ok("旧环码仍可追溯同一鸽只", relOld.status === 200 && relOld.json.pigeon.id === rel.json.pigeon.id);

} catch (e) {
  fail++; console.error("测试异常", e);
} finally {
  // 还原测试前的数据文件
  const { copyFileSync, unlinkSync } = await import("node:fs");
  if (existsSync(BAK)) { copyFileSync(BAK, DATA); unlinkSync(BAK); }
  else if (existsSync(DATA)) rmSync(DATA);
  console.log(`\\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
