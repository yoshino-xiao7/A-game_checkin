import assert from "node:assert/strict"
import test from "node:test"
import { SklandAdapter } from "../lib/communities/skland/index.js"

function response(payload) {
  return { ok: true, status: 200, json: async () => payload }
}

test("SklandAdapter discovers Arknights and Endfield roles", async () => {
  const replies = [
    { status: 0, data: { code: "grant" } },
    { code: 0, message: "OK", data: { cred: "cred", token: "sign-token", userId: "123456" } },
    {
      code: 0,
      data: {
        list: [
          {
            appCode: "arknights",
            bindingList: [
              { uid: "ark-1", channelMasterId: "1", nickName: "博士" },
            ],
          },
          {
            appCode: "endfield",
            bindingList: [
              {
                uid: "ef-user",
                roles: [{ roleId: "ef-1", serverId: "cn", nickname: "管理员" }],
              },
            ],
          },
        ],
      },
    },
  ]
  const adapter = new SklandAdapter({
    fetchImpl: async () => response(replies.shift()),
  })
  const targets = await adapter.discoverTargets("hg-token")
  assert.deepEqual(targets.map(target => target.metadata.gameName), [
    "明日方舟",
    "明日方舟：终末地",
  ])
})

test("SklandAdapter treats repeat attendance as already done", async () => {
  const replies = [
    { status: 0, data: { code: "grant" } },
    { status: 0, data: { cred: "cred", token: "sign-token", userId: "123456" } },
    { code: 10001, message: "请勿重复签到" },
  ]
  const adapter = new SklandAdapter({
    fetchImpl: async () => response(replies.shift()),
  })
  const outcome = await adapter.checkIn("hg-token", {
    metadata: { appCode: "arknights", uid: "ark-1", channelMasterId: "1" },
  })
  assert.equal(outcome.kind, "already-done")
})

test("SklandAdapter resolves Arknights reward icons from resource types", async () => {
  const replies = [
    { status: 0, data: { code: "grant" } },
    { status: 0, data: { cred: "cred", token: "sign-token", userId: "123456" } },
    {
      code: 0,
      data: {
        awards: [{
          resource: {
            id: "4003",
            type: "DIAMOND_SHD",
            name: "合成玉",
          },
          count: 100,
        }],
      },
    },
  ]
  const adapter = new SklandAdapter({
    fetchImpl: async () => response(replies.shift()),
  })
  const outcome = await adapter.checkIn("hg-token", {
    metadata: { appCode: "arknights", uid: "ark-1", channelMasterId: "1" },
  })

  assert.equal(outcome.kind, "success")
  assert.equal(outcome.rewards[0].name, "合成玉")
  assert.equal(
    outcome.rewards[0].icon,
    "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/item/DIAMOND_SHD.png",
  )
})

test("SklandAdapter recovers today's Endfield reward after repeat attendance", async () => {
  const replies = [
    { status: 0, data: { code: "grant" } },
    { status: 0, data: { cred: "cred", token: "sign-token", userId: "123456" } },
    { code: 10001, message: "请勿重复签到" },
    {
      code: 0,
      data: {
        hasToday: true,
        calendar: [
          { awardId: "reward-1", done: true, available: false },
          { awardId: "reward-2", done: true, available: false },
          { awardId: "reward-3", done: false, available: false },
        ],
        resourceInfoMap: {
          "reward-1": { name: "中级作战记录", count: 2, icon: "https://example.com/1.png" },
          "reward-2": { name: "武器检查装置", count: 2, icon: "https://example.com/2.png" },
          "reward-3": { name: "协议棱柱", count: 2, icon: "https://example.com/3.png" },
        },
      },
    },
  ]
  const requests = []
  const adapter = new SklandAdapter({
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return response(replies.shift())
    },
  })

  const outcome = await adapter.checkIn("hg-token", {
    metadata: {
      appCode: "endfield",
      roleId: "ef-role",
      serverId: "cn",
    },
  })

  assert.equal(outcome.kind, "already-done")
  assert.deepEqual(outcome.rewards, [{
    name: "武器检查装置",
    count: 2,
    icon: "https://example.com/2.png",
  }])
  assert.equal(requests[3].options.method, "GET")
  assert.equal(requests[3].options.headers["sk-game-role"], "3_ef-role_cn")
  assert.match(requests[3].url, /gameId=3/)
  assert.match(requests[3].url, /roleId=ef-role/)
  assert.match(requests[3].url, /serverId=cn/)
})

test("SklandAdapter keeps already-done when Endfield reward lookup fails", async () => {
  const replies = [
    { status: 0, data: { code: "grant" } },
    { status: 0, data: { cred: "cred", token: "sign-token", userId: "123456" } },
    { code: 10001, message: "请勿重复签到" },
  ]
  const adapter = new SklandAdapter({
    fetchImpl: async () => {
      if (replies.length) return response(replies.shift())
      throw new Error("calendar unavailable")
    },
  })

  const outcome = await adapter.checkIn("hg-token", {
    metadata: { appCode: "endfield", roleId: "ef-role", serverId: "cn" },
  })

  assert.deepEqual(outcome, { kind: "already-done" })
})

test("SklandAdapter logs in with a phone verification code", async () => {
  const requests = []
  const replies = [
    { status: 0, msg: "OK" },
    { status: 0, msg: "OK", data: { token: "hg-token" } },
  ]
  const adapter = new SklandAdapter({
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) })
      return response(replies.shift())
    },
  })

  await adapter.sendPhoneCode("18888888888")
  const credential = await adapter.loginByPhoneCode("18888888888", "123456")

  assert.deepEqual(requests[0].body, { phone: "18888888888", type: 2 })
  assert.match(requests[0].url, /general\/v1\/send_phone_code$/)
  assert.deepEqual(requests[1].body, { phone: "18888888888", code: "123456" })
  assert.match(requests[1].url, /user\/auth\/v2\/token_by_phone_code$/)
  assert.deepEqual(credential, { token: "hg-token" })
})

test("SklandAdapter refreshes the signing token when cred response omits it", async () => {
  const replies = [
    { status: 0, data: { code: "grant" } },
    { code: 0, message: "OK", data: { cred: "cred", userId: "123456" } },
    { code: 0, message: "OK", data: { token: "refreshed-sign-token" } },
    { code: 0, data: { list: [] } },
  ]
  const requests = []
  const adapter = new SklandAdapter({
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return response(replies.shift())
    },
  })

  await adapter.discoverTargets("hg-token")

  assert.match(requests[2].url, /\/auth\/refresh$/)
  assert.equal(requests[2].options.headers.cred, "cred")
})
