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
    return { kind: "success", reward: { name: "测试奖励", count: 1 } }
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
  assert.equal((await coordinator.listTargets(user.identity))[0].enabled, true)

  const first = await coordinator.runUser(user.identity)
  const second = await coordinator.runUser(user.identity)
  assert.equal(first[0].kind, "success")
  assert.deepEqual(second, [])
  assert.equal(adapter.calls, 1)

  const persisted = await store.read()
  assert.equal(JSON.stringify(persisted).includes("secret"), false)
  assert.equal(persisted.attempts.length, 1)
})
