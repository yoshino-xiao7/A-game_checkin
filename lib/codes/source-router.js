export class CodeSourceRouter {
  constructor(sources) {
    this.sources = sources
  }

  sourceFor(gameKey) {
    return this.sources.find(source => source.supports(gameKey))
  }

  async list(gameKey) {
    const source = this.sourceFor(gameKey)
    if (!source) throw new Error(`没有可用的兑换码数据源：${gameKey}`)
    return source.list(gameKey)
  }

  async listAll(gameKeys) {
    const settled = await Promise.allSettled(
      gameKeys.map(async gameKey => ({ gameKey, items: await this.list(gameKey) })),
    )
    const items = []
    const errors = []
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") items.push(...result.value.items)
      else {
        errors.push({
          gameKey: gameKeys[index],
          message: result.reason?.message || String(result.reason),
        })
      }
    })
    return { items, errors }
  }
}
