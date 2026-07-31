import plugin from "../../../lib/plugins/plugin.js"
import QRCode from "qrcode"
import { coordinator, registry } from "../lib/runtime.js"
import {
  buildRewardCardData,
  formatBatchResult,
  formatCheckinLogs,
} from "../lib/notification/format.js"

const pendingBind = new Map()
const pendingSklandPhone = new Map()
const pendingDelete = new Map()

function identityFromEvent(e) {
  const adapter = e.adapter?.name || e.adapter_name || e.platform || "yunzai"
  return {
    identity: `${adapter}:${e.self_id}:${e.user_id}`,
    userId: String(e.user_id),
    botId: String(e.self_id ?? ""),
  }
}

function privateOnly(e) {
  if (!e.isGroup) return false
  e.reply("该命令涉及账号信息，请私聊机器人使用。")
  return true
}

function dateInShanghai(offsetDays = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86400000))
}

function logDateFromMessage(message) {
  const input = String(message)
    .replace(/^#?签到日志/, "")
    .trim()
  if (!input || input === "今天") return dateInShanghai()
  if (input === "昨天") return dateInShanghai(-1)
  const match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!match) throw new Error("日期格式应为 YYYY-MM-DD，例如 2026-07-31")
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
  const parsed = new Date(`${date}T00:00:00+08:00`)
  if (
    Number.isNaN(parsed.getTime()) ||
    dateInShanghaiFromDate(parsed) !== date
  ) {
    throw new Error("日期无效")
  }
  return date
}

function dateInShanghaiFromDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export class GameCheckinApp extends plugin {
  constructor() {
    super({
      name: "A-game-checkin",
      dsc: "多游戏社区统一签到",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?签到帮助$", fnc: "help" },
        {
          reg: "^#?绑定签到\\s*(米游社(?:\\s*Cookie)?|森空岛(?:\\s*Token)?|库街区)$",
          fnc: "startBind",
        },
        { reg: "^#?签到账号$", fnc: "accounts" },
        { reg: "^#?签到目标$", fnc: "targets" },
        {
          reg: "^#?签到日志(?:\\s*(今天|昨天|\\d{4}-\\d{1,2}-\\d{1,2}))?$",
          fnc: "logs",
        },
        { reg: "^#?开启签到\\s*(\\d+)$", fnc: "enableTarget" },
        { reg: "^#?关闭签到\\s*(\\d+)$", fnc: "disableTarget" },
        { reg: "^#?(全部签到|米游社签到)$", fnc: "checkin" },
        { reg: "^#?删除签到账号\\s*(\\d+)$", fnc: "startDelete" },
      ],
    })
  }

  async help(e) {
    const communities = registry.list().map(item => item.displayName).join("、") || "暂无"
    return e.reply(
      [
        "A-game-checkin 统一签到",
        `已接入社区：${communities}`,
        "",
        "私聊 #绑定签到 米游社（推荐扫码）",
        "私聊 #绑定签到 米游社 Cookie（备用）",
        "私聊 #绑定签到 森空岛（手机号验证码）",
        "私聊 #绑定签到 森空岛 Token（备用）",
        "#签到账号",
        "#签到目标",
        "#签到日志 [今天/昨天/YYYY-MM-DD]",
        "#全部签到",
        "#开启签到 <目标编号>",
        "#关闭签到 <目标编号>",
        "#删除签到账号 <账号编号>",
        "",
        "凭证仅加密保存在本机；验证码或风控需要前往对应社区手动处理。",
      ].join("\n"),
    )
  }

  async startBind(e) {
    if (privateOnly(e)) return
    const communityId = e.msg.includes("米游社")
      ? "miyoushe"
      : e.msg.includes("森空岛")
        ? "skland"
        : e.msg.includes("库街区")
          ? "kuro"
          : null
    if (!communityId) return e.reply("暂不支持该社区。")
    if (communityId === "miyoushe" && !/Cookie$/i.test(e.msg.trim())) {
      return this.bindMiyousheQr(e)
    }
    if (communityId === "skland" && !/Token$/i.test(e.msg.trim())) {
      this.setContext("receiveSklandPhone", false, 120)
      return e.reply("请在 120 秒内发送森空岛绑定的 11 位手机号，发送“取消”可退出。")
    }
    pendingBind.set(String(e.user_id), communityId)
    this.setContext("receiveCredential", false, 120)
    return e.reply(
      `请在 120 秒内发送${registry.get(communityId).displayName}凭证。\n` +
        "米游社发送 Cookie；森空岛发送 Token；库街区发送登录 JSON 或“用户ID Token”。\n" +
        "插件会验证账号并自动发现该账号下所有支持签到的游戏角色。\n" +
        "发送“取消”可退出，凭证不会出现在后续回复或日志中。",
    )
  }

  async receiveSklandPhone() {
    const e = this.e
    const userId = String(e.user_id)
    const phone = String(e.msg ?? "").trim()
    if (phone === "取消") {
      pendingSklandPhone.delete(userId)
      this.finish("receiveSklandPhone")
      return e.reply("已取消绑定。")
    }

    try {
      const adapter = registry.get("skland")
      const result = await adapter.sendPhoneCode(phone)
      const session = {
        phone: result.phone,
        expiresAt: Date.now() + 5 * 60 * 1000,
      }
      pendingSklandPhone.set(userId, session)
      setTimeout(() => {
        if (pendingSklandPhone.get(userId)?.expiresAt === session.expiresAt) {
          pendingSklandPhone.delete(userId)
        }
      }, 5 * 60 * 1000).unref()
      this.finish("receiveSklandPhone")
      this.setContext("receiveSklandCode", false, 300)
      return e.reply(
        "验证码已发送，请在 5 分钟内回复短信验证码。\n" +
          "验证码只用于本次登录，不会保存；发送“取消”可退出。",
      )
    } catch (error) {
      return e.reply(`验证码发送失败：${error.message}\n请重新输入手机号，或发送“取消”。`)
    }
  }

  async receiveSklandCode() {
    const e = this.e
    const userId = String(e.user_id)
    const code = String(e.msg ?? "").trim()
    if (code === "取消") {
      pendingSklandPhone.delete(userId)
      this.finish("receiveSklandCode")
      return e.reply("已取消绑定。")
    }
    const session = pendingSklandPhone.get(userId)
    if (!session || session.expiresAt <= Date.now()) {
      pendingSklandPhone.delete(userId)
      this.finish("receiveSklandCode")
      return e.reply("验证码会话已过期，请重新发送 #绑定签到 森空岛。")
    }

    try {
      const adapter = registry.get("skland")
      const credential = await adapter.loginByPhoneCode(session.phone, code)
      const result = await coordinator.bindAccount(
        identityFromEvent(e),
        "skland",
        credential,
      )
      pendingSklandPhone.delete(userId)
      this.finish("receiveSklandCode")
      return e.reply(
        `绑定成功：${result.account.displayName}\n` +
          `已发现 ${result.targets.length} 个签到目标，并默认开启自动签到。\n` +
          "发送 #签到目标 可查看详情。",
      )
    } catch (error) {
      return e.reply(`验证码登录失败：${error.message}\n请重新输入验证码，或发送“取消”。`)
    }
  }

  async bindMiyousheQr(e) {
    const adapter = registry.get("miyoushe")
    try {
      await e.reply("正在生成米游社登录二维码……")
      const session = await adapter.createQrLogin()
      const image = await QRCode.toBuffer(session.url, {
        type: "png",
        width: 420,
        margin: 2,
        errorCorrectionLevel: "M",
      })
      await e.reply([
        "请使用米游社 App 扫描二维码，并在 App 内确认登录。\n" +
          "二维码约两分钟内有效，请勿扫描他人的登录二维码。",
        segment.image(image),
      ])

      let scanned = false
      for (let index = 0; index < 60; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const result = await adapter.queryQrLogin(session)
        if (result.status === "expired") {
          return e.reply("二维码已过期，请重新发送 #绑定签到 米游社。")
        }
        if (result.status === "scanned" && !scanned) {
          scanned = true
          await e.reply("二维码已扫描，请在米游社 App 内点击确认登录。")
        }
        if (result.status !== "confirmed") continue

        const bound = await coordinator.bindAccount(
          identityFromEvent(e),
          "miyoushe",
          result.credential,
        )
        return e.reply(
          `绑定成功：${bound.account.displayName}\n` +
            `已发现 ${bound.targets.length} 个签到目标，并默认开启自动签到。\n` +
            "发送 #签到目标 可查看详情。",
        )
      }
      return e.reply("等待扫码确认超时，请重新发送 #绑定签到 米游社。")
    } catch (error) {
      return e.reply(`米游社扫码绑定失败：${error.message}`)
    }
  }

  async receiveCredential() {
    const e = this.e
    const userId = String(e.user_id)
    const communityId = pendingBind.get(userId)
    const input = String(e.msg ?? "").trim()
    if (input === "取消") {
      pendingBind.delete(userId)
      this.finish("receiveCredential")
      return e.reply("已取消绑定。")
    }
    if (!communityId) {
      this.finish("receiveCredential")
      return e.reply("绑定会话已过期，请重新发送 #绑定签到 米游社。")
    }

    try {
      const result = await coordinator.bindAccount(
        identityFromEvent(e),
        communityId,
        input,
      )
      pendingBind.delete(userId)
      this.finish("receiveCredential")
      return e.reply(
        `绑定成功：${result.account.displayName}\n` +
          `已发现 ${result.targets.length} 个签到目标，并默认开启自动签到。\n` +
          "发送 #签到目标 可查看详情。",
      )
    } catch (error) {
      return e.reply(`绑定失败：${error.message}\n请检查凭证后重试，或发送“取消”。`)
    }
  }

  async accounts(e) {
    if (privateOnly(e)) return
    const accounts = await coordinator.listAccounts(identityFromEvent(e).identity)
    if (!accounts.length) return e.reply("尚未绑定签到账号。")
    return e.reply(
      accounts
        .map(
          (account, index) =>
            `${index + 1}. ${account.displayName} [${account.credentialStatus}]，` +
            `${account.targetCount} 个目标`,
        )
        .join("\n"),
    )
  }

  async targets(e) {
    if (privateOnly(e)) return
    const targets = await coordinator.listTargets(identityFromEvent(e).identity)
    if (!targets.length) return e.reply("尚未发现签到目标，请先绑定社区账号。")
    return e.reply(
      targets
        .map(
          (target, index) =>
            `${index + 1}. ${target.enabled ? "✅" : "⏸️"} ${target.displayName} ` +
            `(${String(target.preferredHour).padStart(2, "0")}:00)`,
        )
        .join("\n"),
    )
  }

  async logs(e) {
    if (privateOnly(e)) return
    try {
      const date = logDateFromMessage(e.msg)
      const logs = await coordinator.listLogs(identityFromEvent(e).identity, date)
      if (!logs.length) return e.reply(formatCheckinLogs(logs, date))
      try {
        return await this.renderImg(
          "A-game_checkin",
          "reward/index",
          buildRewardCardData(logs, date),
        )
      } catch (error) {
        globalThis.logger?.warn?.(
          `[A-game-checkin] 奖励卡片渲染失败，已回退文字：${error.message}`,
        )
        return e.reply(formatCheckinLogs(logs, date))
      }
    } catch (error) {
      return e.reply(`签到日志查询失败：${error.message}`)
    }
  }

  async enableTarget(e) {
    return this.setTarget(e, true)
  }

  async disableTarget(e) {
    return this.setTarget(e, false)
  }

  async setTarget(e, enabled) {
    if (privateOnly(e)) return
    const ordinal = Number(e.msg.match(/(\d+)$/)?.[1])
    try {
      const target = await coordinator.setTargetEnabled(
        identityFromEvent(e).identity,
        ordinal,
        enabled,
      )
      return e.reply(`已${enabled ? "开启" : "关闭"}：${target.displayName}`)
    } catch (error) {
      return e.reply(error.message)
    }
  }

  async checkin(e) {
    const identity = identityFromEvent(e).identity
    try {
      const results = await coordinator.runUser(identity)
      return e.reply(formatBatchResult(results))
    } catch (error) {
      return e.reply(`签到无法执行：${error.message}`)
    }
  }

  async startDelete(e) {
    if (privateOnly(e)) return
    const ordinal = Number(e.msg.match(/(\d+)$/)?.[1])
    const accounts = await coordinator.listAccounts(identityFromEvent(e).identity)
    const account = accounts[ordinal - 1]
    if (!account) return e.reply("签到账号编号不存在。")
    pendingDelete.set(String(e.user_id), ordinal)
    this.setContext("confirmDelete", false, 60)
    return e.reply(`确认删除 ${account.displayName}？请在 60 秒内回复“确认删除”。`)
  }

  async confirmDelete() {
    const e = this.e
    const userId = String(e.user_id)
    if (String(e.msg).trim() !== "确认删除") {
      pendingDelete.delete(userId)
      this.finish("confirmDelete")
      return e.reply("已取消删除。")
    }
    const ordinal = pendingDelete.get(userId)
    pendingDelete.delete(userId)
    this.finish("confirmDelete")
    try {
      const removed = await coordinator.removeAccount(
        identityFromEvent(e).identity,
        ordinal,
      )
      return e.reply(`已删除 ${removed.displayName} 的凭证、目标和订阅。`)
    } catch (error) {
      return e.reply(`删除失败：${error.message}`)
    }
  }
}
