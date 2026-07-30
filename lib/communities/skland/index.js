import crypto from "node:crypto"
import { CommunityAdapter } from "../base.js"

const APP_CODE = "4ca99fa6b56cc2ba"
const BASE_URL = "https://zonai.skland.com/api/v1"
const SEND_PHONE_CODE_URL =
  "https://as.hypergryph.com/general/v1/send_phone_code"
const TOKEN_BY_PHONE_CODE_URL =
  "https://as.hypergryph.com/user/auth/v2/token_by_phone_code"
const END_FIELD_SIGN_URL = "https://zonai.skland.com/web/v1/game/endfield/attendance"
const USER_AGENT =
  "Skland/1.32.1 (com.hypergryph.skland; build:103201004; Android 33; ) Okhttp/4.11.0"

function compactJson(value) {
  return JSON.stringify(value)
}

function mask(value) {
  const text = String(value ?? "")
  return text.length > 5 ? `${text.slice(0, 2)}***${text.slice(-2)}` : "***"
}

export class SklandAdapter extends CommunityAdapter {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    super("skland", "森空岛")
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.authCache = new Map()
  }

  normalizeCredential(input) {
    const token = typeof input === "string" ? input.trim() : String(input?.token ?? "").trim()
    if (!token) throw new Error("森空岛 Token 不能为空")
    return { token }
  }

  async sendPhoneCode(phone) {
    const normalized = String(phone ?? "").trim()
    if (!/^1\d{10}$/.test(normalized)) throw new Error("请输入正确的中国大陆手机号")
    const payload = await this.requestJson(SEND_PHONE_CODE_URL, {
      method: "POST",
      body: { phone: normalized, type: 2 },
    })
    if (payload.status !== 0) {
      throw new Error(payload.msg || "森空岛验证码发送失败")
    }
    return { phone: normalized }
  }

  async loginByPhoneCode(phone, code) {
    const normalizedPhone = String(phone ?? "").trim()
    const normalizedCode = String(code ?? "").trim()
    if (!/^1\d{10}$/.test(normalizedPhone)) throw new Error("手机号格式错误")
    if (!/^\d{4,8}$/.test(normalizedCode)) throw new Error("验证码格式错误")
    const payload = await this.requestJson(TOKEN_BY_PHONE_CODE_URL, {
      method: "POST",
      body: { phone: normalizedPhone, code: normalizedCode },
    })
    if (payload.status !== 0 || !payload.data?.token) {
      throw new Error(payload.msg || "森空岛验证码登录失败")
    }
    return { token: payload.data.token }
  }

  async validateCredential(input) {
    const credential = this.normalizeCredential(input)
    const auth = await this.authenticate(credential.token)
    const bindings = await this.fetchBindings(auth)
    const targetCount = this.bindingTargets(bindings).length
    return {
      externalAccountId: String(auth.userId ?? crypto.createHash("sha256").update(credential.token).digest("hex").slice(0, 16)),
      displayName: `森空岛 ${mask(auth.userId)}`,
      targetCount,
    }
  }

  async discoverTargets(input) {
    const credential = this.normalizeCredential(input)
    const auth = await this.authenticate(credential.token)
    return this.bindingTargets(await this.fetchBindings(auth))
  }

  bindingTargets(apps) {
    const targets = []
    for (const app of apps ?? []) {
      if (!["arknights", "endfield"].includes(app.appCode)) continue
      for (const binding of app.bindingList ?? []) {
        if (app.appCode === "endfield" && binding.roles?.length) {
          for (const role of binding.roles) {
            targets.push({
              externalId: `endfield:${role.serverId}:${role.roleId}`,
              displayName: `明日方舟：终末地 · ${role.nickname || role.roleId}`,
              businessTimezone: "Asia/Shanghai",
              metadata: {
                appCode: "endfield",
                gameName: "明日方舟：终末地",
                roleId: String(role.roleId),
                serverId: String(role.serverId),
              },
            })
          }
          continue
        }
        targets.push({
          externalId: `arknights:${binding.channelMasterId}:${binding.uid}`,
          displayName: `明日方舟 · ${binding.nickName || binding.uid}`,
          businessTimezone: "Asia/Shanghai",
          metadata: {
            appCode: "arknights",
            gameName: "明日方舟",
            uid: String(binding.uid),
            channelMasterId: String(binding.channelMasterId),
          },
        })
      }
    }
    return targets
  }

  async checkIn(input, target) {
    const credential = this.normalizeCredential(input)
    try {
      const auth = await this.authenticate(credential.token)
      const metadata = target.metadata ?? {}
      if (metadata.appCode === "arknights") {
        return await this.arknightsCheckIn(auth, metadata)
      }
      if (metadata.appCode === "endfield") {
        return await this.endfieldCheckIn(auth, metadata)
      }
      return { kind: "permanent-failure", reason: "未知森空岛游戏目标" }
    } catch (error) {
      return { kind: "retryable", reason: `森空岛请求失败：${error.message}` }
    }
  }

  async arknightsCheckIn(auth, metadata) {
    const body = { uid: metadata.uid, gameId: metadata.channelMasterId }
    const payload = await this.signedRequest(
      `${BASE_URL}/game/attendance`,
      auth,
      { method: "POST", body },
    )
    if (payload.code === 0) {
      const award = payload.data?.awards?.[0]
      return {
        kind: "success",
        reward: award
          ? { name: award.resource?.name, count: award.count }
          : undefined,
      }
    }
    if (payload.code === 10001) return { kind: "already-done" }
    return this.classify(payload)
  }

  async endfieldCheckIn(auth, metadata) {
    const payload = await this.signedRequest(END_FIELD_SIGN_URL, auth, {
      method: "POST",
      extraHeaders: {
        "sk-game-role": `3_${metadata.roleId}_${metadata.serverId}`,
      },
    })
    if (payload.code === 0) {
      const awardId = payload.data?.awardIds?.[0]?.id
      const award = awardId ? payload.data?.resourceInfoMap?.[awardId] : undefined
      return {
        kind: "success",
        reward: award ? { name: award.name, count: award.count, icon: award.icon } : undefined,
      }
    }
    if (payload.code === 10001) return { kind: "already-done" }
    return this.classify(payload)
  }

  classify(payload) {
    const reason = payload.message || payload.msg || `森空岛返回错误 ${payload.code}`
    if ([10000, 10002].includes(payload.code)) return { kind: "auth-expired", reason }
    if (/验证|风控|频繁/.test(reason)) return { kind: "risk-control", reason }
    if ([429, 500, 502, 503].includes(payload.code)) return { kind: "retryable", reason }
    return { kind: "permanent-failure", reason }
  }

  async authenticate(token) {
    const cached = this.authCache.get(token)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const grant = await this.requestJson(
      "https://as.hypergryph.com/user/oauth2/v2/grant",
      {
        method: "POST",
        body: { appCode: APP_CODE, token, type: 0 },
      },
    )
    if (grant.status !== 0 || !grant.data?.code) {
      throw new Error(grant.msg || "森空岛 Token 无效")
    }
    const generated = await this.requestJson(
      `${BASE_URL}/user/auth/generate_cred_by_code`,
      { method: "POST", body: { code: grant.data.code, kind: 1 } },
    )
    if (generated.status !== 0 || !generated.data?.cred || !generated.data?.token) {
      throw new Error(generated.message || generated.msg || "无法生成森空岛凭证")
    }
    const value = generated.data
    this.authCache.set(token, { value, expiresAt: Date.now() + 10 * 60 * 1000 })
    return value
  }

  async fetchBindings(auth) {
    const payload = await this.signedRequest(`${BASE_URL}/game/player/binding`, auth)
    if (payload.code !== 0) {
      const outcome = this.classify(payload)
      throw new Error(outcome.reason)
    }
    return payload.data?.list ?? []
  }

  signHeaders(url, method, body, auth) {
    const timestamp = String(Math.floor(Date.now() / 1000) - 1)
    const signedFields = { platform: "", timestamp, dId: "", vName: "" }
    const parsed = new URL(url)
    const bodyOrQuery =
      method === "POST" ? (body ? compactJson(body) : "") : parsed.search.slice(1)
    const secret =
      parsed.pathname + bodyOrQuery + timestamp + compactJson(signedFields)
    const hmac = crypto.createHmac("sha256", auth.token).update(secret).digest("hex")
    const sign = crypto.createHash("md5").update(hmac).digest("hex")
    return {
      "User-Agent": USER_AGENT,
      "Accept-Encoding": "gzip",
      Connection: "close",
      cred: auth.cred,
      sign,
      ...signedFields,
    }
  }

  async signedRequest(
    url,
    auth,
    { method = "GET", body, extraHeaders = {} } = {},
  ) {
    return this.requestJson(url, {
      method,
      body,
      headers: {
        ...this.signHeaders(url, method, body, auth),
        ...extraHeaders,
      },
    })
  }

  async requestJson(url, { method = "GET", headers = {}, body } = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          ...headers,
        },
        body: body ? compactJson(body) : undefined,
        signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok && !payload?.code) throw new Error(`HTTP ${response.status}`)
      return payload
    } finally {
      clearTimeout(timeout)
    }
  }
}
