import test from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"

import { buildSignatureMessage, verifyInternalRequest } from "./auth.js"

const KEY = "test-shared-key"

function signedHeaders({
  method = "POST",
  path = "/execute/withdrawal",
  body = "{}",
  timestamp = "1700000000",
  nonce = "nonce-1",
  key = KEY,
}) {
  const message = buildSignatureMessage(method, path, timestamp, nonce, body)
  const signature = crypto.createHmac("sha256", key).update(message, "utf8").digest("hex")
  return {
    "x-request-timestamp": timestamp,
    "x-request-nonce": nonce,
    "x-request-signature": signature,
  }
}

test("verifyInternalRequest fails closed when key is missing", () => {
  const result = verifyInternalRequest({
    method: "POST",
    path: "/execute/withdrawal",
    headers: {},
    rawBody: "{}",
    nowSeconds: 1700000000,
    key: "",
    ttlSeconds: 300,
    recentNonces: new Map(),
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 500)
  assert.equal(result.error, "Service auth key not configured")
})

test("verifyInternalRequest rejects invalid signature", () => {
  const nonces = new Map()
  const headers = signedHeaders({})
  headers["x-request-signature"] = "00".repeat(32)

  const result = verifyInternalRequest({
    method: "POST",
    path: "/execute/withdrawal",
    headers,
    rawBody: "{}",
    nowSeconds: 1700000000,
    key: KEY,
    ttlSeconds: 300,
    recentNonces: nonces,
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.equal(result.error, "Invalid request signature")
})

test("verifyInternalRequest rejects expired timestamp", () => {
  const nonces = new Map()
  const headers = signedHeaders({ timestamp: "1699999000" })

  const result = verifyInternalRequest({
    method: "POST",
    path: "/execute/withdrawal",
    headers,
    rawBody: "{}",
    nowSeconds: 1700000000,
    key: KEY,
    ttlSeconds: 300,
    recentNonces: nonces,
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.equal(result.error, "Request timestamp expired")
})

test("verifyInternalRequest rejects replay nonce", () => {
  const nonces = new Map()
  const headers = signedHeaders({ nonce: "replay-nonce" })

  const first = verifyInternalRequest({
    method: "POST",
    path: "/execute/withdrawal",
    headers,
    rawBody: "{}",
    nowSeconds: 1700000000,
    key: KEY,
    ttlSeconds: 300,
    recentNonces: nonces,
  })
  assert.equal(first.ok, true)

  const second = verifyInternalRequest({
    method: "POST",
    path: "/execute/withdrawal",
    headers,
    rawBody: "{}",
    nowSeconds: 1700000001,
    key: KEY,
    ttlSeconds: 300,
    recentNonces: nonces,
  })

  assert.equal(second.ok, false)
  assert.equal(second.status, 409)
  assert.equal(second.error, "Replay request blocked")
})
