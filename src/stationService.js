// 判定层：足环刻印、发放、换环核验的全部业务规则
// 只在 store.mutate 传入的草稿上读写；任何一步判定失败即抛 StationError，整单不落盘。
import { mutate, read } from "./store.js";

export class StationError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const DAMAGE_LEVELS = ["轻微", "中度", "严重"];

const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const text = value => String(value ?? "").trim();
const fail = (status, code, message, extra) => { throw new StationError(status, code, message, extra); };

function seq(db, prefix) {
  const key = `${prefix}Seq`;
  db[key] = (db[key] || 0) + 1;
  return `${prefix}-${String(db[key]).padStart(4, "0")}`;
}

function findPigeon(db, id) {
  return db.pigeons.find(item => item.id === id)
    || fail(404, "pigeon_not_found", "鸽只不存在");
}
function findRing(db, code) {
  return db.rings.find(item => item.code === code)
    || fail(404, "ring_not_found", "足环不存在");
}
function activeRingOf(db, pigeonId) {
  return db.rings.find(ring => ring.status === "in_use" && ring.pigeonId === pigeonId) || null;
}
function pendingReserve(db, code, excludeId = null) {
  return db.replacements.find(order =>
    order.state === "pending"
    && order.newCode === code
    && order.id !== excludeId) || null;
}
// 换环幂等键：显式 requestId 优先，否则由 旧环+新环+鸽只 自然确定
function idemKey(input, pigeonId, oldCode, newCode) {
  return text(input.requestId) || `auto:${pigeonId}|${oldCode}|${newCode}`;
}
function findReplacement(db, input, pigeonId, oldCode, newCode) {
  const key = idemKey(input, pigeonId, oldCode, newCode);
  return db.replacements.find(order =>
    order.requestId === key
    || (key.startsWith("auto:") && order.pigeonId === pigeonId
      && order.oldCode === oldCode && order.newCode === newCode
      && order.requestId.startsWith("auto:"))) || null;
}
function blockersFor(db, oldRing, pigeon, input) {
  const blockers = [];
  if (!input.oldCollected) blockers.push("old_ring_not_collected");
  if (text(input.operator) && text(input.operator) === text(input.verifier)) blockers.push("same_verifier");
  if (pigeon.races.some(race => race.status === "ongoing")) blockers.push("race_ongoing");
  return blockers;
}
function pushHistory(ring, action, detail) {
  ring.history.push({ at: nowIso(), action, detail });
}

// 对鸽只视角的统一富化：在役环 + 待回收环 + 未结束参赛记录
function decoratePigeon(db, pigeon) {
  const activeRing = activeRingOf(db, pigeon.id);
  const pendingRings = db.rings
    .filter(ring => ring.status === "pending_recycle" && ring.pigeonId === pigeon.id)
    .map(ring => ring.code);
  return {
    ...pigeon,
    activeRingCode: activeRing ? activeRing.code : null,
    pendingRecycleRings: pendingRings,
    hasOngoingRace: pigeon.races.some(race => race.status === "ongoing")
  };
}

/* ---------------- 查询：列表、履历、刷新后状态一致 ---------------- */

export async function listPigeons() {
  const db = await read();
  return db.pigeons.map(item => decoratePigeon(db, item));
}

export async function pigeonHistory(id) {
  const db = await read();
  const pigeon = findPigeon(db, id);
  const rings = db.rings
    .filter(ring => ring.pigeonId === id)
    .sort((a, b) => a.code.localeCompare(b.code));
  const replacements = db.replacements
    .filter(order => order.pigeonId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    pigeon: decoratePigeon(db, pigeon),
    rings: rings.map(ring => ({ code: ring.code, batch: ring.batch, status: ring.status, history: ring.history })),
    replacements
  };
}

