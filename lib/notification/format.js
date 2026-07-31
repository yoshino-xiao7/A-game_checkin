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
}

export function formatBatchResult(batch, title = "游戏签到结果") {
  if (!batch?.length) return `${title}\n没有可执行的签到目标。`
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

export function buildRewardCardData(logs, date) {
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
    date,
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
