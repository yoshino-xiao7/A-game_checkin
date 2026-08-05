import path from "node:path"
import { config, rootDir } from "./config.js"
import { MiyousheAdapter } from "./communities/miyoushe/index.js"
import { KuroAdapter } from "./communities/kuro/index.js"
import { CommunityRegistry } from "./communities/registry.js"
import { SklandAdapter } from "./communities/skland/index.js"
import { TaygedoAdapter } from "./communities/taygedo/index.js"
import { CheckinCoordinator } from "./core/coordinator.js"
import { MiyousheLiveCodeSource } from "./codes/miyoushe-live.js"
import { KuroOfficialCodeSource } from "./codes/kuro-official.js"
import { SklandOfficialCodeSource } from "./codes/skland-official.js"
import { TaygedoOfficialCodeSource } from "./codes/taygedo-official.js"
import { CodeSourceRouter } from "./codes/source-router.js"
import { CodeSubscriptionService } from "./codes/subscription-service.js"
import { JsonStore } from "./persistence/json-store.js"
import { CredentialVault } from "./secrets/vault.js"

const registry = new CommunityRegistry()

if (config.communities.miyoushe?.enabled) {
  registry.register(
    new MiyousheAdapter({
      timeoutMs: config.communities.miyoushe.requestTimeoutMs,
    }),
  )
}

if (config.communities.skland?.enabled) {
  registry.register(
    new SklandAdapter({
      timeoutMs: config.communities.skland.requestTimeoutMs,
    }),
  )
}

if (config.communities.kuro?.enabled) {
  registry.register(
    new KuroAdapter({
      timeoutMs: config.communities.kuro.requestTimeoutMs,
    }),
  )
}

if (config.communities.taygedo?.enabled) {
  registry.register(
    new TaygedoAdapter({
      timeoutMs: config.communities.taygedo.requestTimeoutMs,
    }),
  )
}

const store = new JsonStore(path.join(rootDir, "data", "accounts.json"))
const vault = new CredentialVault()
const coordinator = new CheckinCoordinator({ registry, store, vault, config })
const codeSource = new CodeSourceRouter([
  new MiyousheLiveCodeSource({
    timeoutMs: config.codeSubscription.requestTimeoutMs,
  }),
  new KuroOfficialCodeSource({
    timeoutMs: config.codeSubscription.requestTimeoutMs,
  }),
  new SklandOfficialCodeSource({
    timeoutMs: config.codeSubscription.requestTimeoutMs,
  }),
  new TaygedoOfficialCodeSource({
    timeoutMs: config.codeSubscription.requestTimeoutMs,
  }),
])
const codeSubscriptions = new CodeSubscriptionService({
  store,
  source: codeSource,
  retentionDays: config.codeSubscription.deliveryRetentionDays,
})

export {
  codeSource,
  codeSubscriptions,
  config,
  coordinator,
  registry,
  store,
  vault,
}
