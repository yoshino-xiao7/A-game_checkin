import crypto from "node:crypto"
import { CommunityAdapter } from "../base.js"
import { MIYOUSHE_GAME_BY_ID, MIYOUSHE_GAMES } from "./games.js"

const RECORD_URL =
  "https://api-takumi-record.mihoyo.com/game_record/card/wapi/getGameRecordCard"
const CREATE_QR_URL =
  "https://passport-api.mihoyo.com/account/ma-cn-passport/web/createQRLogin"
const QUERY_QR_URL =
  "https://passport-api.mihoyo.com/account/ma-cn-passport/web/queryQRLoginStatus"
const PASSPORT_APP_ID = "bll8iq97cem8"
const DEFAULT_API_BASE = "https://api-takumi.mihoyo.com/event/luna"
const DS_SALT_IOS = "9ttJY72HxbjwWRNHJvn0n2AYue47nYsK"
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/2.63.1"

function parseCookie(cookie) {
  return Object.fromEntries(
    String(cookie)
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const separator = part.indexOf("=")
        return separator < 0
          ? [part, ""]
          : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
      }),
  )
}

function accountUid(cookie) {
  const values = parseCookie(cookie)
  return (
    values.stuid ||
    values.ltuid ||
    values.account_id ||
    values.login_uid ||
    values.ltuid_v2 ||
    values.account_id_v2 ||
    values.ltmid_v2 ||
    values.account_mid_v2
  )
}

function cookiesFromHeaders(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean)
  const cookies = {}
  for (const value of values) {
    const pattern = /(?:^|,\s*)([^=;,\s]+)=([^;,]*)/g
    for (const match of value.matchAll(pattern)) cookies[match[1]] = match[2]
  }
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

function createDs() {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const random = crypto.randomBytes(4).toString("hex").slice(0, 6)
  const checksum = crypto
    .createHash("md5")
    .update(`salt=${DS_SALT_IOS}&t=${timestamp}&r=${random}`)
    .digest("hex")
  return `${timestamp},${random},${checksum}`
}

function isAuthExpired(payload) {
  return [-100, 10001].includes(payload?.retcode) || /登录失效|尚未登录/.test(payload?.message ?? "")
}

function apiFailure(payload) {
  return payload?.retcode !== 0 && payload?.retcode !== 1 && payload?.message !== "OK"
}

export class MiyousheAdapter extends CommunityAdapter {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    super("miyoushe", "米游社")
    if (!fetchImpl) throw new Error("当前 Node.js 环境不支持 fetch")
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  async validateCredential(input) {
    const credential = this.normalizeCredential(input)
    const uid = accountUid(credential.cookie)
    if (!uid) throw new Error("Cookie 中缺少米游社 UID")
    const records = await this.fetchRecords(credential)
    return {
      externalAccountId: String(uid),
      displayName: `米游社 ${String(uid).replace(/^(.{2}).*(.{2})$/, "$1***$2")}`,
      targetCount: records.length,
    }
  }

  async createQrLogin() {
    const deviceId = crypto.randomUUID().toUpperCase()
    const response = await this.requestPassport(CREATE_QR_URL, deviceId, {})
    if (response.payload?.retcode !== 0) {
      throw new Error(response.payload?.message || "无法创建米游社登录二维码")
    }
    const { url, ticket } = response.payload.data ?? {}
    if (!url || !ticket) throw new Error("米游社未返回完整的二维码信息")
    return { deviceId, url, ticket }
  }

  async queryQrLogin({ deviceId, ticket }) {
    const response = await this.requestPassport(QUERY_QR_URL, deviceId, { ticket })
    const payload = response.payload
    if (payload?.retcode !== 0) {
      const message = String(payload?.message || "米游社扫码状态异常")
      if ([-106, -1002].includes(payload?.retcode) || message.includes("过期")) {
        return { status: "expired", reason: message }
      }
      throw new Error(message)
    }

    const status = payload.data?.status
    if (["Created", "Init"].includes(status)) return { status: "waiting" }
    if (status === "Scanned") return { status: "scanned" }
    if (status !== "Confirmed") {
      throw new Error(`未知的米游社扫码状态：${status ?? "空"}`)
    }

    const cookie = cookiesFromHeaders(response.headers)
    if (!accountUid(cookie) || !/(?:cookie_token|cookie_token_v2)=/.test(cookie)) {
      throw new Error("扫码已确认，但米游社未返回完整登录态")
    }
    return { status: "confirmed", credential: { cookie, deviceId } }
  }

  async discoverTargets(input) {
    const credential = this.normalizeCredential(input)
    const records = await this.fetchRecords(credential)
    return records.flatMap(record => {
      const game = MIYOUSHE_GAME_BY_ID.get(Number(record.game_id))
      if (!game) return []
      return [{
        externalId: `${game.key}:${record.region}:${record.game_role_id}`,
        displayName: `${game.name} · ${record.nickname || record.game_role_id}`,
        businessTimezone: "Asia/Shanghai",
        metadata: {
          gameKey: game.key,
          gameId: game.gameId,
          gameName: game.name,
          actId: game.actId,
          signGame: game.signGame,
          apiBase: game.apiBase,
          region: record.region,
          uid: String(record.game_role_id),
          nickname: record.nickname,
          level: record.level,
        },
      }]
    })
  }

