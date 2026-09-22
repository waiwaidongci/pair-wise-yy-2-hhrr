// 判定层：足环刻印、发放、换环核验的全部业务规则。
// 纯函数 + store.mutate 事务：校验失败抛 HttpError 时整单不写；
// 换环阻塞时不报错，而是把单据落为 pending_recycle（“只转待回收”）。
import { mutate, snapshot, nextId } from "./store.js";

export class HttpError extends Error {
  constructor(status, error, detail) {
    super(error);
    this.status = status;
    this.error = error;
    this.detail = detail || {};
  }
}

export const today = () => new Date().toISOString().slice(0, 10);
export const stamp = () => new Date().toISOString();

const DAMAGE_LEVELS = new Set(["完好", "轻微磨损", "严重损伤"]);

// ---------- 查询投影：在役环、鸽主、履历都从同一份存储实时推导，保证刷新一致 ----------

function ringByCode(db, code) {
  return db.rings.find(r => r.code === code) || null;
}
function activeRingOf(db, pigeonId) {
  return db.rings.find(r => r.pigeonId === pigeonId && r.status === "active") || null;
}
export function findPigeon(db, idOrCode) {
  const p = db.pigeons.find(x => x.id === idOrCode || x.ringNo === idOrCode);
  if (p) return p;
  const ring = ringByCode(db, idOrCode);
  return ring ? db.pigeons.find(x => x.id === ring.pigeonId) || null : null;
}

export function pigeonView(db, p) {
  const ring = activeRingOf(db, p.id);
  const history = [];
  for (const r of db.rings.filter(x => x.pigeonId === p.id)) {
    if (r.engravedAt) history.push({ at: r.engravedAt, type: "engrave", ring: r.code, batch: r.batch });
    if (r.issuedAt) history.push({ at: r.issuedAt, type: "issue", ring: r.code, owner: r.ownerSnapshot });
    if (r.deactivatedAt) history.push({ at: r.deactivatedAt, type: "deactivate", ring: r.code });
    if (r.recycledAt) history.push({ at: r.recycledAt, type: "recycle", ring: r.code });
  }
  history.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  return { ...p, ringNo: ring ? ring.code : p.ringNo, activeRingCode: ring ? ring.code : "", activeRingStatus: ring ? ring.status : "none", ringHistory: history };
}

function ringView(db, r) {
  const pigeon = r.pigeonId ? db.pigeons.find(p => p.id === r.pigeonId) || null : null;
  return { ...r, pigeonId: r.pigeonId || null, pigeonOwner: pigeon ? pigeon.owner : null };
}

function replaceView(db, o) {
  const pigeon = db.pigeons.find(p => p.id === o.pigeonId);
  return { ...o, pigeonOwner: pigeon ? pigeon.owner : null };
}

