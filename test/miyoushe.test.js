import assert from "node:assert/strict"
import test from "node:test"
import { MiyousheAdapter } from "../lib/communities/miyoushe/index.js"

function jsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload }
}

test("MiyousheAdapter discovers every supported game role returned by the community", async () => {
  const records = [
    { game_id: 2, region: "cn_gf01", game_role_id: "10001", nickname: "旅行者", level: 60 },
    { game_id: 6, region: "prod_gf_cn", game_role_id: "10002", nickname: "开拓者", level: 70 },
    { game_id: 8, region: "prod_gf_cn", game_role_id: "10003", nickname: "绳匠", level: 60 },
    { game_id: 999, region: "unknown", game_role_id: "0", nickname: "未知", level: 1 },
  ]
  const adapter = new MiyousheAdapter({
    fetchImpl: async () => jsonResponse({ retcode: 0, message: "OK", data: { list: records } }),
  })

  const targets = await adapter.discoverTargets("ltuid=123;cookie_token=secret")
  assert.deepEqual(targets.map(item => item.metadata.gameName), [
    "原神",
    "崩坏：星穹铁道",
    "绝区零",
  ])
  assert.equal(targets.every(item => item.externalId.includes(":")), true)
})

test("MiyousheAdapter normalizes already checked-in responses", async () => {
  const replies = [
    { retcode: 0, message: "OK", data: { is_sign: true, total_sign_day: 2 } },
    {
      retcode: 0,
      message: "OK",
      data: { awards: [{ name: "摩拉", cnt: 1 }, { name: "原石", cnt: 20 }] },
    },
  ]
  const adapter = new MiyousheAdapter({
    fetchImpl: async () => jsonResponse(replies.shift()),
  })
  const outcome = await adapter.checkIn(
    "ltuid=123;cookie_token=secret",
    {
      metadata: {
        gameKey: "genshin",
        actId: "activity",
        region: "cn_gf01",
        uid: "10001",
        signGame: "hk4e",
      },
    },
  )

  assert.equal(outcome.kind, "already-done")
  assert.deepEqual(outcome.reward, { name: "原石", count: 20, icon: undefined })
})

test("MiyousheAdapter exchanges a confirmed Passport QR login for credentials", async () => {
  const requests = []
  const replies = [
    {
      payload: {
        retcode: 0,
        data: { url: "https://example.test/qr", ticket: "ticket-1" },
      },
      cookies: [],
    },
    {
      payload: { retcode: 0, data: { status: "Scanned" } },
      cookies: [],
    },
    {
      payload: { retcode: 0, data: { status: "Confirmed" } },
      cookies: [
        "account_id_v2=123456; Path=/; HttpOnly",
        "cookie_token_v2=secret-token; Path=/; HttpOnly",
      ],
    },
  ]
  const adapter = new MiyousheAdapter({
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      const reply = replies.shift()
      return {
        ok: true,
        status: 200,
        headers: { getSetCookie: () => reply.cookies },
        json: async () => reply.payload,
      }
    },
  })

  const session = await adapter.createQrLogin()
  assert.equal(session.url, "https://example.test/qr")
  assert.equal((await adapter.queryQrLogin(session)).status, "scanned")

  const confirmed = await adapter.queryQrLogin(session)
  assert.equal(confirmed.status, "confirmed")
  assert.match(confirmed.credential.cookie, /account_id_v2=123456/)
  assert.match(confirmed.credential.cookie, /cookie_token_v2=secret-token/)
  assert.equal(requests[0].options.headers["x-rpc-app_id"], "bll8iq97cem8")
})
