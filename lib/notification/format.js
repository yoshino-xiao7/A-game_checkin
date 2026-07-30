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
    const reward = item.reward?.name
      ? `，奖励：${item.reward.name} × ${item.reward.count ?? 1}`
      : ""
    const reason = item.reason ? `（${item.reason}）` : ""
    return `${icon} ${item.targetName}：${resultText(item.kind)}${reward}${reason}`
  })
  return `${title}\n${lines.join("\n")}`
}

function resultText(kind) {
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
