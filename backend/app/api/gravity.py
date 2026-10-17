"""
Financial Gravity Engine — Layer 4 of Citadel

Profiles a user's 3-month transaction history, computes their "spending orbit"
(normal behaviour baseline), and detects when a new transaction breaks that
orbit (anomalous financial behaviour).

Uses deterministic seeded synthetic data keyed by customer_id — no DB
migration required. Works seamlessly with existing demo users (Harsh, attacker
simulation, coercion victim).
"""
import hashlib
import logging
import math
import random
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.security import AuthUser, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Spending categories ───────────────────────────────────────────────────────
CATEGORIES = [
    "University Fees",
    "Rent / PG",
    "Food & Dining",
    "Entertainment",
    "Utilities",
    "Bank & Savings",
]

# Category colours (for frontend viz)
CATEGORY_COLORS = {
    "University Fees": "#8b5cf6",   # violet
    "Rent / PG":       "#6366f1",   # indigo
    "Food & Dining":   "#f59e0b",   # amber
    "Entertainment":   "#ec4899",   # pink
    "Utilities":       "#0ea5e9",   # sky
    "Bank & Savings":  "#10b981",   # emerald
}

# Typical spending % bands per category (min, max). The minima must sum to
# under 100 and the maxima to over 100, so a draw that sums to exactly 100%
# always exists inside the bands.
CATEGORY_BANDS = {
    "University Fees": (16, 24),
    "Rent / PG":       (18, 26),
    "Food & Dining":   (12, 18),
    "Entertainment":   (4, 8),
    "Utilities":       (5, 9),
    "Bank & Savings":  (20, 30),
}

# ── Merchant catalogue ────────────────────────────────────────────────────────
# The category, ticket size, and time-of-day of a transaction are all properties
# OF THE MERCHANT, so they are declared together here. Sampling a category and a
# payee independently is what produced nonsense rows like "Netflix · Education
# · ₹5,564" — a Netflix charge is Entertainment and is never five thousand
# rupees. Each entry: (payee, (amount_lo, amount_hi), (hour_lo, hour_hi), weight,
# cap) where weight is the merchant's relative frequency and cap is the most
# times it can legitimately appear in one month — a fee or an EMI bills once,
# a canteen does not.
PAYEE_CATALOG: dict[str, list[tuple[str, tuple[int, int], tuple[int, int], int, int]]] = {
    "University Fees": [
        ("Tuition Fee",       (28000, 52000), (10, 16), 1, 1),
        ("Hostel Fee",        (12000, 22000), (10, 16), 1, 1),
        ("Mess Fee",          (3200, 4800),   (10, 17), 2, 1),
        ("Development Fee",   (2500, 6000),   (10, 16), 1, 1),
        ("Exam Fee",          (600, 2500),    (10, 17), 1, 2),
    ],
    "Rent / PG": [
        ("PG Rent",           (6500, 12000),  (9, 12),  3, 1),
        ("Landlord UPI",      (6500, 12000),  (9, 13),  1, 1),
    ],
    "Food & Dining": [
        ("Swiggy",            (180, 750),     (13, 22), 5, 8),
        ("Zomato",            (160, 700),     (13, 22), 4, 6),
        ("Canteen",           (40, 220),      (9, 20),  6, 12),
        ("Domino's",          (250, 800),     (19, 23), 2, 3),
        ("Chai Point",        (40, 150),      (8, 19),  3, 10),
    ],
    "Entertainment": [
        ("Netflix",           (199, 649),     (20, 23), 2, 1),
        ("Amazon Prime",      (299, 1499),    (20, 23), 1, 1),
        ("Spotify",           (119, 199),     (9, 23),  2, 1),
        ("BookMyShow",        (250, 900),     (17, 22), 2, 3),
        ("PVR Cinemas",       (300, 1200),    (17, 22), 1, 2),
    ],
    "Utilities": [
        ("Electricity Board", (600, 2600),    (10, 19), 2, 1),
        ("Jio Fiber",         (399, 1499),    (10, 20), 2, 1),
        ("Airtel Recharge",   (199, 999),     (9, 21),  2, 2),
        ("Gas Cylinder",      (850, 1150),    (10, 18), 1, 1),
    ],
    "Bank & Savings": [
        ("Savings Transfer",  (2000, 12000),  (9, 18),  3, 4),
        ("SIP - Mutual Fund", (1000, 5000),   (9, 14),  2, 1),
        ("Loan EMI",          (2500, 9000),   (9, 13),  1, 1),
    ],
}

