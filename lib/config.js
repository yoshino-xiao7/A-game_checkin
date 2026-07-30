import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function merge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? merge(base?.[key] ?? {}, value)
        : value
  }
  return result
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

export function loadConfig() {
  const defaults = readJson(path.join(rootDir, "config", "default.json"))
  const overridePath = path.join(rootDir, "config", "config.json")
  return fs.existsSync(overridePath) ? merge(defaults, readJson(overridePath)) : defaults
}

export { rootDir }
export const config = loadConfig()
