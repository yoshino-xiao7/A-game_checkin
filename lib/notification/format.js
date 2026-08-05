const LABELS = {
  success: "✅",
  "already-done": "☑️",
  "auth-expired": "🔑",
  "risk-control": "⚠️",
  retryable: "⏳",
  "permanent-failure": "❌",
  skipped: "⏭️",
}

function monthlyCheckinText(item) {
  if (!/^\d{4}-\d{2}$/.test(String(item?.checkinMonth ?? ""))) return ""
  const count = Number(item?.monthlyCheckinCount)
  if (!Number.isFinite(count)) return ""
  return `${Number(item.checkinMonth.slice(5, 7))}月签到 ${count} 次`
}

const COMMUNITY_CARD_META = {
  miyoushe: {
    name: "米游社",
    theme: "miyoushe",
    icon: "reward/icons/community/miyoushe.jpg",
  },
  skland: {
    name: "森空岛",
    theme: "skland",
    icon: "reward/icons/community/skland.jpg",
  },
  kuro: {
    name: "库街区",
    theme: "kuro",
    icon: "reward/icons/community/kuro.jpg",
  },
  taygedo: {
    name: "塔吉多",
    theme: "taygedo",
    icon: "reward/icons/community/taygedo.jpg",
  },
}

const GAME_CARD_ICONS = {
  原神: "reward/icons/game/genshin.jpg",
  "崩坏：星穹铁道": "reward/icons/game/star-rail.jpg",
  绝区零: "reward/icons/game/zenless.jpg",
  崩坏3: "reward/icons/game/honkai3.jpg",
  明日方舟: "reward/icons/game/arknights.jpg",
  "明日方舟：终末地": "reward/icons/game/endfield.jpg",
  鸣潮: "reward/icons/game/wuthering-waves.jpg",
  战双帕弥什: "reward/icons/game/punishing-gray-raven.jpg",
  幻塔: "reward/icons/game/tower-of-fantasy.jpg",
  异环: "reward/icons/game/neverness-to-everness.jpg",
}

const HELP_BACKGROUNDS = [
  {
    image: "help/backgrounds/hoyoverse.webp",
    label: "米游社 · 原神 / 星铁 / 绝区零",
    position: "center 30%",
    accent: "hoyoverse",
  },
  {
    image: "help/backgrounds/arknights.jpg",
    label: "森空岛 · 明日方舟",
    position: "center 28%",
    accent: "arknights",
  },
  {
    image: "help/backgrounds/endfield.jpg",
    label: "森空岛 · 明日方舟：终末地",
    position: "center 30%",
    accent: "endfield",
  },
  {
    image: "help/backgrounds/wuthering-waves.webp",
    label: "库街区 · 鸣潮",
    position: "center 26%",
    accent: "wuthering",
  },
  {
    image: "help/backgrounds/punishing-gray-raven.jpg",
    label: "库街区 · 战双帕弥什",
    position: "center 30%",
    accent: "pgr",
  },
  {
    image: "help/backgrounds/neverness-to-everness.webp",
    label: "塔吉多 · 异环 / 幻塔",
    position: "center 30%",
    accent: "taygedo",
  },
]

function selectCardBackground(backgroundIndex) {
  const selectedIndex = Number.isInteger(backgroundIndex)
    ? Math.abs(backgroundIndex) % HELP_BACKGROUNDS.length
    : Math.floor(Math.random() * HELP_BACKGROUNDS.length)
  return HELP_BACKGROUNDS[selectedIndex]
}