# Merchants that bill once a month, so every month's timeline has the fixed
# commitments a real statement would show rather than only discretionary spend.
RECURRING_PAYEES = ["PG Rent", "Mess Fee", "Jio Fiber", "Netflix", "SIP - Mutual Fund"]

# Flat payee -> category index, for lookups.
PAYEE_CATEGORY = {
    payee: cat for cat, entries in PAYEE_CATALOG.items() for payee, _a, _h, _w, _c in entries
}
PAYEE_SPEC = {
    payee: (amount, hours, weight, cap)
    for entries in PAYEE_CATALOG.values()
    for payee, amount, hours, weight, cap in entries
}
NORMAL_PAYEES = list(PAYEE_CATEGORY.keys())

# Static reference list — kept only for the /evaluate endpoint's index lookups.
# The /profile path now COMPUTES signals from the actual transactions instead
# (see _compute_signals), so severities and labels reflect real values and vary
# per persona rather than being the same five constants for every user.
ANOMALOUS_SIGNALS = [
    {"id": "unknown_beneficiary",       "label": "Unknown Beneficiary",         "severity": 0.75, "color": "#ef4444"},
    {"id": "night_transfer",            "label": "Night Transfer (23:47)",       "severity": 0.55, "color": "#f97316"},
    {"id": "post_salary_velocity",      "label": "Post-Salary Velocity Spike",   "severity": 0.90, "color": "#ef4444"},
    {"id": "new_wallet_creation",       "label": "New Wallet Created",           "severity": 0.85, "color": "#ef4444"},
    {"id": "half_balance_transfer",     "label": "48% Balance Transferred",      "severity": 0.80, "color": "#ef4444"},
]

# Presentation metadata per signal id (colour only — labels are computed).
SIGNAL_COLOR = {
    "unknown_beneficiary":  "#ef4444",
    "night_transfer":       "#f97316",
    "post_salary_velocity": "#ef4444",
    "new_wallet_creation":  "#ef4444",
    "half_balance_transfer": "#ef4444",
    "rapid_fire_transfers": "#f97316",
    "device_change":        "#f59e0b",
    "benign_new_payee":     "#10b981",
}


def _persona(customer_id: str) -> str:
    """Classify the demo persona from the customer id so each profile tells a
    distinct risk story instead of all three sharing one hardcoded anomaly."""
    c = (customer_id or "").lower()
    if any(k in c for k in ("attack", "mule", "fraud", "hacker")):
        return "attacker"
    if any(k in c for k in ("coerc", "duress", "victim", "hostage")):
        return "coercion"
    return "legit"


def _fmt_inr(amount: int) -> str:
    return f"₹{amount:,.0f}"


