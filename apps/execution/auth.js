import crypto from "node:crypto"

export function pruneNonces(recentNonces, nowSeconds, ttlSeconds) {
  for (const [nonce, ts] of recentNonces.entries()) {
    if (nowSeconds - ts > ttlSeconds) {
      recentNonces.delete(nonce)
    }
  }
}

export function buildSignatureMessage(method, path, timestamp, nonce, body) {
  return `${method}\n${path}\n${timestamp}\n${nonce}\n${body}`
}

export function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}

export function verifyInternalRequest({
  method,
  path,
  headers,
  rawBody,
  nowSeconds,
  key,
  ttlSeconds,
  recentNonces,
}) {
  if (!key) {
    return { ok: true }
  }

  if (headers["x-internal-key"] !== key) {
    return { ok: false, status: 401, error: "Unauthorized" }
  }

  const timestamp = String(headers["x-request-timestamp"] || "")
  const nonce = String(headers["x-request-nonce"] || "")
  const signature = String(headers["x-request-signature"] || "")
  if (!timestamp || !nonce || !signature) {
    return { ok: false, status: 401, error: "Missing request signature headers" }
  }

  const tsInt = Number(timestamp)
  if (!Number.isFinite(tsInt)) {
    return { ok: false, status: 401, error: "Invalid request timestamp" }
  }

  if (Math.abs(nowSeconds - tsInt) > ttlSeconds) {
    return { ok: false, status: 401, error: "Request timestamp expired" }
  }

  pruneNonces(recentNonces, nowSeconds, ttlSeconds)
  if (recentNonces.has(nonce)) {
    return { ok: false, status: 409, error: "Replay request blocked" }
  }

  const expected = crypto
    .createHmac("sha256", key)
    .update(buildSignatureMessage(method, path, timestamp, nonce, rawBody || ""), "utf8")
    .digest("hex")

  if (!safeEqualHex(signature, expected)) {
    return { ok: false, status: 401, error: "Invalid request signature" }
  }

  recentNonces.set(nonce, tsInt)
  return { ok: true }
}
