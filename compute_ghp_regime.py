#!/usr/bin/env python3
"""
Compute GHP Regime Overlay periods (regime8).

Replicates the Pine Script regime_classifier_v4_1.pine 8-criterion scorecard:

  Price Structure (3):
    C1: SPY close > 20 EMA
    C2: SPY close > 50 EMA
    C3: 20 EMA > 50 EMA

  Market Breadth (3):
    C4: MMFI > 50%
    C5: MMTH > 50%
    C6: Net 52w Highs - Lows > 0  (5-day rolling sums)

  Volatility (2):
    C7: VIX < 20
    C8: VIX < VIX 50 EMA

  Score 6-8 = Green, 3-5 = Yellow, 0-2 = Red
  Emergency overrides (always daily): VIX > 35 or SPY gap down <= -4% -> Red

  Weekly assessment mode (default): score locks on Friday, holds through the week.
  Uses prior-day close values for anti-repaint (matching Pine close[1]).

Data sources (TradingView CSV exports):
  SPY  - BATS_SPY, 1D_f9092.csv  (close col4, EMA20 col5, EMA10 col6; 50EMA computed)
  VIX  - TVC_VIX, 1D_90f96.csv   (close col4, EMA50 col6)
  MMTH - INDEX_MMTH, 1D_de5f6.csv (close col4)
  Breadth - COMEX_DL_GC1!, 1D_7152b.csv (YRLO col5, YRHI col6, MMFI col7)

Generates regime periods and updates data.json with regimePeriods['regime8'],
regimeTrades['regime8'], and regimeStats['regime8'].
"""

import argparse
import copy
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone

DATA_JSON = 'data.json'
SPY_CSV = 'BATS_SPY, 1D_f9092.csv'
VIX_CSV = 'TVC_VIX, 1D_90f96.csv'
MMTH_CSV = 'INDEX_MMTH, 1D_de5f6.csv'
BREADTH_CSV = 'COMEX_DL_GC1!, 1D_7152b.csv'

REGIME_START = '2024-01-01'
REGIME_KEY = 'regime8'

NH_LOOKBACK = 5       # Rolling sum window for YRHI/YRLO
EMERGENCY_VIX = 35.0  # VIX spike threshold
EMERGENCY_GAP = -4.0  # SPY gap down % threshold


# -- Load CSVs -----------------------------------------------------------------

def load_spy_csv(csv_path):
    """Load SPY data from CSV.

    Columns: time,open,high,low,close,EMA(20),EMA(10),...
    Returns list of (date_str, open, close, ema20) tuples.
    """
    rows = []
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            ts = int(row[0])
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
            opn = float(row[1])
            close = float(row[4])
            ema20 = float(row[5])
            rows.append((date_str, opn, close, ema20))
    print(f'Loaded {len(rows)} SPY days from {csv_path}')
    print(f'  Date range: {rows[0][0]} to {rows[-1][0]}')
    return rows


def compute_spy_50ema(spy_rows):
    """Compute 50-period EMA from SPY close prices.

    Returns dict of date_str -> ema50 value.
    """
    span = 50
    multiplier = 2.0 / (span + 1)
    ema = None
    result = {}
    for date_str, _, close, _ in spy_rows:
        if ema is None:
            ema = close
        else:
            ema = (close - ema) * multiplier + ema
        result[date_str] = ema
    print(f'  Computed SPY 50 EMA ({len(result)} values)')
    return result


def load_vix_csv(csv_path):
    """Load VIX data from CSV.

    Columns: time,open,high,low,close,EMA(200),EMA(50),EMA(20),EMA(10),...
    Returns dict of date_str -> (close, ema50).
    """
    data = {}
    count = 0
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            ts = int(row[0])
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
            close = float(row[4])
            ema50 = float(row[6])
            data[date_str] = (close, ema50)
            count += 1
    print(f'Loaded {count} VIX days from {csv_path}')
    return data


def load_mmth_csv(csv_path):
    """Load MMTH data from CSV.

    Columns: time,open,high,low,close,EMA(20),EMA(10)
    Returns dict of date_str -> close.
    """
    data = {}
    count = 0
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            ts = int(row[0])
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
            close = float(row[4])
            data[date_str] = close
            count += 1
    print(f'Loaded {count} MMTH days from {csv_path}')
    return data


