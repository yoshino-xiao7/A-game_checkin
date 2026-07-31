const LABELS = {
  success: "✅",
  "already-done": "☑️",
  "auth-expired": "🔑",
  "risk-control": "⚠️",
  retryable: "⏳",
  "permanent-failure": "❌",
  skipped: "⏭️",
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

export function buildHelpCardData(communities = [], backgroundIndex) {
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

  return {
    imgType: "png",
    background: selectCardBackground(backgroundIndex),
    communityCount: communityCards.length,
    communities: communityCards,
    groups: [
      {
        name: "账号绑定",
        label: "ACCOUNT",
        summary: "四个社区，优先使用推荐登录方式",
        theme: "blue",
        commands: [
          {
            command: "#绑定签到 米游社",
            description: "扫码登录米游社",
            tag: "私聊",
          },
          {
            command: "#绑定签到 米游社 Cookie",
            description: "使用 Cookie 备用登录",
            tag: "私聊",
          },
          {
            command: "#绑定签到 森空岛",
            description: "手机号验证码登录",
            tag: "私聊",
          },
          {
            command: "#绑定签到 森空岛 Token",
            description: "使用 Token 备用登录",
            tag: "私聊",
          },
          {
            command: "#绑定签到 库街区",
            description: "本地验证文件 + 短信验证码",
            tag: "私聊",
          },
          {
            command: "#绑定签到 库街区 Token",
            description: "使用登录 JSON 或 Token 备用",
            tag: "私聊",
          },
          {
            command: "#绑定签到 塔吉多",
            description: "手机号验证码登录",
            tag: "私聊",
          },
          {
            command: "#绑定签到 塔吉多 Token",
            description: "使用登录 JSON 备用",
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
          },
          {
            command: "#签到游戏",
            description: "查看游戏角色与游戏编号",
          },
          {
            command: "#签到日志",
            description: "查看今天获得的签到道具",
          },
          {
            command: "#签到日志 昨天",
            description: "也支持指定 YYYY-MM-DD",
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
          },
          {
            command: "#签到原神",
            description: "按名称签到该游戏全部角色",
          },
          {
            command: "#签到 <游戏编号>",
            description: "按卡片编号签到单个角色",
          },
          {
            command: "#开启签到 <游戏编号>",
            description: "开启指定游戏自动签到",
          },
          {
            command: "#关闭签到 <游戏编号>",
            description: "暂停指定游戏自动签到",
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
            tag: "主人",
          },
          {
            command: "#删除签到账号 <账号编号>",
            description: "删除账号及其全部游戏配置",
            tag: "需确认",
          },
        ],
        note: "账号编号来自 #签到账号；游戏编号来自 #签到游戏，请勿混用。",
      },
    ],
    copyright: "Created By A-game_checkin",
  }
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
    return `${icon} ${item.targetName}：${resultText(item.kind)}${reward}${reason}`
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
    return (
      `${index + 1}. ${icon} ${item.targetName}\n` +
      `   ${detail}`
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