export function buildAccountCardData(accounts, backgroundIndex) {
  const statusMeta = {
    valid: { text: "已连接", className: "valid" },
    expired: { text: "登录失效", className: "expired" },
    "risk-control": { text: "需要验证", className: "warning" },
  }

  return {
    imgType: "png",
    background: selectCardBackground(backgroundIndex),
    accountCount: accounts.length,
    targetCount: accounts.reduce(
      (sum, account) => sum + Number(account.targetCount ?? 0),
      0,
    ),
    accounts: accounts.map((account, index) => {
      const community = COMMUNITY_CARD_META[account.communityId] ?? {
        name: "游戏社区",
        theme: "default",
      }
      const status = statusMeta[account.credentialStatus] ?? {
        text: "状态未知",
        className: "unknown",
      }
      return {
        index: String(index + 1).padStart(2, "0"),
        displayName: account.displayName,
        targetCount: Number(account.targetCount ?? 0),
        roles: (account.roles ?? []).map(role => ({
          gameName: role.gameName,
          playerName: role.playerName,
          enabled: role.enabled,
          stateText: role.enabled ? "自动签到" : "已暂停",
          stateClass: role.enabled ? "enabled" : "disabled",
          preferredTime: `${String(role.preferredHour ?? 9).padStart(2, "0")}:00`,
          monthlyText: monthlyCheckinText(role),
          icon: GAME_CARD_ICONS[role.gameName],
        })),
        ...community,
        ...status,
      }
    }),
    copyright: "Created By A-game_checkin",
  }
}

export function buildGameCardData(targets, backgroundIndex) {
  const games = targets.map((target, index) => {
    const [gameName, ...playerParts] = String(
      target.displayName ?? "游戏角色",
    ).split(" · ")
    const community = COMMUNITY_CARD_META[target.communityId] ?? {
      name: "游戏社区",
      theme: "default",
    }
    return {
      number: String(index + 1).padStart(2, "0"),
      gameName,
      playerName: playerParts.join(" · ") || "已绑定角色",
      gameIcon: GAME_CARD_ICONS[gameName],
      communityName: community.name,
      communityIcon: community.icon,
      theme: community.theme,
      enabled: Boolean(target.enabled),
      stateText: target.enabled ? "自动签到" : "已暂停",
      stateClass: target.enabled ? "enabled" : "disabled",
      preferredTime: `${String(target.preferredHour ?? 9).padStart(2, "0")}:00`,
      monthlyText: monthlyCheckinText(target),
    }
  })

  return {
    imgType: "png",
    background: selectCardBackground(backgroundIndex),
    gameCount: games.length,
    enabledCount: games.filter(game => game.enabled).length,
    games,
    copyright: "Created By A-game_checkin",
  }
}

