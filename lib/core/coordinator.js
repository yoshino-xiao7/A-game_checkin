import crypto from "node:crypto"

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function businessDate(timezone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function hourInTimezone(timezone, date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(date),
  ) % 24
}

function safeRemoteImage(value) {
  if (!value) return undefined
  try {
    const url = new URL(String(value))
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

const GAME_NAME_ALIASES = new Map([
  ["星铁", "崩坏：星穹铁道"],
  ["崩铁", "崩坏：星穹铁道"],
  ["崩坏星穹铁道", "崩坏：星穹铁道"],
  ["崩坏三", "崩坏3"],
  ["终末地", "明日方舟：终末地"],
  ["鸣朝", "鸣潮"],
  ["战双", "战双帕弥什"],
])

function normalizedGameName(value) {
  const name = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/:/g, "：")
  return GAME_NAME_ALIASES.get(name) ?? name
}

export class CheckinCoordinator {
  constructor({ registry, store, vault, config }) {
    this.registry = registry
    this.store = store
    this.vault = vault
    this.config = config
    this.locks = new Set()
  }

  async bindAccount(userContext, communityId, credentialInput) {
    const adapter = this.registry.get(communityId)
    const credential = adapter.normalizeCredential
      ? adapter.normalizeCredential(credentialInput)
      : credentialInput
    const profile = await adapter.validateCredential(credential)
    const discovered = await adapter.discoverTargets(credential)
    if (!discovered.length) throw new Error("该社区账号下未发现可签到的游戏角色")

    const encryptedCredential = this.vault.encrypt(credential)
    return this.store.transaction(data => {
      const user = (data.users[userContext.identity] ??= {
        identity: userContext.identity,
        userId: String(userContext.userId),
        botId: String(userContext.botId ?? ""),
        accounts: [],
      })
      user.userId = String(userContext.userId)
      user.botId = String(userContext.botId ?? user.botId ?? "")

      let account = user.accounts.find(
        item =>
          item.communityId === communityId &&
          item.externalAccountId === profile.externalAccountId,
      )
      if (!account) {
        account = {
          id: crypto.randomUUID(),
          communityId,
          externalAccountId: profile.externalAccountId,
          displayName: profile.displayName,
          credentialStatus: "valid",
          credential: encryptedCredential,
          targets: [],
          createdAt: new Date().toISOString(),
        }
        user.accounts.push(account)
      } else {
        account.credential = encryptedCredential
        account.credentialStatus = "valid"
        account.displayName = profile.displayName
      }

      for (const target of discovered) {
        const existing = account.targets.find(item => item.externalId === target.externalId)
        if (existing) {
          Object.assign(existing, target, { id: existing.id, subscription: existing.subscription })
        } else {
          account.targets.push({
            ...target,
            id: crypto.randomUUID(),
            subscription: {
              enabled: true,
            },
          })
        }
      }
      account.updatedAt = new Date().toISOString()
      return {
        account: this.publicAccount(account),
        targets: account.targets.map(target => this.publicTarget(target)),
      }
    })
  }

  async listAccounts(identity) {
    const data = await this.store.read()
    return (data.users[identity]?.accounts ?? []).map(account => this.publicAccount(account))
  }

  async listTargets(identity) {
    const data = await this.store.read()
    return (data.users[identity]?.accounts ?? []).flatMap(account =>
      account.targets.map(target => ({
        ...this.publicTarget(target),
        accountId: account.id,
        accountName: account.displayName,
        communityId: account.communityId,
      })),
    )
  }

  async listLogs(identity, date = businessDate("Asia/Shanghai")) {
    const data = await this.store.read()
    const targetInfo = new Map(
      (data.users[identity]?.accounts ?? []).flatMap(account =>
        account.targets.map(target => [
          target.id,
          {
            communityId: account.communityId,
            accountName: account.displayName,
            targetName: target.displayName,
          },
        ]),
      ),
    )
    const targetIds = new Set(targetInfo.keys())
    return data.attempts
      .filter(
        attempt =>
          attempt.businessDate === date &&
          (attempt.ownerIdentity === identity || targetIds.has(attempt.targetId)),
      )
      .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))
      .map(attempt => {
        const current = targetInfo.get(attempt.targetId)
        return {
          id: attempt.id,
          finishedAt: attempt.finishedAt,
          businessDate: attempt.businessDate,
          trigger: attempt.trigger ?? "unknown",
          communityId: attempt.communityId ?? current?.communityId,
          accountName: attempt.accountName ?? current?.accountName,
          targetName: attempt.targetName ?? current?.targetName ?? attempt.targetId,
          resultKind: attempt.resultKind,
          reason: attempt.reason,
          rewards:
            attempt.rewards ??
            (attempt.reward ? [attempt.reward] : []),
          attemptNo: attempt.attemptNo,
          durationMs: attempt.durationMs,
        }
      })
  }

  async setTargetEnabled(identity, ordinal, enabled) {
    return this.store.transaction(data => {
      const targets = (data.users[identity]?.accounts ?? []).flatMap(account => account.targets)
      const target = targets[ordinal - 1]
      if (!target) throw new Error("游戏编号不存在，请发送 #签到游戏 查看")
      target.subscription ??= {}
      target.subscription.enabled = enabled
      return this.publicTarget(target)
    })
  }

  async removeAccount(identity, ordinal) {
    return this.store.transaction(data => {
      const accounts = data.users[identity]?.accounts
      if (!accounts?.[ordinal - 1]) throw new Error("签到账号编号不存在")
      const [removed] = accounts.splice(ordinal - 1, 1)
      return this.publicAccount(removed)
    })
  }

  async runUser(identity, communityId) {
    const data = await this.store.read()
    const user = data.users[identity]
    if (!user) throw new Error("尚未绑定签到账号")
    const jobs = this.collectJobs(user, data.attempts, {
      communityId,
      respectSchedule: false,
      trigger: "manual",
      now: new Date(),
    })
    return this.runJobs(user, jobs)
  }

  async runTarget(identity, selector) {
    const data = await this.store.read()
    const user = data.users[identity]
    if (!user) throw new Error("尚未绑定签到账号")
    const targets = (user.accounts ?? []).flatMap(account =>
      (account.targets ?? []).map(target => ({ account, target })),
    )

    let selected
    if (/^\d+$/.test(String(selector).trim())) {
      const ordinal = Number(selector)
      selected = targets[ordinal - 1] ? [targets[ordinal - 1]] : []
      if (!selected.length) {
        throw new Error("游戏编号不存在，请发送 #签到游戏 查看")
      }
    } else {
      const requestedName = normalizedGameName(selector)
      selected = targets.filter(({ target }) => {
        const gameName = String(target.displayName ?? "").split(" · ")[0]
        return normalizedGameName(gameName) === requestedName
      })
      if (!selected.length) {
        throw new Error(
          `未找到游戏“${String(selector).trim()}”，请发送 #签到游戏 查看`,
        )
      }
    }

    const targetIds = new Set(selected.map(({ target }) => target.id))
    const jobs = this.collectJobs(user, data.attempts, {
      targetIds,
      respectEnabled: false,
      respectSchedule: false,
      trigger: "manual",
      now: new Date(),
    })
    return this.runJobs(user, jobs)
  }

  async runDue(now = new Date()) {
    const data = await this.store.read()
    const batches = []
    for (const user of Object.values(data.users)) {
      const jobs = this.collectJobs(user, data.attempts, {
        respectSchedule: true,
        trigger: "automatic",
        now,
      })
      if (!jobs.length) continue
      batches.push({ user, results: await this.runJobs(user, jobs) })
    }
    return batches
  }

  collectJobs(
    user,
    attempts,
    {
      communityId,
      targetIds,
      respectEnabled = true,
      respectSchedule,
      trigger,
      now,
    },
  ) {
    const jobs = []
    for (const account of user.accounts ?? []) {
      if (communityId && account.communityId !== communityId) continue
      for (const target of account.targets ?? []) {
        if (targetIds && !targetIds.has(target.id)) continue
        if (respectEnabled && !target.subscription?.enabled) continue
        const date = businessDate(target.businessTimezone, now)
        if (
          attempts.some(
            attempt =>
              attempt.targetId === target.id &&
              attempt.businessDate === date &&
              ["success", "already-done"].includes(attempt.resultKind),
          )
        ) continue
        if (
          respectSchedule &&
          hourInTimezone(target.businessTimezone, now) !==
            Number(this.config.scheduler.defaultHour)
        ) continue
        jobs.push({ account, target, businessDate: date, trigger })
      }
    }
    return jobs
  }

  async runJobs(user, jobs) {
    const results = []
    for (const job of jobs) {
      const lockKey = `${job.target.id}:${job.businessDate}`
      if (this.locks.has(lockKey)) {
        results.push({
          targetId: job.target.id,
          targetName: job.target.displayName,
          communityId: job.account.communityId,
          accountName: job.account.displayName,
          trigger: job.trigger,
          kind: "skipped",
          reason: "签到任务正在执行",
        })
        continue
      }
      this.locks.add(lockKey)
      try {
        results.push(await this.runOne(user, job))
      } finally {
        this.locks.delete(lockKey)
      }
    }
    return results
  }

  async runOne(user, job) {
    const adapter = this.registry.get(job.account.communityId)
    const startedAt = new Date()
    let outcome
    let attemptNo = 0
    try {
      const credential = this.vault.decrypt(job.account.credential)
      const maxAttempts = Math.max(1, Number(this.config.retry.maxAttempts) || 1)
      do {
        attemptNo += 1
        outcome = await adapter.checkIn(credential, job.target, {
          businessDate: job.businessDate,
          attemptNo,
        })
        if (outcome.kind !== "retryable" || attemptNo >= maxAttempts) break
        const delay =
          Number(this.config.retry.baseDelayMs) * 2 ** (attemptNo - 1) +
          Math.floor(Math.random() * 400)
        await sleep(delay)
      } while (true)
    } catch (error) {
      outcome = { kind: "permanent-failure", reason: error.message }
    }

    await this.recordAttempt(
      user.identity,
      job,
      outcome,
      attemptNo,
      startedAt,
    )
    globalThis.logger?.mark?.(
      `[A-game-checkin] ${job.trigger === "automatic" ? "自动" : "手动"}签到 ` +
        `${job.target.displayName}：${outcome.kind}` +
        `${outcome.reason ? `（${outcome.reason}）` : ""}`,
    )
    return {
      targetId: job.target.id,
      targetName: job.target.displayName,
      communityId: job.account.communityId,
      accountName: job.account.displayName,
      trigger: job.trigger,
      ...outcome,
    }
  }

  async recordAttempt(identity, job, outcome, attemptNo, startedAt) {
    await this.store.transaction(data => {
      const account = data.users[identity]?.accounts?.find(item => item.id === job.account.id)
      if (account) {
        if (outcome.kind === "auth-expired") account.credentialStatus = "expired"
        else if (outcome.kind === "risk-control") account.credentialStatus = "risk-control"
        else if (["success", "already-done"].includes(outcome.kind)) {
          account.credentialStatus = "valid"
        }
      }
      data.attempts.push({
        id: crypto.randomUUID(),
        ownerIdentity: identity,
        communityId: job.account.communityId,
        accountId: job.account.id,
        accountName: job.account.displayName,
        targetId: job.target.id,
        targetName: job.target.displayName,
        businessDate: job.businessDate,
        trigger: job.trigger,
        attemptNo,
        resultKind: outcome.kind,
        reason: outcome.reason,
        rewards: (outcome.rewards ?? (outcome.reward ? [outcome.reward] : []))
          .filter(reward => reward?.name)
          .map(reward => ({
            name: reward.name,
            count: reward.count,
            icon: safeRemoteImage(reward.icon),
          })),
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      })
      const retention = Number(this.config.storage.attemptRetentionDays) || 90
      const cutoff = Date.now() - retention * 86400000
      data.attempts = data.attempts.filter(
        attempt => Date.parse(attempt.finishedAt) >= cutoff,
      )
    })
  }

  publicAccount(account) {
    const roles = (account.targets ?? []).map(target => {
      const [gameName, ...playerParts] = String(
        target.displayName ?? "游戏角色",
      ).split(" · ")
      return {
        gameName,
        playerName: playerParts.join(" · ") || "已绑定角色",
        enabled: Boolean(target.subscription?.enabled),
        preferredHour: Number(this.config.scheduler.defaultHour),
      }
    })
    return {
      id: account.id,
      communityId: account.communityId,
      displayName: account.displayName,
      credentialStatus: account.credentialStatus,
      targetCount: account.targets?.length ?? 0,
      roles,
    }
  }

  publicTarget(target) {
    return {
      id: target.id,
      displayName: target.displayName,
      enabled: Boolean(target.subscription?.enabled),
      preferredHour: Number(this.config.scheduler.defaultHour),
    }
  }
}

export { businessDate, hourInTimezone }
