import assert from "node:assert/strict"
import test from "node:test"
import {
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
  ], "2026-07-31")

  assert.equal(card.groups[0].icon, "reward/icons/community/skland.jpg")
  assert.equal(
    card.groups[0].records[0].gameIcon,
    "reward/icons/game/endfield.jpg",
  )
  assert.equal(card.copyright, "Created By A-game_checkin")
})
