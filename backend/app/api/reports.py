import io
import json
import logging
import math
import datetime
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from redis.asyncio import Redis
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

from app.core.security import AuthUser, get_current_user
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)
router = APIRouter()

class PDFReportRequest(BaseModel):
    account: dict
    dnaEvents: list
    riskScore: int
    decision: str
    signals: dict
    coercionProb: float
    onChain: bool
    session_id: str

def compute_advanced_metrics(raw_signals):
    """Compute deeper biometric metrics from raw telemetry"""
    metrics = {
        "tcv": 0.0, # Typing Cadence Variability (ms)
        "cpl": 0.0, # Cursor Path Linearity (0.0 to 1.0)
        "velocity": 0.0, # Events per second
        "clipboard_ratio": 0.0, 
    }
    
    if not raw_signals:
        return metrics
        
    keystrokes = raw_signals.get("keystroke_events", [])
    mouse_events = raw_signals.get("mouse_events", [])
    
    # 1. Typing Cadence Variability (TCV)
    dwell_times = [k.get("dwellTime") for k in keystrokes if k.get("dwellTime")]
    if len(dwell_times) > 1:
        mean = sum(dwell_times) / len(dwell_times)
        variance = sum((x - mean) ** 2 for x in dwell_times) / len(dwell_times)
        metrics["tcv"] = math.sqrt(variance)
        
    # 2. Cursor Path Linearity (CPL)
    if len(mouse_events) > 2:
        total_distance = 0
        for i in range(1, len(mouse_events)):
            dx = mouse_events[i].get("x", 0) - mouse_events[i-1].get("x", 0)
            dy = mouse_events[i].get("y", 0) - mouse_events[i-1].get("y", 0)
            total_distance += math.sqrt(dx*dx + dy*dy)
            
        start = mouse_events[0]
        end = mouse_events[-1]
        displacement = math.sqrt((end.get("x", 0) - start.get("x", 0))**2 + (end.get("y", 0) - start.get("y", 0))**2)
        
        if total_distance > 0:
            metrics["cpl"] = displacement / total_distance
            
    # 3. Velocity
    timestamps = [k.get("timestamp") for k in keystrokes] + [m.get("timestamp") for m in mouse_events]
    if len(timestamps) > 1:
        duration_sec = (max(timestamps) - min(timestamps)) / 1000.0
        if duration_sec > 0:
            metrics["velocity"] = len(timestamps) / duration_sec
            
    return metrics

