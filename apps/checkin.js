import plugin from "../../../lib/plugins/plugin.js"
import fs from "node:fs/promises"
import path from "node:path"
import QRCode from "qrcode"
import { coordinator, registry } from "../lib/runtime.js"
import {
  buildAccountCardData,
  buildGameCardData,
  buildHelpCardData,
  buildRewardCardData,
  formatBatchResult,
  formatCheckinLogs,
} from "../lib/notification/format.js"

const pendingBind = new Map()
const pendingSklandPhone = new Map()
const pendingKuroPhone = new Map()
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

async function sendPrivateFile(e, filePath, fileName) {
  const target =
    globalThis.Bot?.pickUser?.(e.user_id) ??
    e.friend
  const attempts = []
  if (target?.sendFile) {
    attempts.push(() => target.sendFile(filePath, fileName))
    attempts.push(() => target.sendFile(filePath))
  }
  attempts.push(() =>
    e.reply([{ type: "file", data: { file: filePath, name: fileName } }]),
  )
  attempts.push(() =>
    e.reply([
      { type: "file", data: { file: `file://${filePath}`, name: fileName } },
    ]),
  )

  const errors = []
  for (const attempt of attempts) {
    try {
      await attempt()
      return
    } catch (error) {
      errors.push(error.message)
    }
  }
  throw new Error(errors.filter(Boolean).join("；") || "当前适配器不支持发送文件")
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
          reg: "^#?绑定签到\\s*(米游社(?:\\s*Cookie)?|森空岛(?:\\s*Token)?|库街区(?:\\s*Token)?)$",
          fnc: "startBind",
        },
        { reg: "^#?签到账号$", fnc: "accounts" },
        { reg: "^#?(签到目标|签到游戏)$", fnc: "targets" },
        {
          reg: "^#?签到日志(?:\\s*(今天|昨天|\\d{4}-\\d{1,2}-\\d{1,2}))?$",
          fnc: "logs",
        },
        { reg: "^#?开启签到\\s*(\\d+)$", fnc: "enableTarget" },
        { reg: "^#?关闭签到\\s*(\\d+)$", fnc: "disableTarget" },
        {
          reg: "^#?签到\\s*(\\d+|原神|星铁|崩铁|崩坏(?:：|:)?星穹铁道|绝区零|崩坏3|崩坏三|明日方舟|终末地|明日方舟(?:：|:)?终末地|鸣潮|鸣朝|战双|战双帕弥什)$",
          fnc: "checkinTarget",
        },
        { reg: "^#?(全部签到|米游社签到)$", fnc: "checkin" },
        { reg: "^#?删除签到账号\\s*(\\d+)$", fnc: "startDelete" },
      ],
    })
  }

  async help(e) {
    const communities = registry.list()
    try {
      return await this.renderImg(
        "A-game_checkin",
        "help/index",
        buildHelpCardData(communities),
        { scale: 1.5 },
      )
    } catch (error) {
      globalThis.logger?.warn?.(
        `[A-game-checkin] 帮助图片渲染失败，已回退文字：${error.message}`,
      )
      const names = communities.map(item => item.displayName).join("、") || "暂无"
      return e.reply(
        [
          "A-game-checkin 统一签到",
          `已接入社区：${names}`,
          "",
          "私聊 #绑定签到 米游社（推荐扫码）",
          "私聊 #绑定签到 米游社 Cookie（备用）",
          "私聊 #绑定签到 森空岛（手机号验证码）",
          "私聊 #绑定签到 森空岛 Token（备用）",
          "私聊 #绑定签到 库街区（本地验证文件 + 短信验证码）",
          "私聊 #绑定签到 库街区 Token（备用）",
          "#签到账号（查看账号编号）",
          "#签到游戏（查看游戏编号）",
          "#签到日志 [今天/昨天/YYYY-MM-DD]",
          "#全部签到",
          "#签到原神",
          "#签到 <游戏编号>",
          "#开启签到 <游戏编号>",
          "#关闭签到 <游戏编号>",
          "#删除签到账号 <账号编号>",
          "",
          "默认每天 09:00 自动签到；账号编号与游戏编号不可混用。",
        ].join("\n"),
      )
    }
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
    if (communityId === "kuro" && !/Token$/i.test(e.msg.trim())) {
      this.setContext("receiveKuroPhone", false, 120)
      return e.reply(
        "请在 120 秒内发送库街区绑定的 11 位手机号，发送“取消”可退出。",
      )
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

  async receiveKuroPhone() {
    const e = this.e
    const userId = String(e.user_id)
    const phone = String(e.msg ?? "").trim()
    if (phone === "取消") {
      pendingKuroPhone.delete(userId)
      this.finish("receiveKuroPhone")
      return e.reply("已取消绑定。")
    }

    try {
      const adapter = registry.get("kuro")
      const session = adapter.createPhoneLogin(phone)
      const filePath = await adapter.createPhoneLoginFile(
        session.token,
        path.join(process.cwd(), "temp", "A-game_checkin"),
      )
      try {
        await sendPrivateFile(e, filePath, path.basename(filePath))
      } finally {
        await fs.unlink(filePath).catch(() => {})
      }
      pendingKuroPhone.set(userId, session.token)
      this.finish("receiveKuroPhone")
      this.setContext("receiveKuroCode", false, 600)
      return e.reply(
        "手机号已记录在临时内存中，不会写入文件。\n" +
          "请下载刚刚收到的一次性 HTML 文件，用浏览器打开并完成滑块。\n" +
          "页面会直接请求库洛官方接口发送短信，不需要机器人公网。\n" +
          "页面提示短信已发送后，请回到私聊直接回复短信验证码。\n" +
          "发送“取消”可退出。",
      )
    } catch (error) {
      return e.reply(
        `库街区登录初始化失败：${error.message}\n请重新输入手机号，或发送“取消”。`,
      )
    }
  }

  async receiveKuroCode() {
    const e = this.e
    const userId = String(e.user_id)
    const code = String(e.msg ?? "").trim()
    const adapter = registry.get("kuro")
    const token = pendingKuroPhone.get(userId)
    if (code === "取消") {
      if (token) adapter.finishPhoneLogin(token)
      pendingKuroPhone.delete(userId)
      this.finish("receiveKuroCode")
      return e.reply("已取消绑定。")
    }

    const session = token ? adapter.getPhoneLogin(token) : null
    if (!session) {
      pendingKuroPhone.delete(userId)
      this.finish("receiveKuroCode")
      return e.reply("验证码会话已过期，请重新发送 #绑定签到 库街区。")
    }
    try {
      const credential = await adapter.loginPhoneSession(token, code)
      const result = await coordinator.bindAccount(
        identityFromEvent(e),
        "kuro",
        credential,
      )
      adapter.finishPhoneLogin(token)
      pendingKuroPhone.delete(userId)
      this.finish("receiveKuroCode")
      return e.reply(
        `绑定成功：${result.account.displayName}\n` +
          `已发现 ${result.targets.length} 个游戏角色，并默认开启自动签到。\n` +
          "发送 #签到游戏 可查看游戏编号。",
      )
    } catch (error) {
      return e.reply(
        `库街区验证码登录失败：${error.message}\n请重新输入验证码，或发送“取消”。`,
      )
    }
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
          `已发现 ${result.targets.length} 个游戏角色，并默认开启自动签到。\n` +
          "发送 #签到游戏 可查看游戏编号。",
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
            `已发现 ${bound.targets.length} 个游戏角色，并默认开启自动签到。\n` +
            "发送 #签到游戏 可查看游戏编号。",
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
      return e.reply("绑定会话已过期，请重新发送对应的 #绑定签到 命令。")
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
        `已发现 ${result.targets.length} 个游戏角色，并默认开启自动签到。\n` +
        "发送 #签到游戏 可查看游戏编号。",
      )
    } catch (error) {
      return e.reply(`绑定失败：${error.message}\n请检查凭证后重试，或发送“取消”。`)
    }
  }

  async accounts(e) {
    if (privateOnly(e)) return
    const accounts = await coordinator.listAccounts(identityFromEvent(e).identity)
    if (!accounts.length) return e.reply("尚未绑定签到账号。")
    try {
      return await this.renderImg(
        "A-game_checkin",
        "account/index",
        buildAccountCardData(accounts),
        { scale: 1.5 },
      )
    } catch (error) {
      globalThis.logger?.warn?.(
        `[A-game-checkin] 账号卡片渲染失败，已回退文字：${error.message}`,
      )
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
  }

  async targets(e) {
    if (privateOnly(e)) return
    const targets = await coordinator.listTargets(identityFromEvent(e).identity)
    if (!targets.length) return e.reply("尚未发现签到游戏，请先绑定社区账号。")
    try {
      return await this.renderImg(
        "A-game_checkin",
        "game/index",
        buildGameCardData(targets),
        { scale: 1.5 },
      )
    } catch (error) {
      globalThis.logger?.warn?.(
        `[A-game-checkin] 游戏卡片渲染失败，已回退文字：${error.message}`,
      )
      return e.reply(
        targets
          .map(
            (target, index) =>
              `游戏 ${index + 1}：${target.enabled ? "✅" : "⏸️"} ` +
              `${target.displayName} ` +
              `(${String(target.preferredHour).padStart(2, "0")}:00)`,
          )
          .join("\n"),
      )
    }
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
      return e.reply(
        `已${enabled ? "开启" : "关闭"}游戏签到：${target.displayName}`,
      )
    } catch (error) {
      return e.reply(error.message)
    }
  }

  async checkin(e) {
    const identity = identityFromEvent(e).identity
    try {
      const results = await coordinator.runUser(identity)
      if (!results.length) return e.reply("今天没有需要执行的签到游戏。")
      return this.replyCheckinCard(e, results, "全部游戏")
    } catch (error) {
      return e.reply(`签到无法执行：${error.message}`)
    }
  }

  async checkinTarget(e) {
    const identity = identityFromEvent(e).identity
    const selector = String(e.msg ?? "")
      .replace(/^#?签到\s*/, "")
      .trim()
    try {
      const results = await coordinator.runTarget(identity, selector)
      if (!results.length) {
        return e.reply(`所选游戏今天已经签到：${selector}`)
      }
      return this.replyCheckinCard(e, results, selector)
    } catch (error) {
      return e.reply(`签到无法执行：${error.message}`)
    }
  }

  async replyCheckinCard(e, results, selector) {
    const fallback = formatBatchResult(results, `手动签到 · ${selector}`)
    const logs = results.map(result => ({
      ...result,
      resultKind: result.kind,
    }))
    try {
      return await this.renderImg(
        "A-game_checkin",
        "reward/index",
        buildRewardCardData(logs, dateInShanghai(), {
          kicker: "本次奖励一览",
          title: `手动签到 · ${selector}`,
          dateText: `${dateInShanghai()} · 签到结果已记录`,
        }),
        { scale: 1.5 },
      )
    } catch (error) {
      globalThis.logger?.warn?.(
        `[A-game-checkin] 手动签到卡片渲染失败，已回退文字：${error.message}`,
      )
      return e.reply(fallback)
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
