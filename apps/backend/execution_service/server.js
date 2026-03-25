import express from "express"
import {
  verifyInternalRequest,
} from "./auth.js"
import { executeRebalance, executeWithdrawal } from "./execute.js"

const VERSION = "1.0.0"
const REQUEST_TTL_SECONDS = Number(process.env.INTERNAL_REQUEST_TTL_SECONDS || 300)
const EXECUTION_TIMEOUT_MS = Number(process.env.EXECUTION_TIMEOUT_MS || 30000)
const recentNonces = new Map()
// Per-sender concurrency lock: prevents two concurrent UserOps for the same
// smart account from being submitted to the bundler simultaneously.
// This avoids "duplicate permissionHash" and nonce collision errors.
const activeSenders = new Set()

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
  console.error("FATAL uncaught exception:", err)
  process.exit(1)
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
    timestamp: new Date().toISOString(),
  }),
)

// ── Internal auth — only backend should call this service ────────────────────
app.use((req, res, next) => {
  const key = process.env.INTERNAL_SERVICE_KEY
  const result = verifyInternalRequest({
    method: req.method,
    path: req.path,
    headers: req.headers,
    rawBody: req.rawBody || "",
    nowSeconds: Math.floor(Date.now() / 1000),
    key,
    ttlSeconds: REQUEST_TTL_SECONDS,
    recentNonces,
  })
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error })
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

  // Per-sender concurrency guard: reject if another UserOp is in-flight
  const sender = req.body.smartAccountAddress?.toLowerCase()
  if (activeSenders.has(sender)) {
    console.log(JSON.stringify({
      level: "warn",
      action: "rebalance_dedup_rejected",
      smartAccountAddress: req.body.smartAccountAddress,
      message: "Another rebalance is already in-flight for this sender",
      timestamp: new Date().toISOString(),
    }))
    return res.status(409).json({ error: "Rebalance already in-flight for this account" })
  }
  activeSenders.add(sender)

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
    activeSenders.delete(sender)
  }
})

app.post("/execute/withdrawal", async (req, res) => {
  const startMs = Date.now()
  const validationErrors = validateWithdrawalBody(req.body)
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: validationErrors })
  }
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
