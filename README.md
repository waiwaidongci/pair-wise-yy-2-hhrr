# 足环刻印发放与换环核验台

由原「赛鸽血统环号登记站」扩展而来。足环（刻印码）与鸽只档案分离：鸽只身份为 `P-xxx`，
足环按刻印码进入台账，可经历 `已刻印 → 在役 → 待回收 → 已停用` 的生命周期。

## 运行

```bash
npm start        # http://localhost:3024
npm test         # 端到端规则测试（55 项，使用临时库）
```

首次启动时自动将 `data/pigeons.json`（环号即身份的旧档案）迁移为
`data/station.json`（鸽只 + 足环台账 + 换环单），血统、疫苗、转让、成绩原样保留；
旧文件不再被写入。

## 代码分层（入口 / 判定 / 存储）

| 文件 | 职责 |
| --- | --- |
| `src/stationRoutes.js` | 入口：HTTP 路由、URL/JSON 解析，不做业务判定 |
| `src/stationService.js` | 判定：刻印、发放、换环核验的全部规则，失败抛 `StationError(status, code)` |
| `src/store.js` | 存储：唯一落盘出口；写操作互斥串行 + 草稿快照 + 原子替换写入 |

`server.js` 仅为 HTTP 薄壳，`src/page.js` 为三页签操作界面。

## 核心规则

- **刻印唯一**：刻印码全局唯一，重复或并发刻印只有一枚成功，其余 `409 ring_code_occupied`。
- **发放三核对**：发环前核对批次、鸽主、鸽只；码不存在/不可发、批次不符（`batch_mismatch`）、
  鸽主不符（`owner_mismatch`）、同羽已有在役环（`active_ring_exists`）一律 `409`，整单不写。
- **同羽一枚在役环**：一羽鸽只同时至多一枚 `in_use` 足环。
- **换环核验**：必须回收旧环，且核验人与经办人不是同一人，按损伤等级（轻微/中度/严重）登记。
  旧环未回收（`old_ring_not_collected`）、核验人相同（`same_verifier`）或有未结束参赛记录
  （`race_ongoing`）时，单据只转 **待回收（pending）**：旧环置 `待回收`、新环预留不启用、
  鸽只暂不切换；条件补齐后调确认接口转正式。
- **正式换环**：新环启用、旧环停用（retired）；血统、疫苗、转让、成绩均挂在鸽只上，不随环丢失。
- **幂等**：换环请求带 `requestId`（或按 鸽只+旧环+新环 自动成键），重复与并发相同请求沿用首次
  返回结果（`reused: true`）；进行中再提不同换环单返回 `409 replacement_in_progress`。
- **一致性**：列表、鸽只履历（足环台账 + 环履历 + 换环单）与刷新后状态均来自同一份台账。

## 主要接口

```
GET    /api/pigeons                      鸽只列表（含在役环/待回收环/参赛状态）
POST   /api/pigeons                      建档（无在役环）
GET    /api/pigeons/:id/history          鸽只履历
POST   /api/pigeons/:id/transfers        登记转让（归鸽只）
POST   /api/pigeons/:id/vaccines         登记疫苗（归鸽只）
POST   /api/pigeons/:id/races            报名赛事（参赛中）
POST   /api/pigeons/:id/races/finish     赛事结束（之后换环可转正式）

GET    /api/rings                        足环台账
POST   /api/rings/engrave                刻印（码唯一）
POST   /api/rings/issue                  发放（核对批次/鸽主/鸽只）

GET    /api/replacements?state=pending   换环单列表
POST   /api/replacements                 申请换环（阻断则 pending）
POST   /api/replacements/:id/confirm     待回收单补条件后转正式
```
