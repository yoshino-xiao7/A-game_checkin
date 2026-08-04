import assert from "node:assert/strict"
import test from "node:test"
import { createScheduledImageRenderer } from "../lib/notification/scheduled-render.js"

test("scheduled image renderer provides a runtime without a message event", async () => {
  class FakeRuntime {
    constructor(event) {
      this.event = event
    }
  }

  const render = createScheduledImageRenderer({
    RuntimeClass: FakeRuntime,
    renderImg(pluginName, template, data, config) {
      return {
        pluginName,
        template,
        data,
        config,
        event: this.e,
        runtime: this.e.runtime,
      }
    },
  })

  const result = await render("A-game_checkin", "reward/index", { ok: true }, {
    retType: "base64",
  })

  assert.equal(result.event.runtime, result.runtime)
  assert.equal(result.runtime.event, result.event)
  assert.equal(result.pluginName, "A-game_checkin")
  assert.equal(result.template, "reward/index")
  assert.deepEqual(result.data, { ok: true })
  assert.equal(result.config.retType, "base64")
})