def _severity_and_label(sig_id: str, txn: dict, monthly_income: int) -> tuple[float, str]:
    """Derive a signal's severity (0-1) and human label from the transaction's
    ACTUAL values, so the numbers are computed rather than hardcoded."""
    amt = int(txn.get("amount", 0) or 0)
    frac = (amt / monthly_income) if monthly_income else 0.0
    hour = int(txn.get("hour", 12) or 12)

    if sig_id == "unknown_beneficiary":
        sev = min(0.97, 0.45 + frac)  # bigger transfer to an unknown payee = worse
        return sev, f"Unknown Beneficiary ({_fmt_inr(amt)} to unverified payee)"
    if sig_id == "night_transfer":
        # deepest at ~02:00; tapers toward morning/evening
        depth = max(0.0, 1.0 - abs(hour - 2) / 6.0) if (hour >= 22 or hour <= 5) else 0.2
        return min(0.9, 0.35 + 0.5 * depth), f"Night Transfer ({hour:02d}:{txn.get('minute', 47):02d})"
    if sig_id == "half_balance_transfer":
        pct = round(frac * 100)
        return min(0.96, frac / 0.5 * 0.85), f"{pct}% Balance Transferred"
    if sig_id == "post_salary_velocity":
        return min(0.95, 0.55 + frac), "Post-Salary Velocity Spike"
    if sig_id == "new_wallet_creation":
        return 0.85, f"New Wallet Created ({txn.get('payee', 'wallet').replace('NewWallet_', '')})"
    if sig_id == "rapid_fire_transfers":
        n = int(txn.get("burst_count", 3))
        return min(0.7, 0.28 + 0.05 * n), f"Rapid-Fire Transfers ({n} in 60s)"
    if sig_id == "device_change":
        return 0.55, "New Device / Screen-Share Active"
    if sig_id == "benign_new_payee":
        return 0.12, f"New Payee Added ({_fmt_inr(amt)}, verified)"
    return 0.5, sig_id.replace("_", " ").title()


def _compute_signals(anomaly_txns: list[dict], monthly_income: int) -> list[dict]:
    """Aggregate the anomalous transactions into a de-duplicated, computed
    signal list (each signal keeps its highest-severity occurrence)."""
    agg: dict[str, tuple[float, str]] = {}
    for t in anomaly_txns:
        for sid in t.get("signals", []):
            sev, label = _severity_and_label(sid, t, monthly_income)
            if sid not in agg or sev > agg[sid][0]:
                agg[sid] = (sev, label)
    signals = [
        {"id": sid, "label": label, "severity": round(sev, 2), "color": SIGNAL_COLOR.get(sid, "#ef4444")}
        for sid, (sev, label) in agg.items()
    ]
    # Strongest signal first — drives the visual ordering.
    signals.sort(key=lambda s: s["severity"], reverse=True)
    return signals


def _gravity_from_signals(signals: list[dict], rng: random.Random) -> float:
    """Composite 0-100 gravity score: the dominant risk factor sets the band,
    with a small corroboration bonus per additional signal. This grades (a
    single moderate signal stays STEP-UP; several severe ones hit BLOCK) where a
    pure probabilistic-OR would saturate to ~100 on any 2+ signals. No signals →
    a low in-orbit score."""
    if not signals:
        return round(rng.uniform(6, 16), 1)
    top = max(s["severity"] for s in signals)
    corroboration = 0.045 * (len(signals) - 1)
    return round(min(1.0, top + corroboration) * 100, 1)


def _decision_for_score(score: float) -> str:
    if score >= 70:
        return "HARD_BLOCK"
    if score >= 40:
        return "STEP_UP"
    return "APPROVE"


