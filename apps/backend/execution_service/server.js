import express from "express"
import {
  pruneNonces,
  verifyInternalRequest,
} from "./auth.js"
import { executeFolksRecovery, executeRebalance, executeWithdrawal } from "./execute.js"

const VERSION = "1.5.1"
const REQUEST_TTL_SECONDS = Number(process.env.INTERNAL_REQUEST_TTL_SECONDS || 300)
const EXECUTION_TIMEOUT_MS = Number(process.env.EXECUTION_TIMEOUT_MS || 120000)
const MAX_CONCURRENT_OPS = Number(process.env.MAX_CONCURRENT_OPS || 2)
const SENDER_LOCK_STALE_MS = Number(
  process.env.SENDER_LOCK_STALE_MS
  || Math.max(EXECUTION_TIMEOUT_MS + 30_000, 180_000),
)
const NONCE_STORE_MODE = String(process.env.NONCE_STORE_MODE || "memory").toLowerCase()
const NONCE_STORE_STRICT = String(process.env.NONCE_STORE_STRICT || "false").toLowerCase() === "true"
const NONCE_STORE_TABLE = String(process.env.NONCE_STORE_TABLE || "internal_request_nonces")
const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
const SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || "")

const supabaseNonceStoreConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY)
let effectiveNonceStoreMode = NONCE_STORE_MODE

if (NONCE_STORE_MODE === "supabase" && !supabaseNonceStoreConfigured) {
  const msg = "NONCE_STORE_MODE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_KEY"
  if (NONCE_STORE_STRICT) {
    console.error(`FATAL: ${msg}. Exiting.`)
    process.exit(1)
  }
  console.warn(`WARN: ${msg}. Falling back to in-memory nonce store.`)
  effectiveNonceStoreMode = "memory"
}

const usePersistentNonceStore = effectiveNonceStoreMode === "supabase"

const recentNonces = new Map()
let noncePersistOps = 0


function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  }
}


async function storeNonceInSupabase(nonce, timestampSeconds) {
  const seenAt = new Date(timestampSeconds * 1000).toISOString()
  const expiresAt = new Date((timestampSeconds + REQUEST_TTL_SECONDS) * 1000).toISOString()
  const url = `${SUPABASE_URL}/rest/v1/${NONCE_STORE_TABLE}`

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify([
        {
          nonce,
          seen_at: seenAt,
          expires_at: expiresAt,
        },
      ]),
    })

    if (response.ok) {
      return { ok: true }
    }
    if (response.status === 409) {
      return { ok: false, status: 409, error: "Replay request blocked" }
    }

    const body = await response.text()
    console.error(
      `Nonce store insert failed (status=${response.status} body=${body.slice(0, 300)})`,
    )
    if (NONCE_STORE_STRICT) {
      return { ok: false, status: 503, error: "Persistent nonce store unavailable" }
    }
  } catch (err) {
    console.error(`Nonce store insert error: ${String(err)}`)
    if (NONCE_STORE_STRICT) {
      return { ok: false, status: 503, error: "Persistent nonce store unavailable" }
    }
  }

  // Non-strict fallback: keep replay protection via in-memory TTL map.
  const nowSeconds = Math.floor(Date.now() / 1000)
  pruneNonces(recentNonces, nowSeconds, REQUEST_TTL_SECONDS)
  if (recentNonces.has(nonce)) {
    return { ok: false, status: 409, error: "Replay request blocked" }
  }
  recentNonces.set(nonce, timestampSeconds)
  return { ok: true }
}


async function purgeExpiredSupabaseNonces() {
  if (!usePersistentNonceStore) {
    return
  }

  noncePersistOps += 1
  if (noncePersistOps % 50 !== 0) {
    return
  }

  const nowIso = new Date().toISOString()
  const url = `${SUPABASE_URL}/rest/v1/${NONCE_STORE_TABLE}?expires_at=${encodeURIComponent(`lt.${nowIso}`)}`

  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: supabaseHeaders(),
    })
    if (!response.ok) {
      console.warn(`Nonce purge failed with status ${response.status}`)
    }
  } catch (err) {
    console.warn(`Nonce purge error: ${String(err)}`)
  }
}
// Global concurrency limiter: each rebalance creates multiple ZeroDev SDK
// client instances (primary + retry modes, each with HTTP transports and
// RPC-heavy diagnostics).  Running 3+ concurrently exhausts Node.js heap
// and causes Railway to kill the process → 503 for all in-flight requests.
let activeOps = 0
// Per-sender concurrency lock: prevents two concurrent UserOps for the same
// smart account from being submitted to the bundler simultaneously.
// This avoids "duplicate permissionHash" and nonce collision errors.
// Uses a Map with timestamps so stale entries auto-expire after the execution
// timeout window (plus a safety buffer) if the finally block never runs.
const activeSenders = new Map()

