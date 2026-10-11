"""Lightweight variance-explanation agent.

The agent is deliberately deterministic: every number in an answer comes from the
fitted models in ``forecast.py``. An LLM is optional and only rewrites the finished
facts into a short summary. Set GEMINI_API_KEY (free tier) or ANTHROPIC_API_KEY to enable
it. If the call fails or the quota is hit, the rule-based answer is returned unchanged.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

from .forecast import FEATURES, LABELS, UNITS, ForecastModel

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

LIMITATIONS = [
    "60 rows over 30 days, with only 3 outage rows. The outage effect is clear; irradiance, wind and temperature effects are not statistically reliable.",
    "Attribution is linear and additive. It cannot capture interactions such as wind curtailment during a grid constraint.",
    "No site column: repeated dates are treated as two parallel blocks (A and B) in order of appearance.",
    "Weather inputs are observed values, not the forecast values the operator used, so weather forecast error cannot be separated from model error.",
    "Dummy data. Treat results as a demonstration of the method, not as plant performance.",
]


def _find_rows(model: ForecastModel, q: str):
    """Return (rows, notes) matching a date and/or block mentioned in the question."""
    df, notes = model.df, []
    year = int(df["date"].dt.year.iloc[0])
    date = None
    if m := re.search(r"(\d{4})-(\d{2})-(\d{2})", q):
        date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    elif m := re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b", q):
        date = f"{year}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"
    elif m := re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)", q):
        date = f"{year}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"
    rows = df
    if date:
        rows = rows[rows["date"].dt.strftime("%Y-%m-%d") == date]
        notes.append(f"Matched date {date}: {len(rows)} row(s).")
    if m := re.search(r"\bblock\s+([a-z])\b", q):
        rows = rows[rows["block"] == m.group(1).upper()]
        notes.append(f"Filtered to block {m.group(1).upper()}.")
    return (rows if notes else None), date, notes


def _drivers_text(step_list, top=2, outage=False):
    named = [s for s in step_list if s["key"] in FEATURES and (outage or s["key"] != "outage_flag")]
    named.sort(key=lambda s: abs(s["value"]), reverse=True)
    parts = []
    for s in named[:top]:
        if abs(s["value"]) < 0.5:
            continue
        verb = "added" if s["value"] > 0 else "removed"
        parts.append(f"{s['label'].lower()} {verb} about {abs(s['value']):.1f} MWh")
    return parts


def describe_row(model: ForecastModel, row_id: int) -> str:
    e = model.explain_row(row_id)
    err = e["error_mwh"]
    direction = "shortfall" if err < 0 else "surplus"
    pct = abs(err) / e["forecast_mwh"] * 100
    text = (
        f"On {e['date']} (block {e['block']}) actual output was {e['actual_mwh']:.1f} MWh against a "
        f"{e['forecast_mwh']:.1f} MWh forecast: a {abs(err):.1f} MWh {direction} ({pct:.0f}% of forecast)."
    )
    parts = _drivers_text(e["steps"])
    if e["inputs"]["outage_flag"] == 1:
        out = next(s for s in e["steps"] if s["key"] == "outage_flag")
        parts.insert(0, f"the outage flag explains about {abs(out['value']):.1f} MWh of the miss")
    if parts:
        joined = "; ".join(parts)
        text += " " + joined[0].upper() + joined[1:] + "."
    un = next(s for s in e["steps"] if s["key"] == "unexplained")
    if abs(un["value"]) > abs(err) * 0.5 and abs(un["value"]) > 3:
        text += f" About {abs(un['value']):.1f} MWh is not explained by the available inputs."
    return text


def _driver_summary(model: ForecastModel) -> str:
    ds = model.drivers()
    reliable = [d for d in ds if d["reliable"]]
    weak = [d["label"].lower() for d in ds if not d["reliable"]]
    lines = []
    for d in reliable:
        lines.append(
            f"{d['label']} is {'the only' if len(reliable) == 1 else 'a'} reliable driver: an outage day averages {abs(d['coef']):.1f} MWh "
            f"{'below' if d['coef'] < 0 else 'above'} forecast (90% interval {d['ci_low']:.1f} to {d['ci_high']:.1f})."
        )
    if weak:
        lines.append(f"The effects of {', '.join(weak)} are small and their intervals include zero.")
    lines.append(f"Together the inputs explain {model.error_r2 * 100:.0f}% of the variance in forecast error.")
    return " ".join(lines)


def run(model: ForecastModel, question: str, use_llm: bool = True) -> dict:
    q = (question or "").strip()
    ql = q.lower()
    steps = [f"Read the question: {q!r}" if q else "No question given; defaulting to an overall summary."]
    df = model.df

    rows, date, notes = _find_rows(model, ql)
    steps += notes
    mentioned = [f for f, key in [
        ("irradiance_wm2", "irradi"), ("wind_speed_ms", "wind"), ("temperature_c", "temp"), ("outage_flag", "outage")
    ] if key in ql]

    if rows is not None and len(rows) > 0:
        intent = "row"
        ids = rows["row_id"].tolist()
        answer = " ".join(describe_row(model, i) for i in ids)
        steps.append("Split each miss into typical bias, driver effects and an unexplained remainder.")
    elif rows is not None:
        intent = "not_found"
        ids = []
        answer = (f"There is no data for {date or 'that block'}. "
                  f"The file covers {df['date'].min():%Y-%m-%d} to {df['date'].max():%Y-%m-%d}.")
    elif re.search(r"worst|largest|biggest|top|miss", ql) and "outage" not in ql:
        intent = "top_misses"
        n = int(m.group(1)) if (m := re.search(r"\b(?:top\s+)?(\d{1,2})\b", ql)) else 3
        ids = df.reindex(df["error_mwh"].abs().sort_values(ascending=False).index)["row_id"].head(min(max(n, 1), 8)).tolist()
        steps.append(f"Ranked all {len(df)} rows by absolute forecast error and took the top {len(ids)}.")
        answer = " ".join(describe_row(model, i) for i in ids)
    elif "outage" in ql:
        intent = "outage"
        o = df[df["outage_flag"] == 1]
        ids = o["row_id"].tolist()
        steps.append(f"Selected the {len(o)} rows with outage_flag = 1.")
        d = next(x for x in model.drivers() if x["key"] == "outage_flag")
        answer = (
            f"{len(o)} rows have an outage flag. They missed forecast by {o['error_mwh'].mean():.1f} MWh on average, "
            f"against {df[df['outage_flag'] == 0]['error_mwh'].mean():+.1f} MWh on normal days. "
            f"The fitted outage effect is {d['coef']:.1f} MWh (90% interval {d['ci_low']:.1f} to {d['ci_high']:.1f})."
        )
    elif mentioned:
        intent = "driver"
        ids = []
        ds = {d["key"]: d for d in model.drivers()}
        parts = []
        for f in mentioned:
            d = ds[f]
            unit = f" per {d['unit']}" if d["unit"] else ""
            rel = "reliable" if d["reliable"] else "not statistically reliable"
            parts.append(f"{d['label']}: {d['coef']:+.3f} MWh{unit}, 90% interval {d['ci_low']:.3f} to {d['ci_high']:.3f} ({rel}).")
        steps.append("Looked up the fitted error-model coefficient and bootstrap interval for each named driver.")
        answer = " ".join(parts)
    else:
        intent = "summary"
        ids = df.reindex(df["error_mwh"].abs().sort_values(ascending=False).index)["row_id"].head(3).tolist()
        steps.append("Fitted a linear error model on weather inputs and the outage flag; bootstrapped the coefficients.")
        answer = _driver_summary(model)

    evidence = [model.explain_row(i) for i in ids[:6]]
    metrics = model.metrics()["table"]
    result = {
        "input": question,
        "intent": intent,
        "result": answer,
        "mode": "rules",
        "reasoning_steps": steps,
        "evidence": evidence,
        "metrics": metrics,
        "limitations": LIMITATIONS,
    }
    polished = _llm_rewrite(q, answer) if use_llm else None
    if polished:
        result["result"], result["mode"] = polished, "llm"
        result["reasoning_steps"].append("Rewrote the computed findings as a short summary with an LLM (numbers unchanged).")
    return result


_PROMPT = (
    "Rewrite these computed findings as a clear 2-4 sentence answer for a plant operations analyst. "
    "Use only the numbers given. Do not add causes that are not stated.\n\n"
    "Question: {question}\nFindings: {facts}"
)
_CACHE: dict[tuple[str, str], str] = {}  # only successful rewrites are cached, so a 429 is retried later


def _post_json(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def _gemini(prompt: str, key: str) -> str | None:
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024},
    }
    data = _post_json(url, body, {"x-goog-api-key": key})
    parts = data["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts).strip() or None


def _anthropic(prompt: str, key: str) -> str | None:
    body = {
        "model": os.environ.get("LLM_MODEL", "claude-sonnet-5-5"),
        "max_tokens": 300,
        "messages": [{"role": "user", "content": prompt}],
    }
    data = _post_json("https://api.anthropic.com/v1/messages", body, {"x-api-key": key, "anthropic-version": "2023-06-01"})
    return "".join(b.get("text", "") for b in data.get("content", [])).strip() or None


def _llm_rewrite(question: str, facts: str) -> str | None:
    gemini_key, anthropic_key = os.environ.get("GEMINI_API_KEY"), os.environ.get("ANTHROPIC_API_KEY")
    if not (gemini_key or anthropic_key):
        return None
    cache_key = (question, facts)
    if cache_key in _CACHE:
        return _CACHE[cache_key]
    prompt = _PROMPT.format(question=question or "(none)", facts=facts)
    try:
        text = _gemini(prompt, gemini_key) if gemini_key else _anthropic(prompt, anthropic_key)
    except Exception:
        return None
    if text:
        _CACHE[cache_key] = text
    return text
