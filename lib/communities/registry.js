export class CommunityRegistry {
  constructor(adapters = []) {
    this.adapters = new Map()
    for (const adapter of adapters) this.register(adapter)
  }

  register(adapter) {
    if (!adapter?.id) throw new TypeError("社区适配器必须提供 id")
    if (this.adapters.has(adapter.id)) throw new Error(`社区适配器重复注册：${adapter.id}`)
    this.adapters.set(adapter.id, adapter)
    return this
  }

  get(id) {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error(`尚未支持社区：${id}`)
    return adapter
  }

  list() {
    return [...this.adapters.values()]
  }
}
