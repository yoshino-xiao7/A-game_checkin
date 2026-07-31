import crypto from "node:crypto"
import { CommunityAdapter } from "../base.js"

const SECRET = "89155cc4e8634ec5b1b6364013b23e3e"
const LOGIN_BASE = "https://user.laohu.com"
const API_BASE = "https://bbs-api.tajiduo.com"
const APP_VERSION = "1.2.5"
const APP_ID = "10550"
const USER_CENTER_APP_ID = "10551"
const BID = "com.pwrd.htassistant"
const DEVICE_MODEL = "LGE-AN10"
const SDK_VERSION = "4.129.0"
const API_DS_SECRET = "pUds3dfMkl"
const RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

const GAMES = Object.freeze([
  {
    gameId: 1256,
    communityId: 1,
    key: "tower-of-fantasy",
    name: "幻塔",
  },
  {
    gameId: 1289,
    communityId: 2,
    key: "neverness-to-everness",
    name: "异环",
  },
])

function randomDeviceId() {
  return crypto.randomUUID().replaceAll("-", "").toLowerCase()
}

function mask(value) {
  const text = String(value ?? "")
  return text.length > 5 ? `${text.slice(0, 2)}***${text.slice(-2)}` : "***"
}

function apiMessage(payload, fallback) {
  return payload?.message || payload?.msg || fallback
}

function successful(payload) {
  return Number(payload?.code) === 0
}

function generateSign(parameters) {
  const values = Object.keys(parameters)
    .sort()
    .map(key => String(parameters[key]))
    .join("")
  return crypto.createHash("md5").update(values + SECRET).digest("hex")
}

function generateDs({
  timestamp = Math.floor(Date.now() / 1000),
  nonce = Array.from(
    crypto.randomBytes(8),
    byte => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length],
  ).join(""),
} = {}) {
  const digest = crypto
    .createHash("md5")
    .update(`${timestamp}${nonce}${APP_VERSION}${API_DS_SECRET}`)
    .digest("hex")
  return `${timestamp},${nonce},${digest}`
}

function encryptLoginField(value) {
  const cipher = crypto.createCipheriv(
    "aes-128-ecb",
    Buffer.from(SECRET.slice(-16), "utf8"),
    null,
  )
  cipher.setAutoPadding(true)
  return Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]).toString("base64")
}

function collectRoles(value, output = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return output
  seen.add(value)
  if (value.roleId != null) {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRoles(item, output, seen)
    return output
  }
  for (const key of ["roles", "roleList", "bindingList", "list", "data"]) {
    collectRoles(value[key], output, seen)
  }
  return output
}

function rewardList(value) {
  if (Array.isArray(value)) return value
  for (const key of ["rewards", "rewardList", "list", "items"]) {
    if (Array.isArray(value?.[key])) return value[key]
  }
  return []
}

function rewardForDay(value, dayIndex) {
  const rewards = rewardList(value)
  const day = Math.max(1, Number(dayIndex) + 1)
  const dated = rewards.filter(item =>
    [item?.day, item?.days, item?.signDay].some(entry => Number(entry) === day),
  )
  const selected = dated.length
    ? dated
    : rewards[day - 1]
      ? [rewards[day - 1]]
      : rewards
  return selected.flatMap(reward => {
    const name =
      reward.name ?? reward.rewardName ?? reward.goodsName ?? reward.itemName
    if (!name) return []
    return [{
      name: String(name),
      count: reward.num ?? reward.count ?? reward.quantity ?? 1,
      icon:
        reward.icon ??
        reward.iconUrl ??
        reward.image ??
        reward.imageUrl ??
        reward.picUrl,
    }]
  })
}

export class TaygedoAdapter extends CommunityAdapter {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    super("taygedo", "塔吉多")
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  normalizeCredential(input) {
    let source = input
    if (typeof input === "string") {
      try {
        source = JSON.parse(input)
      } catch {
        throw new Error("塔吉多备用凭证应为登录 JSON")
      }
    }
    source = source?.data ?? source
    if (!source || typeof source !== "object") {
      throw new Error("塔吉多凭证格式错误")
    }
    const credential = {
      uid: String(source.uid ?? ""),
      deviceId: String(source.deviceId ?? source.device_id ?? ""),
      accessToken: String(source.accessToken ?? source.access_token ?? ""),
      refreshToken: String(source.refreshToken ?? source.refresh_token ?? ""),
      refreshedAt: Number(source.refreshedAt ?? 0),
    }
    if (!credential.uid || !credential.deviceId) {
      throw new Error("塔吉多凭证缺少 uid 或 deviceId")
    }
    if (!credential.accessToken && !credential.refreshToken) {
      throw new Error("塔吉多凭证缺少 accessToken 或 refreshToken")
    }
    return credential
  }

