import assert from "node:assert/strict"
import test from "node:test"
import { KuroAdapter } from "../lib/communities/kuro/index.js"

function response(payload) {
  return { ok: true, status: 200, json: async () => payload }
}

test("KuroAdapter discovers Punishing Gray Raven and Wuthering Waves roles", async () => {
  const replies = [
    { code: 200, data: [{ serverId: "pns-cn", roleId: "1", roleName: "指挥官" }] },
    { code: 200, data: [{ serverId: "mc-cn", roleId: "2", roleName: "漂泊者" }] },
  ]
  const adapter = new KuroAdapter({
    fetchImpl: async () => response(replies.shift()),
  })
  const targets = await adapter.discoverTargets({ userId: "123456", token: "token" })
  assert.deepEqual(targets.map(target => target.metadata.gameName), [
    "战双帕弥什",
    "鸣潮",
  ])
})

test("KuroAdapter sends a phone code with a user-completed Geetest result", async () => {
  const requests = []
  const adapter = new KuroAdapter({
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return response({ code: 200, msg: "OK" })
    },
  })
  const validation = {
    lot_number: "lot",
    captcha_output: "output",
    pass_token: "pass",
    gen_time: "time",
  }

  const result = await adapter.sendPhoneCode(
    "18888888888",
    validation,
    "DEVICE-CODE",
  )
  const body = new URLSearchParams(requests[0].options.body)

  assert.equal(result.phone, "18888888888")
  assert.match(requests[0].url, /\/user\/getSmsCode$/)
  assert.equal(body.get("mobile"), "18888888888")
  assert.deepEqual(JSON.parse(body.get("geeTestData")), validation)
  assert.equal(requests[0].options.headers.devCode, "DEVICE-CODE")
})

test("KuroAdapter exchanges a phone code for a persistent credential", async () => {
  const requests = []
  const adapter = new KuroAdapter({
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return response({
        code: 200,
        data: { userId: "123456", token: "login-token" },
      })
    },
  })

  const credential = await adapter.loginByPhoneCode(
    "18888888888",
    "123456",
    "DEVICE-CODE",
  )
  const body = new URLSearchParams(requests[0].options.body)

  assert.deepEqual(credential, {
    userId: "123456",
    token: "login-token",
    deviceCode: "DEVICE-CODE",
  })
  assert.match(requests[0].url, /\/user\/sdkLogin$/)
  assert.equal(body.get("mobile"), "18888888888")
  assert.equal(body.get("code"), "123456")
  assert.equal(body.get("devCode"), "DEVICE-CODE")
})

test("KuroAdapter normalizes risk control during sign-in", async () => {
  const replies = [
    { code: 200, data: { isSigIn: false } },
    { code: 220, success: false, msg: "请求异常" },
  ]
  const adapter = new KuroAdapter({
    fetchImpl: async () => response(replies.shift()),
  })
  const outcome = await adapter.checkIn(
    { userId: "123456", token: "token" },
    {
      metadata: {
        gameId: 3,
        serverId: "mc-cn",
        roleId: "2",
      },
    },
  )
  assert.equal(outcome.kind, "risk-control")
})

test("KuroAdapter records every reward received today", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const replies = [
    {
      code: 200,
      data: {
        isSigIn: true,
        signInGoodsConfigs: [
          { goodsId: 10, goodsUrl: "https://example.com/astrite.png" },
          { goodsId: 11, goodsUrl: "https://example.com/shell-credit.png" },
        ],
      },
    },
    {
      code: 200,
      data: [
        {
          sigInDate: `${today} 09:00:00`,
          goodsId: 10,
          goodsName: "星声",
          goodsNum: 20,
        },
        {
          sigInDate: `${today} 09:00:00`,
          goodsId: 11,
          goodsName: "贝币",
          goodsNum: 3000,
        },
      ],
    },
  ]
  const adapter = new KuroAdapter({
    fetchImpl: async () => response(replies.shift()),
  })
  const outcome = await adapter.checkIn(
    { userId: "123456", token: "token" },
    { metadata: { gameId: 3, serverId: "mc-cn", roleId: "2" } },
  )

  assert.equal(outcome.kind, "already-done")
  assert.deepEqual(outcome.rewards, [
    { name: "星声", count: 20, icon: "https://example.com/astrite.png" },
    { name: "贝币", count: 3000, icon: "https://example.com/shell-credit.png" },
  ])
})