def load_breadth_csv(csv_path):
    """Load breadth data (YRLO, YRHI, MMFI) from CSV.

    Columns: time,open,high,low,close,YRLO.US,YRHI.US,MMFI
    Returns dict of date_str -> (yrlo, yrhi, mmfi).
    """
    data = {}
    count = 0
    skipped = 0
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            ts = int(row[0])
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
            # Skip rows with missing breadth data
            if not row[5] or not row[6] or not row[7]:
                skipped += 1
                continue
            yrlo = float(row[5])
            yrhi = float(row[6])
            mmfi = float(row[7])
            data[date_str] = (yrlo, yrhi, mmfi)
            count += 1
    print(f'Loaded {count} breadth days from {csv_path} ({skipped} skipped)')
    return data


def compute_rolling_net_hl(breadth_data, spy_dates, lookback=NH_LOOKBACK):
    """Compute rolling sum of YRHI and YRLO over lookback days.

    Returns dict of date_str -> net_hl (sum_yrhi - sum_yrlo).
    Only uses dates that appear in breadth_data.
    """
    # Build ordered list of breadth dates that align with SPY trading days
    ordered_dates = [d for d in spy_dates if d in breadth_data]

    result = {}
    for i, date_str in enumerate(ordered_dates):
        start = max(0, i - lookback + 1)
        window = ordered_dates[start:i + 1]
        sum_yrhi = sum(breadth_data[d][1] for d in window)
        sum_yrlo = sum(breadth_data[d][0] for d in window)
        result[date_str] = sum_yrhi - sum_yrlo
    return result


# -- Classification ------------------------------------------------------------

def score_day(spy_close, spy_ema20, spy_ema50, mmfi, mmth_close, net_hl,
              vix_close, vix_ema50):
    """Score a single day on the 8-criterion checklist.

    Returns (score, criteria_list) where criteria_list is 8 booleans.
    """
    c1 = spy_close > spy_ema20
    c2 = spy_close > spy_ema50
    c3 = spy_ema20 > spy_ema50
    c4 = mmfi > 50
    c5 = mmth_close > 50
    c6 = net_hl > 0
    c7 = vix_close < 20
    c8 = vix_close < vix_ema50

    criteria = [c1, c2, c3, c4, c5, c6, c7, c8]
    return sum(criteria), criteria


def score_to_color(score):
    """Map score to regime color."""
    if score >= 6:
        return 'Green'
    elif score >= 3:
        return 'Yellow'
    else:
        return 'Red'


def classify_days(spy_rows, spy_50ema, vix_data, mmth_data, breadth_data,
                  net_hl_data, mode='weekly'):
    """Classify each trading day using the GHP 8-criterion scorecard.

    Uses prior-day values for anti-repaint (matching Pine close[1]).
    Weekly mode locks score on Friday, holds through the week.

    Returns a list of (date_str, color) tuples starting from REGIME_START.
    """
    daily_colors = []
    prev_spy_close = None

    # Weekly state
    weekly_color = None

    for i, (date_str, spy_open, spy_close, spy_ema20) in enumerate(spy_rows):
        # We need prior-day data, so skip the very first row
        if i == 0:
            prev_spy_close = spy_close
            continue

        if date_str < REGIME_START:
            prev_spy_close = spy_close
            continue

        # Check all data sources available for prior day
        prev_date = spy_rows[i - 1][0]
        prev_close = spy_rows[i - 1][2]
        prev_ema20 = spy_rows[i - 1][3]

        if prev_date not in spy_50ema:
            prev_spy_close = spy_close
            continue
        prev_ema50 = spy_50ema[prev_date]

        if prev_date not in vix_data:
            prev_spy_close = spy_close
            continue
        prev_vix_close, prev_vix_ema50 = vix_data[prev_date]

        if prev_date not in mmth_data:
            prev_spy_close = spy_close
            continue
        prev_mmth = mmth_data[prev_date]

        if prev_date not in breadth_data:
            prev_spy_close = spy_close
            continue
        _, _, prev_mmfi = breadth_data[prev_date]

        prev_net_hl = net_hl_data.get(prev_date, 0)

        # Score using prior-day values
        score, _ = score_day(
            prev_close, prev_ema20, prev_ema50,
            prev_mmfi, prev_mmth, prev_net_hl,
            prev_vix_close, prev_vix_ema50,
        )
        score_color = score_to_color(score)

        # Emergency overrides (always checked daily, using current day's data)
        # VIX spike: use prior day's VIX close (already anti-repainted)
        emergency = False
        if prev_vix_close > EMERGENCY_VIX:
            emergency = True

        # Gap down: (today's open - yesterday's close) / yesterday's close
        prev_prev_close = spy_rows[i - 1][2]  # prior day close
        if prev_prev_close != 0:
            gap_pct = (spy_open - prev_prev_close) / prev_prev_close * 100
            if gap_pct <= EMERGENCY_GAP:
                emergency = True

        if emergency:
            day_color = 'Red'
        else:
            day_color = score_color

        # Weekly mode: lock on Friday, hold through the week
        if mode == 'weekly':
            dt = datetime.strptime(date_str, '%Y-%m-%d')
            is_friday = dt.weekday() == 4  # Monday=0, Friday=4

            if is_friday:
                weekly_color = day_color

            if weekly_color is not None:
                # Emergency overrides still apply daily
                if emergency:
                    final_color = 'Red'
                else:
                    final_color = weekly_color
            else:
                # No Friday seen yet — use daily until first Friday
                final_color = day_color

            daily_colors.append((date_str, final_color))
        else:
            daily_colors.append((date_str, day_color))

        prev_spy_close = spy_close

    return daily_colors


