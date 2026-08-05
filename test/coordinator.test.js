import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { CommunityAdapter } from "../lib/communities/base.js"
import { CommunityRegistry } from "../lib/communities/registry.js"
import { CheckinCoordinator } from "../lib/core/coordinator.js"
import { JsonStore } from "../lib/persistence/json-store.js"
import { CredentialVault } from "../lib/secrets/vault.js"

class FakeAdapter extends CommunityAdapter {
  constructor() {
    super("fake", "测试社区")
    this.calls = 0
  }

  async validateCredential() {
    return { externalAccountId: "account-1", displayName: "测试账号" }
  }

  async discoverTargets() {
    return [
      {
        externalId: "game:role-1",
        displayName: "测试游戏 · 角色",
        businessTimezone: "Asia/Shanghai",
        metadata: {},
      },
    ]
  }

  async checkIn() {
    this.calls += 1
    return {
      kind: "success",
      reward: { name: "测试奖励", count: 1, icon: "https://example.com/item.png" },
    }
  }
}

class SelectiveAdapter extends CommunityAdapter {
  constructor() {
    super("selective", "选择测试社区")
    this.checked = []
  }

  async validateCredential() {
    return { externalAccountId: "account-2", displayName: "选择测试账号" }
  }

  async discoverTargets() {
    return [
      {
        externalId: "genshin:role-1",
        displayName: "原神 · 角色一",
        businessTimezone: "Asia/Shanghai",
      },
      {
        externalId: "genshin:role-2",
        displayName: "原神 · 角色二",
        businessTimezone: "Asia/Shanghai",
      },
      {
        externalId: "wuthering-waves:role-3",
        displayName: "鸣潮 · 角色三",
        businessTimezone: "Asia/Shanghai",
      },
    ]
  }

  async checkIn(_credential, target) {
    this.checked.push(target.externalId)
    return { kind: "success", reward: { name: "测试奖励", count: 1 } }
  }
}

class RotatingCredentialAdapter extends CommunityAdapter {
  constructor() {
    super("rotating", "轮换凭证社区")
    this.seenTokens = []
  }

  normalizeCredential(input) {
    return { token: String(input.token) }
  }

  async validateCredential() {
    return { externalAccountId: "rotating-1", displayName: "轮换账号" }
  }

  async discoverTargets() {
    return [
      {
        externalId: "rotate:1",
        displayName: "轮换游戏 · 角色一",
        businessTimezone: "Asia/Shanghai",
      },
      {
        externalId: "rotate:2",
        displayName: "轮换游戏 · 角色二",
        businessTimezone: "Asia/Shanghai",
      },
    ]
  }

  async checkIn(credential) {
    this.seenTokens.push(credential.token)
    return {
      kind: "success",
      credentialUpdate: { token: `${credential.token}-next` },
    }
  }
}

function testConfig() {
  return {
    scheduler: { defaultHour: 8 },
    retry: { maxAttempts: 2, baseDelayMs: 1 },
    storage: { attemptRetentionDays: 90 },
  }
}

test("CheckinCoordinator binds discovered targets and keeps daily runs idempotent", async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "a-game-checkin-"))
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }))

  const adapter = new FakeAdapter()
  const store = new JsonStore(path.join(tempDir, "accounts.json"))
  const vault = new CredentialVault(() => Buffer.alloc(32, 3).toString("base64"))
  const coordinator = new CheckinCoordinator({
    registry: new CommunityRegistry([adapter]),
    store,
    vault,
    config: testConfig(),
  })
  const user = { identity: "test:bot:user", userId: "user", botId: "bot" }

  const bound = await coordinator.bindAccount(user, "fake", { token: "secret" })
  assert.equal(bound.targets.length, 1)
  assert.deepEqual(bound.account.roles, [{
    gameName: "测试游戏",
    playerName: "角色",
    enabled: true,
    preferredHour: 8,
  }])
  assert.equal((await coordinator.listTargets(user.identity))[0].enabled, true)

  await store.transaction(data => {
    data.users[user.identity].accounts[0].targets[0].subscription.preferredHour = 1
  })
  assert.equal((await coordinator.listTargets(user.identity))[0].preferredHour, 8)

  const scheduledAt = new Date("2026-07-30T00:00:00.000Z")
  const due = await coordinator.runDue(scheduledAt)
  const first = due[0].results
  const second = await coordinator.runDue(scheduledAt)
  assert.equal(first[0].kind, "success")
  assert.equal(first[0].checkinMonth, "2026-07")
  assert.equal(first[0].monthlyCheckinCount, 1)
  assert.deepEqual(second, [])
  assert.equal(adapter.calls, 1)

  const logs = await coordinator.listLogs(user.identity, "2026-07-30")
  assert.equal(logs.length, 1)
  assert.equal(logs[0].trigger, "automatic")
  assert.equal(logs[0].targetName, "测试游戏 · 角色")
  assert.equal(logs[0].resultKind, "success")
  assert.equal(logs[0].checkinMonth, "2026-07")
  assert.equal(logs[0].monthlyCheckinCount, 1)
  assert.deepEqual(logs[0].rewards, [{
    name: "测试奖励",
    count: 1,
    icon: "https://example.com/item.png",
  }])

  const persisted = await store.read()
  assert.equal(JSON.stringify(persisted).includes("secret"), false)
  assert.equal(persisted.attempts.length, 1)
})