export async function fullState() {
  const db = await snapshot();
  return {
    pigeons: db.pigeons.map(p => pigeonView(db, p)),
    rings: db.rings.map(r => ringView(db, r)),
    issueOrders: db.issueOrders,
    replaceOrders: db.replaceOrders.map(o => replaceView(db, o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    damageLevels: [...DAMAGE_LEVELS]
  };
}

export async function relationOf(idOrCode) {
  return mutate(async (db) => ({ commit: false, value: (() => {
    const pigeon = findPigeon(db, idOrCode);
    if (!pigeon) throw new HttpError(404, "pigeon_not_found");
    const father = db.pigeons.find(x => x.ringNo === pigeon.fatherRing) || null;
    const mother = db.pigeons.find(x => x.ringNo === pigeon.motherRing) || null;
    const children = db.pigeons.filter(x => x.fatherRing === pigeon.ringNo || x.motherRing === pigeon.ringNo);
    return { pigeon: pigeonView(db, pigeon), father: father && pigeonView(db, father), mother: mother && pigeonView(db, mother), children: children.map(c => pigeonView(db, c)) };
  })() })).then(o => o.value);
}

// ---------- 档案（登记站原有功能保留，建档时不再自动发环，环须走刻印+发放） ----------

export async function createPigeon(input) {
  if (!input.ringNo || !input.owner || !input.color || !input.loft) {
    throw new HttpError(400, "missing_fields", { required: ["ringNo", "owner", "color", "loft"] });
  }
  return mutate(async (db) => {
    if (db.pigeons.some(p => p.ringNo === input.ringNo)) throw new HttpError(409, "ring_exists");
    const id = nextId(db, "pigeon", "P");
    const pigeon = {
      id, ringNo: input.ringNo, owner: input.owner,
      fatherRing: input.fatherRing || "", motherRing: input.motherRing || "",
      color: input.color, loft: input.loft,
      vaccines: [], transfers: [], races: []
    };
    db.pigeons.unshift(pigeon);
    return { status: 201, value: pigeonView(db, pigeon) };
  });
}

async function withPigeon(db, idOrCode, write = true) {
  const pigeon = findPigeon(db, idOrCode);
  if (!pigeon) throw new HttpError(404, "pigeon_not_found");
  return pigeon;
}

export async function addTransfer(idOrCode, input) {
  if (!input.to) throw new HttpError(400, "missing_fields", { required: ["to"] });
  return mutate(async (db) => {
    const pigeon = await withPigeon(db, idOrCode);
    pigeon.transfers.push({ date: input.date || today(), from: pigeon.owner, to: input.to });
    pigeon.owner = input.to;
    // 转让归鸽只：在役环上的鸽主快照同步，履历仍留在鸽只档案。
    const ring = activeRingOf(db, pigeon.id);
    if (ring) ring.ownerSnapshot = input.to;
    return { status: 200, value: pigeonView(db, pigeon) };
  });
}

export async function addVaccine(idOrCode, input) {
  if (!input.name) throw new HttpError(400, "missing_fields", { required: ["name"] });
  return mutate(async (db) => {
    const pigeon = await withPigeon(db, idOrCode);
    pigeon.vaccines.push({ date: input.date || today(), name: input.name });
    return { status: 200, value: pigeonView(db, pigeon) };
  });
}

export async function addRace(idOrCode, input) {
  if (!input.event) throw new HttpError(400, "missing_fields", { required: ["event"] });
  return mutate(async (db) => {
    const pigeon = await withPigeon(db, idOrCode);
    const race = {
      id: `R${stamp().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6)}`,
      date: input.date || today(), event: input.event,
      distance: Number(input.distance || 0), returnTime: input.returnTime || "",
      rank: Number(input.rank || 0),
      status: input.status === "finished" ? "finished" : "open"
    };
    pigeon.races.push(race);
    return { status: 200, value: pigeonView(db, pigeon) };
  });
}

export async function finishRace(idOrCode, raceId) {
  return mutate(async (db) => {
    const pigeon = await withPigeon(db, idOrCode);
    const race = pigeon.races.find(r => r.id === raceId);
    if (!race) throw new HttpError(404, "race_not_found");
    race.status = "finished";
    return { status: 200, value: pigeonView(db, pigeon) };
  });
}

// ---------- 足环刻印：刻印码唯一，重复码整单不写 ----------

export async function engrave(input) {
  const codes = [...new Set((Array.isArray(input.codes) ? input.codes : input.code ? [input.code] : []).map(c => String(c || "").trim()).filter(Boolean))];
  if (!codes.length) throw new HttpError(400, "missing_fields", { required: ["code|codes"] });
  if (!input.batch) throw new HttpError(400, "missing_fields", { required: ["batch"] });
  return mutate(async (db) => {
    // 先在内存里整体校验，任何一码占用都不落任何记录。
    const dup = codes.find(c => ringByCode(db, c));
    if (dup) throw new HttpError(409, "ring_code_taken", { code: dup });
    const at = stamp();
    for (const code of codes) {
      db.rings.unshift({
        code, batch: input.batch, status: "engraved", pigeonId: null,
        engravedAt: at, issuedAt: null, deactivatedAt: null, recycledAt: null,
        ownerSnapshot: "", note: input.note || ""
      });
    }
    return { status: 201, value: { codes, batch: input.batch, engravedAt: at } };
  });
}

// ---------- 足环发放：核对批次、鸽主、鸽只；同羽只留一枚在役环；冲突 409 整单不写 ----------

export async function issue(input) {
  const items = Array.isArray(input.items) ? input.items : [input];
  const clean = items.map(it => ({ code: String(it.code || "").trim(), batch: String(it.batch || "").trim(), owner: String(it.owner || "").trim(), pigeon: String(it.pigeon || it.pigeonId || "").trim() }));
  if (clean.some(it => !it.code || !it.batch || !it.owner || !it.pigeon)) {
    throw new HttpError(400, "missing_fields", { required: ["code,batch,owner,pigeon"] });
  }
  return mutate(async (db) => {
    // 整单校验阶段：解析并记住全部实体，任何一项失败都不写。
    const resolved = clean.map(it => {
      const ring = ringByCode(db, it.code);
      if (!ring) throw new HttpError(404, "ring_not_found", { code: it.code });
      if (ring.status !== "engraved") throw new HttpError(409, "ring_not_issuable", { code: it.code, status: ring.status });
      if (ring.batch !== it.batch) throw new HttpError(400, "batch_mismatch", { code: it.code, expected: ring.batch, given: it.batch });
      const pigeon = findPigeon(db, it.pigeon);
      if (!pigeon) throw new HttpError(404, "pigeon_not_found", { pigeon: it.pigeon });
      if (pigeon.owner !== it.owner) throw new HttpError(400, "owner_mismatch", { code: it.code, expected: pigeon.owner, given: it.owner });
      const current = activeRingOf(db, pigeon.id);
      if (current) throw new HttpError(409, "pigeon_already_ringed", { pigeon: pigeon.id, activeRing: current.code });
      return { it, ring, pigeon };
    });
    // 同单内也不能给同一羽发两枚。
    const seen = new Set();
    for (const { pigeon } of resolved) {
      if (seen.has(pigeon.id)) throw new HttpError(409, "pigeon_already_ringed", { pigeon: pigeon.id });
      seen.add(pigeon.id);
    }
    const at = stamp();
    const order = { id: nextId(db, "issue", "IS"), date: today(), createdAt: at, operator: input.operator || "", items: [], status: "completed" };
    for (const { it, ring, pigeon } of resolved) {
      ring.status = "active";
      ring.pigeonId = pigeon.id;
      ring.issuedAt = at;
      ring.ownerSnapshot = pigeon.owner;
      pigeon.ringNo = ring.code; // 兼容旧字段与血统关联
      order.items.push({ code: ring.code, batch: ring.batch, pigeonId: pigeon.id, owner: pigeon.owner });
    }
    db.issueOrders.unshift(order);
    return { status: 201, value: order };
  });
}

// ---------- 换环核验 ----------
// 规则：
//  1) 旧环必须是在役（active），新环必须已刻印未发放（engraved）；
//  2) 必须回收旧环、核验人须与经办人不同、损伤等级有效、鸽只无未结束参赛记录；
//  3) 任一硬性条件不满足 -> 单据只转 pending_recycle：新环预留占用、旧环仍在役；
//  4) 全部满足 -> 新环启用、旧环停用并回收，血统/疫苗/转让/成绩仍挂鸽只；
//  5) 重复或并发换环沿用首次结果（同 requestId 或同 oldCode+newCode）。

function deriveKey(input) {
  return input.requestId || `swap:${String(input.oldCode || "").trim()}=>${String(input.newCode || "").trim()}`;
}

function blockedReasons(db, input, oldRing, pigeon) {
  const reasons = [];
  if (!input.recycled) reasons.push("old_ring_not_recycled");
  if (input.verifier && input.operator && input.verifier === input.operator) reasons.push("verifier_same_as_operator");
  if (!DAMAGE_LEVELS.has(input.damage)) reasons.push("damage_level_invalid");
  if (pigeon.races.some(r => r.status !== "finished")) reasons.push("race_unfinished");
  return reasons;
}

export async function replaceRing(input) {
  const oldCode = String(input.oldCode || "").trim();
  const newCode = String(input.newCode || "").trim();
  if (!oldCode || !newCode || !input.operator || !input.verifier || !input.damage) {
    throw new HttpError(400, "missing_fields", { required: ["oldCode", "newCode", "operator", "verifier", "damage"] });
  }
  if (oldCode === newCode) throw new HttpError(400, "same_ring");
  const key = deriveKey(input);
  return mutate(async (db) => {
    // 重复 / 并发请求：沿用首次结果（单据已存在则原样回放，不重复执行）。
    const prior = db.replaceOrders.find(o => o.idempotencyKey === key);
    if (prior) return { status: 200, reused: true, value: replaceView(db, prior) };

    const oldRing = ringByCode(db, oldCode);
    if (!oldRing) throw new HttpError(404, "old_ring_not_found", { code: oldCode });
    if (oldRing.status !== "active") throw new HttpError(409, "old_ring_not_active", { code: oldCode, status: oldRing.status });
    const pigeon = db.pigeons.find(p => p.id === oldRing.pigeonId);
    if (!pigeon) throw new HttpError(409, "old_ring_unbound", { code: oldCode });
    const newRing = ringByCode(db, newCode);
    if (!newRing) throw new HttpError(404, "new_ring_not_found", { code: newCode });
    if (newRing.status !== "engraved") throw new HttpError(409, "new_ring_not_available", { code: newCode, status: newRing.status });
    // 同羽已有未结束换环单（待回收 / 处理中）也按冲突处理，沿用首次结果需拿首次单号。
    const openOrder = db.replaceOrders.find(o => o.pigeonId === pigeon.id && o.status !== "completed" && o.status !== "cancelled");
    if (openOrder) throw new HttpError(409, "replace_in_progress", { orderId: openOrder.id, status: openOrder.status });

    const reasons = blockedReasons(db, input, oldRing, pigeon);
    const at = stamp();
    const order = {
      id: nextId(db, "replace", "RP"),
      idempotencyKey: key,
      createdAt: at,
      pigeonId: pigeon.id,
      oldCode, newCode: newRing.code,
      batch: newRing.batch,
      operator: input.operator, verifier: input.verifier,
      damage: input.damage, recycled: !!input.recycled,
      status: reasons.length ? "pending_recycle" : "completed",
      blockedReasons: reasons,
      events: [{ at, type: reasons.length ? "pending_recycle" : "completed", reasons }]
    };

    if (reasons.length) {
      // 只转待回收：新环预留（reserved）防被他单占用，旧环保持 active。
      newRing.status = "reserved";
      newRing.pigeonId = pigeon.id;
      newRing.ownerSnapshot = pigeon.owner;
    } else {
      // 新环启用，旧环停用并回收；鸽只身份与血统/疫苗/转让/成绩不动。
      newRing.status = "active";
      newRing.pigeonId = pigeon.id;
      newRing.issuedAt = at;
      newRing.ownerSnapshot = pigeon.owner;
      oldRing.status = "recycled";
      oldRing.deactivatedAt = at;
      oldRing.recycledAt = at;
      pigeon.ringNo = newRing.code;
    }
    db.replaceOrders.unshift(order);
    return { status: 201, reused: false, value: replaceView(db, order) };
  });
}

// 待回收单据的再次核验：回收补齐、换人核验、赛事结束后可确认完成。
export async function confirmReplace(orderId, input) {
  return mutate(async (db) => {
    const order = db.replaceOrders.find(o => o.id === orderId);
    if (!order) throw new HttpError(404, "replace_order_not_found", { orderId });
    if (order.status === "completed") return { status: 200, reused: true, value: replaceView(db, order) };
    if (order.status !== "pending_recycle") throw new HttpError(409, "order_not_pending", { status: order.status });

    const oldRing = ringByCode(db, order.oldCode);
    const newRing = ringByCode(db, order.newCode);
    const pigeon = db.pigeons.find(p => p.id === order.pigeonId);
    if (!oldRing || !newRing || !pigeon) throw new HttpError(409, "order_state_broken");

    const patch = {
      recycled: input.recycled !== undefined ? !!input.recycled : order.recycled,
      verifier: input.verifier || order.verifier,
      operator: input.operator || order.operator,
      damage: input.damage || order.damage
    };
    const reasons = [];
    if (!patch.recycled) reasons.push("old_ring_not_recycled");
    if (patch.verifier === patch.operator) reasons.push("verifier_same_as_operator");
    if (!DAMAGE_LEVELS.has(patch.damage)) reasons.push("damage_level_invalid");
    if (pigeon.races.some(r => r.status !== "finished")) reasons.push("race_unfinished");
    if (oldRing.status !== "active") reasons.push("old_ring_not_active");
    if (newRing.status !== "reserved" && newRing.status !== "engraved") reasons.push("new_ring_not_available");

    const at = stamp();
    if (reasons.length) {
      Object.assign(order, patch, { blockedReasons: reasons });
      order.events.push({ at, type: "pending_recycle", reasons });
      return { status: 200, reused: false, value: replaceView(db, order) };
    }
    Object.assign(order, patch, { status: "completed", blockedReasons: [] });
    order.events.push({ at, type: "completed", reasons: [] });
    newRing.status = "active";
    newRing.pigeonId = pigeon.id;
    newRing.issuedAt = newRing.issuedAt || at;
    newRing.ownerSnapshot = pigeon.owner;
    oldRing.status = "recycled";
    oldRing.deactivatedAt = at;
    oldRing.recycledAt = at;
    pigeon.ringNo = newRing.code;
    return { status: 200, reused: false, value: replaceView(db, order) };
  });
}
