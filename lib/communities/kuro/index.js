import crypto from "node:crypto"
import { CommunityAdapter } from "../base.js"
import {
  createKuroPhoneLoginFile,
  createKuroPhoneSession,
  finishKuroPhoneSession,
  getKuroPhoneSession,
  loginKuroPhoneSession,
} from "./phone-login.js"

const BASE_URL = "https://api.kurobbs.com"
const GAMES = Object.freeze([
  { gameId: 2, key: "pns", name: "战双帕弥什" },
  { gameId: 3, key: "wuthering-waves", name: "鸣潮" },
])

function mask(value) {
  const text = String(value ?? "")
  return text.length > 5 ? `${text.slice(0, 2)}***${text.slice(-2)}` : "***"
}

function fixedDeviceCode(userId) {
  return crypto.createHash("sha256").update(String(userId)).digest("hex").toUpperCase().slice(0, 40)
}

function randomDeviceCode() {
  return crypto.randomBytes(20).toString("hex").toUpperCase()
}

function collectGoodsIcons(value, icons = new Map(), seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return icons
  seen.add(value)
  if (value.goodsId != null && value.goodsUrl) {
    icons.set(String(value.goodsId), value.goodsUrl)
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectGoodsIcons(child, icons, seen)
  }
  return icons
}

export class KuroAdapter extends CommunityAdapter {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    super("kuro", "库街区")
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  normalizeCredential(input) {
    if (typeof input === "object" && input) {
      const source = input.data ?? input
      if (source.userId && source.token) {
        return {
          userId: String(source.userId),
          token: String(source.token),
          ...(source.deviceCode ? { deviceCode: String(source.deviceCode) } : {}),
        }
      }
    }
    const text = String(input ?? "").trim()
    try {
      const parsed = JSON.parse(text)
      return this.normalizeCredential(parsed)
    } catch {}
    const matched = text.match(/^(\d+)\s*[:：,\s]\s*(\S+)$/)
    if (matched) return { userId: matched[1], token: matched[2] }
    throw new Error("库街区凭证格式应为登录 JSON，或“用户ID Token”")
  }

  createPhoneLogin(phone) {
    return createKuroPhoneSession(phone, randomDeviceCode())
  }

  createPhoneLoginFile(token, directory) {
    return createKuroPhoneLoginFile(token, directory)
  }

  getPhoneLogin(token) {
    return getKuroPhoneSession(token)
  }

  finishPhoneLogin(token) {
    finishKuroPhoneSession(token)
  }

  async loginPhoneSession(token, code) {
    return loginKuroPhoneSession(this, token, code)
  }

