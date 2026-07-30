import fs from "node:fs/promises"
import path from "node:path"

const EMPTY_DATA = Object.freeze({ version: 1, users: {}, attempts: [] })

function cloneEmptyData() {
  return JSON.parse(JSON.stringify(EMPTY_DATA))
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath
    this.queue = Promise.resolve()
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return cloneEmptyData()
      throw error
    }
  }

  async transaction(mutator) {
    const operation = this.queue.then(async () => {
      const data = await this.read()
      data.users ??= {}
      data.attempts ??= []
      const result = await mutator(data)
      await this.write(data)
      return result
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    await fs.rename(temporary, this.filePath)
  }
}
