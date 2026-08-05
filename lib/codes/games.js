export const CODE_GAMES = Object.freeze({
  genshin: {
    key: "genshin",
    name: "原神",
    provider: "miyoushe",
    aliases: ["原神"],
  },
  starRail: {
    key: "starRail",
    name: "崩坏：星穹铁道",
    provider: "miyoushe",
    aliases: ["星铁", "崩铁", "星穹铁道", "崩坏星穹铁道", "崩坏：星穹铁道"],
  },
  zenless: {
    key: "zenless",
    name: "绝区零",
    provider: "miyoushe",
    aliases: ["绝区零"],
  },
  honkai3: {
    key: "honkai3",
    name: "崩坏3",
    provider: "miyoushe",
    aliases: ["崩坏3", "崩坏三", "崩三"],
  },
  wutheringWaves: {
    key: "wutheringWaves",
    name: "鸣潮",
    provider: "kuro",
    gameId: "3",
    gamePath: "mc",
    aliases: ["鸣潮"],
  },
  punishingGrayRaven: {
    key: "punishingGrayRaven",
    name: "战双帕弥什",
    provider: "kuro",
    gameId: "2",
    gamePath: "pns",
    aliases: ["战双", "战双帕弥什", "帕弥什"],
  },
})

export function resolveCodeGame(input) {
  const normalized = String(input ?? "")
    .replace(/[：:\s·-]/g, "")
    .toLowerCase()
  if (!normalized) return null
  for (const game of Object.values(CODE_GAMES)) {
    if (
      game.key.toLowerCase() === normalized ||
      game.aliases.some(alias =>
        alias.replace(/[：:\s·-]/g, "").toLowerCase() === normalized,
      )
    ) {
      return game
    }
  }
  return null
}
