import crypto from "node:crypto"

const VERSION = "v1"

export class VaultConfigurationError extends Error {}

export class CredentialVault {
  constructor(keySource = () => process.env.A_GAME_CHECKIN_MASTER_KEY) {
    this.keySource = keySource
  }

  getKey() {
    const input = this.keySource()
    if (!input) {
      throw new VaultConfigurationError(
        "未配置 A_GAME_CHECKIN_MASTER_KEY，拒绝以明文保存签到凭证",
      )
    }

    if (/^[a-f\d]{64}$/i.test(input)) return Buffer.from(input, "hex")

    const decoded = Buffer.from(input, "base64")
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === input.replace(/=+$/, "")) {
      return decoded
    }

    throw new VaultConfigurationError(
      "A_GAME_CHECKIN_MASTER_KEY 必须是 32 字节 Base64 或 64 位十六进制密钥",
    )
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv("aes-256-gcm", this.getKey(), iv)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return [VERSION, iv, tag, ciphertext].map(item =>
      Buffer.isBuffer(item) ? item.toString("base64url") : item,
    ).join(".")
  }

  decrypt(payload) {
    const [version, ivText, tagText, ciphertextText] = String(payload).split(".")
    if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
      throw new Error("无法识别的凭证密文格式")
    }
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.getKey(),
      Buffer.from(ivText, "base64url"),
    )
    decipher.setAuthTag(Buffer.from(tagText, "base64url"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString("utf8"))
  }
}
