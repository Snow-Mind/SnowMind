import express from "express"
import { executeRebalance } from "./execute.js"

const app = express()
app.use(express.json({ limit: "1mb" }))

// Internal auth — only Python backend can call this
app.use((req, res, next) => {
  const key = process.env.INTERNAL_SERVICE_KEY
  // If key is configured, enforce it; otherwise allow (dev/single-container mode)
  if (key && req.headers["x-internal-key"] !== key)
    return res.status(401).json({ error: "Unauthorized" })
  next()
})

app.get("/health", (_, res) => res.json({ status: "ok" }))

app.post("/execute-rebalance", async (req, res) => {
  try {
    const result = await executeRebalance(req.body)
    res.json(result)
  } catch (err) {
    console.error("Execution error:", err)
    res.status(500).json({ error: err.message, code: err.code || "UNKNOWN" })
  }
})

app.listen(3001, () => console.log("Executor running on :3001"))
