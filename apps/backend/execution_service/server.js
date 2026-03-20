import express from "express"
import {
  verifyInternalRequest,
} from "./auth.js"
import { executeRebalance, executeWithdrawal } from "./execute.js"

const REQUEST_TTL_SECONDS = Number(process.env.INTERNAL_REQUEST_TTL_SECONDS || 300)
const recentNonces = new Map()
const SERVICE_MODE = "legacy-compat"

const app = express()
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8")
    },
  }),
)

// Internal auth — only Python backend can call this
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

app.get("/health", (_, res) =>
  res.json({
    status: "ok",
    mode: SERVICE_MODE,
    deprecated: true,
    canonical_service: "apps/execution",
  }),
)

app.post("/execute-rebalance", async (req, res) => {
  try {
    const result = await executeRebalance(req.body)
    res.json(result)
  } catch (err) {
    console.error("Execution error:", err)
    res.status(500).json({ error: err.message, code: err.code || "UNKNOWN" })
  }
})

app.post("/execute/withdrawal", async (req, res) => {
  try {
    const result = await executeWithdrawal(req.body)
    res.json(result)
  } catch (err) {
    console.error("Withdrawal execution error:", err)
    res.status(500).json({ error: err.message, code: err.code || "UNKNOWN" })
  }
})

app.listen(3001, () => {
  console.warn(
    "[DEPRECATED] Legacy execution service is running in compatibility mode. " +
      "Use apps/execution service as canonical runtime target.",
  )
  console.log("Executor running on :3001")
})
