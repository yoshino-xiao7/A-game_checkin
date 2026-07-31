import assert from "node:assert/strict"
import test from "node:test"
import {
  TaygedoAdapter,
  encryptLoginField,
  generateDs,
  generateSign,
} from "../lib/communities/taygedo/index.js"

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

test("TaygedoAdapter signs and encrypts official login parameters", () => {
  assert.equal(generateSign({ b: 2, a: 1 }), generateSign({ a: 1, b: 2 }))
  assert.match(generateSign({ a: 1 }), /^[a-f0-9]{32}$/)
  assert.notEqual(encryptLoginField("13800138000"), "13800138000")
  assert.equal(
    Buffer.from(encryptLoginField("123456"), "base64").length % 16,
    0,
  )
})

test("TaygedoAdapter generates the user-center DS signature used by 1.2.5", () => {
  assert.equal(
    generateDs({ timestamp: 1722330000, nonce: "Ab12Cd34" }),
    "1722330000,Ab12Cd34,f89a8eaabc7f4f20e34488754986b851",
  )
})

test("TaygedoAdapter logs in by phone code and discovers 幻塔 and 异环", async () => {
  const calls = []
  const adapter = new TaygedoAdapter({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options })
      if (String(url).includes("sendPhoneCaptchaWithOutLogin")) {
        return jsonResponse({ code: 0, message: "手机短信发送成功" })
      }
      if (String(url).includes("/openApi/sms/new/login")) {
        const form = new URLSearchParams(options.body)
        assert.notEqual(form.get("cellphone"), "13800138000")
        assert.notEqual(form.get("captcha"), "123456")
        return jsonResponse({
          code: 0,
          result: { token: "laohu-token", userId: "laohu-user" },
        })
      }
      if (String(url).endsWith("/usercenter/api/login")) {
        const headers = new Headers(options.headers)
        const [timestamp, nonce, digest] = headers.get("ds").split(",")
        assert.equal(headers.get("appVersion"), "1.2.5")
        assert.equal(headers.get("deviceId"), "device-1")
        assert.equal(headers.get("uid"), "0")
        assert.equal(headers.get("debug-uid"), "3")
        assert.match(timestamp, /^\d{10}$/)
        assert.match(nonce, /^[A-Za-z0-9]{8}$/)
        assert.match(digest, /^[a-f0-9]{32}$/)
        return jsonResponse({
          code: 0,
          data: {
            uid: "10086",
            accessToken: "access-token",
            refreshToken: "refresh-token",
          },
        })
      }
      if (String(url).includes("gameId=1256")) {
        return jsonResponse({
          code: 0,
          data: { roleId: "ht-1", roleName: "拓荒者" },
        })
      }
      if (String(url).includes("gameId=1289")) {
        return jsonResponse({
          code: 0,
          data: { roleId: "yh-1", roleName: "鉴定师" },
        })
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })

  const sent = await adapter.sendPhoneCode("13800138000", "device-1")
  const credential = await adapter.loginByPhoneCode(
    sent.phone,
    "123456",
    sent.deviceId,
  )
  const targets = await adapter.discoverTargets(credential)

  assert.equal(credential.uid, "10086")
  assert.deepEqual(
    targets.map(item => item.displayName),
    ["幻塔 · 拓荒者", "异环 · 鉴定师"],
  )
  assert.equal(
    calls.filter(item => item.url.includes("getGameBindRole")).length,
    2,
  )
  assert.equal(
    calls.some(item => item.url.includes("checkPhoneCaptchaWithOutLogin")),
    false,
  )
})

test("TaygedoAdapter performs game check-in and returns item details", async () => {
  const adapter = new TaygedoAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = String(url)
      if (path.includes("/signin/state")) {
        return jsonResponse({ code: 0, data: { days: 23, todaySign: false } })
      }
      if (path.includes("/sign/rewards")) {
        return jsonResponse({
          code: 0,
          data: {
            items: [
              { name: "环石", num: 30, icon: "https://example.com/3.png" },
            ],
          },
        })
      }
      if (path.endsWith("/apihub/awapi/sign")) {
        assert.equal(new URLSearchParams(options.body).get("gameId"), "1289")
        assert.equal(new URLSearchParams(options.body).get("roleId"), "yh-1")
        return jsonResponse({ code: 0, msg: "ok" })
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const outcome = await adapter.checkIn(
    {
      uid: "10086",
      deviceId: "device-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      refreshedAt: Date.now(),
    },
    {
      metadata: { gameId: 1289, roleId: "yh-1" },
    },
  )

  assert.equal(outcome.kind, "success")
  assert.deepEqual(outcome.rewards, [{
    name: "环石",
    count: 30,
    icon: "https://example.com/3.png",
  }])
  assert.equal(outcome.credentialUpdate.uid, "10086")
})
