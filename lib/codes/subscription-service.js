import { CODE_GAMES, resolveCodeGame } from "./games.js"

function nowIso() {
  return new Date().toISOString()
}

function ensureCodeData(data) {
  data.users ??= {}
  data.redemptionCodes ??= {}
  data.codeDeliveries ??= {}
}

function ensureUser(data, context) {
  const identity = String(context.identity)
  const user = data.users[identity] ?? {
    identity,
    userId: String(context.userId),
    botId: String(context.botId ?? ""),
    accounts: [],
  }
  user.userId = String(context.userId)
  user.botId = String(context.botId ?? user.botId ?? "")
  user.accounts ??= []
  user.codeSubscriptions ??= {}
  data.users[identity] = user
  return user
}

function publicSubscription(user) {
  return Object.values(CODE_GAMES).map(game => ({
    gameKey: game.key,
    gameName: game.name,
    enabled: Boolean(user?.codeSubscriptions?.[game.key]?.enabled),
  }))
}

export class CodeSubscriptionService {
  constructor({ store, source, retentionDays = 30 }) {
    this.store = store
    this.source = source
    this.retentionDays = retentionDays
  }

  async subscribe(context, selector) {
    const games = this.selectGames(selector)
    return this.store.transaction(data => {
      ensureCodeData(data)
      const user = ensureUser(data, context)
      for (const game of games) {
        user.codeSubscriptions[game.key] = {
          enabled: true,
          createdAt: nowIso(),
        }
      }
      return publicSubscription(user)
    })
  }

  async unsubscribe(context, selector) {
    const games = this.selectGames(selector)
    return this.store.transaction(data => {
      ensureCodeData(data)
      const user = ensureUser(data, context)
      for (const game of games) delete user.codeSubscriptions[game.key]
      return publicSubscription(user)
    })
  }

  async unsubscribeAll(context) {
    return this.store.transaction(data => {
      ensureCodeData(data)
      const user = ensureUser(data, context)
      user.codeSubscriptions = {}
      return publicSubscription(user)
    })
  }

  async listSubscriptions(identity) {
    const data = await this.store.read()
    ensureCodeData(data)
    return publicSubscription(data.users[String(identity)])
  }

  async refresh(selector) {
    const gameKeys = selector
      ? [this.requireGame(selector).key]
      : Object.keys(CODE_GAMES)
    const result = await this.source.listAll(gameKeys)
    await this.saveCodes(result.items)
    return {
      ...result,
      groups: this.groupCodes(result.items),
    }
  }

  async scan() {
    const subscriptions = await this.store.read()
    ensureCodeData(subscriptions)
    const gameKeys = [...new Set(
      Object.values(subscriptions.users).flatMap(user =>
        Object.entries(user.codeSubscriptions ?? {})
          .filter(([, subscription]) => subscription?.enabled)
          .map(([gameKey]) => gameKey),
      ),
    )].filter(gameKey => CODE_GAMES[gameKey])
    if (!gameKeys.length) return { batches: [], errors: [] }

    const result = await this.source.listAll(gameKeys)
    await this.saveCodes(result.items)
    const data = await this.store.read()
    ensureCodeData(data)
    const groups = new Map()

    for (const user of Object.values(data.users)) {
      for (const code of result.items) {
        if (!user.codeSubscriptions?.[code.gameKey]?.enabled) continue
        const deliveryKey = `${user.identity}:${code.id}`
        if (data.codeDeliveries[deliveryKey]) continue
        const groupKey = `${user.identity}:${code.gameKey}`
        const group = groups.get(groupKey) ?? {
          user: {
            identity: user.identity,
            userId: user.userId,
            botId: user.botId,
          },
          gameKey: code.gameKey,
          gameName: code.gameName,
          codes: [],
        }
        group.codes.push(code)
        groups.set(groupKey, group)
      }
    }
    return { batches: [...groups.values()], errors: result.errors }
  }

  async markDelivered(identity, codeIds) {
    return this.store.transaction(data => {
      ensureCodeData(data)
      const deliveredAt = nowIso()
      for (const codeId of codeIds) {
        data.codeDeliveries[`${identity}:${codeId}`] = { deliveredAt }
      }
      this.prune(data)
    })
  }

  async saveCodes(items) {
    if (!items.length) return
    await this.store.transaction(data => {
      ensureCodeData(data)
      const seenAt = nowIso()
      for (const item of items) {
        data.redemptionCodes[item.id] = {
          ...data.redemptionCodes[item.id],
          ...item,
          firstSeenAt:
            data.redemptionCodes[item.id]?.firstSeenAt ?? item.discoveredAt,
          lastSeenAt: seenAt,
        }
      }
      this.prune(data)
    })
  }

  groupCodes(items) {
    const groups = new Map()
    for (const code of items) {
      const group = groups.get(code.gameKey) ?? {
        gameKey: code.gameKey,
        gameName: code.gameName,
        codes: [],
      }
      group.codes.push(code)
      groups.set(code.gameKey, group)
    }
    return [...groups.values()]
  }

  selectGames(selector) {
    return selector
      ? [this.requireGame(selector)]
      : Object.values(CODE_GAMES)
  }

  requireGame(selector) {
    const game = resolveCodeGame(selector)
    if (!game) {
      throw new Error("暂不支持该游戏的国服前瞻兑换码")
    }
    return game
  }

  prune(data) {
    const cutoff = Date.now() - this.retentionDays * 86400000
    for (const [id, code] of Object.entries(data.redemptionCodes)) {
      const lastSeen = Date.parse(code.lastSeenAt || code.discoveredAt || 0)
      if (Number.isFinite(lastSeen) && lastSeen < cutoff) {
        delete data.redemptionCodes[id]
      }
    }
    for (const [key, delivery] of Object.entries(data.codeDeliveries)) {
      const deliveredAt = Date.parse(delivery.deliveredAt || 0)
      if (Number.isFinite(deliveredAt) && deliveredAt < cutoff) {
        delete data.codeDeliveries[key]
      }
    }
  }
}