def _anomaly_txns_for_persona(persona: str, rng: random.Random, monthly_income: int) -> list[dict]:
    """Build the current-month event transactions appropriate to the persona,
    so the three demo users tell genuinely different risk stories."""
    if persona == "attacker":
        return [
            {
                "payee": "UNKNOWN_BENE_" + rng.choice(["XYZ123", "ACC7721", "MULE_ACC"]),
                "category": "Transfer",
                "amount": int(monthly_income * rng.uniform(0.42, 0.52)),
                "hour": 23, "minute": rng.randint(40, 59),
                "is_known_payee": False, "anomalous": True,
                "signals": ["unknown_beneficiary", "night_transfer", "half_balance_transfer"],
            },
            {
                "payee": "NewWallet_" + rng.choice(["PhonePe", "Paytm", "GPay"]),
                "category": "Wallet Creation", "amount": 0, "hour": 23,
                "is_known_payee": False, "anomalous": True,
                "signals": ["new_wallet_creation"],
            },
            {
                "payee": "SELF_TRANSFER", "category": "Transfer",
                "amount": int(monthly_income * rng.uniform(0.12, 0.22)),
                "hour": 0, "minute": rng.randint(5, 30),
                "is_known_payee": False, "anomalous": True,
                "signals": ["post_salary_velocity"],
            },
        ]
    if persona == "coercion":
        # Duress: legitimate credentials, but behavioural stress markers — a
        # new-device/screen-share session plus an out-of-pattern late payment.
        # Moderate signals → STEP-UP (silent duress protocol), not a hard block
        # (hard-blocking a coerced user can escalate the situation).
        return [
            {
                "payee": "COERCED_PAYEE_" + rng.choice(["A88", "K12"]),
                "category": "Transfer",
                "amount": int(monthly_income * rng.uniform(0.16, 0.24)),
                "hour": 22, "minute": rng.randint(0, 59),
                "is_known_payee": False, "anomalous": True,
                "signals": ["device_change", "night_transfer"],
            },
        ]
    # legit: no orbit-breaking event — at most a small, verified new payee.
    if rng.random() < 0.5:
        return [
            {
                "payee": "Verified UPI Payee", "category": "Transfer",
                "amount": rng.randint(500, 2500), "hour": rng.randint(10, 20),
                "is_known_payee": True, "anomalous": False,
                "signals": ["benign_new_payee"],
            }
        ]
    return []


def _seed(customer_id: str) -> random.Random:
    """Return a seeded Random instance so the same customer always gets the same synthetic data."""
    digest = int(hashlib.sha256(customer_id.encode()).hexdigest(), 16) % (2**32)
    return random.Random(digest)


def _rebalance(pcts: dict[str, float]) -> dict[str, float]:
    """Nudge a category split to sum to 100% without leaving CATEGORY_BANDS.

    Scaling a free draw up to 100% (or letting one category swallow the
    remainder) pushes categories outside their band — Bank & Savings landed at
    42% against a 10-22 band — so the shortfall is spread across each
    category's remaining headroom in its own band instead.
    """
    pcts = dict(pcts)
    for _ in range(12):
        delta = 100.0 - sum(pcts.values())
        if abs(delta) < 0.05:
            break
        # Headroom in the direction we need to move.
        room = {
            cat: (CATEGORY_BANDS[cat][1] - p) if delta > 0 else (p - CATEGORY_BANDS[cat][0])
            for cat, p in pcts.items()
        }
        total_room = sum(room.values())
        if total_room <= 0:
            break
        for cat in pcts:
            pcts[cat] += delta * room[cat] / total_room
    return {cat: round(p, 1) for cat, p in pcts.items()}


def _draw_distribution(rng: random.Random) -> dict[str, float]:
    """Draw a category split that sums to 100% with every category in its band."""
    return _rebalance({cat: rng.uniform(*CATEGORY_BANDS[cat]) for cat in CATEGORIES})


