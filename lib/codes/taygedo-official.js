import crypto from "node:crypto"
import { CODE_GAMES } from "./games.js"

const BASE_URL = "https://bbs-api.tajiduo.com"
const WEB_URL = "https://yh.wanmei.com/m/news/gamenews/index.html"
const APP_VERSION = "1.2.5"
const DS_SECRET = "pUds3dfMkl"
const RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
const SEARCH_TERMS = ["前瞻", "前瞻兑换"]
const MAX_POST_AGE_MS = 14 * 86400000
const CODE_PATTERN = /[A-Z0-9]{6,24}(?![A-Z0-9])/g
const PREVIEW_CONTEXT = /前瞻|特别节目|直播/
const CODE_CONTEXT = /兑换码|礼包码|直播码|前瞻码|兑换/
const INVITATION_CONTEXT = /邀请码|回归码|好友码|招募码|助力码/
const PLATFORM_CONTEXT = /抖音|哔哩哔哩|B站|TapTap|平台专属|渠道专属|边角料/i
const PLATFORM_CODE = /DOUYIN|BILIBILI|TAPTAP|CHANNEL/i
const TAYGEDO_GAMES = Object.freeze(
  Object.fromEntries(
    Object.values(CODE_GAMES)
      .filter(game => game.provider === "taygedo")
      .map(game => [game.key, game]),
  ),
)

function generateDs({
  timestamp = Math.floor(Date.now() / 1000),
  nonce = Array.from(
    crypto.randomBytes(8),
    byte => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length],
  ).join(""),
} = {}) {
  const digest = crypto
    .createHash("md5")
    .update(`${timestamp}${nonce}${APP_VERSION}${DS_SECRET}`)
    .digest("hex")
  return `${timestamp},${nonce},${digest}`
}

function structuredText(value) {
  try {
    const blocks = typeof value === "string" ? JSON.parse(value) : value
    if (!Array.isArray(blocks)) return ""
    return blocks.map(block => block?.txt ?? block?.text ?? "").join("")
  } catch {
    return ""
  }
}

function postText(post) {
  return [post?.subject, post?.content, structuredText(post?.structuredContent)]
    .filter(Boolean)
    .join("\n")
}

function expiryFromText(text, publishedAt = Date.now()) {
  const matched = String(text).match(
    /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})[:：时](\d{2})?)?/,
  )
  if (!matched) return null
  const published = new Date(Number(publishedAt) || Date.now())
  let year = Number(matched[1] || published.getFullYear())
  const month = Number(matched[2])
  if (!matched[1] && month < published.getMonth() + 1 - 6) year += 1
  const hour = matched[4] || "23"
  const minute = matched[5] || "59"
  const value = `${year}-${String(month).padStart(2, "0")}-${matched[3].padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00+08:00`
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function codeCandidates(text) {
  return [...new Set(
    [...String(text).toUpperCase().matchAll(CODE_PATTERN)]
      .map(match => match[0])
      .filter(code => /[A-Z]/.test(code))
      .filter(code => !PLATFORM_CODE.test(code)),
  )]
}

export function extractTrustedTaygedoCodes(posts, users = [], now = Date.now()) {
  const cutoff = now - MAX_POST_AGE_MS
  const officialUsers = new Set(
    users
      .filter(user => user?.officialMaster || user?.userMaster)
      .map(user => String(user.uid)),
  )
  const byCode = new Map()
  for (const post of posts) {
    const publishedAt = Number(post?.sendTime ?? post?.createTime ?? 0)
    if (!publishedAt || publishedAt < cutoff) continue
    const text = postText(post)
    if (!PREVIEW_CONTEXT.test(text) || !CODE_CONTEXT.test(text)) continue
    if (INVITATION_CONTEXT.test(text) || PLATFORM_CONTEXT.test(text)) continue
    const userId = String(post?.uid ?? post?.postId ?? "unknown")
    const trusted = officialUsers.has(userId)
    const expiresAt = expiryFromText(text, publishedAt)
    for (const code of codeCandidates(text)) {
      const evidence = byCode.get(code) ?? {
        code,
        users: new Set(),
        trusted: false,
        expiresAt: null,
        title: "",
        postId: "",
        publishedAt: 0,
      }
      evidence.users.add(userId)
      evidence.trusted ||= trusted
      evidence.expiresAt ||= expiresAt
      if (publishedAt >= evidence.publishedAt) {
        evidence.publishedAt = publishedAt
        evidence.title = String(post?.subject ?? "")
        evidence.postId = String(post?.postId ?? "")
      }
      byCode.set(code, evidence)
    }
  }
  return [...byCode.values()]
    .filter(item => item.trusted || item.users.size >= 2)
    .filter(item => !item.expiresAt || Date.parse(item.expiresAt) > now)
    .map(({ users: evidenceUsers, trusted, publishedAt, ...item }) => item)
}

export class TaygedoOfficialCodeSource {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  supports(gameKey) {
    return Boolean(TAYGEDO_GAMES[gameKey])
  }

  async list(gameKey) {
    const game = TAYGEDO_GAMES[gameKey]
    if (!game) throw new Error(`不支持的塔吉多兑换码游戏：${gameKey}`)
    const payloads = await Promise.all(
      SEARCH_TERMS.map(keyword => this.search(game, keyword)),
    )
    const posts = payloads.flatMap(payload => payload?.data?.posts ?? [])
    const users = payloads.flatMap(payload => payload?.data?.users ?? [])
    const discoveredAt = new Date().toISOString()
    return extractTrustedTaygedoCodes(posts, users).map(item => ({
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
      source: "taygedo-official-community",
      sourceLabel: "Hotta Studio / 塔吉多异环前瞻内容交叉验证",
      sourceUrl: WEB_URL,
      discoveredAt,
    }))
  }

  async search(game, keyword) {
    const query = new URLSearchParams({
      keyword,
      communityId: game.communityId,
      page: "1",
      size: "50",
      orderType: "1",
    })
    const response = await this.request(`/bbs/api/searchPost?${query}`)
    const payload = await response.json()
    if (!response.ok || payload?.code !== 0) {
      throw new Error(payload?.msg || `塔吉多返回错误 ${payload?.code ?? response.status}`)
    }
    return payload
  }

  async request(path) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(`${BASE_URL}${path}`, {
        headers: {
          Accept: "application/json, text/plain, */*",
          platform: "android",
          deviceId: crypto.randomUUID().replaceAll("-", ""),
          Authorization: "",
          appVersion: APP_VERSION,
          uid: "0",
          ds: generateDs(),
          "User-Agent": "okhttp/4.12.0",
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

export { TAYGEDO_GAMES as TAYGEDO_CODE_GAMES, generateDs }
