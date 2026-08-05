import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAccountCardData,
  buildGameCardData,
  buildHelpCardData,
  buildRewardCardData,
  formatCheckinLogs,
} from "../lib/notification/format.js"

test("formatCheckinLogs renders safe, readable history", () => {
  const text = formatCheckinLogs([
    {
      finishedAt: "2026-07-31T01:00:00.000Z",
      trigger: "automatic",
      targetName: "明日方舟 · 博士",
      resultKind: "success",
      rewards: [
        { name: "合成玉", count: 100 },
        { name: "龙门币", count: 5000 },
      ],
      checkinMonth: "2026-07",
      monthlyCheckinCount: 12,
      attemptNo: 1,
    },
  ], "2026-07-31")

  assert.match(text, /签到奖励记录（2026-07-31）/)
  assert.match(text, /1\. ✅ 明日方舟 · 博士/)
  assert.match(text, /合成玉 × 100、龙门币 × 5000/)
  assert.match(text, /7月签到 12 次/)
})

test("buildRewardCardData includes local community and game icons", () => {
  const card = buildRewardCardData([
    {
      communityId: "skland",
      targetName: "明日方舟：终末地 · 管理员",
      resultKind: "success",
      rewards: [],
      checkinMonth: "2026-07",
      monthlyCheckinCount: 9,
    },
  ], "2026-07-31", { backgroundIndex: 1 })

  assert.equal(card.groups[0].icon, "reward/icons/community/skland.jpg")
  assert.equal(
    card.groups[0].records[0].gameIcon,
    "reward/icons/game/endfield.jpg",
  )
  assert.equal(card.copyright, "Created By A-game_checkin")
  assert.equal(card.background.image, "help/backgrounds/arknights.jpg")
  assert.equal(card.groups[0].records[0].monthlyText, "7月签到 9 次")
})

test("buildAccountCardData creates compact community account cards", () => {
  const card = buildAccountCardData([
    {
      communityId: "miyoushe",
      displayName: "米游社 12***34",
      credentialStatus: "valid",
      targetCount: 2,
      roles: [
        {
          gameName: "原神",
          playerName: "旅行者",
          enabled: true,
          preferredHour: 9,
          checkinMonth: "2026-08",
          monthlyCheckinCount: 5,
        },
        {
          gameName: "崩坏：星穹铁道",
          playerName: "开拓者",
          enabled: false,
          preferredHour: 9,
        },
      ],
    },
  ], 0)

  assert.equal(card.accountCount, 1)
  assert.equal(card.background.image, "help/backgrounds/hoyoverse.webp")
  assert.equal(card.targetCount, 2)
  assert.equal(card.imgType, "png")
  assert.equal(card.accounts[0].text, "已连接")
  assert.equal(
    card.accounts[0].roles[1].icon,
    "reward/icons/game/star-rail.jpg",
  )
  assert.equal(card.accounts[0].roles[1].stateText, "已暂停")
  assert.equal(card.accounts[0].roles[0].monthlyText, "8月签到 5 次")
})

test("buildGameCardData assigns stable game numbers", () => {
  const card = buildGameCardData([
    {
      communityId: "miyoushe",
      displayName: "原神 · 旅行者",
      enabled: true,
      preferredHour: 9,
      checkinMonth: "2026-08",
      monthlyCheckinCount: 5,
    },
    {
      communityId: "skland",
      displayName: "明日方舟 · 博士",
      enabled: false,
      preferredHour: 9,
    },
  ], 4)

  assert.equal(card.imgType, "png")
  assert.equal(
    card.background.image,
    "help/backgrounds/punishing-gray-raven.jpg",
  )
  assert.equal(card.enabledCount, 1)
  assert.equal(card.games[0].number, "01")
  assert.equal(card.games[0].playerName, "旅行者")
  assert.equal(card.games[0].monthlyText, "8月签到 5 次")
  assert.equal(card.games[1].number, "02")
  assert.equal(card.games[1].stateText, "已暂停")
})

test("buildHelpCardData keeps the main page short and exposes detailed pages", () => {
  const card = buildHelpCardData([
    { id: "miyoushe", displayName: "米游社" },
    { id: "skland", displayName: "森空岛" },
  ], 2)

  assert.equal(card.imgType, "png")
  assert.equal(card.communityCount, 2)
  assert.equal(card.background.image, "help/backgrounds/endfield.jpg")
  assert.match(card.background.label, /终末地/)
  assert.equal(card.helpTitle, "签到助手")
  assert.equal(card.groups.length, 3)
  assert.equal(card.groups.flatMap(group => group.commands).length, 9)

  const binding = buildHelpCardData([], 2, "binding")
  const codes = buildHelpCardData([], 2, "codes")
  const management = buildHelpCardData([], 2, "management")

  assert.equal(binding.helpTitle, "账号绑定帮助")
  assert.equal(binding.groups[0].commands.length, 8)
  assert.equal(codes.helpTitle, "兑换码帮助")
  assert.equal(codes.groups[0].commands.length, 6)
  assert.equal(management.helpTitle, "签到管理帮助")
  assert.equal(management.groups.length, 3)
  assert.match(
    management.groups.find(group => group.name === "维护与安全").note,
    /账号编号.*游戏编号/,
  )
  assert.ok(
    binding.groups
      .flatMap(group => group.commands)
      .some(item => item.command === "#绑定签到 库街区"),
  )
  assert.ok(
    management.groups
      .flatMap(group => group.commands)
      .some(item => item.command === "#插件更新agame"),
  )
})
