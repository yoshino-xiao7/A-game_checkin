import crypto from "node:crypto"
import { CODE_GAMES } from "./games.js"

const BASE_URL = "https://api.kurobbs.com"
const WEB_URL = "https://www.kurobbs.com"
const KURO_GAMES = Object.freeze(
  Object.fromEntries(
    Object.values(CODE_GAMES)
      .filter(game => game.provider === "kuro")
      .map(game => [game.key, game]),
  ),
)

const POST_TITLE = /(?:版本|周年).*(?:前瞻|特别通讯|直播)|(?:前瞻|特别通讯).*(?:内容一览|节目一览|回顾|内容前瞻)/
const POST_EXCLUDE = /预告|预约|角色|场景|剧情|玩法|获取方式|有奖活动|讨论/
const CODE_CONTEXT = /兑换码|礼包码|直播码|前瞻码/
const CODE_PATTERN = /^[A-Z0-9]{6,24}$/
const MAX_POST_AGE_MS = 14 * 86400000

function textParts(value) {
  if (!value) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(textParts)
  if (typeof value !== "object") return []
  return [
    value.content,
    value.replyContent,
    value.replyContentStr,
    value.postH5Content,
    value.postNewH5Content,
  ].flatMap(textParts)
}

function normalizedText(value) {
  return textParts(value)
    .join("\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
}

function candidates(text) {
  const raw = String(text)
  const found = [
    ...[...raw.matchAll(/[【[]([A-Z0-9]{6,24})[】\]]/g)].map(match => match[1]),
    ...[...raw.matchAll(/[:：]\s*([A-Z0-9]{6,24})(?=\s|$|[、，。；;])/g)].map(match => match[1]),
    ...raw.split(/\r?\n/).map(line => line.trim()).filter(line => CODE_PATTERN.test(line)),
  ]
  return [...new Set(found.filter(code => /[A-Z]/.test(code)))]
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

function expiryForCode(text, code) {
  const segments = String(text).split(/[。！？]/)
  const segment = segments.find(item => item.toUpperCase().includes(code))
  return expiryFromText(segment ?? "")
}

function evidenceFromDetail(payload) {
  const evidence = []
  const detail = payload?.data?.postDetail
  if (detail) {
    evidence.push({
      userId: String(detail.postUserId ?? "publisher"),
      trusted: true,
      text: normalizedText(detail),
    })
  }
  for (const comment of payload?.data?.comment ?? []) {
    evidence.push({
      userId: String(comment.userId ?? comment.commentId),
      trusted: Boolean(comment.isPublisher || comment.isOfficial),
      text: normalizedText(comment.commentContent),
    })
    for (const reply of comment.replyVos ?? []) {
      evidence.push({
        userId: String(reply.userId ?? reply.replyId),
        trusted: Boolean(reply.isPublisher || reply.isOfficial),
        text: normalizedText(reply),
      })
    }
  }
  return evidence
}

export function extractTrustedKuroCodes(payloads) {
  const byCode = new Map()
  for (const evidence of payloads.flatMap(evidenceFromDetail)) {
    const codes = candidates(evidence.text)
    if (!codes.length) continue
    const contextual = CODE_CONTEXT.test(evidence.text)
    const standalone = codes.length === 1 && evidence.text.trim().toUpperCase() === codes[0]
    if (!contextual && !standalone && !evidence.trusted) continue
    for (const code of codes) {
      const expiresAt = expiryForCode(evidence.text, code)
      const item = byCode.get(code) ?? {
        code,
        users: new Set(),
        trusted: false,
        expiresAt: null,
      }
      item.users.add(evidence.userId)
      item.trusted ||= evidence.trusted && (contextual || standalone)
      item.expiresAt ||= expiresAt
      byCode.set(code, item)
    }
  }
  const now = Date.now()
  const hasTrustedCodes = [...byCode.values()].some(item => item.trusted)
  return [...byCode.values()]
    .filter(item => hasTrustedCodes ? item.trusted : item.users.size >= 2)
    .filter(item => !item.expiresAt || Date.parse(item.expiresAt) > now)
    .map(({ users, trusted, ...item }) => item)
}

function browserHeaders(game, postId) {
  return {
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 Chrome/138.0 Safari/537.36",
    source: "h5",
    devcode: crypto.createHash("sha256").update("A-game_checkin").digest("hex").slice(0, 32),
    version: "2.2.1",
    versionCode: "2210",
    channelId: "2",
    lang: "zh-Hans",
    countryCode: "CN",
    Origin: WEB_URL,
    Referer: `${WEB_URL}/${game.gamePath}/post/${postId ?? ""}`,
  }
}

export class KuroOfficialCodeSource {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  supports(gameKey) {
    return Boolean(KURO_GAMES[gameKey])
  }

  async list(gameKey) {
    const game = KURO_GAMES[gameKey]
    if (!game) throw new Error(`不支持的库街区兑换码游戏：${gameKey}`)
    const posts = await this.findPosts(game)
    const groups = await Promise.all(posts.map(post => this.fetchPost(game, post)))
    return [...new Map(groups.flat().map(item => [item.id, item])).values()]
  }

  async findPosts(game) {
    const payloads = await Promise.all([1, 2].map(eventType =>
      this.request("/forum/companyEvent/findEventList", {
        gameId: game.gameId,
        eventType,
        pageNo: 1,
        pageSize: 30,
      }, browserHeaders(game)),
    ))
    const cutoff = Date.now() - MAX_POST_AGE_MS
    const unique = new Map()
    for (const post of payloads.flatMap(payload => payload?.data?.list ?? [])) {
      const title = String(post.postTitle ?? "")
      if (!POST_TITLE.test(title) || POST_EXCLUDE.test(title)) continue
      if (Number(post.publishTime) < cutoff) continue
      unique.set(String(post.postId), post)
    }
    return [...unique.values()]
      .sort((a, b) => Number(b.publishTime) - Number(a.publishTime))
      .slice(0, 4)
  }

  async fetchPost(game, post) {
    const payloads = await Promise.all([1, 2].map(showOrderType =>
      this.request("/forum/getPostDetail", {
        postId: post.postId,
        isOnlyPublisher: 0,
        showOrderType,
      }, browserHeaders(game, post.postId)),
    ))
    const now = new Date().toISOString()
    return extractTrustedKuroCodes(payloads).map(item => ({
      id: crypto
        .createHash("sha256")
        .update(`cn:${game.key}:${item.code}`)
        .digest("hex")
        .slice(0, 24),
      gameKey: game.key,
      gameName: game.name,
      region: "cn",
      code: item.code,
      title: String(post.postTitle || `${game.name}前瞻特别节目`),
      rewards: [],
      expiresAt: item.expiresAt,
      source: "kuro-official-community",
      sourceLabel: "库洛游戏 / 库街区官方前瞻帖及评论",
      sourceUrl: `${WEB_URL}/${game.gamePath}/post/${post.postId}`,
      discoveredAt: now,
    }))
  }

  async request(path, data, headers) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: new URLSearchParams(
          Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
        ).toString(),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.code !== 200) throw new Error(payload?.msg || `库街区返回错误 ${payload?.code}`)
      return payload
    } finally {
      clearTimeout(timer)
    }
  }
}

export { KURO_GAMES as KURO_CODE_GAMES }
