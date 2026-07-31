import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createKuroPhoneLoginFile,
  createKuroPhoneSession,
  finishKuroPhoneSession,
} from "../lib/communities/kuro/phone-login.js"

test("Kuro phone login creates a local Geetest page that calls Kuro directly", async () => {
  const session = createKuroPhoneSession(
    "18888888888",
    "DEVICE-CODE",
  )
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kuro-login-"))
  try {
    const filePath = await createKuroPhoneLoginFile(session.token, directory)
    const page = await fs.readFile(filePath, "utf8")

    assert.match(page, /static\.geetest\.com\/v4\/gt4\.js/)
    assert.match(page, /https:\/\/api\.kurobbs\.com\/user\/getSmsCode/)
    assert.match(page, /188 \*\*\*\* 8888/)
    assert.match(page, /const phone = "18888888888"/)
    assert.match(page, /const deviceCode = "DEVICE-CODE"/)
    assert.doesNotMatch(page, /a-game-checkin\/kuro-login/)
  } finally {
    finishKuroPhoneSession(session.token)
    await fs.rm(directory, { recursive: true, force: true })
  }
})
