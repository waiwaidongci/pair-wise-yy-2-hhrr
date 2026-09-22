# 足环刻印发放与换环核验台

在赛鸽血统环号登记站基础上扩展，足环全生命周期（刻印 → 发放 → 换环 → 回收停用）独立管理，血统、疫苗、转让、成绩始终归鸽只。

## 运行

```bash
npm start        # http://localhost:3024
npm test         # 冒烟测试（自动备份/还原 data/pigeons.json）
```

旧版登记站数据首次启动时自动迁移：每羽旧档生成一枚 `active` 在役足环。

## 三层结构（入口 / 判定 / 存储分文件）

| 文件 | 职责 |
|---|---|
| `routes.js` | 入口层：HTTP 路由、请求解析、页面，不含业务判定 |
| `service.js` | 判定层：刻印、发放、换环的全部业务规则与状态流转 |
| `store.js` | 存储层：`data/pigeons.json` 读写、播种、旧档迁移、串行写队列与整单原子落盘 |

## 业务规则

**刻印** `/api/rings/engrave`
- 刻印码全局唯一；码被占用返回 `409 ring_code_taken`，整批不写。

**发放** `/api/rings/issue`（支持一单多枚，原子提交）
- 逐枚核对：批次一致（`400 batch_mismatch`）、鸽主一致（`400 owner_mismatch`）、鸽只存在；
- 足环须为已刻印未发放（`409 ring_not_issuable`）；
- 同一羽只允许一枚在役环，已有在役环返回 `409 pigeon_already_ringed`；
- 单内任一枚失败 → 整单 409/400，一枚都不写。

**换环核验** `/api/rings/replace`
- 旧环须在役、新环须已刻印；必须回收旧环（`recycled=true`）、核验人与经办人不是同一人、损伤等级（完好 / 轻微磨损 / 严重损伤）有效、鸽只无未结束参赛记录；
- 任一条件不满足：单据只转 `pending_recycle`，旧环保持在役，新环 `reserved` 预留防被他单占用；可在④面板补齐后 `/api/replace-rings/:id/confirm` 再次核验；
- 条件齐全：新环 `active` 启用、旧环 `recycled` 停用回收；鸽只 id、血统父母环码、疫苗、转让、成绩均不变；
- 幂等：重复或并发换环（同 `requestId`，或未带时同 旧环→新环 组合）沿用首次结果；同羽已有处理中单据时再来一单返回 `409 replace_in_progress`。

**一致性**
- 在役环、鸽主、履历全部由存储实时投影（`GET /api/state`），列表、卡片履历与刷新后状态同源；
- 新环码与旧环码都能查到同一羽鸽只；新环上脚后旧环履历保留在鸽只档案中。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 鸽只/足环/发放单/换环单全量投影 |
| POST | `/api/rings/engrave` | 刻印入库（codes + batch） |
| POST | `/api/rings/issue` | 整单发放（items: code/batch/owner/pigeon） |
| POST | `/api/rings/replace` | 换环核验 |
| POST | `/api/replace-rings/:id/confirm` | 待回收单再次核验确认 |
| GET/POST | `/api/pigeons` | 鸽只列表 / 建档 |
| GET | `/api/pigeons/:idOrCode/relation` | 血统（支持新环码或旧环码） |
| POST | `/api/pigeons/:idOrCode/transfers|vaccines|races` | 转让 / 疫苗 / 成绩（参赛记录带 status） |
| POST | `/api/pigeons/:idOrCode/races/:raceId/finish` | 参赛记录结束 |
