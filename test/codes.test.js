import assert from "node:assert/strict"
import test from "node:test"
import {
  MiyousheLiveCodeSource,
  resolveCodeGame,
} from "../lib/codes/miyoushe-live.js"
import { CodeSubscriptionService } from "../lib/codes/subscription-service.js"
import {
  buildCodeCardData,
  buildCodeSubscriptionCardData,
  formatCodeNotification,
} from "../lib/notification/format.js"

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

class MemoryStore {
  constructor() {
    this.data = { version: 1, users: {}, attempts: [] }
  }

  async read() {
    return structuredClone(this.data)
  }

  async transaction(mutator) {
    const copy = structuredClone(this.data)
    const result = await mutator(copy)
    this.data = copy
    return result
  }
}

test("MiyousheLiveCodeSource discovers and normalizes official CN codes", async () => {
  const calls = []
  const source = new MiyousheLiveCodeSource({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options })
      if (String(url).includes("user_instant/list")) {
        return jsonResponse({
          retcode: 0,
          data: {
            list: [{
              post: {
                post: {
                  structured_content:
                    '{"link":"https://webstatic.mihoyo.com/bbs/event/live/index.html?act_id=live123"}',
                },
              },
            }],
          },
        })
      }
      if (String(url).endsWith("/event/miyolive/index")) {
        assert.equal(options.headers["x-rpc-act_id"], "live123")
        return jsonResponse({
          retcode: 0,
          data: {
            live: {
              title: "原神 7.0 版本前瞻特别节目",
              code_ver: "7.0",
              remain: 0,
              start: "2026-07-31 20:00:00",
            },
            template: JSON.stringify({
              codeTipText: "兑换码将于8月3日12:00过期，请及时兑换~",
            }),
          },
        })
      }
      if (String(url).includes("/event/miyolive/refreshCode")) {
        return jsonResponse({
          retcode: 0,
          data: {
            code_list: [{
              code: "无神怜爱的雪国",
              title:
                '<p>原石*<span>100</span> 精锻用魔矿*<span>10</span></p>',
            }],
          },
        })
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })

  const codes = await source.list("genshin")
  assert.equal(codes.length, 1)
  assert.equal(codes[0].code, "无神怜爱的雪国")
  assert.equal(codes[0].region, "cn")
  assert.deepEqual(codes[0].rewards, ["原石 ×100 精锻用魔矿 ×10"])
  assert.equal(codes[0].expiresAt, "2026-08-03T04:00:00.000Z")
  assert.equal(resolveCodeGame("崩铁").key, "starRail")
  assert.equal(calls.filter(call => call.url.includes("user_instant")).length, 1)
})

test("CodeSubscriptionService stores subscriptions and deduplicates delivery", async () => {
  const item = {
    id: "code-1",
    gameKey: "genshin",
    gameName: "原神",
    region: "cn",
    code: "CN7TEST1",
    title: "原神前瞻特别节目",
    rewards: ["原石 ×100"],
    expiresAt: null,
    discoveredAt: new Date().toISOString(),
  }
  const source = {
    async listAll() {
      return { items: [item], errors: [] }
    },
  }
  const store = new MemoryStore()
  const service = new CodeSubscriptionService({ store, source })
  const context = {
    identity: "test:bot:user",
    userId: "user",
    botId: "bot",
  }

  await service.subscribe(context, "原神")
  const first = await service.scan()
  assert.equal(first.batches.length, 1)
  assert.equal(first.batches[0].codes[0].code, "CN7TEST1")

  await service.markDelivered(context.identity, ["code-1"])
  const second = await service.scan()
  assert.equal(second.batches.length, 0)
  assert.equal(
    (await service.listSubscriptions(context.identity))
      .find(game => game.gameKey === "genshin").enabled,
    true,
  )
})

test("CodeSubscriptionService skips official polling without subscribers", async () => {
  let calls = 0
  const service = new CodeSubscriptionService({
    store: new MemoryStore(),
    source: {
      async listAll() {
        calls += 1
        return { items: [], errors: [] }
      },
    },
  })
  const result = await service.scan()
  assert.equal(calls, 0)
  assert.deepEqual(result, { batches: [], errors: [] })
})

test("code notification data includes a copyable text fallback", () => {
  const batch = {
    gameName: "原神",
    codes: [{
      code: "CN7TEST1",
      title: "原神前瞻特别节目",
      rewards: ["原石 ×100"],
      expiresAt: null,
    }],
  }
  const card = buildCodeCardData(batch, 0)
  const text = formatCodeNotification(batch)
  assert.equal(card.gameIcon, "reward/icons/game/genshin.jpg")
  assert.equal(card.codes[0].code, "CN7TEST1")
  assert.match(text, /CN7TEST1/)
  assert.match(text, /不会自动兑换/)
})

test("code subscription card shows enabled and disabled games", () => {
  const card = buildCodeSubscriptionCardData([
    { gameKey: "genshin", gameName: "原神", enabled: true },
    { gameKey: "starRail", gameName: "崩坏：星穹铁道", enabled: false },
  ])
  assert.equal(card.subscribedCount, 1)
  assert.equal(card.gameCount, 2)
  assert.equal(card.games[0].stateText, "已订阅")
  assert.equal(card.games[1].stateText, "未订阅")
  assert.equal(card.games[0].gameIcon, "reward/icons/game/genshin.jpg")
})
