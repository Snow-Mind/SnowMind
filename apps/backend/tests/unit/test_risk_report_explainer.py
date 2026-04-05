from app.services.optimizer.risk_report_explainer import RiskReportExplainer


def test_risk_report_explainer_loads_framework_and_protocol_section() -> None:
    explainer = RiskReportExplainer()

    ctx = explainer.get_context("aave_v3")

    assert ctx.report_source is not None
    assert ctx.report_source.endswith("report.md")
    assert "Scoring Framework" in ctx.framework_markdown
    assert "Aave V3" in ctx.protocol_markdown


def test_risk_report_explainer_unknown_protocol_returns_fallback_message() -> None:
    explainer = RiskReportExplainer()

    ctx = explainer.get_context("unknown_protocol")

    assert "No protocol-specific section" in ctx.protocol_markdown