test("CheckinCoordinator counts unique successful days per calendar month", async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "a-game-monthly-"))
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }))

  const store = new JsonStore(path.join(tempDir, "accounts.json"))
  const coordinator = new CheckinCoordinator({
    registry: new CommunityRegistry([new FakeAdapter()]),
    store,
    vault: new CredentialVault(() => Buffer.alloc(32, 6).toString("base64")),
    config: testConfig(),
  })
  const user = { identity: "test:bot:monthly", userId: "monthly", botId: "bot" }
  await coordinator.bindAccount(user, "fake", { token: "secret" })

  await store.transaction(data => {
    const targetId = data.users[user.identity].accounts[0].targets[0].id
    data.attempts.push(
      { targetId, businessDate: "2026-08-01", resultKind: "success" },
      { targetId, businessDate: "2026-08-01", resultKind: "already-done" },
      { targetId, businessDate: "2026-08-02", resultKind: "already-done" },
      { targetId, businessDate: "2026-08-03", resultKind: "permanent-failure" },
      { targetId, businessDate: "2026-09-01", resultKind: "success" },
    )
  })

  const august = (await coordinator.listTargets(user.identity, "2026-08-31"))[0]
  const september = (await coordinator.listTargets(user.identity, "2026-09-01"))[0]

  assert.equal(august.checkinMonth, "2026-08")
  assert.equal(august.monthlyCheckinCount, 2)
  assert.equal(september.checkinMonth, "2026-09")
  assert.equal(september.monthlyCheckinCount, 1)
})

test("CheckinCoordinator manually runs a game by name or ordinal", async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "a-game-selective-"))
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }))

  const adapter = new SelectiveAdapter()
  const store = new JsonStore(path.join(tempDir, "accounts.json"))
  const coordinator = new CheckinCoordinator({
    registry: new CommunityRegistry([adapter]),
    store,
    vault: new CredentialVault(() => Buffer.alloc(32, 4).toString("base64")),
    config: testConfig(),
  })
  const user = {
    identity: "test:bot:selective",
    userId: "selective",
    botId: "bot",
  }

  await coordinator.bindAccount(user, "selective", { token: "secret" })
  await coordinator.setTargetEnabled(user.identity, 1, false)

  const byName = await coordinator.runTarget(user.identity, "原神")
  assert.equal(byName.length, 2)
  assert.deepEqual(adapter.checked, ["genshin:role-1", "genshin:role-2"])

  const byOrdinal = await coordinator.runTarget(user.identity, 3)
  assert.equal(byOrdinal.length, 1)
  assert.equal(adapter.checked.at(-1), "wuthering-waves:role-3")
  assert.equal(byOrdinal[0].communityId, "selective")

  assert.deepEqual(await coordinator.runTarget(user.identity, "原神"), [])
  assert.deepEqual(await coordinator.runTarget(user.identity, "鸣朝"), [])
  const logs = await coordinator.listLogs(user.identity)
  assert.equal(logs.length, 3)
  assert.ok(logs.every(item => item.trigger === "manual"))
})

test("CheckinCoordinator persists rotating community credentials between targets", async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "a-game-rotating-"))
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }))

  const adapter = new RotatingCredentialAdapter()
  const vault = new CredentialVault(() => Buffer.alloc(32, 5).toString("base64"))
  const store = new JsonStore(path.join(tempDir, "accounts.json"))
  const coordinator = new CheckinCoordinator({
    registry: new CommunityRegistry([adapter]),
    store,
    vault,
    config: testConfig(),
  })
  const user = { identity: "test:bot:rotate", userId: "rotate", botId: "bot" }

  await coordinator.bindAccount(user, "rotating", { token: "start" })
  const results = await coordinator.runUser(user.identity)

  assert.equal(results.length, 2)
  assert.deepEqual(adapter.seenTokens, ["start", "start-next"])
  const persisted = await store.read()
  assert.deepEqual(
    vault.decrypt(persisted.users[user.identity].accounts[0].credential),
    { token: "start-next-next" },
  )
  assert.ok(results.every(result => !Object.hasOwn(result, "credentialUpdate")))
})