export function buildHelpCardData(
  communities = [],
  backgroundIndex,
  page = "main",
) {
  const communityCards = communities.map(item => {
    const id = item.id ?? item.communityId
    const meta = COMMUNITY_CARD_META[id] ?? {
      name: item.displayName ?? "游戏社区",
      theme: "default",
    }
    return {
      name: item.displayName ?? meta.name,
      icon: meta.icon,
      theme: meta.theme,
    }
  })

  const detailedGroups = [
      {
        name: "账号绑定",
        label: "ACCOUNT",
        summary: "四个社区，优先使用推荐登录方式",
        theme: "blue",
        commands: [
          {
            command: "#绑定签到 米游社",
            description: "扫码登录米游社",
            icon: COMMUNITY_CARD_META.miyoushe.icon,
            tag: "私聊",
          },
          {
            command: "#绑定签到 米游社 Cookie",
            description: "使用 Cookie 备用登录",
            icon: COMMUNITY_CARD_META.miyoushe.icon,
            tag: "私聊",
          },
          {
            command: "#绑定签到 森空岛",
            description: "手机号验证码登录",
            icon: COMMUNITY_CARD_META.skland.icon,
            tag: "私聊",
          },
          {
            command: "#绑定签到 森空岛 Token",
            description: "使用 Token 备用登录",
            icon: COMMUNITY_CARD_META.skland.icon,
            tag: "私聊",
          },
          {
            command: "#绑定签到 库街区",
            description: "本地验证文件 + 短信验证码",
            icon: COMMUNITY_CARD_META.kuro.icon,
            tag: "私聊",
          },
          {
            command: "#绑定签到 库街区 Token",
            description: "使用登录 JSON 或 Token 备用",
            icon: COMMUNITY_CARD_META.kuro.icon,
            tag: "私聊",
          },
          {
            command: "#绑定签到 塔吉多",
            description: "手机号验证码登录",
            icon: COMMUNITY_CARD_META.taygedo.icon,
            tag: "私聊",
          },
          {
            command: "#绑定签到 塔吉多 Token",
            description: "使用登录 JSON 备用",
            icon: COMMUNITY_CARD_META.taygedo.icon,
            tag: "私聊",
          },
        ],
      },
      {
        name: "查询与记录",
        label: "OVERVIEW",
        summary: "账号、游戏编号与每日奖励",
        theme: "violet",
        commands: [
          {
            command: "#签到账号",
            description: "查看社区账号与账号编号",
            mark: "账",
          },
          {
            command: "#签到游戏",
            description: "查看游戏角色与游戏编号",
            mark: "游",
          },
          {
            command: "#签到日志",
            description: "查看今天获得的签到道具",
            mark: "礼",
          },
          {
            command: "#签到日志 昨天",
            description: "也支持指定 YYYY-MM-DD",
            mark: "日",
          },
        ],
      },
      {
        name: "签到控制",
        label: "SCHEDULE",
        summary: "手动执行与自动任务开关",
        theme: "green",
        commands: [
          {
            command: "#全部签到",
            description: "立即执行所有已开启游戏",
            mark: "全",
          },
          {
            command: "#签到原神",
            description: "按名称签到该游戏全部角色",
            mark: "签",
          },
          {
            command: "#签到 <游戏编号>",
            description: "按卡片编号签到单个角色",
            mark: "号",
          },
          {
            command: "#开启签到 <游戏编号>",
            description: "开启指定游戏自动签到",
            mark: "开",
          },
          {
            command: "#关闭签到 <游戏编号>",
            description: "暂停指定游戏自动签到",
            mark: "停",
          },
        ],
      },
      {
        name: "前瞻兑换码",
        label: "REDEEM CODES",
        summary: "仅国服官方来源，发现新码后私聊通知",
        theme: "cyan",
        commands: [
          {
            command: "#订阅前瞻兑换码",
            description: "订阅全部受支持的国服游戏",
            mark: "订",
          },
          {
            command: "#订阅前瞻兑换码 原神",
            description: "只订阅指定游戏",
            mark: "单",
          },
          {
            command: "#取消订阅前瞻兑换码 原神",
            description: "取消指定游戏订阅",
            mark: "消",
          },
          {
            command: "#订阅前瞻兑换码状态",
            description: "用图片卡片查看各游戏订阅状态",
            mark: "览",
          },
          {
            command: "#签到兑换码 原神",
            description: "立即查询当前前瞻兑换码",
            mark: "查",
          },
          {
            command: "#取消全部兑换码订阅",
            description: "清空全部游戏订阅",
            mark: "空",
          },
        ],
      },
      {
        name: "维护与安全",
        label: "MAINTENANCE",
        summary: "插件更新、账号解绑与安全提示",
        theme: "orange",
        commands: [
          {
            command: "#插件更新agame",
            description: "从当前 GitHub / Gitee 仓库更新",
            mark: "更",
            tag: "主人",
          },
          {
            command: "#删除签到账号 <账号编号>",
            description: "删除账号及其全部游戏配置",
            mark: "删",
            tag: "需确认",
          },
        ],
        note: "账号编号来自 #签到账号；游戏编号来自 #签到游戏，请勿混用。",
      },
  ]

  const mainGroups = [
    {
      name: "快速开始",
      label: "QUICK START",
      summary: "绑定、查看游戏、立即签到",
      theme: "blue",
      commands: [
        {
          command: "#绑定签到 <社区>",
          description: "私聊绑定米游社、森空岛、库街区或塔吉多",
          mark: "绑",
        },
        {
          command: "#签到游戏",
          description: "查看游戏角色和可操作编号",
          mark: "游",
        },
        {
          command: "#全部签到",
          description: "立即执行全部已开启游戏",
          mark: "签",
        },
      ],
    },
    {
      name: "日常使用",
      label: "DAILY",
      summary: "签到、账号与奖励记录",
      theme: "green",
      commands: [
        {
          command: "#签到 <游戏名/编号>",
          description: "手动签到指定游戏或角色",
          mark: "签",
        },
        {
          command: "#签到日志",
          description: "查看今天获得的签到奖励",
          mark: "礼",
        },
        {
          command: "#签到账号",
          description: "查看已绑定社区账号",
          mark: "账",
        },
      ],
    },
    {
      name: "更多帮助",
      label: "MORE",
      summary: "需要时再打开详细说明",
      theme: "violet",
      commands: [
        {
          command: "#签到帮助 绑定",
          description: "登录方式与备用凭证",
          mark: "绑",
        },
        {
          command: "#签到帮助 兑换码",
          description: "订阅、查询与状态命令",
          mark: "码",
        },
        {
          command: "#签到帮助 管理",
          description: "开关、日志、删除与更新",
          mark: "管",
        },
      ],
    },
  ]

  const pages = {
    main: {
      helpTitle: "签到助手",
      helpSubtitle: "只看常用操作 · 详细说明按需打开",
      groups: mainGroups,
    },
    binding: {
      helpTitle: "账号绑定帮助",
      helpSubtitle: "四个社区的推荐与备用登录方式",
      groups: [detailedGroups[0]],
    },
    codes: {
      helpTitle: "兑换码帮助",
      helpSubtitle: "国服官方前瞻 · 仅通知、不自动兑换",
      groups: [detailedGroups[3]],
    },
    management: {
      helpTitle: "签到管理帮助",
      helpSubtitle: "账号、游戏、日志、开关与维护",
      groups: [detailedGroups[1], detailedGroups[2], detailedGroups[4]],
    },
  }
  const selected = pages[page] ?? pages.main

  return {
    imgType: "png",
    background: selectCardBackground(backgroundIndex),
    communityCount: communityCards.length,
    communities: communityCards,
    helpTitle: selected.helpTitle,
    helpSubtitle: selected.helpSubtitle,
    groups: selected.groups,
    copyright: "Created By A-game_checkin",
  }
}

