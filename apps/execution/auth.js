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
  futureSkewSeconds = 30,
  recentNonces,
  skipReplayCheck = false,
}) {
  if (!key) {
    return { ok: false, status: 500, error: "Service auth key not configured" }
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

  if (tsInt > nowSeconds + futureSkewSeconds) {
    return { ok: false, status: 401, error: "Request timestamp is too far in the future" }
  }

  if ((nowSeconds - tsInt) > ttlSeconds) {
    return { ok: false, status: 401, error: "Request timestamp expired" }
  }

  // Always keep in-process replay protection enabled.
  // Even when persistent nonce storage is active, this blocks same-process
  // races before the external store write completes.
  pruneNonces(recentNonces, nowSeconds, ttlSeconds)
  if (recentNonces.has(nonce)) {
    return { ok: false, status: 409, error: "Replay request blocked" }
  }

  if (skipReplayCheck) {
    // Backward compatibility note: skipReplayCheck no longer disables local
    // replay protection; persistent stores are still used for cross-instance
    // replay prevention.
  }

  const expected = crypto
    .createHmac("sha256", key)
    .update(buildSignatureMessage(method, path, timestamp, nonce, rawBody || ""), "utf8")
    .digest("hex")

  if (!safeEqualHex(signature, expected)) {
    return { ok: false, status: 401, error: "Invalid request signature" }
  }

  recentNonces.set(nonce, tsInt)
  return { ok: true, nonce, timestamp: tsInt }
}
