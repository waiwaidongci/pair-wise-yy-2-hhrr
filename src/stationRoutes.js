// 入口层：HTTP 路由与参数解析，不做业务判定，只转调判定层
import * as station from "./stationService.js";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求体不是合法 JSON");
    error.status = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function send(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

const dec = segment => decodeURIComponent(segment);

// 仅依赖 URL/方法做分发；所有冲突与“整单不写”由判定层抛出的 StationError 承载
export async function stationRoutes(req, res, url) {
  const body = () => readBody(req);
  const p = url.pathname;

  if (req.method === "GET" && p === "/api/pigeons") {
    return send(res, 200, await station.listPigeons());
  }
  if (req.method === "POST" && p === "/api/pigeons") {
    return send(res, 201, await station.createPigeon(await body()));
  }

  let m = p.match(/^\/api\/pigeons\/([^/]+)$/);
  if (m && req.method === "GET") return send(res, 405, { error: "method_not_allowed" });

  m = p.match(/^\/api\/pigeons\/([^/]+)\/history$/);
  if (m && req.method === "GET") return send(res, 200, await station.pigeonHistory(dec(m[1])));

  m = p.match(/^\/api\/pigeons\/([^/]+)\/transfers$/);
  if (m && req.method === "POST") return send(res, 200, await station.transferPigeon(dec(m[1]), await body()));

  m = p.match(/^\/api\/pigeons\/([^/]+)\/vaccines$/);
  if (m && req.method === "POST") return send(res, 200, await station.addVaccine(dec(m[1]), await body()));

  m = p.match(/^\/api\/pigeons\/([^/]+)\/races$/);
  if (m && req.method === "POST") return send(res, 200, await station.enterRace(dec(m[1]), await body()));

  m = p.match(/^\/api\/pigeons\/([^/]+)\/races\/finish$/);
  if (m && req.method === "POST") return send(res, 200, await station.finishRace(dec(m[1]), await body()));

  if (req.method === "GET" && p === "/api/rings") {
    return send(res, 200, await station.listRings());
  }
  if (req.method === "POST" && p === "/api/rings/engrave") {
    return send(res, 201, await station.engraveRing(await body()));
  }
  if (req.method === "POST" && p === "/api/rings/issue") {
    return send(res, 201, await station.issueRing(await body()));
  }

  if (req.method === "GET" && p === "/api/replacements") {
    return send(res, 200, await station.listReplacements(url.searchParams.get("state") || ""));
  }
  if (req.method === "POST" && p === "/api/replacements") {
    return send(res, 201, await station.replaceRing(await body()));
  }
  m = p.match(/^\/api\/replacements\/([^/]+)\/confirm$/);
  if (m && req.method === "POST") {
    return send(res, 200, await station.confirmReplacement(dec(m[1]), await body()));
  }

  return false;
}