def _generate_monthly_dna(rng: random.Random, monthly_income: int) -> dict:
    """Generate one month of spending DNA for a user."""
    distribution = _draw_distribution(rng)

    # Known payees: at least one merchant from every category the user spends
    # in, so the month's timeline covers the whole orbit rather than a random
    # slice of it.
    payees: list[str] = []
    for cat, entries in PAYEE_CATALOG.items():
        names = [p for p, _a, _h, _w, _c in entries]
        payees.extend(rng.sample(names, k=min(len(names), rng.randint(1, 3))))
    for fixed in RECURRING_PAYEES:
        if fixed not in payees:
            payees.append(fixed)

    # Typical hour distribution — 9am to 11pm active, peak at 7pm
    hour_weights = [0.0] * 24
    for h in range(9, 23):
        hour_weights[h] = math.exp(-0.5 * ((h - 19) / 4) ** 2)
    total_w = sum(hour_weights)
    hour_dist = [round(w / total_w * 100, 1) for w in hour_weights]

    used: dict[str, int] = {}

    def _txn(payee: str) -> dict:
        """Build one transaction, taking every field from the merchant's spec."""
        (amt_lo, amt_hi), (hr_lo, hr_hi), _weight, _cap = PAYEE_SPEC[payee]
        used[payee] = used.get(payee, 0) + 1
        return {
            "payee": payee,
            "category": PAYEE_CATEGORY[payee],
            "amount": rng.randint(amt_lo, amt_hi),
            "hour": rng.randint(hr_lo, hr_hi),
            # Known purely by whether the merchant is in this month's payee
            # list — the same merchant must not read as known on one row and
            # unknown on the next.
            "is_known_payee": payee in payees,
            "anomalous": False,
        }

    def _has_room(payee: str) -> bool:
        return used.get(payee, 0) < PAYEE_SPEC[payee][3]

    # Fixed monthly commitments first, then discretionary spend weighted by the
    # month's category distribution and each merchant's own frequency.
    transactions = [_txn(p) for p in RECURRING_PAYEES if p in payees]

    n_txns = rng.randint(12, 22) - len(transactions)
    for _ in range(max(n_txns, 0)):
        cat = rng.choices(CATEGORIES, weights=[distribution[c] for c in CATEGORIES])[0]
        in_cat = [p for p in payees if PAYEE_CATEGORY[p] == cat and _has_room(p)]
        if not in_cat:
            # Every known merchant in this category has hit its monthly cap, so
            # spend goes to one the user does not normally use.
            in_cat = [p for p, _a, _h, _w, _c in PAYEE_CATALOG[cat] if _has_room(p)]
        if not in_cat:
            continue
        payee = rng.choices(in_cat, weights=[PAYEE_SPEC[p][2] for p in in_cat])[0]
        transactions.append(_txn(payee))

    rng.shuffle(transactions)

    return {
        "distribution": distribution,
        "payees": payees,
        "hour_distribution": hour_dist,
        "transactions": transactions,
        "total_spent": sum(t["amount"] for t in transactions),
        "monthly_income": monthly_income,
    }


def _generate_anomaly_month(
    rng: random.Random, baseline_dna: dict, monthly_income: int, persona: str
) -> dict:
    """Generate the current-month event for this persona and compute its signals
    and gravity score from the actual transactions (not hardcoded constants)."""
    # Start with a mostly-normal month
    month = _generate_monthly_dna(rng, monthly_income)

    anomaly_txns = _anomaly_txns_for_persona(persona, rng, monthly_income)
    signals = _compute_signals(anomaly_txns, monthly_income)
    score = _gravity_from_signals(signals, rng)

    if anomaly_txns:
        month["transactions"] = anomaly_txns + month["transactions"][:8]
    month["has_anomaly"] = any(t.get("anomalous") for t in anomaly_txns)
    month["anomaly_signals"] = signals
    month["gravity_score"] = score
    month["decision"] = _decision_for_score(score)
    return month


