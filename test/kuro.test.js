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
