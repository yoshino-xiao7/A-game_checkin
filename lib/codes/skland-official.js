import crypto from "node:crypto"
import { CODE_GAMES } from "./games.js"

const BASE_URL = "https://zonai.skland.com"
const WEB_URL = "https://www.skland.com"
const SEARCH_TERMS = ["前瞻兑换码", "直播兑换码"]
const MAX_POST_AGE_MS = 14 * 86400000
const TOKEN_TTL_MS = 25 * 60000
const CODE_PATTERN = /[A-Z0-9]{6,24}(?![A-Z0-9])/g
const CODE_CONTEXT = /前瞻|直播|兑换码|礼包码/
const SKLAND_GAMES = Object.freeze(
  Object.fromEntries(
    Object.values(CODE_GAMES)
      .filter(game => game.provider === "skland")
      .map(game => [game.key, game]),
  ),
)

function captionText(item) {
  return (item?.caption ?? [])
    .map(part => part?.text?.text ?? part?.text ?? "")
    .join("")
}

function expiryFromText(text) {
  const matched = String(text).match(
    /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})[:：时](\d{2})?)?/,
  )
  if (!matched) return null
  const year = matched[1] || new Date().getFullYear()
  const hour = matched[4] || "23"
  const minute = matched[5] || "59"
  const value = `${year}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00+08:00`
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function codeCandidates(text) {
  return [...new Set(
    [...String(text).toUpperCase().matchAll(CODE_PATTERN)]
      .map(match => match[0])
      .filter(code => /[A-Z]/.test(code)),
  )]
}

export function extractTrustedSklandCodes(results, now = Date.now()) {
  const cutoff = now - MAX_POST_AGE_MS
  const byCode = new Map()
  for (const result of results) {
    const item = result?.item ?? {}
    if (Number(item.timestamp) * 1000 < cutoff) continue
    const title = String(item.title ?? "")
    const text = `${title}\n${captionText(item)}`
    if (!CODE_CONTEXT.test(text)) continue
    const userId = String(result?.user?.id ?? item.userId ?? item.id)
    const trusted = Boolean(
      result?.user?.identity === 2 ||
      result?.user?.isModerator ||
      item.isOfficial,
    )
    const expiresAt = expiryFromText(text)
    for (const code of codeCandidates(text)) {
      const evidence = byCode.get(code) ?? {
        code,
        users: new Set(),
        trusted: false,
        expiresAt: null,
        title: "",
        itemId: "",
        timestamp: 0,
      }
      evidence.users.add(userId)
      evidence.trusted ||= trusted
      evidence.expiresAt ||= expiresAt
      if (Number(item.timestamp) >= evidence.timestamp) {
        evidence.timestamp = Number(item.timestamp)
        evidence.title = title
        evidence.itemId = String(item.id ?? "")
      }
      byCode.set(code, evidence)
    }
  }
  return [...byCode.values()]
    .filter(item => item.trusted || item.users.size >= 2)
    .filter(item => !item.expiresAt || Date.parse(item.expiresAt) > now)
    .map(({ users, trusted, timestamp, ...item }) => item)
}

export class SklandOfficialCodeSource {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.token = ""
    this.tokenExpiresAt = 0
    this.tokenPromise = null
  }

  supports(gameKey) {
    return Boolean(SKLAND_GAMES[gameKey])
  }

  async list(gameKey) {
    const game = SKLAND_GAMES[gameKey]
    if (!game) throw new Error(`不支持的森空岛兑换码游戏：${gameKey}`)
    const payloads = await Promise.all(
      SEARCH_TERMS.map(keyword => this.search(game, keyword)),
    )
    const results = payloads.flatMap(payload => payload?.data?.list ?? [])
    const now = new Date().toISOString()
    return extractTrustedSklandCodes(results).map(item => ({
      id: crypto
        .createHash("sha256")
        .update(`cn:${game.key}:${item.code}`)
        .digest("hex")
        .slice(0, 24),
      gameKey: game.key,
      gameName: game.name,
      region: "cn",
      code: item.code,
      title: item.title || `${game.name}前瞻特别节目`,
      rewards: [],
      expiresAt: item.expiresAt,
      source: "skland-official-community",
      sourceLabel: "鹰角网络 / 森空岛前瞻内容交叉验证",
      sourceUrl: item.itemId
        ? `${WEB_URL}/article?id=${item.itemId}`
        : `${WEB_URL}/search?gameId=${game.gameId}`,
      discoveredAt: now,
    }))
  }

  async search(game, keyword, retried = false) {
    const token = await this.getToken()
    const path = "/web/v2/search/item"
    const query = new URLSearchParams({
      gameId: game.gameId,
      keyword,
      pageSize: "10",
      viewKind: "0",
      sortType: "1",
    }).toString()
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signMeta = {
      platform: "3",
      timestamp,
      dId: "",
      vName: "1.0.0",
    }
    const hmac = crypto
      .createHmac("sha256", token)
      .update(`${path}${query}${timestamp}${JSON.stringify(signMeta)}`)
      .digest("hex")
    const sign = crypto.createHash("md5").update(hmac).digest("hex")
    const response = await this.request(`${path}?${query}`, {
      platform: "3",
      vName: "1.0.0",
      timestamp,
      sign,
    })
    if (response.status === 401 && !retried) {
      this.token = ""
      this.tokenExpiresAt = 0
      return this.search(game, keyword, true)
    }
    const payload = await response.json()
    if (!response.ok || payload?.code !== 0) {
      throw new Error(payload?.message || `森空岛返回错误 ${payload?.code ?? response.status}`)
    }
    return payload
  }

  async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token
    if (this.tokenPromise) return this.tokenPromise
    this.tokenPromise = (async () => {
      const response = await this.request("/web/v1/auth/refresh")
      const payload = await response.json()
      if (!response.ok || payload?.code !== 0 || !payload?.data?.token) {
        throw new Error(payload?.message || "森空岛匿名凭证刷新失败")
      }
      this.token = String(payload.data.token)
      this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
      return this.token
    })()
    try {
      return await this.tokenPromise
    } finally {
      this.tokenPromise = null
    }
  }

  async request(path, headers = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(`${BASE_URL}${path}`, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": "A-game_checkin/1.1.3",
          Origin: WEB_URL,
          Referer: `${WEB_URL}/`,
          ...headers,
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

export { SKLAND_GAMES as SKLAND_CODE_GAMES }
