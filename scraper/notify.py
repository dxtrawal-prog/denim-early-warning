"""
Send push notifications when tier status changes to amber/red.
Calls the Next.js /api/push/notify endpoint.
"""

import os

try:
    from curl_cffi import requests as cffi_requests
    _session = cffi_requests.Session(impersonate="chrome")
except ImportError:
    import requests as _fallback_requests
    _session = None

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000")


def send_alert(tier: str, level: str, avg_z: float, signals: list[dict]):
    """Send a push notification for a tier alert. Best-effort, never raises."""
    try:
        top_signals = sorted(signals, key=lambda s: abs(s.get("z", 0)), reverse=True)[:3]
        signal_text = ", ".join(
            f"{s['name']} ({s.get('z', 0):.2f}z)" for s in top_signals
        )

        title = f"⚠️ Denim Alert: Tier {tier} → {level.upper()}"
        body = f"z={avg_z:.2f} | Top signals: {signal_text}"

        url = f"{DASHBOARD_URL}/api/push/notify"
        payload = {"title": title, "body": body, "tag": f"tier-{tier}-{level}"}

        if _session:
            resp = _session.post(url, json=payload, timeout=10)
        else:
            resp = _fallback_requests.post(url, json=payload, timeout=10)

        if resp.status_code == 200:
            data = resp.json()
            print(f"  [push] sent to {data.get('sent', 0)} subscriber(s)")
        else:
            print(f"  [push] failed: HTTP {resp.status_code}")
    except Exception as e:
        print(f"  [push] error (non-fatal): {e}")
