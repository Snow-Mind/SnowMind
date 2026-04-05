# SnowMind Risk Scoring (Legacy Note)

This file is kept only as a legacy pointer.

## Canonical Source

Use [report.md](report.md) as the single source of truth for:

- The current 9-point scoring framework
- Hard filters and category definitions
- Protocol-specific rationale and risk explanations
- Assistant-facing explanation context

## Runtime Implementation

Runtime behavior is implemented in backend and API routes:

- Dynamic scoring engine: apps/backend/app/services/optimizer/risk_scorer.py
- Report-grounded explainer: apps/backend/app/services/optimizer/risk_report_explainer.py
- Risk APIs: apps/backend/app/api/routes/optimizer.py

Any previous 10-point references in this file are deprecated.