function isSenderActive(sender) {
  const ts = activeSenders.get(sender)
  if (!ts) return false
  if (Date.now() - ts > SENDER_LOCK_STALE_MS) {
    activeSenders.delete(sender)
    return false
  }
  return true
}

function markSenderActive(sender) {
  activeSenders.set(sender, Date.now())
}

function clearSender(sender) {
  activeSenders.delete(sender)
}

// ── Startup validation: fail fast if critical env vars are missing ───────────
const REQUIRED_ENV = [
  "ZERODEV_PROJECT_ID",
  "AVALANCHE_RPC_URL",
  "INTERNAL_SERVICE_KEY",
]

const missing = REQUIRED_ENV.filter((key) => !process.env[key])
if (missing.length > 0) {
  console.error(
    `FATAL: Missing required environment variables: ${missing.join(", ")}. Exiting.`,
  )
  process.exit(1)
}

// ── Process-level error handlers — crash loud, never hang silently ───────────
process.on("uncaughtException", (err) => {
  // DO NOT crash the process on uncaught exceptions.
  // The ZeroDev SDK creates multiple KernelAccountClient instances during
  // retry logic (regular mode → enable mode). When a client fails and is
  // abandoned, its background processes (HTTP transports, gas estimation
  // callbacks, bundler long-polls) can throw synchronous errors AFTER the
  // outer catch block has moved on. Crashing on these kills the process
  // and returns 503 for ALL in-flight requests, including the retry that
  // would have succeeded.
  console.error(JSON.stringify({
    level: "error",
    action: "uncaught_exception",
    message: err?.message?.slice(0, 1000),
    stack: err?.stack?.slice(0, 500),
    timestamp: new Date().toISOString(),
  }))
})
process.on("unhandledRejection", (reason) => {
  // DO NOT crash the process on unhandled rejections.
  // The ZeroDev SDK creates multiple KernelAccountClient instances during
  // retry logic (regular mode → enable mode).  Background promises from
  // failed clients (gas estimation callbacks, paymaster polling) can reject
  // AFTER the outer catch block has handled the error.  Crashing on these
  // kills the process and returns 503 for all in-flight requests.
  console.error(JSON.stringify({
    level: "error",
    action: "unhandled_rejection",
    reason: String(reason)?.slice(0, 1000),
    stack: reason instanceof Error ? reason.stack?.slice(0, 500) : undefined,
    timestamp: new Date().toISOString(),
  }))
})

const app = express()
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8")
    },
  }),
)

// ── Health endpoint — BEFORE auth middleware so Railway can reach it ──────────
app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    version: VERSION,
    nonceStore: effectiveNonceStoreMode,
    nonceStoreStrict: NONCE_STORE_STRICT,
    activeOps,
    maxConcurrentOps: MAX_CONCURRENT_OPS,
    activeSenders: activeSenders.size,
    timestamp: new Date().toISOString(),
  }),
)

// ── Internal auth — only backend should call this service ────────────────────
app.use(async (req, res, next) => {
  const key = process.env.INTERNAL_SERVICE_KEY
  const nowSeconds = Math.floor(Date.now() / 1000)
  const result = verifyInternalRequest({
    method: req.method,
    path: req.path,
    headers: req.headers,
    rawBody: req.rawBody || "",
    nowSeconds,
    key,
    ttlSeconds: REQUEST_TTL_SECONDS,
    futureSkewSeconds: INTERNAL_REQUEST_MAX_FUTURE_SKEW_SECONDS,
    recentNonces,
    skipReplayCheck: usePersistentNonceStore,
  })
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error })
  }

  if (usePersistentNonceStore) {
    const persist = await storeNonceInSupabase(result.nonce, result.timestamp)
    if (!persist.ok) {
      return res.status(persist.status).json({ error: persist.error })
    }
    void purgeExpiredSupabaseNonces()
  }

  next()
})