  async sendPhoneCode(phone, geeTestData, deviceCode = randomDeviceCode()) {
    const normalizedPhone = String(phone ?? "").trim()
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) {
      throw new Error("请输入正确的中国大陆手机号")
    }
    const required = ["lot_number", "captcha_output", "pass_token", "gen_time"]
    const validation = Object.fromEntries(
      required.map(key => [key, String(geeTestData?.[key] ?? "").trim()]),
    )
    if (required.some(key => !validation[key])) {
      throw new Error("滑块验证结果不完整，请刷新验证页后重试")
    }
    const payload = await this.postAuth(
      "/user/getSmsCode",
      {
        mobile: normalizedPhone,
        geeTestData: JSON.stringify(validation),
      },
      deviceCode,
    )
    if (payload.code !== 200) {
      throw new Error(payload.msg || payload.message || "库街区验证码发送失败")
    }
    return { phone: normalizedPhone, deviceCode }
  }

  async loginByPhoneCode(phone, code, deviceCode = randomDeviceCode()) {
    const normalizedPhone = String(phone ?? "").trim()
    const normalizedCode = String(code ?? "").trim()
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) throw new Error("手机号格式错误")
    if (!/^\d{4,8}$/.test(normalizedCode)) throw new Error("验证码格式错误")
    const payload = await this.postAuth(
      "/user/sdkLogin",
      {
        code: normalizedCode,
        devCode: deviceCode,
        gameList: "",
        mobile: normalizedPhone,
      },
      deviceCode,
    )
    if (payload.code !== 200 || !payload.data?.token) {
      throw new Error(payload.msg || payload.message || "库街区验证码登录失败")
    }
    const token = String(payload.data.token)
    const userId =
      payload.data.userId ??
      payload.data.user_id ??
      payload.data.uid ??
      (await this.resolveLoginUserId(token, deviceCode))
    if (!userId) throw new Error("登录成功，但没有找到该库街区账号下的游戏角色")
    return { userId: String(userId), token, deviceCode }
  }

  async resolveLoginUserId(token, deviceCode) {
    const credential = { userId: "", token, deviceCode }
    for (const game of GAMES) {
      const payload = await this.post("/gamer/role/list", credential, {
        gameId: game.gameId,
      })
      if (payload.code !== 200) continue
      const userId = payload.data?.find(role => role.userId)?.userId
      if (userId) return String(userId)
    }
    return null
  }

  async validateCredential(input) {
    const credential = this.normalizeCredential(input)
    const mine = await this.post("/user/mineV2", credential, {
      otherUserId: credential.userId,
    })
    if (mine.code === 220) throw new Error("库街区 Token 已失效")
    if (mine.code !== 200) throw new Error(mine.msg || mine.message || "库街区凭证验证失败")
    return {
      externalAccountId: credential.userId,
      displayName: `${mine.data?.mine?.userName || "库街区"} ${mask(credential.userId)}`,
    }
  }

  async discoverTargets(input) {
    const credential = this.normalizeCredential(input)
    const targets = []
    for (const game of GAMES) {
      const payload = await this.post("/user/role/findRoleList", credential, {
        gameId: game.gameId,
      })
      if (payload.code === 220) throw new Error("库街区 Token 已失效")
      if (payload.code !== 200) continue
      for (const role of payload.data ?? []) {
        targets.push({
          externalId: `${game.key}:${role.serverId}:${role.roleId}`,
          displayName: `${game.name} · ${role.roleName || role.roleId}`,
          businessTimezone: "Asia/Shanghai",
          metadata: {
            gameId: game.gameId,
            gameName: game.name,
            serverId: String(role.serverId),
            roleId: String(role.roleId),
            userId: credential.userId,
          },
        })
      }
    }
    return targets
  }

  async checkIn(input, target) {
    const credential = this.normalizeCredential(input)
    const metadata = target.metadata ?? {}
    try {
      const info = await this.post("/encourage/signIn/initSignInV2", credential, {
        gameId: metadata.gameId,
        serverId: metadata.serverId,
        roleId: metadata.roleId,
        userId: credential.userId,
      }, true)
      const classifiedInfo = this.classify(info)
      if (classifiedInfo) return classifiedInfo
      if (info.data?.isSigIn) {
        return {
          kind: "already-done",
          rewards: await this.todayRewards(credential, metadata, info.data),
        }
      }

      const signed = await this.post("/encourage/signIn/v2", credential, {
        gameId: metadata.gameId,
        serverId: metadata.serverId,
        roleId: metadata.roleId,
        userId: credential.userId,
        reqMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
      }, true)
      const classifiedSign = this.classify(signed, true)
      if (classifiedSign) return classifiedSign
      return {
        kind: "success",
        rewards: await this.todayRewards(credential, metadata, info.data),
      }
    } catch (error) {
      return { kind: "retryable", reason: `库街区请求失败：${error.message}` }
    }
  }

  async todayRewards(credential, metadata, signInConfig) {
    try {
      const goodsIcons = collectGoodsIcons(signInConfig)
      const payload = await this.post("/encourage/signIn/queryRecordV2", credential, {
        gameId: metadata.gameId,
        serverId: metadata.serverId,
        roleId: metadata.roleId,
        userId: credential.userId,
      }, true)
      if (payload.code !== 200) return undefined
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
      return (payload.data ?? []).filter(item =>
        String(item.sigInDate ?? "").startsWith(today),
      )
        .filter(item => item.goodsName)
        .map(item => ({
          name: item.goodsName,
          count: item.goodsNum,
          icon: item.goodsUrl ?? goodsIcons.get(String(item.goodsId)),
        }))
    } catch {
      return []
    }
  }

  classify(payload, signing = false) {
    if (payload.code === 200) return null
    const reason = payload.msg || payload.message || `库街区返回错误 ${payload.code}`
    if (payload.code === 220) {
      return signing && Object.hasOwn(payload, "success")
        ? { kind: "risk-control", reason }
        : { kind: "auth-expired", reason }
    }
    if (/风控|验证|频繁/.test(reason)) return { kind: "risk-control", reason }
    if ([429, 500, 502, 503].includes(payload.code)) return { kind: "retryable", reason }
    return { kind: "permanent-failure", reason }
  }

  headers(credential, browser = false) {
    const deviceCode = credential.deviceCode || fixedDeviceCode(credential.userId)
    if (browser) {
      return {
        source: "android",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 " +
          "Kuro/2.2.1 KuroGameBox/2.2.1",
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json, text/plain, */*",
        devcode: deviceCode,
        token: credential.token,
        origin: "https://web-static.kurobbs.com",
      }
    }
    return {
      devCode: deviceCode,
      source: "android",
      version: "2.2.1",
      versionCode: "2210",
      osVersion: "Android",
      countryCode: "CN",
      model: "23127PN0CC",
      lang: "zh-Hans",
      channelId: "2",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "User-Agent": "okhttp/3.11.0",
      token: credential.token,
      Cookie: `user_token=${credential.token}`,
    }
  }

  async post(path, credential, data, browser = false) {
    return this.request(path, data, this.headers(credential, browser))
  }

  async postAuth(path, data, deviceCode) {
    return this.request(path, data, {
      ...this.headers({ userId: "", token: "", deviceCode }),
      did: deviceCode,
      distinct_id: deviceCode,
      "x-requested-with": "com.kurogame.kjq",
      accept: "application/json, text/plain, */*",
    })
  }

  async request(path, data, headers) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: new URLSearchParams(
          Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
        ).toString(),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }
}

export { GAMES as KURO_GAMES }