  async sendPhoneCode(phone, deviceId = randomDeviceId()) {
    const normalized = String(phone ?? "").trim()
    if (!/^1[3-9]\d{9}$/.test(normalized)) {
      throw new Error("请输入正确的中国大陆手机号")
    }
    const data = {
      ...this.deviceParameters(deviceId),
      type: "16",
      versionCode: "1",
      t: String(Math.floor(Date.now() / 1000)),
      areaCodeId: "1",
      cellphone: normalized,
    }
    data.sign = generateSign(data)
    const payload = await this.requestForm(
      `${LOGIN_BASE}/m/newApi/sendPhoneCaptchaWithOutLogin`,
      data,
    )
    if (!successful(payload)) {
      throw new Error(apiMessage(payload, "塔吉多验证码发送失败"))
    }
    return { phone: normalized, deviceId }
  }

  async loginByPhoneCode(phone, code, deviceId) {
    const normalizedPhone = String(phone ?? "").trim()
    const normalizedCode = String(code ?? "").trim()
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) throw new Error("手机号格式错误")
    if (!/^\d{6}$/.test(normalizedCode)) throw new Error("验证码应为 6 位数字")
    if (!deviceId) throw new Error("塔吉多登录会话已失效")

    // 当前完美世界登录流程应在短信发送后直接换取登录态。
    // 预先调用 checkPhoneCaptchaWithOutLogin 会改变验证码会话状态，
    // 随后的正式登录可能返回 "invalid request"。
    const loginData = {
      ...this.deviceParameters(deviceId),
      idfa: "",
      sign: "",
      adm: "",
      type: "16",
      version: "1",
      mac: "",
      t: String(Date.now()),
      areaCodeId: "1",
      cellphone: encryptLoginField(normalizedPhone),
      captcha: encryptLoginField(normalizedCode),
    }
    loginData.sign = generateSign(loginData)
    const loggedIn = await this.requestForm(
      `${LOGIN_BASE}/openApi/sms/new/login`,
      loginData,
    )
    if (!successful(loggedIn) || !loggedIn.result?.token) {
      throw new Error(
        `完美世界账号登录失败：${apiMessage(loggedIn, "请求未通过")}`,
      )
    }

