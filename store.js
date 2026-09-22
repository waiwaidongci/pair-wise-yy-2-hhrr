// 存储层：足环刻印发放与换环核验台
// 只负责 data/pigeons.json 的读写、首次播种与旧数据迁移，不承载任何业务判定。
// 所有写操作经串行队列进入：校验阶段不落地，提交阶段先在内存副本上完成全部变更，
// 再一次性写盘，保证“整单不写 / 整单生效”的原子性。
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "pigeons.json");

const seed = {
  seq: { issue: 0, replace: 0, pigeon: 3 },
  pigeons: [
    { id: "P001", ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚",
      vaccines: [{ date: "2026-04-01", name: "新城疫" }],
      transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }],
      races: [{ id: "R1", date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18, status: "finished" }] },
    { id: "P002", ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { id: "P003", ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ],
  rings: [
    { code: "CHN-2026-001", batch: "旧档迁移-2026", status: "active", pigeonId: "P001",
      engravedAt: null, issuedAt: "2026-04-15", deactivatedAt: null, recycledAt: null,
      ownerSnapshot: "北岸棚", note: "登记站旧档案迁移" },
    { code: "CHN-2022-188", batch: "旧档迁移-2022", status: "active", pigeonId: "P002",
      engravedAt: null, issuedAt: "2022-01-01", deactivatedAt: null, recycledAt: null,
      ownerSnapshot: "育种棚", note: "登记站旧档案迁移" },
    { code: "CHN-2023-512", batch: "旧档迁移-2023", status: "active", pigeonId: "P003",
      engravedAt: null, issuedAt: "2023-01-01", deactivatedAt: null, recycledAt: null,
      ownerSnapshot: "育种棚", note: "登记站旧档案迁移" }
  ],
  issueOrders: [],
  replaceOrders: []
};

// 旧版登记站（只有 pigeons）首次加载时迁移：每羽旧档生成一枚 active 足环。
function migrate(raw) {
  if (Array.isArray(raw.rings) && Array.isArray(raw.pigeons)) {
    raw.seq = raw.seq || { issue: 0, replace: 0, pigeon: raw.pigeons.length };
    raw.issueOrders = raw.issueOrders || [];
    raw.replaceOrders = raw.replaceOrders || [];
    for (const p of raw.pigeons) {
      if (!p.id) p.id = `P${String((raw.seq.pigeon += 1)).padStart(3, "0")}`;
      for (const r of p.races || []) if (!r.id) r.id = `R${Math.random().toString(36).slice(2, 8)}`;
      for (const r of p.races || []) r.status = r.status || "finished";
    }
    return raw;
  }
  const db = structuredClone(seed);
  db.pigeons = [];
  db.rings = [];
  db.seq.pigeon = 0;
  for (const item of raw.pigeons || []) {
    db.seq.pigeon += 1;
    const id = `P${String(db.seq.pigeon).padStart(3, "0")}`;
    db.pigeons.push({
      id,
      ringNo: item.ringNo,
      owner: item.owner,
      fatherRing: item.fatherRing || "",
      motherRing: item.motherRing || "",
      color: item.color,
      loft: item.loft,
      vaccines: item.vaccines || [],
      transfers: item.transfers || [],
      races: (item.races || []).map((r, i) => ({ ...r, id: `R${id}-${i + 1}`, status: r.status || "finished" }))
    });
    db.rings.push({
      code: item.ringNo, batch: "旧档迁移", status: "active", pigeonId: id,
      engravedAt: null, issuedAt: (item.transfers || [])[0]?.date || null,
      deactivatedAt: null, recycledAt: null, ownerSnapshot: item.owner, note: "登记站旧档案迁移"
    });
  }
  return db;
}

async function readRaw() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return structuredClone(seed);
  }
  return migrate(JSON.parse(await readFile(dbPath, "utf8")));
}

async function persist(db) {
  // 先写临时文件再 rename，避免刷新瞬间读到半截 JSON。
  const tmp = `${dbPath}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, dbPath);
}

// 串行写队列：同一时刻只有一个判定+写盘事务，杜绝并发换环交叉落地。
let chain = Promise.resolve();
export function mutate(worker) {
  const run = chain.then(() => readRaw().then(async (db) => {
    // worker 只返回结果；若它在 db 上做了变更则整体落盘，抛错则本次全部不写。
    const outcome = await worker(db);
    if (outcome && outcome.commit === false) return outcome;
    await persist(db);
    return outcome;
  }));
  chain = run.then(() => {}, () => {});
  return run;
}

export async function snapshot() {
  return readRaw();
}

export function nextId(db, kind, prefix) {
  db.seq[kind] = (db.seq[kind] || 0) + 1;
  return `${prefix}${String(db.seq[kind]).padStart(4, "0")}`;
}
