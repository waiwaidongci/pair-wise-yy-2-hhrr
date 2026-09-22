// 存储层：足环刻印发放与换环核验台的唯一落盘出口
// 所有写操作经互斥串行队列 + 草稿快照提交，保证“整单不写”与并发安全。
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.STATION_DB || join(__dirname, "..", "data", "station.json");
const legacyPath = join(__dirname, "..", "data", "pigeons.json");

// 首次启动且旧档案缺失时使用的内置种子（与原 data/pigeons.json 同内容）
const legacySeed = {
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ]
};

let state = null;
let chain = Promise.resolve();

function ringBatch(code) {
  return `B-${code.slice(4, 8) || "2026"}`;
}

// 旧档案（环号即身份）迁移为：鸽只档案 + 足环台账，血统/疫苗/转让/成绩原样保留
function migrate(source) {
  const pigeons = [];
  const rings = [];
  source.pigeons.forEach((item, index) => {
    const id = `P-${String(index + 1).padStart(3, "0")}`;
    const year = item.ringNo.slice(4, 8) || "2026";
    const batch = ringBatch(item.ringNo);
    pigeons.push({
      id,
      ringNo: item.ringNo,
      owner: item.owner,
      fatherRing: item.fatherRing || "",
      motherRing: item.motherRing || "",
      color: item.color,
      loft: item.loft,
      vaccines: item.vaccines || [],
      transfers: item.transfers || [],
      races: (item.races || []).map(race => ({
        date: race.date,
        event: race.event,
        distance: Number(race.distance || 0),
        returnTime: race.returnTime || "",
        finishTime: race.returnTime || "",
        rank: race.rank ?? null,
        status: "finished"
      }))
    });
    rings.push({
      code: item.ringNo,
      batch,
      status: "in_use",
      pigeonId: id,
      issuedAt: `${year}-01-01T00:00:00.000Z`,
      ownerAtIssue: item.owner,
      history: [
        { at: `${year}-01-01T00:00:00.000Z`, action: "engraved", detail: { batch } },
        { at: `${year}-01-01T00:00:00.000Z`, action: "issued", detail: { pigeonId: id, owner: item.owner } }
      ]
    });
  });
  // 一枚已刻印未发放的备用环，供发放演示
  rings.push({
    code: "CHN-2026-002",
    batch: "B-2026",
    status: "engraved",
    pigeonId: null,
    issuedAt: null,
    ownerAtIssue: "",
    history: [{ at: "2026-01-02T00:00:00.000Z", action: "engraved", detail: { batch: "B-2026" } }]
  });
  return { pigeons, rings, replacements: [] };
}

async function persist(next) {
  const tmp = `${dbPath}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, dbPath);
}

async function load() {
  if (existsSync(dbPath)) {
    state = JSON.parse(await readFile(dbPath, "utf8"));
    return;
  }
  await mkdir(dirname(dbPath), { recursive: true });
  const source = existsSync(legacyPath)
    ? JSON.parse(await readFile(legacyPath, "utf8"))
    : legacySeed;
  state = migrate(source);
  await persist(state);
}

const ready = load();

// 在互斥临界区内对草稿执行业务判定；抛错则草稿连同本单一起丢弃，绝不部分写入
export async function mutate(worker) {
  const run = chain.then(async () => {
    await ready;
    const draft = structuredClone(state);
    const result = await worker(draft);
    await persist(draft);
    state = draft;
    return result;
  });
  chain = run.then(() => {}, () => {});
  return run;
}

export async function read() {
  await ready;
  return structuredClone(state);
}