function formatShanghaiTime(value) {
  if (!value) return "请尽快兑换"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "请尽快兑换"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

export function buildCodeCardData(batch, backgroundIndex) {
  const codes = batch.codes ?? []
  return {
    imgType: "png",
    background: selectCardBackground(
      Number.isInteger(backgroundIndex) ? backgroundIndex : 0,
    ),
    gameName: batch.gameName ?? codes[0]?.gameName ?? "游戏",
    gameIcon: GAME_CARD_ICONS[batch.gameName ?? codes[0]?.gameName],
    title: codes[0]?.title ?? "国服前瞻特别节目",
    codeCount: codes.length,
    codes: codes.map(item => ({
      code: item.code,
      rewards: item.rewards?.length
        ? item.rewards.join("、")
        : "奖励以游戏内邮件为准",
      expiresText: formatShanghaiTime(item.expiresAt),
    })),
    sourceText:
      codes[0]?.sourceLabel ?? "米哈游 / 米游社国服官方活动",
    copyright: "Created By A-game_checkin",
  }
}

export function buildCodeSubscriptionCardData(items, backgroundIndex) {
  const games = items.map(item => ({
    gameKey: item.gameKey,
    gameName: item.gameName,
    gameIcon: GAME_CARD_ICONS[item.gameName],
    enabled: Boolean(item.enabled),
    stateText: item.enabled ? "已订阅" : "未订阅",
    stateClass: item.enabled ? "enabled" : "disabled",
  }))
  return {
    imgType: "png",
    background: selectCardBackground(
      Number.isInteger(backgroundIndex) ? backgroundIndex : 0,
    ),
    subscribedCount: games.filter(game => game.enabled).length,
    gameCount: games.length,
    games,
    copyright: "Created By A-game_checkin",
  }
}

export function formatCodeNotification(batch) {
  if (!batch?.codes?.length) return `${batch?.gameName ?? "游戏"}暂无前瞻兑换码。`
  const lines = batch.codes.flatMap((item, index) => [
    `${index + 1}. ${item.code}`,
    item.rewards?.length ? `奖励：${item.rewards.join("、")}` : null,
    `有效期：${formatShanghaiTime(item.expiresAt)}`,
  ].filter(Boolean))
  return [
    `${batch.gameName}国服前瞻兑换码`,
    batch.codes[0]?.title,
    "",
    ...lines,
    "",
    "请复制兑换码前往游戏内使用，本插件不会自动兑换。",
  ].filter(Boolean).join("\n")
}

export function formatBatchResult(batch, title = "游戏签到结果") {
  if (!batch?.length) return `${title}\n没有可执行的签到游戏。`
  const lines = batch.map(item => {
    const icon = LABELS[item.kind] ?? "•"
    const rewards = item.rewards ?? (item.reward ? [item.reward] : [])
    const reward = rewards.length
      ? `，奖励：${rewards
          .map(entry => `${entry.name} × ${entry.count ?? 1}`)
          .join("、")}`
      : ""
    const reason = item.reason ? `（${item.reason}）` : ""
    const monthly = monthlyCheckinText(item)
    return (
      `${icon} ${item.targetName}：${resultText(item.kind)}${reward}${reason}` +
      `${monthly ? `，${monthly}` : ""}`
    )
  })
  return `${title}\n${lines.join("\n")}`
}

export function formatCheckinLogs(logs, date) {
  const title = date ? `签到奖励记录（${date}）` : "签到奖励记录"
  if (!logs?.length) return `${title}\n暂无签到奖励记录。`
  const lines = logs.map((item, index) => {
    const icon = LABELS[item.resultKind] ?? "•"
    const rewards = item.rewards ?? (item.reward ? [item.reward] : [])
    let detail
    if (rewards.length) {
      detail = rewards
        .map(reward => `${reward.name} × ${reward.count ?? 1}`)
        .join("、")
    } else if (["success", "already-done"].includes(item.resultKind)) {
      detail = item.trigger === "unknown"
        ? "历史记录未保存道具详情"
        : "未获取到道具详情"
    } else {
      detail = `未获得奖励${item.reason ? `（${item.reason}）` : ""}`
    }
    const monthly = monthlyCheckinText(item)
    return (
      `${index + 1}. ${icon} ${item.targetName}\n` +
      `   ${detail}${monthly ? `；${monthly}` : ""}`
    )
  })
  return `${title}\n${lines.join("\n")}`
}

export function buildRewardCardData(logs, date, options = {}) {
  const groupMap = new Map()
  let successCount = 0

  for (const item of logs) {
    const successful = ["success", "already-done"].includes(item.resultKind)
    if (successful) successCount += 1
    const community = COMMUNITY_CARD_META[item.communityId] ?? {
      name: "游戏社区",
      theme: "default",
    }
    const group = groupMap.get(item.communityId) ?? {
      ...community,
      records: [],
    }
    const [gameName, ...playerParts] = String(item.targetName ?? "游戏角色").split(" · ")
    const rewards = item.rewards ?? (item.reward ? [item.reward] : [])
    group.records.push({
      gameName,
      gameIcon: GAME_CARD_ICONS[gameName],
      playerName: playerParts.join(" · ") || "已绑定角色",
      status: resultText(item.resultKind),
      statusIcon: successful ? "✓" : "!",
      statusClass: successful ? "success" : "failure",
      monthlyText: monthlyCheckinText(item),
      rewards: rewards.map(reward => ({
        name: reward.name,
        count: reward.count ?? 1,
        icon: reward.icon,
      })),
      emptyText: successful
        ? item.trigger === "unknown"
          ? "历史记录未保存道具详情"
          : "本次未获取到道具详情"
        : item.reason || "本次未获得奖励",
    })
    groupMap.set(item.communityId, group)
  }

  return {
    imgType: "png",
    background: selectCardBackground(options.backgroundIndex),
    date,
    kicker: options.kicker ?? "今日奖励一览",
    title: options.title ?? "每日签到奖励",
    dateText: options.dateText ?? `${date} · 奖励已存入背包`,
    successCount,
    totalCount: logs.length,
    groups: [...groupMap.values()],
    copyright: "Created By A-game_checkin",
  }
}

export function resultText(kind) {
  return {
    success: "签到成功",
    "already-done": "今日已签到",
    "auth-expired": "登录失效",
    "risk-control": "触发风控",
    retryable: "暂时失败",
    "permanent-failure": "签到失败",
    skipped: "已跳过",
  }[kind] ?? kind
}