def _generate_future_intent_dna(rng: random.Random, baseline_dna: dict, monthly_income: int) -> dict:
    """Generate a predicted Month +1 forecast based on past baseline DNA."""
    # Apply a slight utility seasonal adjustment (+1.5%) and nudge the rest,
    # then rebalance to 100% inside the bands — the same reason the monthly
    # draw does not let one category absorb the remainder.
    shifted: dict[str, float] = {}
    for cat in CATEGORIES:
        base_pct = baseline_dna.get(cat, 10.0)
        if cat == "Utilities":
            pct = base_pct + rng.uniform(1.0, 2.5)
        elif cat == "University Fees":
            pct = base_pct + rng.uniform(-1.0, 1.5)
        else:
            pct = base_pct + rng.uniform(-2.0, 1.0)
        lo, hi = CATEGORY_BANDS[cat]
        shifted[cat] = min(max(pct, lo), hi)
    distribution = _rebalance(shifted)

    # Predicted upcoming transactions (intended transactions). Each forecast
    # names a real merchant, so its category and ticket size come from that
    # merchant's spec rather than being drawn separately.
    def _predict(payee: str, day: int, probability: float, description: str) -> dict:
        (amt_lo, amt_hi), _hours, _weight, _cap = PAYEE_SPEC[payee]
        return {
            "payee": payee,
            "category": PAYEE_CATEGORY[payee],
            "amount": rng.randint(amt_lo, amt_hi),
            "predicted_day": day,
            "probability": probability,
            "description": description,
        }

    predicted_txns = [
        _predict(rng.choice(["PG Rent", "Hostel Fee"]), 2, 0.99, "Auto-recurring rental baseline"),
        _predict("Electricity Board", 7, 0.88, "Expected seasonal usage increase"),
        _predict("Mess Fee", 8, 0.94, "Fixed monthly mess billing"),
        _predict(rng.choice(["Tuition Fee", "Development Fee"]), 10, 0.76, "Cyclic term payment forecast"),
    ]

    return {
        "distribution": distribution,
        "predicted_transactions": predicted_txns,
        "month_label": "Next Month (Intent AI)",
        "month_index": 4,
        "gravity_score": round(rng.uniform(6, 15), 1),
        "decision": "APPROVE",
    }


def _build_profile(customer_id: str) -> dict:
    rng = _seed(customer_id)
    persona = _persona(customer_id)

    # User archetype — student/salaried
    monthly_income = rng.choice([25000, 32000, 40000, 45000, 55000])
    salary_credit_day = rng.randint(1, 5)

    months = []
    for i in range(3):
        m = _generate_monthly_dna(rng, monthly_income)
        m["month_label"] = ["3 Months Ago", "2 Months Ago", "Last Month"][i]
        m["month_index"] = i
        m["has_anomaly"] = False
        m["gravity_score"] = round(rng.uniform(8, 24), 1)
        m["decision"] = "APPROVE"
        months.append(m)

    # Month 4 = the persona's current-month event (attacker/coercion = anomaly,
    # legit = a clean month within orbit).
    anomaly = _generate_anomaly_month(rng, months[-1], monthly_income, persona)
    anomaly["month_label"] = (
        "This Month (ANOMALY)" if anomaly["has_anomaly"] else "This Month (WITHIN ORBIT)"
    )
    anomaly["month_index"] = 3

    # Compute baseline (average category distribution across 3 normal months)
    baseline: dict[str, float] = {}
    for cat in CATEGORIES:
        baseline[cat] = round(sum(m["distribution"].get(cat, 0) for m in months) / 3, 1)

    # All payees known across normal months
    all_known_payees: list[str] = []
    for m in months:
        all_known_payees.extend(m["payees"])
    all_known_payees = list(set(all_known_payees))

    # Generate prediction Month +1
    future_intent = _generate_future_intent_dna(rng, baseline, monthly_income)

    return {
        "customer_id": customer_id,
        "persona": persona,
        "monthly_income": monthly_income,
        "salary_credit_day": salary_credit_day,
        "baseline_distribution": baseline,
        "category_colors": CATEGORY_COLORS,
        "known_payees_count": len(all_known_payees),
        "months": months,
        "anomaly_month": anomaly,
        "anomaly_signals": anomaly["anomaly_signals"],
        "current_gravity_score": anomaly["gravity_score"],
        "current_decision": anomaly["decision"],
        "future_intent": future_intent,
    }


# ── Pydantic models ───────────────────────────────────────────────────────────

