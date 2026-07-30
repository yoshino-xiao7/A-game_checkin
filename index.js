import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const apps = {}
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(currentDir, "apps")

for (const file of fs.readdirSync(appDir).filter(name => name.endsWith(".js"))) {
  const module = await import(`./apps/${file}`)
  for (const [name, exported] of Object.entries(module)) {
    apps[name] = exported
  }
}

export { apps }
