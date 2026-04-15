"""
Sizing optimization study.

Replays enriched historical trades under a fixed exit ladder while sweeping
the sizing distance. The cut price (plannedCut) stays fixed; varying the
sizing changes share count, where 1R/2R targets land, and how much loss is
realized when the cut fires.

Exit ladder (universal, applied to every simulated trade):
  1. Sell 1/2 at +1R
  2. Sell 1/2 of the remainder (= 1/4 of original) at +2R
  3. Trail the remaining 1/4 with 20-day EMA on the underlying;
     exit on the first daily close beyond it
  4. Hard stop at plannedCut: exit ALL remaining shares at the cut price

Same-day stop+target collisions: stop fires first (conservative).
Same-day 1R+2R collisions: both fill on the same bar.

Reads:  data.json, ohlc.json
Writes: sizing_runs.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
DATA_PATH = ROOT / "data.json"
OHLC_PATH = ROOT / "ohlc.json"
RUNS_PATH = ROOT / "sizing_runs.json"

LOOKAHEAD_BARS = 60   # max trading days the simulator walks past entry
EMA_PERIOD = 20


# ------------------------------------------------------------ data loading

def load_inputs():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    with open(OHLC_PATH, "r", encoding="utf-8") as f:
        ohlc = json.load(f)
    trades = data["regimeTrades"]["regime8"]
    return trades, ohlc


def filter_enriched(trades, ohlc):
    """Keep only trades the simulator can replay."""
    out = []
    skipped = {"missing_fields": 0, "missing_ohlc": 0, "bad_distance": 0}
    for t in trades:
        if (
            t.get("riskDollars") is None
            or t.get("plannedEntry") is None
            or t.get("plannedStop") is None
            or t.get("plannedCut") is None
        ):
            skipped["missing_fields"] += 1
            continue
        if t["symbol"] not in ohlc:
            skipped["missing_ohlc"] += 1
            continue
        if abs(t["plannedEntry"] - t["plannedStop"]) <= 0:
            skipped["bad_distance"] += 1
            continue
        out.append(t)
    return out, skipped


# ------------------------------------------------------------ EMA cache

def compute_ema(closes, period=EMA_PERIOD):
    """Standard EMA seeded with SMA of first `period` bars."""
    n = len(closes)
    out = [None] * n
    if n < period:
        return out
    alpha = 2.0 / (period + 1)
    sma = sum(closes[:period]) / period
    out[period - 1] = sma
    for i in range(period, n):
        out[i] = alpha * closes[i] + (1 - alpha) * out[i - 1]
    return out


def build_ema_cache(ohlc):
    cache = {}
    for sym, bars in ohlc.items():
        closes = [b["c"] for b in bars]
        cache[sym] = compute_ema(closes, EMA_PERIOD)
    return cache


# ------------------------------------------------------------ trade simulator

def find_entry_index(bars, entry_date):
    lo, hi = 0, len(bars)
    while lo < hi:
        mid = (lo + hi) // 2
        if bars[mid]["t"] < entry_date:
            lo = mid + 1
        else:
            hi = mid
    return lo if lo < len(bars) else None


def simulate_trade(trade, sizing_pct, bars, ema20, cut_pct=None):
    """
    Returns dict: {pnl, r, holding_days, exit_reason, stopped, tranches_filled, shares}
    or None if unsimulatable.

    If cut_pct is None, the historical mothersheet plannedCut is used (1D mode).
    If cut_pct is a number, the hard stop is recomputed as
    entry +/- cut_pct * deep_distance (2D mode).
    """
    side = 1 if trade["side"] == "Buy" else -1
    entry = float(trade["plannedEntry"])
    risk = float(trade["riskDollars"])
    deep_dist = abs(entry - float(trade["plannedStop"]))
    if deep_dist <= 0 or risk <= 0:
        return None

    if cut_pct is None:
        cut = float(trade["plannedCut"])
    else:
        cut = entry - side * cut_pct * deep_dist  # cut sits adverse-side of entry

    sd = sizing_pct * deep_dist
    if sd <= 0:
        return None

    shares = risk / sd
    t1 = entry + side * sd
    t2 = entry + side * 2 * sd

    si = find_entry_index(bars, trade["entryDate"])
    if si is None:
        return None

    # Detect price-scale mismatch (e.g. split-adjusted OHLC vs unadjusted planned price)
    # and rescale bars in the simulator's window by entry / entry-day-open.
    entry_bar = bars[si]
    if entry_bar["o"] and entry_bar["o"] > 0:
        scale = entry / entry_bar["o"]
    else:
        scale = 1.0
    if 0.83 <= scale <= 1.2:
        scale = 1.0   # within tolerance — no adjustment needed

    state = "open"   # open -> after_1R -> after_2R (trailing) -> closed
    realized = 0.0
    exit_date = trade["entryDate"]
    exit_reason = "time-out"
    tranches = 0
    last_idx = si

    end = min(si + LOOKAHEAD_BARS, len(bars))
    j = si
    while j < end:
        b = bars[j]
        h = b["h"] * scale
        l = b["l"] * scale
        c = b["c"] * scale
        last_idx = j

        if state == "after_2R":
            # Pure trail mode on subsequent bars only. Stop still applies.
            stop_hit = (l <= cut) if side > 0 else (h >= cut)
            if stop_hit:
                remain = shares * 0.25
                realized += side * (cut - entry) * remain
                state = "closed"
                exit_date = b["t"]
                exit_reason = "stop_in_trail"
                break
            ema = ema20[j]
            if ema is not None:
                ema = ema * scale
                exited = (c < ema) if side > 0 else (c > ema)
                if exited:
                    remain = shares * 0.25
                    realized += side * (c - entry) * remain
                    state = "closed"
                    exit_date = b["t"]
                    exit_reason = "trail_ema20"
                    break
            j += 1
            continue

        # Conservative stop check first
        stop_hit = (l <= cut) if side > 0 else (h >= cut)
        if stop_hit:
            remain = shares if state == "open" else shares * 0.5
            realized += side * (cut - entry) * remain
            state = "closed"
            exit_date = b["t"]
            exit_reason = "stop"
            break

        # 1R fill
        if state == "open":
            hit1 = (h >= t1) if side > 0 else (l <= t1)
            if hit1:
                qty1 = shares * 0.5
                realized += side * (t1 - entry) * qty1
                state = "after_1R"
                tranches = 1

        # 2R fill (same bar permitted)
        if state == "after_1R":
            hit2 = (h >= t2) if side > 0 else (l <= t2)
            if hit2:
                qty2 = shares * 0.25
                realized += side * (t2 - entry) * qty2
                state = "after_2R"
                tranches = 2

        j += 1

    # Time-out force close (whatever remains, mark to last close)
    if state != "closed":
        bar = bars[last_idx]
        last_close = bar["c"] * scale
        if state == "open":
            remain = shares
        elif state == "after_1R":
            remain = shares * 0.5
        else:  # after_2R
            remain = shares * 0.25
        realized += side * (last_close - entry) * remain
        exit_date = bar["t"]
        exit_reason = "time-out"
        state = "closed"

    try:
        d0 = date.fromisoformat(trade["entryDate"])
        d1 = date.fromisoformat(exit_date)
        holding = max(0, (d1 - d0).days)
    except Exception:
        holding = 0

    return {
        "pnl": realized,
        "r": realized / risk,
        "holding_days": holding,
        "exit_reason": exit_reason,
        "stopped": exit_reason in ("stop", "stop_in_trail"),
        "tranches_filled": tranches,
        "shares": shares,
    }


# ------------------------------------------------------------ run aggregation

def run_one(trades, ohlc, ema_cache, sizing_pct, note="", is_baseline=False, idx=0, cut_pct=None):
    sims = []
    skipped = 0
    for t in trades:
        bars = ohlc[t["symbol"]]
        ema = ema_cache[t["symbol"]]
        s = simulate_trade(t, sizing_pct, bars, ema, cut_pct=cut_pct)
        if s is None:
            skipped += 1
            continue
        sims.append((t, s))

    n = len(sims)
    if n == 0:
        return None

    pnls = [s["pnl"] for _, s in sims]
    rs = [s["r"] for _, s in sims]
    holds = [s["holding_days"] for _, s in sims]
    wins = [s for _, s in sims if s["pnl"] > 0]
    losses = [s for _, s in sims if s["pnl"] <= 0]
    stops = sum(1 for _, s in sims if s["stopped"])
    t1_filled = sum(1 for _, s in sims if s["tranches_filled"] >= 1)
    t2_filled = sum(1 for _, s in sims if s["tranches_filled"] >= 2)
    gross_win = sum(s["pnl"] for _, s in sims if s["pnl"] > 0)
    gross_loss = -sum(s["pnl"] for _, s in sims if s["pnl"] < 0)

    aggregate = {
        "trades_simulated": n,
        "trades_skipped": skipped,
        "total_pnl": round(sum(pnls), 2),
        "expectancy_R": round(sum(rs) / n, 4),
        "win_rate": round(len(wins) / n, 4),
        "profit_factor": round(gross_win / gross_loss, 3) if gross_loss > 0 else None,
        "stop_outs": stops,
        "stop_out_rate": round(stops / n, 4),
        "avg_holding_days": round(sum(holds) / n, 2),
        "tranche_fill_rate_1R": round(t1_filled / n, 4),
        "tranche_fill_rate_2R": round(t2_filled / n, 4),
        "avg_shares_per_trade": round(sum(s["shares"] for _, s in sims) / n, 1),
    }

    # Per-strategy
    by_strat = defaultdict(list)
    for t, s in sims:
        key = t.get("primaryStrategy") or "(none)"
        by_strat[key].append((t, s))

    per_strategy = []
    for strat, items in sorted(by_strat.items()):
        m = len(items)
        rs_s = [s["r"] for _, s in items]
        wins_s = [s for _, s in items if s["pnl"] > 0]
        stops_s = sum(1 for _, s in items if s["stopped"])
        holds_s = [s["holding_days"] for _, s in items]
        per_strategy.append({
            "strategy": strat,
            "trades": m,
            "expectancy_R": round(sum(rs_s) / m, 4),
            "win_rate": round(len(wins_s) / m, 4),
            "stop_outs": stops_s,
            "avg_holding_days": round(sum(holds_s) / m, 2),
            "total_pnl": round(sum(s["pnl"] for _, s in items), 2),
        })

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rid = f"run_{ts}_{idx:03d}"
    params = {"sizing_pct": round(sizing_pct, 4)}
    if cut_pct is not None:
        params["cut_pct"] = round(cut_pct, 4)
    else:
        params["cut_pct"] = None  # historical plannedCut
    return {
        "id": rid,
        "timestamp": ts,
        "is_baseline": bool(is_baseline),
        "params": params,
        "note": note,
        "aggregate": aggregate,
        "per_strategy": per_strategy,
        "deltas_vs_baseline": None,
        "notable_shifts": [],
    }


# ------------------------------------------------------------ deltas

def attach_deltas(runs, baseline):
    b = baseline["aggregate"]
    by_strat_b = {s["strategy"]: s for s in baseline["per_strategy"]}
    for r in runs:
        if r is baseline:
            r["deltas_vs_baseline"] = {
                "expectancy_R": 0.0, "stop_outs": 0, "avg_holding_days": 0.0,
                "total_pnl": 0.0, "win_rate": 0.0,
            }
            continue
        a = r["aggregate"]
        r["deltas_vs_baseline"] = {
            "expectancy_R": round(a["expectancy_R"] - b["expectancy_R"], 4),
            "stop_outs": a["stop_outs"] - b["stop_outs"],
            "avg_holding_days": round(a["avg_holding_days"] - b["avg_holding_days"], 2),
            "total_pnl": round(a["total_pnl"] - b["total_pnl"], 2),
            "win_rate": round(a["win_rate"] - b["win_rate"], 4),
        }
        for s in r["per_strategy"]:
            base = by_strat_b.get(s["strategy"])
            if base:
                s["delta_expectancy_R"] = round(s["expectancy_R"] - base["expectancy_R"], 4)
                s["delta_stop_outs"] = s["stop_outs"] - base["stop_outs"]
                s["delta_avg_holding_days"] = round(s["avg_holding_days"] - base["avg_holding_days"], 2)
                s["delta_total_pnl"] = round(s["total_pnl"] - base["total_pnl"], 2)
            else:
                s["delta_expectancy_R"] = None
                s["delta_stop_outs"] = None
                s["delta_avg_holding_days"] = None
                s["delta_total_pnl"] = None

        movers = sorted(
            [s for s in r["per_strategy"] if s.get("delta_expectancy_R") is not None and s["trades"] >= 5],
            key=lambda s: s["delta_expectancy_R"], reverse=True,
        )
        notable = []
        if movers:
            top = movers[0]
            if top["delta_expectancy_R"] >= 0.10:
                notable.append(
                    f"{top['strategy']} expectancy jumped {top['delta_expectancy_R']:+.2f}R (best mover)"
                )
            bot = movers[-1]
            if bot is not top and bot["delta_expectancy_R"] <= -0.10:
                notable.append(
                    f"{bot['strategy']} expectancy dropped {bot['delta_expectancy_R']:+.2f}R (worst mover)"
                )
        d = r["deltas_vs_baseline"]
        if abs(d["avg_holding_days"]) >= 0.5:
            verb = "compressed" if d["avg_holding_days"] < 0 else "extended"
            notable.append(
                f"Avg holding period {verb} by {abs(d['avg_holding_days']):.1f} days fund-wide"
            )
        if abs(d["stop_outs"]) >= 5:
            verb = "increased" if d["stop_outs"] > 0 else "decreased"
            pct = (100 * d["stop_outs"] / b["stop_outs"]) if b["stop_outs"] else 0
            notable.append(
                f"Stop-outs {verb} by {abs(d['stop_outs'])} ({pct:+.0f}% from baseline)"
            )
        if abs(d["total_pnl"]) >= 1000:
            notable.append(f"Total P&L moved {d['total_pnl']:+,.0f} vs baseline")
        r["notable_shifts"] = notable


# ------------------------------------------------------------ autoresearch

def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def autoresearch(trades, ohlc, ema_cache, total_iters, lo=0.10, hi=1.50, seed=None):
    if seed is not None:
        random.seed(seed)

    runs = []
    idx = 0

    # Baseline (sizing_pct = 1.0 = "size deeply")
    baseline = run_one(trades, ohlc, ema_cache, 1.0,
                       note="baseline (size deeply, current behavior)",
                       is_baseline=True, idx=idx)
    runs.append(baseline)
    idx += 1

    # Phase 1: coarse uniform grid
    coarse_n = max(4, total_iters // 4)
    if coarse_n > 1:
        coarse_vals = [round(lo + (hi - lo) * i / (coarse_n - 1), 3) for i in range(coarse_n)]
    else:
        coarse_vals = [round((lo + hi) / 2, 3)]
    for v in coarse_vals:
        if idx - 1 >= total_iters:
            break
        r = run_one(trades, ohlc, ema_cache, v, note=f"coarse pass [{lo}-{hi}]", idx=idx)
        if r:
            runs.append(r)
            idx += 1

    # Phase 2: refine around top 3
    top3 = sorted(runs[1:], key=lambda r: r["aggregate"]["expectancy_R"], reverse=True)[:3]
    refine_target = max(0, (total_iters - (idx - 1)) // 2)
    if refine_target > 0 and top3:
        per_top = max(1, refine_target // len(top3))
        for tr in top3:
            base_v = tr["params"]["sizing_pct"]
            for _ in range(per_top):
                if idx - 1 >= total_iters:
                    break
                v = round(clamp(base_v + random.gauss(0, 0.08), 0.05, 2.0), 3)
                r = run_one(trades, ohlc, ema_cache, v,
                            note=f"refine around {base_v}", idx=idx)
                if r:
                    runs.append(r)
                    idx += 1

    # Phase 3: hill climb around the best
    best = max(runs[1:], key=lambda r: r["aggregate"]["expectancy_R"])
    best_v = best["params"]["sizing_pct"]
    step = 0.05
    safety = 0
    while idx - 1 < total_iters and safety < 200:
        safety += 1
        for delta in (-step, +step):
            if idx - 1 >= total_iters:
                break
            v = round(clamp(best_v + delta, 0.05, 2.0), 3)
            r = run_one(trades, ohlc, ema_cache, v,
                        note=f"hill-climb step {step:.3f}", idx=idx)
            if r:
                runs.append(r)
                idx += 1
                if r["aggregate"]["expectancy_R"] > best["aggregate"]["expectancy_R"]:
                    best = r
                    best_v = v
        step *= 0.5
        if step < 0.005:
            break

    attach_deltas(runs, baseline)
    return runs


# ------------------------------------------------------------ 2D autoresearch

def autoresearch_2d(trades, ohlc, ema_cache, total_iters,
                    s_lo=0.20, s_hi=1.50, c_lo=0.20, c_hi=1.50,
                    coarse_grid=8, seed=None):
    """
    Two-knob sweep: sizing_pct x cut_pct, both expressed as fractions of the
    deep stop distance. Baseline is the historical (sizing=1.0, cut=plannedCut)
    run for delta reference.
    """
    if seed is not None:
        random.seed(seed)

    runs = []
    idx = 0

    # Baseline is the historical-cut run (cut_pct=None), so deltas remain
    # comparable with the 1D sweeps already in the file.
    baseline = run_one(trades, ohlc, ema_cache, 1.0,
                       note="baseline (size deeply, historical cut)",
                       is_baseline=True, idx=idx, cut_pct=None)
    runs.append(baseline)
    idx += 1

    # Phase 1: coarse N x N grid in (sizing, cut)
    if coarse_grid < 2:
        coarse_grid = 2
    s_vals = [round(s_lo + (s_hi - s_lo) * i / (coarse_grid - 1), 3) for i in range(coarse_grid)]
    c_vals = [round(c_lo + (c_hi - c_lo) * i / (coarse_grid - 1), 3) for i in range(coarse_grid)]
    for sv in s_vals:
        for cv in c_vals:
            if idx - 1 >= total_iters:
                break
            r = run_one(trades, ohlc, ema_cache, sv,
                        note=f"coarse grid s={sv} c={cv}",
                        idx=idx, cut_pct=cv)
            if r:
                runs.append(r)
                idx += 1

    # Phase 2: refine around top 5 cells with Gaussian jitter
    refined_target = max(0, (total_iters - (idx - 1)) // 2)
    if refined_target > 0:
        top_cells = sorted(
            [r for r in runs if not r["is_baseline"]],
            key=lambda r: r["aggregate"]["expectancy_R"], reverse=True,
        )[:5]
        per_cell = max(1, refined_target // max(1, len(top_cells)))
        for cell in top_cells:
            base_s = cell["params"]["sizing_pct"]
            base_c = cell["params"]["cut_pct"] or 1.0
            for _ in range(per_cell):
                if idx - 1 >= total_iters:
                    break
                sv = round(clamp(base_s + random.gauss(0, 0.07), 0.05, 2.0), 3)
                cv = round(clamp(base_c + random.gauss(0, 0.07), 0.05, 2.0), 3)
                r = run_one(trades, ohlc, ema_cache, sv,
                            note=f"refine around (s={base_s}, c={base_c})",
                            idx=idx, cut_pct=cv)
                if r:
                    runs.append(r)
                    idx += 1

    # Phase 3: hill-climb in 2D around the best
    best = max(
        [r for r in runs if not r["is_baseline"]],
        key=lambda r: r["aggregate"]["expectancy_R"],
    )
    best_s = best["params"]["sizing_pct"]
    best_c = best["params"]["cut_pct"] or 1.0
    step = 0.05
    safety = 0
    while idx - 1 < total_iters and safety < 200:
        safety += 1
        improved = False
        # 4 neighbors in 2D
        for ds, dc in ((-step, 0), (+step, 0), (0, -step), (0, +step)):
            if idx - 1 >= total_iters:
                break
            sv = round(clamp(best_s + ds, 0.05, 2.0), 3)
            cv = round(clamp(best_c + dc, 0.05, 2.0), 3)
            r = run_one(trades, ohlc, ema_cache, sv,
                        note=f"hill-climb step {step:.3f}",
                        idx=idx, cut_pct=cv)
            if r:
                runs.append(r)
                idx += 1
                if r["aggregate"]["expectancy_R"] > best["aggregate"]["expectancy_R"]:
                    best = r
                    best_s = sv
                    best_c = cv
                    improved = True
        if not improved:
            step *= 0.5
            if step < 0.005:
                break

    attach_deltas(runs, baseline)
    return runs


# ------------------------------------------------------------ persistence

def load_existing_runs():
    if not RUNS_PATH.exists():
        return {"runs": []}
    try:
        with open(RUNS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"runs": []}


def save_runs(payload):
    with open(RUNS_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


# ------------------------------------------------------------ CLI

def main():
    ap = argparse.ArgumentParser(description="Sizing autoresearch sweep.")
    ap.add_argument("--iters", type=int, default=80,
                    help="Total simulation iterations (excludes baseline). Default 80.")
    ap.add_argument("--mode", choices=("1d", "2d"), default="1d",
                    help="1d = sweep sizing only (cut fixed at plannedCut). "
                         "2d = sweep sizing x cut, both as fractions of the deep distance.")
    ap.add_argument("--sizing", type=float, default=None,
                    help="Run a single sizing_pct (skip the autoresearch loop).")
    ap.add_argument("--cut", type=float, default=None,
                    help="With --sizing, also override cut_pct for the single run.")
    ap.add_argument("--lo", type=float, default=0.10, help="Sizing sweep lower bound. Default 0.10")
    ap.add_argument("--hi", type=float, default=1.50, help="Sizing sweep upper bound. Default 1.50")
    ap.add_argument("--cut-lo", type=float, default=0.20, help="2D cut sweep lower bound. Default 0.20")
    ap.add_argument("--cut-hi", type=float, default=1.50, help="2D cut sweep upper bound. Default 1.50")
    ap.add_argument("--coarse-grid", type=int, default=8,
                    help="2D coarse grid size NxN. Default 8 (= 64 cells).")
    ap.add_argument("--note", type=str, default="", help="Note attached to this batch.")
    ap.add_argument("--reset", action="store_true",
                    help="Clear sizing_runs.json and start fresh.")
    ap.add_argument("--seed", type=int, default=None, help="Random seed (for reproducibility).")
    args = ap.parse_args()

    print("[load] reading data.json + ohlc.json ...")
    raw_trades, ohlc = load_inputs()
    trades, skip_stats = filter_enriched(raw_trades, ohlc)
    print(f"[load] {len(trades)} simulatable trades  (skipped: {skip_stats})")

    print("[ema]  precomputing 20EMA per symbol ...")
    ema_cache = build_ema_cache(ohlc)

    if args.sizing is not None:
        print(f"[run]  single iteration sizing_pct={args.sizing} cut_pct={args.cut}")
        baseline = run_one(trades, ohlc, ema_cache, 1.0,
                           note="baseline (auto-attached)", is_baseline=True, idx=0)
        single = run_one(trades, ohlc, ema_cache, args.sizing,
                         note=args.note or f"single s={args.sizing} c={args.cut}",
                         idx=1, cut_pct=args.cut)
        runs = [baseline, single]
        attach_deltas(runs, baseline)
    elif args.mode == "2d":
        print(f"[run]  2D autoresearch: {args.iters} iters, "
              f"sizing [{args.lo}, {args.hi}] x cut [{args.cut_lo}, {args.cut_hi}], "
              f"coarse {args.coarse_grid}x{args.coarse_grid}")
        runs = autoresearch_2d(trades, ohlc, ema_cache, args.iters,
                               s_lo=args.lo, s_hi=args.hi,
                               c_lo=args.cut_lo, c_hi=args.cut_hi,
                               coarse_grid=args.coarse_grid, seed=args.seed)
    else:
        print(f"[run]  1D autoresearch sweep: {args.iters} iters, range [{args.lo}, {args.hi}]")
        runs = autoresearch(trades, ohlc, ema_cache, args.iters,
                            lo=args.lo, hi=args.hi, seed=args.seed)

    # Merge with existing runs (unless --reset)
    if args.reset:
        payload = {"runs": []}
    else:
        payload = load_existing_runs()
        if "runs" not in payload:
            payload["runs"] = []

    batch_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    batch_id = f"batch_{batch_ts}"
    for r in runs:
        r["batch_id"] = batch_id
        if args.note:
            r["note"] = (r.get("note", "") + " | " + args.note).strip(" |")
    payload["runs"].extend(runs)
    payload["last_updated"] = batch_ts
    payload["last_batch_id"] = batch_id

    save_runs(payload)

    # Print summary
    print()
    print(f"[done] wrote {len(runs)} runs to {RUNS_PATH.name} (total runs in file: {len(payload['runs'])})")
    print()
    print(f"  {'sizing':>8}  {'cut':>6}  {'expR':>8}  {'win%':>6}  {'stops':>6}  {'avgHold':>8}  {'totalPnL':>12}  {'note'}")
    print(f"  {'-'*8}  {'-'*6}  {'-'*8}  {'-'*6}  {'-'*6}  {'-'*8}  {'-'*12}  {'-'*30}")
    for r in sorted(runs, key=lambda x: x["aggregate"]["expectancy_R"], reverse=True):
        a = r["aggregate"]
        tag = " *baseline*" if r["is_baseline"] else ""
        cv = r["params"].get("cut_pct")
        cut_str = f"{cv:>6.3f}" if cv is not None else f"{'hist':>6}"
        print(f"  {r['params']['sizing_pct']:>8.3f}  {cut_str}  {a['expectancy_R']:>+8.3f}  "
              f"{a['win_rate']*100:>5.1f}%  {a['stop_outs']:>6d}  "
              f"{a['avg_holding_days']:>8.2f}  {a['total_pnl']:>12,.0f}  {r['note']}{tag}")

    best = max(runs, key=lambda r: r["aggregate"]["expectancy_R"])
    print()
    print(f"[best] sizing_pct={best['params']['sizing_pct']}  "
          f"expectancy={best['aggregate']['expectancy_R']:+.3f}R  "
          f"({len(best['notable_shifts'])} notable shifts)")
    for s in best["notable_shifts"]:
        print(f"       - {s}")


if __name__ == "__main__":
    main()