def generate_periods(daily_colors):
    """Group consecutive same-color trading days into regime periods."""
    if not daily_colors:
        return []

    periods = []
    cur_color = daily_colors[0][1]
    cur_start = daily_colors[0][0]
    cur_end = daily_colors[0][0]

    for date_str, color in daily_colors[1:]:
        if color == cur_color:
            cur_end = date_str
        else:
            s = datetime.strptime(cur_start, '%Y-%m-%d')
            e = datetime.strptime(cur_end, '%Y-%m-%d')
            periods.append({
                'color': cur_color,
                'start': cur_start,
                'end': cur_end,
                'duration': (e - s).days + 1,
            })
            cur_color = color
            cur_start = date_str
            cur_end = date_str

    # Final period
    s = datetime.strptime(cur_start, '%Y-%m-%d')
    e = datetime.strptime(cur_end, '%Y-%m-%d')
    periods.append({
        'color': cur_color,
        'start': cur_start,
        'end': cur_end,
        'duration': (e - s).days + 1,
    })

    return periods


# -- Update data.json ----------------------------------------------------------

def get_regime_color(date_str, sorted_periods):
    """Assign regime color with gap tolerance for holiday gaps."""
    for p in sorted_periods:
        if p['start'] <= date_str <= p['end']:
            return p['color']
    for i in range(len(sorted_periods) - 1):
        if sorted_periods[i]['end'] < date_str < sorted_periods[i + 1]['start']:
            return sorted_periods[i]['color']
    return 'Unknown'