  async checkIn(input, target) {
    const credential = this.normalizeCredential(input)
    const metadata = target.metadata ?? {}
    const game = MIYOUSHE_GAMES.find(item => item.key === metadata.gameKey)
    if (!game) return { kind: "permanent-failure", reason: "未知米游社签到游戏" }

    try {
      const info = await this.requestSignApi("info", credential, target, "GET")
      if (isAuthExpired(info)) return { kind: "auth-expired", reason: info.message || "登录失效" }
      if (!apiFailure(info) && info.data?.is_sign) {
        return {
          kind: "already-done",
          reward: await this.rewardSummary(credential, target, info.data.total_sign_day),
        }
      }

      const signed = await this.requestSignApi("sign", credential, target, "POST")
      if (isAuthExpired(signed)) {
        return { kind: "auth-expired", reason: signed.message || "登录失效" }
      }
      if (Number(signed.data?.risk_code ?? 0) !== 0 || /验证码|风控/.test(signed.message ?? "")) {
        return { kind: "risk-control", reason: signed.message || "触发米游社人机验证" }
      }
      if (apiFailure(signed)) {
        return this.classifyFailure(signed)
      }

      const refreshed = await this.requestSignApi("info", credential, target, "GET").catch(() => null)
      return {
        kind: "success",
        reward: await this.rewardSummary(
          credential,
          target,
          refreshed?.data?.total_sign_day,
        ),
      }
    } catch (error) {
      return { kind: "retryable", reason: `网络请求失败：${error.message}` }
    }
  }

  normalizeCredential(input) {
    const credential = typeof input === "string" ? { cookie: input } : { ...input }
    credential.cookie = String(credential.cookie ?? "").trim()
    if (!credential.cookie) throw new Error("米游社 Cookie 不能为空")
    credential.deviceId ??= crypto.randomUUID().toUpperCase()
    return credential
  }

  async fetchRecords(credential) {
    const uid = accountUid(credential.cookie)
    const payload = await this.requestJson(
      `${RECORD_URL}?uid=${encodeURIComponent(uid)}`,
      { headers: this.recordHeaders(), cookie: credential.cookie },
    )
    if (isAuthExpired(payload)) throw new Error("米游社登录已失效")
    if (apiFailure(payload) || !Array.isArray(payload.data?.list)) {
      throw new Error(payload.message || "无法获取米游社游戏角色")
    }
    return payload.data.list
  }

  async requestSignApi(action, credential, target, method) {
    const metadata = target.metadata
    const base = metadata.apiBase || DEFAULT_API_BASE
    const query = new URLSearchParams({
      act_id: metadata.actId,
      region: metadata.region,
      uid: metadata.uid,
      lang: "zh-cn",
    })
    const url = action === "info" ? `${base}/info?${query}` : `${base}/sign`
    const body = action === "sign"
      ? {
          act_id: metadata.actId,
          region: metadata.region,
          uid: metadata.uid,
        }
      : undefined
    return this.requestJson(url, {
      method,
      headers: this.signHeaders(credential, metadata),
      cookie: credential.cookie,
      body,
    })
  }

  async rewardSummary(credential, target, day) {
    if (!Number.isInteger(day) || day < 1) return undefined
    try {
      const metadata = target.metadata
      const base = metadata.apiBase || DEFAULT_API_BASE
      const query = new URLSearchParams({ act_id: metadata.actId, lang: "zh-cn" })
      const payload = await this.requestJson(`${base}/home?${query}`, {
        headers: this.rewardHeaders(metadata),
        cookie: credential.cookie,
      })
      const award = payload.data?.awards?.[day - 1]
      return award ? { name: award.name, count: award.cnt, icon: award.icon } : undefined
    } catch {
      return undefined
    }
  }

  classifyFailure(payload) {
    const reason = payload.message || `米游社返回错误 ${payload.retcode}`
    if ([429, -110, -5003].includes(payload.retcode) || /频繁|稍后|繁忙/.test(reason)) {
      return { kind: "retryable", reason }
    }
    return { kind: "permanent-failure", reason }
  }

  recordHeaders() {
    return {
      Accept: "application/json, text/plain, */*",
      "User-Agent": USER_AGENT,
      Origin: "https://webstatic.mihoyo.com",
      Referer: "https://webstatic.mihoyo.com/",
    }
  }

  signHeaders(credential, metadata) {
    const headers = {
      ...this.recordHeaders(),
      "Content-Type": "application/json;charset=utf-8",
      "x-rpc-app_version": "2.63.1",
      "x-rpc-channel": "appstore",
      "x-rpc-client_type": "5",
      "x-rpc-device_id": credential.deviceId,
      "x-rpc-device_model": "iPhone10,2",
      "x-rpc-device_name": "iPhone",
      "x-rpc-platform": "ios",
      "x-rpc-sys_version": "16.2",
      DS: createDs(),
    }
    if (metadata.signGame) headers["x-rpc-signgame"] = metadata.signGame
    if (metadata.gameKey === "genshin" || metadata.gameKey === "zzz") {
      headers.Origin = "https://act.mihoyo.com"
      headers.Referer = "https://act.mihoyo.com/"
    }
    return headers
  }

  rewardHeaders(metadata) {
    const headers = this.recordHeaders()
    if (metadata.signGame) headers["x-rpc-signgame"] = metadata.signGame
    if (metadata.gameKey === "genshin" || metadata.gameKey === "zzz") {
      headers.Origin = "https://act.mihoyo.com"
      headers.Referer = "https://act.mihoyo.com/"
    }
    return headers
  }

  async requestJson(url, { method = "GET", headers = {}, cookie, body } = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: { ...headers, Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  async requestPassport(url, deviceId, body) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
          "x-rpc-app_id": PASSPORT_APP_ID,
          "x-rpc-device_id": deviceId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return { payload: await response.json(), headers: response.headers }
    } finally {
      clearTimeout(timeout)
    }
  }
}
