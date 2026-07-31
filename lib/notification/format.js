const LABELS = {
  success: "✅",
  "already-done": "☑️",
  "auth-expired": "🔑",
  "risk-control": "⚠️",
  retryable: "⏳",
  "permanent-failure": "❌",
  skipped: "⏭️",
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
  return {
    date,
    summary: `${logs.length} 个签到目标`,
    records: logs.map(item => {
      const rewards = item.rewards ?? (item.reward ? [item.reward] : [])
      const successful = ["success", "already-done"].includes(item.resultKind)
      return {
        targetName: item.targetName,
        communityName: {
          miyoushe: "米游社",
          skland: "森空岛",
          kuro: "库街区",
        }[item.communityId] ?? "游戏社区",
        status: resultText(item.resultKind),
        statusClass: successful ? "success" : "failure",
        rewards: rewards.map(reward => ({
          name: reward.name,
          count: reward.count ?? 1,
          icon: reward.icon,
          initial: String(reward.name ?? "?").trim().slice(0, 1) || "?",
        })),
        emptyText: successful
          ? item.trigger === "unknown"
            ? "历史记录未保存道具详情"
            : "本次未获取到道具详情"
          : item.reason || "本次未获得奖励",
      }
    }),
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
