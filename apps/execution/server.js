import express from "express"
import {
  verifyInternalRequest,
} from "./auth.js"
import { executeRebalance, executeWithdrawal } from "./execute.js"

const VERSION = "1.0.0"
const REQUEST_TTL_SECONDS = Number(process.env.INTERNAL_REQUEST_TTL_SECONDS || 300)
const EXECUTION_TIMEOUT_MS = Number(process.env.EXECUTION_TIMEOUT_MS || 30000)
const recentNonces = new Map()

// ── Startup validation: fail fast if critical env vars are missing ───────────
const REQUIRED_ENV = [
  "ZERODEV_PROJECT_ID",
  "AVALANCHE_RPC_URL",
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
  console.error("FATAL unhandled rejection:", reason)
  process.exit(1)
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

app.post("/execute-rebalance", async (req, res) => {
  const startMs = Date.now()
  const validationErrors = validateRebalanceBody(req.body)
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: validationErrors })
  }
  try {
    const result = await withTimeout(executeRebalance(req.body), EXECUTION_TIMEOUT_MS)
    console.log(JSON.stringify({
      level: "info",
      action: "rebalance_executed",
      smartAccountAddress: req.body.smartAccountAddress,
      txHash: result.txHash,
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    res.json(result)
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      action: "rebalance_failed",
      smartAccountAddress: req.body.smartAccountAddress,
      error: err.message,
      code: err.code || "UNKNOWN",
      durationMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
    }))
    const status = err.message?.includes("timed out") ? 504 : 500
    res.status(status).json({ error: err.message, code: err.code || "UNKNOWN" })
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
    console.error(JSON.stringify({
      level: "error",
      action: "withdrawal_failed",
      smartAccountAddress: req.body.smartAccountAddress,
      error: err.message,
      code: err.code || "UNKNOWN",
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
    timestamp: new Date().toISOString(),
  })),
)
