import http from "node:http";
import { stationRoutes } from "./src/stationRoutes.js";
import { StationError } from "./src/stationService.js";
import { page } from "./src/page.js";

const port = Number(process.env.PORT || 3024);

const server = http.createServer(async (req, res) => {  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    const handled = await stationRoutes(req, res, url);
    if (handled === false) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not_found" }));
    }
  } catch (error) {
    const status = error.status || (error instanceof StationError ? 409 : 500);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.code || "internal_error", message: error.message }));
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(port, () => console.log(`足环刻印发放与换环核验台 listening on http://localhost:${port}`));
}

export default server;

