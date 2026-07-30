import assert from "node:assert/strict"
import test from "node:test"
import { CredentialVault } from "../lib/secrets/vault.js"

test("CredentialVault encrypts and decrypts without exposing plaintext", () => {
  const key = Buffer.alloc(32, 7).toString("base64")
  const vault = new CredentialVault(() => key)
  const credential = { cookie: "ltuid=123;cookie_token=secret" }
  const encrypted = vault.encrypt(credential)

  assert.equal(encrypted.includes("cookie_token"), false)
  assert.deepEqual(vault.decrypt(encrypted), credential)
})

test("CredentialVault rejects a wrong key", () => {
  const encrypted = new CredentialVault(() => Buffer.alloc(32, 1).toString("base64"))
    .encrypt({ token: "secret" })
  const wrongVault = new CredentialVault(() => Buffer.alloc(32, 2).toString("base64"))
  assert.throws(() => wrongVault.decrypt(encrypted))
})
