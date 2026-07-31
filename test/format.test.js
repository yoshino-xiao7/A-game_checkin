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
      attemptNo: 1,
    },
  ], "2026-07-31")

  assert.match(text, /签到奖励记录（2026-07-31）/)
  assert.match(text, /1\. ✅ 明日方舟 · 博士/)
  assert.match(text, /合成玉 × 100、龙门币 × 5000/)
})

test("buildRewardCardData includes local community and game icons", () => {
  const card = buildRewardCardData([
    {
      communityId: "skland",
      targetName: "明日方舟：终末地 · 管理员",
      resultKind: "success",
      rewards: [],
    },
  ], "2026-07-31", { backgroundIndex: 1 })

  assert.equal(card.groups[0].icon, "reward/icons/community/skland.jpg")
  assert.equal(
    card.groups[0].records[0].gameIcon,
    "reward/icons/game/endfield.jpg",
  )
  assert.equal(card.copyright, "Created By A-game_checkin")
  assert.equal(card.background.image, "help/backgrounds/arknights.jpg")
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
})

test("buildGameCardData assigns stable game numbers", () => {
  const card = buildGameCardData([
    {
      communityId: "miyoushe",
      displayName: "原神 · 旅行者",
      enabled: true,
      preferredHour: 9,
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
  assert.equal(card.games[1].number, "02")
  assert.equal(card.games[1].stateText, "已暂停")
})

test("buildHelpCardData separates ordinals and selects a local game background", () => {
  const card = buildHelpCardData([
    { id: "miyoushe", displayName: "米游社" },
    { id: "skland", displayName: "森空岛" },
  ], 2)

  assert.equal(card.imgType, "png")
  assert.equal(card.communityCount, 2)
  assert.equal(card.background.image, "help/backgrounds/endfield.jpg")
  assert.match(card.background.label, /终末地/)
  assert.match(
    card.groups.find(group => group.name === "账号安全").note,
    /账号编号.*游戏编号/,
  )
  assert.ok(
    card.groups
      .flatMap(group => group.commands)
      .some(item => item.command === "#绑定签到 库街区"),
  )
})