def update_data_json(periods, dry_run=False):
    """Write regime8 periods, trades, and stats to data.json."""
    print(f'\n-- Updating data.json --')

    with open(DATA_JSON, 'r') as f:
        data = json.load(f)

    # Print period summary
    color_counts = defaultdict(int)
    for p in periods:
        color_counts[p['color']] += 1
    print(f'  Generated {len(periods)} periods: '
          + ', '.join(f'{c}={n}' for c, n in sorted(color_counts.items())))

    if dry_run:
        print('  DRY RUN -- not writing to data.json')
        for p in periods:
            print(f'    {p["color"]:6s}  {p["start"]} -> {p["end"]}  ({p["duration"]}d)')
        return

    # 1. Set regime periods
    data['regimePeriods'][REGIME_KEY] = periods

    # 2. Create regime8 trades by copying from regime1 and reclassifying
    sorted_periods = sorted(periods, key=lambda p: p['start'])
    regime_trades = copy.deepcopy(data['regimeTrades']['regime1'])

    reclassified = 0
    for t in regime_trades:
        new_color = get_regime_color(t['entryDate'], sorted_periods)
        if t['regimeColor'] != new_color:
            reclassified += 1
        t['regimeColor'] = new_color

    data['regimeTrades'][REGIME_KEY] = regime_trades

    unknowns = sum(1 for t in regime_trades if t['regimeColor'] == 'Unknown')
    print(f'  Classified {len(regime_trades)} trades ({reclassified} reclassified, {unknowns} Unknown)')

    # 3. Compute regime8 stats
    color_groups = defaultdict(list)
    for t in regime_trades:
        if t.get('status') == 'Closed':
            color_groups[t['regimeColor']].append(t)
            color_groups['All'].append(t)

    regime_stats = {}
    for color, ctrades in color_groups.items():
        n = len(ctrades)
        pnls = [t['pnl'] for t in ctrades]
        winners = [p for p in pnls if p > 0]
        losers = [p for p in pnls if p <= 0]
        total_pnl = sum(pnls)
        gross_profit = sum(winners) if winners else 0
        gross_loss = abs(sum(losers)) if losers else 0
        avg_win = (gross_profit / len(winners)) if winners else 0
        avg_loss = (gross_loss / len(losers)) if losers else 0
        edge_ratio = round(avg_win / avg_loss, 4) if avg_loss > 0 else 0

        holding_days = []
        for t in ctrades:
            if t.get('entryDate') and t.get('exitDate'):
                try:
                    d1 = datetime.strptime(t['entryDate'], '%Y-%m-%d')
                    d2 = datetime.strptime(t['exitDate'], '%Y-%m-%d')
                    holding_days.append((d2 - d1).days)
                except (ValueError, TypeError):
                    pass
        avg_hold = round(sum(holding_days) / len(holding_days), 1) if holding_days else 0

        regime_stats[color] = {
            '# Trades': n,
            'Total P&L': round(total_pnl, 2),
            'Win Rate': round(len(winners) / n, 4) if n else 0,
            'Avg P&L': round(total_pnl / n, 2) if n else 0,
            'Avg Win': round(avg_win, 2),
            'Avg Loss': round(-avg_loss, 2),
            'Edge Ratio': edge_ratio,
            'Max Win': round(max(pnls), 2) if pnls else 0,
            'Max Loss': round(min(pnls), 2) if pnls else 0,
            'Median P&L': round(sorted(pnls)[n // 2], 2) if n else 0,
            '# Winners': len(winners),
            '# Losers': len(losers),
            'Avg Holding Period': avg_hold,
        }

    data['regimeStats'][REGIME_KEY] = regime_stats

    # Print summary
    for color in ['Green', 'Yellow', 'Red', 'Unknown', 'All']:
        if color in regime_stats:
            s = regime_stats[color]
            print(f'    {color}: {s["# Trades"]} trades, ${s["Total P&L"]:,.2f}, '
                  f'WR {s["Win Rate"]:.1%}, ER {s["Edge Ratio"]:.2f}')

    with open(DATA_JSON, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

    print(f'  Written to data.json')


# -- Main ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Compute GHP Regime Overlay periods (regime8)')
    parser.add_argument('--mode', choices=['weekly', 'daily'], default='weekly',
                        help='Assessment mode: weekly (lock on Friday) or daily (default: weekly)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show periods without writing to data.json')
    args = parser.parse_args()

    # 1. Load all CSV data
    spy_rows = load_spy_csv(SPY_CSV)
    spy_50ema = compute_spy_50ema(spy_rows)
    vix_data = load_vix_csv(VIX_CSV)
    mmth_data = load_mmth_csv(MMTH_CSV)
    breadth_data = load_breadth_csv(BREADTH_CSV)

    # 2. Compute rolling net highs-lows
    spy_dates = [d for d, _, _, _ in spy_rows]
    net_hl_data = compute_rolling_net_hl(breadth_data, spy_dates)
    print(f'  Computed rolling {NH_LOOKBACK}-day net H-L ({len(net_hl_data)} values)')

    # 3. Classify each trading day
    daily_colors = classify_days(spy_rows, spy_50ema, vix_data, mmth_data,
                                 breadth_data, net_hl_data, mode=args.mode)
    print(f'  Classified {len(daily_colors)} trading days from {REGIME_START} ({args.mode} mode)')

    # Print color distribution
    color_dist = defaultdict(int)
    for _, c in daily_colors:
        color_dist[c] += 1
    print(f'  Distribution: ' + ', '.join(f'{c}={n}' for c, n in sorted(color_dist.items())))

    # 4. Generate periods
    periods = generate_periods(daily_colors)

    # 5. Update data.json
    update_data_json(periods, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
