"""Single source of truth for a fraud report's threat level.

Four code paths used to classify severity, and they disagreed with each other:

    fraud_agent.py          >=800 CRITICAL, 500-799 HIGH, <500 MEDIUM
    security_integration.py >=700 CRITICAL, else MEDIUM      (no HIGH at all)
    auth.py                 >=900 CRITICAL, else HIGH if HARD_BLOCK else MEDIUM
    admin.py                hardcoded MEDIUM / CRITICAL

In the live worklist that produced labels that cannot both be right: a
risk-750 report from the security gate was CRITICAL while a risk-762 report
from the login path was HIGH — a *lower* score carrying a *higher* label. Five
reports scored 0 were labelled MEDIUM. 51 of 67 reports were CRITICAL, which
leaves an analyst no way to triage. LOW was unreachable in every path, so it
never appeared once.

The bands below are the system's own decision thresholds, so the severity an
analyst sees lines up with the decision the engine actually made:

    < approve  (299)          LOW       would have been approved
    approve..stepup (300-599) MEDIUM    step-up territory
    block..799 (600-799)      HIGH      block territory
    >= 800                    CRITICAL  severe block

Keeping these tied to settings means moving a threshold moves the labels with
it, instead of leaving four hardcoded scales to drift apart again.
"""

from __future__ import annotations

from typing import Literal

from app.core.config import settings

ThreatLevel = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]

# Above the block threshold, the point at which a block is severe rather than
# routine. Not a configured threshold because it does not gate any decision —
# it only separates "blocked" from "blocked hard" for triage.
CRITICAL_FLOOR = 800


def classify(risk_score: int | float | None) -> ThreatLevel:
    """Map a 0-1000 risk score to a threat level.

    A missing score is LOW, not MEDIUM: an unscored report is not evidence of
    a medium threat, and defaulting it upwards is how reports scored 0 ended up
    in the worklist as MEDIUM.
    """
    score = int(risk_score or 0)

    if score >= CRITICAL_FLOOR:
        return "CRITICAL"
    if score >= settings.ml_risk_threshold_block:      # 600
        return "HIGH"
    if score > settings.ml_risk_threshold_approve:     # > 299
        return "MEDIUM"
    return "LOW"
