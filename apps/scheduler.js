import plugin from "../../../lib/plugins/plugin.js"
import { config, coordinator } from "../lib/runtime.js"
import { formatBatchResult } from "../lib/notification/format.js"

async function notify(user, message) {
  if (globalThis.Bot?.sendFriendMsg && user.botId) {
    return Bot.sendFriendMsg(user.botId, user.userId, message)
  }
  if (globalThis.Bot?.pickUser) {
    return Bot.pickUser(user.userId).sendMsg(message)
  }
  throw new Error("当前 Yunzai 适配器不支持主动私聊通知")
}

export class GameCheckinScheduler extends plugin {
  constructor() {
    super({
      name: "A-game-checkin 定时任务",
      dsc: "扫描到期的游戏签到订阅",
      event: "message",
      priority: 9999,
      rule: [],
    })
  }

  init() {
    this.task = [
      {
        name: "A-game-checkin 自动签到扫描",
        cron: config.scheduler.cron,
        fnc: this.scan.bind(this),
      },
    ]
  }

  async scan() {
    const batches = await coordinator.runDue()
    for (const batch of batches) {
      try {
        await notify(batch.user, formatBatchResult(batch.results, "自动游戏签到结果"))
      } catch (error) {
        globalThis.logger?.error?.(`[A-game-checkin] 通知用户失败：${error.message}`)
      }
    }
  }
}
