import { codeSubscriptions } from "../lib/runtime.js"
import {
  buildCodeCardData,
  buildCodeSubscriptionCardData,
  formatCodeNotification,
} from "../lib/notification/format.js"

const GAME_PATTERN =
  "(原神|星铁|崩铁|星穹铁道|崩坏(?:：|:)?星穹铁道|绝区零|崩坏3|崩坏三|崩三)"

function identityFromEvent(e) {
  const adapter = e.adapter?.name || e.adapter_name || e.platform || "yunzai"
  return {
    identity: `${adapter}:${e.self_id}:${e.user_id}`,
    userId: String(e.user_id),
    botId: String(e.self_id ?? ""),
  }
}

function selectorFromMessage(message, prefix) {
  return String(message ?? "")
    .replace(prefix, "")
    .trim()
}

function subscriptionText(items) {
  const lines = items.map(
    item =>
      `${item.enabled ? "✅" : "▫️"} ${item.gameName}：` +
      `${item.enabled ? "已订阅" : "未订阅"}`,
  )
  return ["国服前瞻兑换码订阅", ...lines].join("\n")
}

export class RedemptionCodeApp extends plugin {
  constructor() {
    super({
      name: "A-game-checkin 前瞻兑换码",
      dsc: "国服前瞻兑换码订阅与查询",
      event: "message",
      priority: 490,
      rule: [
        {
          reg: `^#?订阅前瞻兑换码(?:\\s*${GAME_PATTERN})?$`,
          fnc: "subscribe",
        },
        {
          reg: `^#?取消订阅前瞻兑换码\\s*${GAME_PATTERN}$`,
          fnc: "unsubscribe",
        },
        {
          reg: "^#?取消全部兑换码订阅$",
          fnc: "unsubscribeAll",
        },
        {
          reg: "^#?(兑换码订阅|订阅前瞻兑换码状态)$",
          fnc: "subscriptions",
        },
        {
          reg: `^#?签到兑换码(?:\\s*${GAME_PATTERN})?$`,
          fnc: "query",
        },
      ],
    })
  }

  async subscribe(e) {
    try {
      const selector = selectorFromMessage(
        e.msg,
        /^#?订阅前瞻兑换码/,
      )
      const items = await codeSubscriptions.subscribe(
        identityFromEvent(e),
        selector || undefined,
      )
      return e.reply(`${subscriptionText(items)}\n新兑换码出现后将主动私聊通知。`)
    } catch (error) {
      return e.reply(`订阅失败：${error.message}`)
    }
  }

  async unsubscribe(e) {
    try {
      const selector = selectorFromMessage(
        e.msg,
        /^#?取消订阅前瞻兑换码/,
      )
      const items = await codeSubscriptions.unsubscribe(
        identityFromEvent(e),
        selector,
      )
      return e.reply(subscriptionText(items))
    } catch (error) {
      return e.reply(`取消订阅失败：${error.message}`)
    }
  }

  async unsubscribeAll(e) {
    try {
      const items = await codeSubscriptions.unsubscribeAll(identityFromEvent(e))
      return e.reply(`${subscriptionText(items)}\n已取消全部兑换码订阅。`)
    } catch (error) {
      return e.reply(`取消订阅失败：${error.message}`)
    }
  }

  async subscriptions(e) {
    const items = await codeSubscriptions.listSubscriptions(
      identityFromEvent(e).identity,
    )
    try {
      return await this.renderImg(
        "A-game_checkin",
        "code-status/index",
        buildCodeSubscriptionCardData(items),
        { scale: 1.5 },
      )
    } catch (error) {
      globalThis.logger?.warn?.(
        `[A-game-checkin] 兑换码订阅状态卡片渲染失败：${error.message}`,
      )
      return e.reply(subscriptionText(items))
    }
  }

  async query(e) {
    const selector = selectorFromMessage(e.msg, /^#?签到兑换码/)
    try {
      const { groups, errors } = await codeSubscriptions.refresh(
        selector || undefined,
      )
      if (!groups.length) {
        const detail = errors.length
          ? `\n获取失败：${errors.map(item => item.message).join("；")}`
          : ""
        return e.reply(`当前暂无国服前瞻兑换码。${detail}`)
      }

      for (const group of groups) {
        try {
          await this.renderImg(
            "A-game_checkin",
            "code/index",
            buildCodeCardData(group),
            { scale: 1.5 },
          )
        } catch (error) {
          globalThis.logger?.warn?.(
            `[A-game-checkin] 兑换码卡片渲染失败：${error.message}`,
          )
        }
        await e.reply(formatCodeNotification(group))
      }
      return true
    } catch (error) {
      return e.reply(`兑换码查询失败：${error.message}`)
    }
  }
}