export async function listRings() {
  const db = await read();
  return db.rings
    .map(ring => ({
      code: ring.code,
      batch: ring.batch,
      status: ring.status,
      pigeonId: ring.pigeonId,
      issuedAt: ring.issuedAt,
      ownerAtIssue: ring.ownerAtIssue,
      heldBy: ring.pigeonId ? db.pigeons.find(p => p.id === ring.pigeonId)?.owner || "" : ""
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function listReplacements(stateFilter = "") {
  const db = await read();
  return db.replacements
    .filter(order => !stateFilter || order.state === stateFilter)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/* ---------------- 鸽只档案、血统、疫苗、转让、成绩 ---------------- */

export async function createPigeon(input) {
  return mutate(db => {
    const pigeon = {
      id: seq(db, "P"),
      ringNo: "",
      owner: text(input.owner) || fail(400, "owner_required", "鸽主必填"),
      fatherRing: text(input.fatherRing),
      motherRing: text(input.motherRing),
      color: text(input.color) || fail(400, "color_required", "羽色必填"),
      loft: text(input.loft) || fail(400, "loft_required", "出生棚号必填"),
      vaccines: [],
      transfers: [],
      races: []
    };
    db.pigeons.push(pigeon);
    return decoratePigeon(db, pigeon);
  });
}

export async function transferPigeon(id, input) {
  return mutate(db => {
    const pigeon = findPigeon(db, id);
    const to = text(input.to) || fail(400, "to_required", "新归属人必填");
    pigeon.transfers.push({ date: text(input.date) || today(), from: pigeon.owner, to });
    pigeon.owner = to; // 转让归鸽只，与佩戴哪枚环无关
    return decoratePigeon(db, pigeon);
  });
}

export async function addVaccine(id, input) {
  return mutate(db => {
    const pigeon = findPigeon(db, id);
    const name = text(input.name) || fail(400, "name_required", "疫苗名称必填");
    pigeon.vaccines.push({ date: text(input.date) || today(), name });
    return decoratePigeon(db, pigeon);
  });
}

export async function enterRace(id, input) {
  return mutate(db => {
    const pigeon = findPigeon(db, id);
    const event = text(input.event) || fail(400, "event_required", "赛事名称必填");
    pigeon.races.push({
      date: text(input.date) || today(),
      event,
      distance: Number(input.distance || 0),
      returnTime: "",
      finishTime: "",
      rank: null,
      status: "ongoing"
    });
    return decoratePigeon(db, pigeon);
  });
}

export async function finishRace(id, input) {
  return mutate(db => {
    const pigeon = findPigeon(db, id);
    const event = text(input.event);
    const race = (event ? pigeon.races.filter(r => r.event === event) : pigeon.races)
      .reverse()
      .find(r => r.status === "ongoing")
      || fail(404, "ongoing_race_not_found", "没有未结束的参赛记录");
    race.status = "finished";
    race.finishTime = text(input.finishTime);
    race.returnTime = race.finishTime;
    race.rank = input.rank === "" || input.rank == null ? null : Number(input.rank);
    return decoratePigeon(db, pigeon);
  });
}

/* ---------------- 刻印：码唯一 ---------------- */

export async function engraveRing(input) {
  return mutate(db => {
    const code = text(input.code) || fail(400, "code_required", "刻印码必填");
    const batch = text(input.batch) || `B-${code.slice(4, 8) || today().slice(0, 4)}`;
    if (db.rings.some(ring => ring.code === code)) {
      fail(409, "ring_code_occupied", "刻印码已被占用");
    }
    const ring = {
      code,
      batch,
      status: "engraved",
      pigeonId: null,
      issuedAt: null,
      ownerAtIssue: "",
      history: [{ at: nowIso(), action: "engraved", detail: { batch } }]
    };
    db.rings.push(ring);
    return { ...ring };
  });
}

/* ---------------- 发放：核对批次、鸽主、鸽只；同羽只留一枚在役足环 ---------------- */

export async function issueRing(input) {
  return mutate(db => {
    const code = text(input.code) || fail(400, "code_required", "足环刻印码必填");
    const batch = text(input.batch) || fail(400, "batch_required", "批次必填");
    const pigeonId = text(input.pigeonId) || fail(400, "pigeon_id_required", "鸽只编号必填");
    const owner = text(input.owner) || fail(400, "owner_required", "鸽主必填");

    const ring = db.rings.find(item => item.code === code);
    if (!ring) fail(409, "ring_code_occupied", "刻印码不存在或已被占用");
    if (ring.status !== "engraved" || ring.pigeonId) {
      fail(409, "ring_not_available", "足环不是可发放状态");
    }
    if (ring.batch !== batch) fail(409, "batch_mismatch", "批次与刻印记录不符");
    if (pendingReserve(db, code)) fail(409, "ring_reserved", "该环已被待回收换环单预留");

    const pigeon = findPigeon(db, pigeonId);
    if (pigeon.owner !== owner) fail(409, "owner_mismatch", "鸽主与登记不符");
    if (activeRingOf(db, pigeonId)) fail(409, "active_ring_exists", "该鸽只已有在役足环");

    // 全部核对通过后一次性提交
    ring.status = "in_use";
    ring.pigeonId = pigeonId;
    ring.issuedAt = nowIso();
    ring.ownerAtIssue = owner;
    pushHistory(ring, "issued", { batch, pigeonId, owner });
    pigeon.ringNo = code;
    return { ring: { ...ring }, pigeon: decoratePigeon(db, pigeon) };
  });
}

/* ---------------- 换环：回收旧环 + 他人按损伤等级核验 ---------------- */

export async function replaceRing(input) {
  const operator = text(input.operator);
  const verifier = text(input.verifier);
  const oldCode = text(input.oldCode);
  const newCode = text(input.newCode);
  const pigeonId = text(input.pigeonId);
  const damageLevel = text(input.damageLevel);

  return mutate(db => {
    if (!pigeonId) fail(400, "pigeon_id_required", "鸽只编号必填");
    if (!oldCode) fail(400, "old_code_required", "旧环码必填");
    if (!newCode) fail(400, "new_code_required", "新环码必填");
    if (!damageLevel || !DAMAGE_LEVELS.includes(damageLevel)) {
      fail(400, "damage_level_invalid", `损伤等级须为：${DAMAGE_LEVELS.join("/")}`);
    }
    if (!verifier) fail(400, "verifier_required", "核验人必填");

    const key = idemKey(input, pigeonId, oldCode, newCode);
    const existing = findReplacement(db, input, pigeonId, oldCode, newCode);
    if (existing) return { reused: true, replacement: existing };

    const pigeon = findPigeon(db, pigeonId);
    const oldRing = db.rings.find(item => item.code === oldCode)
      || fail(404, "old_ring_not_found", "旧环不存在");
    if (oldRing.pigeonId !== pigeonId) fail(409, "old_ring_not_held", "旧环不属于该鸽只");
    if (oldRing.status === "retired") fail(409, "old_ring_retired", "旧环已停用，请勿重复换环");
    if (db.replacements.some(o => o.pigeonId === pigeonId && o.state === "pending")) {
      fail(409, "replacement_in_progress", "该鸽只已有进行中的换环单，结果以首次为准");
    }

    const newRing = db.rings.find(item => item.code === newCode);
    if (!newRing) fail(409, "new_ring_not_engraved", "新环尚未刻印");
    if (newCode === oldCode) fail(409, "same_ring", "新旧环不能相同");
    if (newRing.status !== "engraved" || newRing.pigeonId) {
      fail(409, "new_ring_not_available", "新环不是可发放的刻印环");
    }
    if (pendingReserve(db, newCode)) fail(409, "new_ring_reserved", "新环已被其他待回收单预留");

    const blockers = blockersFor(db, oldRing, pigeon, input);
    const order = {
      id: seq(db, "RPL"),
      requestId: key,
      pigeonId,
      oldCode,
      newCode,
      damageLevel,
      operator,
      verifier,
      oldCollected: Boolean(input.oldCollected),
      blockers,
      state: blockers.length ? "pending" : "completed",
      createdAt: nowIso(),
      completedAt: blockers.length ? null : nowIso()
    };
    db.replacements.push(order);

    if (blockers.length) {
      // 只转待回收：旧环标记待回收、新环预留不动，鸽只暂不切换
      oldRing.status = "pending_recycle";
      pushHistory(oldRing, "pending_recycle", { replacementId: order.id, blockers });
    } else {
      // 新环启用，旧环停用；血统、疫苗、转让、成绩仍挂在鸽只上
      oldRing.status = "retired";
      pushHistory(oldRing, "retired", { replacementId: order.id, damageLevel });
      newRing.status = "in_use";
      newRing.pigeonId = pigeonId;
      newRing.issuedAt = nowIso();
      newRing.ownerAtIssue = pigeon.owner;
      pushHistory(newRing, "issued", { batch: newRing.batch, pigeonId, owner: pigeon.owner, replacementId: order.id });
      pigeon.ringNo = newCode;
    }
    return { reused: false, replacement: order };
  });
}

// 待回收单转正式：条件补齐后执行新环启用、旧环停用
export async function confirmReplacement(id, input = {}) {
  return mutate(db => {
    const order = db.replacements.find(item => item.id === id)
      || fail(404, "replacement_not_found", "换环单不存在");
    if (order.state === "completed") return { reused: true, replacement: order };
    if (order.state !== "pending") fail(409, "replacement_not_pending", "换环单状态不可确认");

    const pigeon = findPigeon(db, order.pigeonId);
    const oldRing = findRing(db, order.oldCode);
    const newRing = db.rings.find(item => item.code === order.newCode);

    const current = {
      oldCollected: input.oldCollected === undefined ? order.oldCollected : Boolean(input.oldCollected),
      operator: input.operator === undefined ? order.operator : text(input.operator),
      verifier: input.verifier === undefined ? order.verifier : text(input.verifier)
    };
    const blockers = [];
    if (!current.oldCollected) blockers.push("old_ring_not_collected");
    if (current.operator && current.operator === current.verifier) blockers.push("same_verifier");
    if (pigeon.races.some(race => race.status === "ongoing")) blockers.push("race_ongoing");

    if (blockers.length) {
      order.blockers = blockers;
      return { reused: false, replacement: order };
    }
    if (!newRing || newRing.status !== "engraved" || newRing.pigeonId) {
      fail(409, "new_ring_not_available", "预留新环已不可用");
    }
    if (oldRing.status !== "pending_recycle") {
      fail(409, "old_ring_state_changed", "旧环状态已变化");
    }

    order.oldCollected = true;
    order.operator = current.operator;
    order.verifier = current.verifier;
    order.blockers = [];
    order.state = "completed";
    order.completedAt = nowIso();

    oldRing.status = "retired";
    pushHistory(oldRing, "recycled", { replacementId: order.id });
    pushHistory(oldRing, "retired", { replacementId: order.id, damageLevel: order.damageLevel });
    newRing.status = "in_use";
    newRing.pigeonId = order.pigeonId;
    newRing.issuedAt = nowIso();
    newRing.ownerAtIssue = pigeon.owner;
    pushHistory(newRing, "issued", { batch: newRing.batch, pigeonId: pigeon.id, owner: pigeon.owner, replacementId: order.id });
    pigeon.ringNo = newRing.code;
    return { reused: false, replacement: order };
  });
}
