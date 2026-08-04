import plugin from "../../../lib/plugins/plugin.js"
import Runtime from "../../../lib/plugins/runtime.js"
import { codeSubscriptions, config, coordinator } from "../lib/runtime.js"
import {
  buildCodeCardData,
  buildRewardCardData,
  formatBatchResult,
  formatCodeNotification,
} from "../lib/notification/format.js"
import { notifyPrivateUser } from "../lib/notification/private.js"
import { createScheduledImageRenderer } from "../lib/notification/scheduled-render.js"

const renderScheduledImage = createScheduledImageRenderer({
  RuntimeClass: Runtime,
  renderImg: plugin.prototype.renderImg,
})

function dateInShanghai(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
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
    if (config.codeSubscription.enabled) {
      this.task.push({
        name: "A-game-checkin 国服前瞻兑换码扫描",
        cron: config.codeSubscription.cron,
        fnc: this.scanCodes.bind(this),
      })
    }
  }

  async scan() {
    const batches = await coordinator.runDue()
    for (const batch of batches) {
      try {
        const date = dateInShanghai()
        const logs = batch.results.map(result => ({
          ...result,
          resultKind: result.kind,
        }))
        try {
          const image = await renderScheduledImage(
            "A-game_checkin",
            "reward/index",
            buildRewardCardData(logs, date, {
              kicker: "今日自动签到",
              title: "每日签到奖励",
              dateText: `${date} · 自动签到已完成`,
            }),
            { scale: 1.5, retType: "base64" },
          )
          if (image) {
            await notifyPrivateUser(batch.user, image)
            continue
          }
        } catch (error) {
          globalThis.logger?.warn?.(
            `[A-game-checkin] 自动签到卡片渲染失败，发送纯文字：${error.message}`,
          )
        }
        await notifyPrivateUser(
          batch.user,
          formatBatchResult(batch.results, "自动游戏签到结果"),
        )
      } catch (error) {
        globalThis.logger?.error?.(`[A-game-checkin] 通知用户失败：${error.message}`)
      }
    }
  }

  async scanCodes() {
    if (this.codeScanRunning) return
    this.codeScanRunning = true
    try {
      const { batches, errors } = await codeSubscriptions.scan()
      for (const error of errors) {
        globalThis.logger?.warn?.(
          `[A-game-checkin] ${error.gameKey} 前瞻兑换码获取失败：${error.message}`,
        )
      }
      for (const batch of batches) {
        try {
          try {
            const image = await renderScheduledImage(
              "A-game_checkin",
              "code/index",
              buildCodeCardData(batch),
              { scale: 1.5, retType: "base64" },
            )
            if (image) await notifyPrivateUser(batch.user, image)
          } catch (error) {
            globalThis.logger?.warn?.(
              `[A-game-checkin] 兑换码卡片渲染失败，发送纯文字：${error.message}`,
            )
          }
          await notifyPrivateUser(batch.user, formatCodeNotification(batch))
          await codeSubscriptions.markDelivered(
            batch.user.identity,
            batch.codes.map(code => code.id),
          )
        } catch (error) {
          globalThis.logger?.error?.(
            `[A-game-checkin] 兑换码通知用户失败：${error.message}`,
          )
        }
      }
    } finally {
      this.codeScanRunning = false
    }
  }
}
