import crypto from "node:crypto"
import { CODE_GAMES } from "./games.js"

export { resolveCodeGame } from "./games.js"

const API = Object.freeze({
  index: "https://api-takumi.mihoyo.com/event/miyolive/index",
  codes: "https://api-takumi-static.mihoyo.com/event/miyolive/refreshCode",
  posts: "https://bbs-api.mihoyo.com/painter/api/user_instant/list",
  navigation: "https://bbs-api.miyoushe.com/apihub/api/home/new",
})

export const CN_CODE_GAMES = Object.freeze({
  genshin: {
    ...CODE_GAMES.genshin,
    officialUid: "75276539",
    gid: "2",
  },
  starRail: {
    ...CODE_GAMES.starRail,
    officialUid: "80823548",
    gid: "6",
  },
  zenless: {
    ...CODE_GAMES.zenless,
    officialUid: "152039148",
    gid: "8",
  },
  honkai3: {
    ...CODE_GAMES.honkai3,
    officialUid: "73565430",
    gid: "1",
  },
})

function findActId(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "")
  return text.match(/[?&]act_id=([A-Za-z0-9_-]+)/)?.[1] ?? ""
}

function timestamp(value) {
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return new Date(number > 1e12 ? number : number * 1000).toISOString()
}

function templateData(live) {
  if (!live?.template) return {}
  if (typeof live.template === "object") return live.template
  try {
    return JSON.parse(live.template)
  } catch {
    return {}
  }
}

function templateExpiry(live) {
  const text = String(templateData(live).codeTipText ?? "")
  const match = text.match(
    /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/,
  )
  if (!match) return null
  const liveYear = String(live?.start ?? "").match(/^(\d{4})/)?.[1]
  const year = match[1] || liveYear || new Date().getFullYear()
  const [, , month, day, hour, minute] = match
  return new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+08:00`,
  ).toISOString()
}

function codeExpiry(item, live) {
  for (const value of [
    item?.expire_time,
    item?.expired_at,
    item?.end_time,
    item?.deadline,
    live?.expire_time,
    live?.end_time,
    live?.deadline,
    templateExpiry(live),
  ]) {
    const parsed = timestamp(value)
    if (parsed) return parsed
  }
  return null
}

function htmlToText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .replace(/\s*\*\s*/g, " ×")
    .trim()
}

function normalizeRewards(item) {
  const source =
    item?.rewards ??
    item?.reward_list ??
    item?.reward ??
    item?.content ??
    item?.desc ??
    item?.title
  if (Array.isArray(source)) {
    return source
      .map(reward =>
        typeof reward === "string"
          ? reward
          : reward?.name || reward?.desc || reward?.title,
      )
      .filter(Boolean)
      .map(String)
  }
  const text = htmlToText(source)
  return text ? [text] : []
}

export class MiyousheLiveCodeSource {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.actIds = new Map()
  }

  supports(gameKey) {
    return Boolean(CN_CODE_GAMES[gameKey])
  }

  async list(gameKey) {
    const game = CN_CODE_GAMES[gameKey]
    if (!game) throw new Error(`不支持的国服兑换码游戏：${gameKey}`)

    const cached = this.actIds.get(gameKey)
    let actId =
      cached && Date.now() - cached.discoveredAt < 10 * 60 * 1000
        ? cached.actId
        : await this.discoverActId(game)
    if (!actId) return []

    let result = await this.fetchActivity(game, actId)
    if (result.invalidActivity) {
      this.actIds.delete(gameKey)
      actId = await this.discoverActId(game)
      if (!actId) return []
      result = await this.fetchActivity(game, actId)
    }
    this.actIds.set(gameKey, { actId, discoveredAt: Date.now() })
    if (!result.items.length) return []
    return result.items
  }

  async listAll(gameKeys = Object.keys(CN_CODE_GAMES)) {
    const settled = await Promise.allSettled(
      gameKeys.map(async gameKey => ({
        gameKey,
        items: await this.list(gameKey),
      })),
    )
    const items = []
    const errors = []
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        items.push(...result.value.items)
      } else {
        errors.push({
          gameKey: gameKeys[index],
          message: result.reason?.message || String(result.reason),
        })
      }
    })
    return { items, errors }
  }

  async discoverActId(game) {
    const postsUrl = new URL(API.posts)
    postsUrl.search = new URLSearchParams({
      offset: "0",
      size: "20",
      uid: game.officialUid,
    })
    try {
      const posts = await this.requestJson(postsUrl)
      for (const entry of posts?.data?.list ?? []) {
        const actId = findActId(
          entry?.post?.post?.structured_content ??
          entry?.post?.post?.content ??
          entry,
        )
        if (actId) return actId
      }
    } catch (error) {
      globalThis.logger?.debug?.(
        `[A-game-checkin] ${game.name}官方动态入口不可用：${error.message}`,
      )
    }

    const navigationUrl = new URL(API.navigation)
    navigationUrl.search = new URLSearchParams({
      gids: game.gid,
      parts: "1,3,4",
    })
    const navigation = await this.requestJson(navigationUrl)
    const item = navigation?.data?.navigator?.find(entry =>
      /前瞻|特别节目/.test(String(entry?.name)) &&
      /act_id=/.test(String(entry?.app_path)),
    )
    return findActId(item?.app_path)
  }

  async fetchActivity(game, actId) {
    const headers = { "x-rpc-act_id": actId }
    const index = await this.requestJson(API.index, { headers })
    const rawLive = index?.data?.live
    const live = rawLive
      ? { ...rawLive, template: index?.data?.template ?? rawLive.template }
      : rawLive
    if (!live || !live.code_ver) {
      return {
        invalidActivity: Boolean(index?.retcode && index.retcode !== 0),
        items: [],
      }
    }
    if (Number(live.remain) > 0) return { invalidActivity: false, items: [] }

    const codesUrl = new URL(API.codes)
    codesUrl.search = new URLSearchParams({
      version: String(live.code_ver),
      time: String(Math.floor(Date.now() / 1000)),
    })
    const payload = await this.requestJson(codesUrl, { headers })
    const codeList = payload?.data?.code_list
    if (!Array.isArray(codeList)) {
      return {
        invalidActivity: Boolean(payload?.retcode && payload.retcode !== 0),
        items: [],
      }
    }

    const now = new Date().toISOString()
    const items = codeList.flatMap(item => {
      const code = String(item?.code ?? "").trim().toUpperCase()
      if (!/^[\p{L}\p{N}]{3,32}$/u.test(code)) return []
      return [{
        id: crypto
          .createHash("sha256")
          .update(`cn:${game.key}:${code}`)
          .digest("hex")
          .slice(0, 24),
        gameKey: game.key,
        gameName: game.name,
        region: "cn",
        code,
        title: String(live.title || `${game.name}前瞻特别节目`),
        rewards: normalizeRewards(item),
        expiresAt: codeExpiry(item, live),
        source: "miyoushe-live",
        sourceUrl: `https://webstatic.mihoyo.com/bbs/event/live/index.html?act_id=${actId}`,
        discoveredAt: now,
      }]
    })
    return { invalidActivity: false, items }
  }

  async requestJson(url, { headers = {} } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(String(url), {
        headers: {
          Accept: "application/json",
          "User-Agent": "A-game_checkin/1.1.4",
          ...headers,
        },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } finally {
      clearTimeout(timer)
    }
  }
}
