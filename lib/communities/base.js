export class CommunityAdapter {
  constructor(id, displayName) {
    if (new.target === CommunityAdapter) {
      throw new TypeError("CommunityAdapter 是抽象适配器")
    }
    this.id = id
    this.displayName = displayName
  }

  async validateCredential() {
    throw new Error("适配器未实现 validateCredential")
  }

  async discoverTargets() {
    throw new Error("适配器未实现 discoverTargets")
  }

  async checkIn() {
    throw new Error("适配器未实现 checkIn")
  }
}