    const centered = await this.requestForm(
      `${API_BASE}/usercenter/api/login`,
      {
        token: loggedIn.result.token,
        userIdentity: loggedIn.result.userId,
        appId: USER_CENTER_APP_ID,
      },
      {
        ...this.appHeaders({ deviceId }),
        "debug-uid": "3",
      },
    )
    if (!successful(centered) || !centered.data?.accessToken) {
      throw new Error(
        `塔吉多用户中心登录失败：${apiMessage(centered, "请求未通过")}`,
      )
    }
    return this.normalizeCredential({
      uid: centered.data.uid,
      deviceId,
      accessToken: centered.data.accessToken,
      refreshToken: centered.data.refreshToken,
      refreshedAt: Date.now(),
    })
  }

  async validateCredential(input) {
    const credential = this.normalizeCredential(input)
    await this.ensureAccessToken(credential)
    return {
      externalAccountId: credential.uid,
      displayName: `塔吉多 ${mask(credential.uid)}`,
    }
  }

  async discoverTargets(input) {
    const credential = this.normalizeCredential(input)
    await this.ensureAccessToken(credential)
    const targets = []
    for (const game of GAMES) {
      const payload = await this.requestJson(
        `${API_BASE}/apihub/api/getGameBindRole?` +
          new URLSearchParams({
            uid: credential.uid,
            gameId: String(game.gameId),
          }),
        { headers: { Authorization: credential.accessToken } },
      )
      if (!successful(payload)) continue
      for (const role of collectRoles(payload.data)) {
        targets.push({
          externalId: `${game.key}:${role.roleId}`,
          displayName: `${game.name} · ${role.roleName || role.nickname || role.roleId}`,
          businessTimezone: "Asia/Shanghai",
          metadata: {
            gameId: game.gameId,
            communityId: game.communityId,
            gameName: game.name,
            roleId: String(role.roleId),
          },
        })
      }
    }
    return targets
  }

  async checkIn(input, target) {
    const credential = this.normalizeCredential(input)
    try {
      await this.ensureAccessToken(credential)
      const metadata = target.metadata ?? {}
      const gameId = Number(metadata.gameId)
      if (!GAMES.some(game => game.gameId === gameId)) {
        return { kind: "permanent-failure", reason: "未知塔吉多游戏目标" }
      }

      const [state, rewards] = await Promise.all([
        this.gameGet("/apihub/awapi/signin/state", credential, gameId),
        this.gameGet("/apihub/awapi/sign/rewards", credential, gameId),
      ])
      if (successful(state) && state.data?.todaySign) {
        return {
          kind: "already-done",
          rewards: rewardForDay(rewards.data, Number(state.data.days) - 1),
          credentialUpdate: credential,
        }
      }

      const signed = await this.requestForm(
        `${API_BASE}/apihub/awapi/sign`,
        { roleId: metadata.roleId, gameId },
        { Authorization: credential.accessToken },
      )
      const message = apiMessage(signed, `塔吉多返回错误 ${signed?.code}`)
      if (!successful(signed)) {
        const outcome = this.classify(signed, message)
        return { ...outcome, credentialUpdate: credential }
      }
      return {
        kind: "success",
        rewards: successful(rewards)
          ? rewardForDay(rewards.data, Number(state.data?.days ?? 0))
          : [],
        credentialUpdate: credential,
      }
    } catch (error) {
      return {
        kind: /登录|Token|凭证|授权|401|403/.test(error.message)
          ? "auth-expired"
          : "retryable",
        reason: `塔吉多请求失败：${error.message}`,
      }
    }
  }

  classify(payload, message = apiMessage(payload, "塔吉多签到失败")) {
    if (/已签到|重复签到|今日.*签/.test(message)) {
      return { kind: "already-done", reason: message }
    }
    if (/登录|token|凭证|授权|过期/i.test(message) || [401, 403].includes(payload?.code)) {
      return { kind: "auth-expired", reason: message }
    }
    if (/验证|风控|频繁|captcha/i.test(message)) {
      return { kind: "risk-control", reason: message }
    }
    if ([429, 500, 502, 503].includes(Number(payload?.code))) {
      return { kind: "retryable", reason: message }
    }
    return { kind: "permanent-failure", reason: message }
  }

  async ensureAccessToken(credential) {
    if (
      credential.accessToken &&
      Date.now() - Number(credential.refreshedAt || 0) < 10 * 60 * 1000
    ) {
      return credential
    }
    if (!credential.refreshToken) {
      if (credential.accessToken) return credential
      throw new Error("塔吉多登录凭证已失效")
    }
    const payload = await this.requestJson(
      `${API_BASE}/usercenter/api/refreshToken`,
      {
        method: "POST",
        headers: this.appHeaders({
          deviceId: credential.deviceId,
          authorization: credential.refreshToken,
        }),
      },
    )
    if (!successful(payload) || !payload.data?.accessToken) {
      throw new Error(apiMessage(payload, "塔吉多登录凭证刷新失败"))
    }
    credential.accessToken = String(payload.data.accessToken)
    credential.refreshToken = String(
      payload.data.refreshToken ?? credential.refreshToken,
    )
    credential.uid = String(payload.data.uid ?? credential.uid)
    credential.refreshedAt = Date.now()
    return credential
  }

  async gameGet(path, credential, gameId) {
    return this.requestJson(
      `${API_BASE}${path}?${new URLSearchParams({ gameId: String(gameId) })}`,
      { headers: { Authorization: credential.accessToken } },
    )
  }

  deviceParameters(deviceId) {
    return {
      deviceType: DEVICE_MODEL,
      deviceId,
      deviceName: DEVICE_MODEL,
      appId: APP_ID,
      deviceSys: "12",
      deviceModel: DEVICE_MODEL,
      sdkVersion: SDK_VERSION,
      bid: BID,
      channelId: "1",
    }
  }

  appHeaders({ deviceId, authorization = "" }) {
    return {
      platform: "android",
      deviceId,
      Authorization: authorization,
      appVersion: APP_VERSION,
      uid: "0",
      ds: generateDs(),
      "User-Agent": "okhttp/4.12.0",
    }
  }

  async requestForm(url, data, headers = {}) {
    return this.requestJson(url, {
      method: "POST",
      headers: {
        platform: "android",
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(
        Object.fromEntries(
          Object.entries(data).map(([key, value]) => [key, String(value ?? "")]),
        ),
      ).toString(),
    })
  }

  async requestJson(
    url,
    { method = "GET", headers = {}, body } = {},
  ) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      })
      const text = await response.text()
      let payload
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`HTTP ${response.status} 返回了无效数据`)
      }
      if (!response.ok && payload.code == null) {
        throw new Error(`HTTP ${response.status}`)
      }
      return payload
    } finally {
      clearTimeout(timeout)
    }
  }
}

export {
  GAMES as TAYGEDO_GAMES,
  encryptLoginField,
  generateDs,
  generateSign,
}
