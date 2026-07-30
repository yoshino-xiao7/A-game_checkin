export const MIYOUSHE_GAMES = Object.freeze([
  {
    key: "genshin",
    name: "原神",
    aliases: ["原神"],
    gameId: 2,
    signGame: "hk4e",
    actId: "e202311201442471",
  },
  {
    key: "honkai3",
    name: "崩坏3",
    aliases: ["崩坏3", "崩坏三", "崩三"],
    gameId: 1,
    actId: "e202306201626331",
  },
  {
    key: "houkai2",
    name: "崩坏学园2",
    aliases: ["崩坏学园2", "崩2"],
    gameId: 3,
    actId: "e202203291431091",
  },
  {
    key: "themis",
    name: "未定事件簿",
    aliases: ["未定事件簿", "未定"],
    gameId: 4,
    actId: "e202202251749321",
  },
  {
    key: "starrail",
    name: "崩坏：星穹铁道",
    aliases: ["崩坏：星穹铁道", "崩坏:星穹铁道", "星穹铁道", "崩铁", "星铁"],
    gameId: 6,
    actId: "e202304121516551",
  },
  {
    key: "zzz",
    name: "绝区零",
    aliases: ["绝区零", "zzz"],
    gameId: 8,
    signGame: "zzz",
    actId: "e202406242138391",
    apiBase: "https://act-nap-api.mihoyo.com/event/luna/zzz",
  },
])

export const MIYOUSHE_GAME_BY_ID = new Map(MIYOUSHE_GAMES.map(game => [game.gameId, game]))