// ── Timeout wrapper — prevents hanging UserOps from blocking the service ─────
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms`)), ms),
    ),
  ])
}

// ── Sanitize request body for logging (strip session keys) ───────────────────
function safeLogBody(body) {
  if (!body) return {}
  const { serializedPermission, serializedSessionKey, ...safe } = body
  return safe
}

// ── Input validation helpers ─────────────────────────────────────────────────
function validateRebalanceBody(body) {
  const errors = []
  if (!body.serializedPermission) errors.push("serializedPermission is required")
  if (!body.sessionPrivateKey) errors.push("sessionPrivateKey is required")
  if (!body.smartAccountAddress) errors.push("smartAccountAddress is required")
  if (!body.contracts?.USDC) errors.push("contracts.USDC is required")
  if (!body.withdrawals && !body.deposits) errors.push("withdrawals or deposits required")
  return errors
}

function validateWithdrawalBody(body) {
  const errors = []
  if (!body.serializedPermission) errors.push("serializedPermission is required")
  if (!body.smartAccountAddress) errors.push("smartAccountAddress is required")
  if (!body.contracts?.USDC) errors.push("contracts.USDC is required")
  if (!body.contracts?.AAVE_POOL) errors.push("contracts.AAVE_POOL is required")
  if (body.isFullWithdrawal === undefined) errors.push("isFullWithdrawal is required")
  return errors
}

function validateFolksRecoveryBody(body) {
  const errors = []
  if (!body.serializedPermission) errors.push("serializedPermission is required")
  if (!body.sessionPrivateKey) errors.push("sessionPrivateKey is required")
  if (!body.smartAccountAddress) errors.push("smartAccountAddress is required")
  if (!body.contracts?.FOLKS_MESSAGE_MANAGER) errors.push("contracts.FOLKS_MESSAGE_MANAGER is required")
  if (!Array.isArray(body.recoveries) || body.recoveries.length === 0) {
    errors.push("recoveries must be a non-empty array")
  }
  return errors
}

// ── Deep error extractor — surfaces buried revert reasons from bundler errors ──
function extractErrorComponents(err) {
  const components = {
    message: err?.message?.slice(0, 2000) || "Unknown",
    shortMessage: err?.shortMessage?.slice(0, 500) || undefined,
    details: err?.details?.slice(0, 2000) || undefined,
    causeMessage: err?.cause?.message?.slice(0, 500) || undefined,
    causeDetails: err?.cause?.details?.slice(0, 1000) || undefined,
    metaMessages: err?.metaMessages?.map((m) => m.slice(0, 500)) || undefined,
    code: err?.code || undefined,
    // Walk nested causes (bundler wraps errors deeply)
    deepCause: err?.cause?.cause?.message?.slice(0, 500) || undefined,
  }
  // Remove undefined keys for cleaner logs
  return Object.fromEntries(Object.entries(components).filter(([, v]) => v !== undefined))
}

app.post("/execute-rebalance", async (req, res) => {
  const startMs = Date.now()
  const validationErrors = validateRebalanceBody(req.body)
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: validationErrors })
  }

  // Global concurrency guard: reject early if too many ops in-flight
  if (activeOps >= MAX_CONCURRENT_OPS) {
    console.log(JSON.stringify({
      level: "warn",
      action: "rebalance_global_concurrency_rejected",
      smartAccountAddress: req.body.smartAccountAddress,
      activeOps,
      maxConcurrentOps: MAX_CONCURRENT_OPS,
      timestamp: new Date().toISOString(),
    }))
    return res.status(429).json({ error: "Too many concurrent operations, retry later" })
  }

  // Per-sender concurrency guard: reject if another UserOp is in-flight
  const sender = req.body.smartAccountAddress?.toLowerCase()
  if (isSenderActive(sender)) {
    console.log(JSON.stringify({
      level: "warn",
      action: "rebalance_dedup_rejected",
      smartAccountAddress: req.body.smartAccountAddress,
      message: "Another rebalance is already in-flight for this sender",
      timestamp: new Date().toISOString(),
    }))
    return res.status(409).json({ error: "Rebalance already in-flight for this account" })
  }
  markSenderActive(sender)
  activeOps++

  try {
    const result = await withTimeout(executeRebalance(req.body), EXECUTION_TIMEOUT_MS)
    console.log(JSON.stringify({
      level: "info",
      action: "rebalance_executed",
      smartAccountAddress: req.body.smartAccountAddress,
      txHash: result.txHash,
      deposits: req.body.deposits?.length || 0,
      withdrawals: req.body.withdrawals?.length || 0,
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    res.json(result)
  } catch (err) {
    const errComponents = extractErrorComponents(err)
    console.error(JSON.stringify({
      level: "error",
      action: "rebalance_failed",
      smartAccountAddress: req.body.smartAccountAddress,
      ...errComponents,
      deposits: req.body.deposits?.map((d) => d.protocol) || [],
      withdrawals: req.body.withdrawals?.map((w) => w.protocol) || [],
      registryAddr: req.body.contracts?.REGISTRY || "NOT_SET",
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    const status = err.message?.includes("timed out") ? 504 : 500
    res.status(status).json({ error: err.message, code: err.code || "UNKNOWN" })
  } finally {
    activeOps--
    clearSender(sender)
  }
})

app.post("/execute/withdrawal", async (req, res) => {
  const startMs = Date.now()
  const validationErrors = validateWithdrawalBody(req.body)
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: validationErrors })
  }

  // Global concurrency guard
  if (activeOps >= MAX_CONCURRENT_OPS) {
    console.log(JSON.stringify({
      level: "warn",
      action: "withdrawal_global_concurrency_rejected",
      smartAccountAddress: req.body.smartAccountAddress,
      activeOps,
      maxConcurrentOps: MAX_CONCURRENT_OPS,
      timestamp: new Date().toISOString(),
    }))
    return res.status(429).json({ error: "Too many concurrent operations, retry later" })
  }

  // Per-sender concurrency guard: same lock as rebalance to prevent
  // concurrent UserOps (withdrawal + rebalance or two withdrawals)
  const sender = req.body.smartAccountAddress?.toLowerCase()
  if (isSenderActive(sender)) {
    console.log(JSON.stringify({
      level: "warn",
      action: "withdrawal_dedup_rejected",
      smartAccountAddress: req.body.smartAccountAddress,
      message: "Another operation is already in-flight for this sender",
      timestamp: new Date().toISOString(),
    }))
    return res.status(409).json({ error: "Operation already in-flight for this account" })
  }
  markSenderActive(sender)
  activeOps++

  try {
    const result = await withTimeout(executeWithdrawal(req.body), EXECUTION_TIMEOUT_MS)
    console.log(JSON.stringify({
      level: "info",
      action: "withdrawal_executed",
      smartAccountAddress: req.body.smartAccountAddress,
      txHash: result.txHash,
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    res.json(result)
  } catch (err) {
    const errComponents = extractErrorComponents(err)
    console.error(JSON.stringify({
      level: "error",
      action: "withdrawal_failed",
      smartAccountAddress: req.body.smartAccountAddress,
      ...errComponents,
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    const status = err.message?.includes("timed out") ? 504 : 500
    res.status(status).json({ error: err.message, code: err.code || "UNKNOWN" })
  } finally {
    activeOps--
    clearSender(sender)
  }
})

app.post("/execute/folks-recovery", async (req, res) => {
  const startMs = Date.now()
  const validationErrors = validateFolksRecoveryBody(req.body)
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: validationErrors })
  }

  if (activeOps >= MAX_CONCURRENT_OPS) {
    console.log(JSON.stringify({
      level: "warn",
      action: "folks_recovery_global_concurrency_rejected",
      smartAccountAddress: req.body.smartAccountAddress,
      activeOps,
      maxConcurrentOps: MAX_CONCURRENT_OPS,
      timestamp: new Date().toISOString(),
    }))
    return res.status(429).json({ error: "Too many concurrent operations, retry later" })
  }

  const sender = req.body.smartAccountAddress?.toLowerCase()
  if (isSenderActive(sender)) {
    console.log(JSON.stringify({
      level: "warn",
      action: "folks_recovery_dedup_rejected",
      smartAccountAddress: req.body.smartAccountAddress,
      message: "Another operation is already in-flight for this sender",
      timestamp: new Date().toISOString(),
    }))
    return res.status(409).json({ error: "Operation already in-flight for this account" })
  }
  markSenderActive(sender)
  activeOps++

  try {
    const result = await withTimeout(executeFolksRecovery(req.body), EXECUTION_TIMEOUT_MS)
    console.log(JSON.stringify({
      level: "info",
      action: "folks_recovery_executed",
      smartAccountAddress: req.body.smartAccountAddress,
      txHash: result.txHash,
      recoveredCount: result.recoveredCount || 0,
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    res.json(result)
  } catch (err) {
    const errComponents = extractErrorComponents(err)
    console.error(JSON.stringify({
      level: "error",
      action: "folks_recovery_failed",
      smartAccountAddress: req.body.smartAccountAddress,
      ...errComponents,
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    const status = err.message?.includes("timed out") ? 504 : 500
    res.status(status).json({ error: err.message, code: err.code || "UNKNOWN" })
  } finally {
    activeOps--
    clearSender(sender)
  }
})

const port = Number(process.env.PORT || 3001)
app.listen(port, () =>
  console.log(JSON.stringify({
    level: "info",
    action: "server_started",
    port,
    version: VERSION,
    bundlerUrl: (process.env.BUNDLER_RPC_URL || "zerodev-default").replace(/apikey=\w+/, "apikey=***"),
    paymasterUrl: (process.env.PAYMASTER_RPC_URL || "zerodev-default").replace(/apikey=\w+/, "apikey=***"),
    timestamp: new Date().toISOString(),
  })),
)