class EvaluateRequest(BaseModel):
    customer_id: Optional[str] = None
    amount: float
    hour: int                           # 0-23
    payee: str
    is_new_payee: bool = False
    is_wallet_creation: bool = False
    is_night_transfer: bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/profile/{customer_id}")
async def get_gravity_profile(
    customer_id: str,
    caller: AuthUser = Depends(get_current_user),
):
    """
    Return the Financial DNA profile for a user.

    Includes:
    - 3 months of normal spending history (seeded synthetic)
    - 1 anomalous month (the "orbit-breaking" event)
    - Baseline distribution across 6 spending categories
    - Current gravity score and decision
    """
    profile = _build_profile(customer_id)
    logger.info(
        "Financial Gravity profile fetched: customer=%s gravity_score=%.1f decision=%s",
        customer_id, profile["current_gravity_score"], profile["current_decision"],
    )
    return profile


@router.get("/profile")
async def get_own_gravity_profile(
    caller: AuthUser = Depends(get_current_user),
):
    """Return the gravity profile for the currently authenticated user."""
    profile = _build_profile(caller.customer_id)
    return profile


@router.post("/evaluate")
async def evaluate_transaction(
    request: EvaluateRequest,
    caller: AuthUser = Depends(get_current_user),
):
    """
    Evaluate a live transaction against the user's Financial Gravity baseline.

    Returns gravity_score (0-100), decision, and SHAP-style signal explanations.
    """
    cid = request.customer_id or caller.customer_id
    profile = _build_profile(cid)
    baseline = profile["baseline_distribution"]
    monthly_income = profile["monthly_income"]

    signals: list[dict] = []
    score_components: list[float] = []

    # Signal 1: Unknown payee
    if request.is_new_payee:
        signals.append({**ANOMALOUS_SIGNALS[0], "contribution": 0.75})
        score_components.append(0.75)

    # Signal 2: Night transfer (11 PM – 4 AM)
    if request.is_night_transfer or request.hour >= 23 or request.hour <= 4:
        signals.append({**ANOMALOUS_SIGNALS[1], "contribution": 0.55})
        score_components.append(0.55)

    # Signal 3: Post-salary velocity — large pct of income moved same day
    if request.amount > monthly_income * 0.35:
        signals.append({**ANOMALOUS_SIGNALS[2], "contribution": 0.90})
        score_components.append(0.90)

    # Signal 4: Wallet creation
    if request.is_wallet_creation:
        signals.append({**ANOMALOUS_SIGNALS[3], "contribution": 0.85})
        score_components.append(0.85)

    # Signal 5: Half-balance transfer
    if request.amount > monthly_income * 0.40:
        signals.append({**ANOMALOUS_SIGNALS[4], "contribution": 0.80})
        score_components.append(0.80)

    # Composite gravity score (0-100)
    if score_components:
        raw = 1.0 - math.prod(1.0 - c for c in score_components)
        gravity_score = round(raw * 100, 1)
    else:
        gravity_score = round(random.uniform(5, 20), 1)

    if gravity_score >= 70:
        decision = "HARD_BLOCK"
    elif gravity_score >= 40:
        decision = "STEP_UP"
    else:
        decision = "APPROVE"

    logger.info(
        "Financial Gravity eval: customer=%s amount=%.0f hour=%d score=%.1f decision=%s signals=%d",
        cid, request.amount, request.hour, gravity_score, decision, len(signals),
    )

    return {
        "customer_id": cid,
        "gravity_score": gravity_score,
        "decision": decision,
        "signals": signals,
        "baseline_summary": {
            cat: f"{baseline.get(cat, 0):.1f}%" for cat in CATEGORIES
        },
        "monthly_income": monthly_income,
        "explanation": (
            "Transaction breaks the user's established financial orbit: "
            + ", ".join(s["label"] for s in signals)
        ) if signals else "Transaction consistent with historical spending pattern.",
    }
