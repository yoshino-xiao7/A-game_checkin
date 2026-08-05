import assert from "node:assert/strict"
import test from "node:test"
import {
  MiyousheLiveCodeSource,
  resolveCodeGame,
} from "../lib/codes/miyoushe-live.js"
import {
  extractTrustedKuroCodes,
  KuroOfficialCodeSource,
} from "../lib/codes/kuro-official.js"
import {
  extractTrustedSklandCodes,
  SklandOfficialCodeSource,
} from "../lib/codes/skland-official.js"
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
  assert.equal(resolveCodeGame("鸣潮").key, "wutheringWaves")
  assert.equal(resolveCodeGame("战双").key, "punishingGrayRaven")
  assert.equal(resolveCodeGame("方舟").key, "arknights")
  assert.equal(resolveCodeGame("终末地").key, "endfield")
  assert.equal(calls.filter(call => call.url.includes("user_instant")).length, 1)
})

test("SklandOfficialCodeSource discovers cross-validated preview codes", async () => {
  const requests = []
  const timestamp = Math.floor(Date.now() / 1000)
  const source = new SklandOfficialCodeSource({
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers })
      if (String(url).endsWith("/web/v1/auth/refresh")) {
        return jsonResponse({ code: 0, data: { token: "anonymous-token" } })
      }
      assert.match(options.headers.sign, /^[a-f0-9]{32}$/)
      return jsonResponse({
        code: 0,
        data: {
          list: [
            {
              item: {
                id: "preview-1",
                title: "终末地1.4前瞻直播兑换码",
                caption: [{ text: { text: "兑换码：ENDFIELDRENEW" } }],
                timestamp,
              },
              user: { id: "user-1", identity: 1 },
            },
            {
              item: {
                id: "preview-2",
                title: "1.4直播前瞻的兑换码记得兑换",
                caption: [{ text: { text: "ENDFIELDRENEW" } }],
                timestamp,
              },
              user: { id: "user-2", identity: 1 },
            },
            {
              item: {
                id: "one-use-cdk",
                title: "兑换码自取",
                caption: [{ text: { text: "RDY4H5XYTDJQR6RVQWZ3AQVKWAPVNVBQ" } }],
                timestamp,
              },
              user: { id: "user-3", identity: 1 },
            },
          ],
        },
      })
    },
  })

  const codes = await source.list("endfield")
  assert.deepEqual(codes.map(item => item.code), ["ENDFIELDRENEW"])
  assert.equal(codes[0].gameName, "明日方舟：终末地")
  assert.equal(codes[0].source, "skland-official-community")
  assert.equal(
    requests.filter(item => item.url.includes("/web/v2/search/item?")).length,
    2,
  )
  assert.equal(
    requests.filter(item => item.url.endsWith("/web/v1/auth/refresh")).length,
    1,
  )
})

test("Skland code extraction requires independent evidence and rejects old posts", () => {
  const now = Date.now()
  const makeResult = (userId, code, timestamp) => ({
    item: {
      id: `${userId}-${code}`,
      title: "明日方舟新春前瞻兑换码",
      caption: [{ text: { text: code } }],
      timestamp: Math.floor(timestamp / 1000),
    },
    user: { id: userId, identity: 1 },
  })
  const result = extractTrustedSklandCodes([
    makeResult("user-1", "26MADAOCHENGGONG", now),
    makeResult("user-2", "26MADAOCHENGGONG", now),
    makeResult("user-3", "FALSEPOSITIVE", now),
    makeResult("user-4", "OLDCODE88", now - 20 * 86400000),
    makeResult("user-5", "OLDCODE88", now - 20 * 86400000),
  ], now)
  assert.deepEqual(result.map(item => item.code), ["26MADAOCHENGGONG"])
})

test("KuroOfficialCodeSource discovers consensus codes from official preview posts", async () => {
  const requests = []
  const publishTime = Date.now()
  const source = new KuroOfficialCodeSource({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: String(options.body) })
      if (String(url).endsWith("/forum/companyEvent/findEventList")) {
        return jsonResponse({
          code: 200,
          data: {
            list: [{
              postId: "preview-1",
              postTitle: "《鸣潮》4.0版本内容前瞻",
              publishTime,
            }],
          },
        })
      }
      if (String(url).endsWith("/forum/getPostDetail")) {
        return jsonResponse({
          code: 200,
          data: {
            postDetail: {
              postUserId: "official",
              postTitle: "《鸣潮》4.0版本内容前瞻",
              postH5Content: "<p>版本内容回顾</p>",
            },
            comment: [
              {
                userId: "user-1",
                commentContent: [{
                  content: "前瞻兑换码【FIRSTCODE】、【SECOND88】，有效期至2099年8月8日23:59",
                }],
              },
              {
                userId: "user-2",
                commentContent: [
                  { content: "兑换码" },
                  { content: "FIRSTCODE" },
                  { content: "SECOND88" },
                ],
              },
              {
                userId: "user-3",
                commentContent: [{ content: "WINDOWSUPDATE" }],
              },
            ],
          },
        })
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })

  const codes = await source.list("wutheringWaves")
  assert.deepEqual(codes.map(item => item.code), ["FIRSTCODE", "SECOND88"])
  assert.equal(codes[0].gameName, "鸣潮")
  assert.equal(codes[0].source, "kuro-official-community")
  assert.equal(codes[0].expiresAt, "2099-08-08T15:59:00.000Z")
  assert.equal(
    requests.filter(item => item.url.endsWith("/forum/getPostDetail")).length,
    2,
  )
  assert.match(requests.at(-1).body, /isOnlyPublisher=0/)
})

test("Kuro code extraction accepts publisher codes and rejects expired codes", () => {
  const result = extractTrustedKuroCodes([{
    data: {
      postDetail: { postUserId: "official", postH5Content: "版本前瞻" },
      comment: [
        {
          userId: "official",
          isPublisher: 1,
          commentContent: [{
            content: "限时礼包兑换码有效期至2099年2月3日23:59，黑卡：PGR2099",
          }],
        },
        {
          userId: "official",
          isPublisher: 1,
          commentContent: [{
            content: "兑换码【EXPIRED1】，有效期至2020年2月3日23:59",
          }],
        },
      ],
    },
  }])
  assert.deepEqual(result.map(item => item.code), ["PGR2099"])
})

test("Kuro code extraction accepts a dated code bundle without manual confirmation", () => {
  const result = extractTrustedKuroCodes([{
    data: {
      postDetail: { postUserId: "official", postH5Content: "版本前瞻" },
      comment: [{
        userId: "guide-author",
        commentContent: [
          { content: "战双版本前瞻兑换码：" },
          { content: "NEWALPHA0602" },
          { content: "FOSANNIVERSARY" },
          { content: "有效期至2099年6月2日23:59" },
        ],
      }],
    },
  }])
  assert.deepEqual(
    result.map(item => item.code),
    ["NEWALPHA0602", "FOSANNIVERSARY"],
  )
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

test("Kuro code card displays its actual official source", () => {
  const card = buildCodeCardData({
    gameName: "鸣潮",
    codes: [{
      code: "FIRSTCODE",
      title: "《鸣潮》4.0版本内容前瞻",
      rewards: [],
      expiresAt: "2099-08-08T15:59:00.000Z",
      sourceLabel: "库洛游戏 / 库街区官方前瞻帖及评论",
    }],
  })
  assert.equal(card.gameIcon, "reward/icons/game/wuthering-waves.jpg")
  assert.equal(card.sourceText, "库洛游戏 / 库街区官方前瞻帖及评论")
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