@router.post("/generate-pdf")
async def generate_pdf_report(
    request: PDFReportRequest,
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(get_current_user),
):
    """Generate a highly professional Bank Audit Report using Matplotlib."""
    # 1. Fetch raw signals from Redis
    raw_signals_str = await redis.get(f"session:{request.session_id}:signals")
    raw_signals = json.loads(raw_signals_str) if raw_signals_str else {}
    adv_metrics = compute_advanced_metrics(raw_signals)
    
    # Create matplotlib figure with corporate aesthetic
    plt.style.use('dark_background')
    fig = plt.figure(figsize=(9, 12), facecolor='#080b17')
    gs = gridspec.GridSpec(5, 2, height_ratios=[1, 1.2, 1.5, 1, 1.5])
    
    # ── TITLE BANNER ──
    ax_title = fig.add_subplot(gs[0, :])
    ax_title.axis('off')
    ax_title.text(0.02, 0.7, "Global Compliance & Security Division", color='#b3965b', fontsize=10, fontweight='bold', textcoords='axes fraction')
    ax_title.text(0.02, 0.4, "CITADEL™ INCIDENT AUDIT REPORT", color='white', fontsize=22, fontweight='heavy', textcoords='axes fraction')
    ax_title.text(0.02, 0.15, f"Date: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}", color='#737a91', fontsize=9, textcoords='axes fraction')
    ax_title.plot([0.02, 0.98], [0.05, 0.05], color='#b3965b', lw=2, transform=ax_title.transAxes) # Gold separator
    
    # ── METADATA TABLE ──
    ax_meta = fig.add_subplot(gs[1, :])
    ax_meta.axis('off')
    ax_meta.text(0.02, 0.95, "1. SESSION CONTEXT & METADATA", color='white', fontsize=12, fontweight='bold', transform=ax_meta.transAxes)
    
    meta_data = [
        ["Target Account Name", request.account.get('name', 'Unknown')],
        ["Account UUID", request.account.get('id', 'N/A')],
        ["Session ID", request.session_id],
        ["Fabric Blockchain Link", "COMMITTED" if request.onChain else "PENDING"],
    ]
    table1 = ax_meta.table(cellText=meta_data, colWidths=[0.3, 0.7], loc='center', cellLoc='left')
    table1.auto_set_font_size(False)
    table1.set_fontsize(10)
    table1.scale(1, 1.8)
    for (row, col), cell in table1.get_celld().items():
        cell.set_edgecolor('#22283a')
        if col == 0:
            cell.set_facecolor('#111524')
            cell.set_text_props(color='#8289a0', weight='bold')
        else:
            cell.set_facecolor('#0d111d')
            cell.set_text_props(color='white')
            
    # ── BEHAVIORAL METRICS CHART (RADAR OR BAR) ──
    ax_chart = fig.add_subplot(gs[2, 0])
    ax_chart.set_facecolor('#0d111d')
    ax_chart.set_title("2. BIOMETRIC RISK INDICES", color='white', pad=20, weight='bold')
    
    # We will draw a horizontal bar chart of the risk factors
    metrics_labels = ['Risk Score', 'Coercion Prob', 'Typing Var (TCV)', 'Cursor Path (CPL)', 'Velocity']
    # Normalize metrics roughly to 0-100% scale for visualization
    tcv_norm = min((adv_metrics['tcv'] / 50.0) * 100, 100) if adv_metrics['tcv'] > 0 else 0
    cpl_norm = adv_metrics['cpl'] * 100
    vel_norm = min(adv_metrics['velocity'] * 5, 100)
    
    metrics_vals = [
        min(request.riskScore / 10, 100), 
        request.coercionProb * 100,
        tcv_norm,
        cpl_norm,
        vel_norm
    ]
    
    colors = []
    for v in metrics_vals:
        if v > 75:
            colors.append('#e33a46')  # Red
        elif v > 40:
            colors.append('#d6a848')  # Gold
        else:
            colors.append('#2f8f5b')  # Green
        
    ax_chart.barh(metrics_labels, metrics_vals, color=colors, edgecolor='#1b2136')
    ax_chart.set_xlim(0, 100)
    ax_chart.spines['top'].set_visible(False)
    ax_chart.spines['right'].set_visible(False)
    ax_chart.spines['bottom'].set_color('#22283a')
    ax_chart.spines['left'].set_color('#22283a')
    ax_chart.tick_params(colors='#8289a0')
    
    # ── ADVANCED TELEMETRY ──
    ax_tele = fig.add_subplot(gs[2, 1])
    ax_tele.axis('off')
    ax_tele.text(0.1, 0.9, "DETAILED BIOMETRIC READINGS", color='white', fontsize=10, fontweight='bold', transform=ax_tele.transAxes)
    tele_text = (
        f"• Keystroke Events: {request.signals.get('ks', 0)}\n\n"
        f"• Mouse Path Points: {request.signals.get('mouse', 0)}\n\n"
        f"• Typing Cadence Var: {adv_metrics['tcv']:.1f}ms\n\n"
        f"• Cursor Linearity: {adv_metrics['cpl']:.2f}\n\n"
        f"• Interaction Velocity: {adv_metrics['velocity']:.1f} ev/sec"
    )
    ax_tele.text(0.1, 0.3, tele_text, color='#aeb4c6', fontsize=11, transform=ax_tele.transAxes, linespacing=1.6)
    
    # ── THREAT DECISION ──
    ax_dec = fig.add_subplot(gs[3, :])
    ax_dec.axis('off')
    dec_color = '#e33a46' if request.decision == 'HARD_BLOCK' else '#d6a848' if request.decision == 'STEP_UP' else '#2f8f5b'
    box = dict(boxstyle='round,pad=0.5', facecolor='#111524', edgecolor=dec_color, lw=2)
    ax_dec.text(0.5, 0.5, f"SYSTEM DECISION: {request.decision}", color=dec_color, fontsize=18, fontweight='bold', ha='center', va='center', bbox=box, transform=ax_dec.transAxes)
    
    # ── INCIDENT TIMELINE ──
    ax_time = fig.add_subplot(gs[4, :])
    ax_time.axis('off')
    ax_time.text(0.02, 0.9, "3. INTEGRITY LOG (LAST 8 EVENTS)", color='white', fontsize=12, fontweight='bold', transform=ax_time.transAxes)
    
    timeline_data = []
    for ev in request.dnaEvents[-8:]:
        prefix = "[BLOCKED]" if ev.get('level') == 'block' else "[ALERT]" if ev.get('level') == 'alert' else "[WARN]" if ev.get('level') == 'warn' else "[OK]"
        safe_msg = ''.join([c for c in ev.get('msg', '') if ord(c) < 128])
        timeline_data.append([ev.get('time', ''), prefix, safe_msg])
        
    if not timeline_data:
        timeline_data = [["-", "-", "No events recorded"]]
        
    table2 = ax_time.table(cellText=timeline_data, colWidths=[0.15, 0.15, 0.7], loc='center', cellLoc='left')
    table2.auto_set_font_size(False)
    table2.set_fontsize(9)
    table2.scale(1, 1.4)
    for (row, col), cell in table2.get_celld().items():
        cell.set_edgecolor('#22283a')
        cell.set_facecolor('#080b17')
        cell.set_text_props(color='#aeb4c6')
        
    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format='pdf', facecolor=fig.get_facecolor(), edgecolor='none', bbox_inches='tight')
    plt.close(fig)
    
    return Response(content=buf.getvalue(), media_type="application/pdf")
