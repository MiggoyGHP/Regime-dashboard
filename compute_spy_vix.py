#!/usr/bin/env python3
"""
Compute SPY 10/20 EMA + VIX EMA regime periods (regime6).

Classification rules combining SPY 10/20 EMA position with VIX EMA trend:
- Green:  SPY > 10EMA AND 10EMA > 20EMA AND VIX not warning
- Yellow: SPY > 10EMA AND 10EMA > 20EMA AND VIX warning (10EMA > 20EMA for N days)
- Yellow: 10EMA > SPY > 20EMA (VIX irrelevant)
- Red:    SPY < both EMAs OR bearish EMA structure (20EMA >= 10EMA)

VIX warning requires VIX 10EMA > VIX 20EMA for VIX_CONFIRM_DAYS consecutive days
to filter out single-day VIX spikes.

Generates regime periods and updates data.json with regimePeriods['regime6'],
regimeTrades['regime6'], and regimeStats['regime6'].
"""

import argparse
import copy
import json
import sys
from collections import defaultdict
from datetime import datetime

import pandas as pd
import yfinance as yf

DATA_JSON = 'data.json'
WARMUP_START = '2023-10-01'  # ~60 trading days before 2024-01-01 for EMA warmup
REGIME_START = '2024-01-01'  # Only generate periods from this date onward
REGIME_KEY = 'regime6'

# --- VIX EMA Configuration (tune these) ---
VIX_EMA_SHORT = 10   # VIX fast EMA period
VIX_EMA_LONG = 20    # VIX slow EMA period
VIX_CONFIRM_DAYS = 2  # Consecutive days VIX short EMA > long EMA to confirm warning


# -- Download ------------------------------------------------------------------

def download_spy(start, end):
    """Download SPY daily OHLC data via yfinance."""
    print(f'Downloading SPY data from {start} to {end}...')
    df = yf.download('SPY', start=start, end=end, progress=False)
    if df.empty:
        print('ERROR: No SPY data returned', file=sys.stderr)
        sys.exit(1)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    print(f'  Got {len(df)} trading days')
    return df


def download_vix(start, end):
    """Download VIX daily OHLC data via yfinance."""
    print(f'Downloading VIX data from {start} to {end}...')
    df = yf.download('^VIX', start=start, end=end, progress=False)
    if df.empty:
        print('ERROR: No VIX data returned', file=sys.stderr)
        sys.exit(1)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    # Forward-fill any NaN close prices
    df['Close'] = df['Close'].ffill()
    print(f'  Got {len(df)} trading days')
    return df


# -- Classification ------------------------------------------------------------

def classify_days(spy_df, vix_df):
    """Classify each trading day using SPY 10/20 EMA + VIX EMA rules.

    Returns a list of (date_str, color) tuples starting from REGIME_START.
    """
    # Compute SPY EMAs
    spy_close = spy_df['Close']
    spy_ema10 = spy_close.ewm(span=10, adjust=False).mean()
    spy_ema20 = spy_close.ewm(span=20, adjust=False).mean()

    # Compute VIX EMAs
    vix_close = vix_df['Close']
    vix_ema_short = vix_close.ewm(span=VIX_EMA_SHORT, adjust=False).mean()
    vix_ema_long = vix_close.ewm(span=VIX_EMA_LONG, adjust=False).mean()

    # Build VIX lookup by date string
    vix_data = {}
    for i in range(len(vix_df)):
        date_str = vix_df.index[i].strftime('%Y-%m-%d')
        vix_data[date_str] = (vix_ema_short.iloc[i], vix_ema_long.iloc[i])

    daily_colors = []
    vix_warn_streak = 0

    for i in range(len(spy_df)):
        date_str = spy_df.index[i].strftime('%Y-%m-%d')

        # Update VIX warning streak (even before REGIME_START for warmup)
        if date_str in vix_data:
            v_short, v_long = vix_data[date_str]
            if v_short > v_long:
                vix_warn_streak += 1
            else:
                vix_warn_streak = 0
        # If no VIX data for this date, keep previous streak unchanged

        if date_str < REGIME_START:
            continue

        c = spy_close.iloc[i]
        e10 = spy_ema10.iloc[i]
        e20 = spy_ema20.iloc[i]

        vix_warning = vix_warn_streak >= VIX_CONFIRM_DAYS

        if e10 > e20 and c > e10:
            # Bullish structure, price above both EMAs — check VIX
            color = 'Yellow' if vix_warning else 'Green'
        elif e10 > e20 and c > e20:
            # Price between EMAs in bullish structure
            color = 'Yellow'
        else:
            # Below both EMAs or bearish EMA structure
            color = 'Red'

        daily_colors.append((date_str, color))

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
    """Write regime6 periods, trades, and stats to data.json."""
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

    # 2. Create regime6 trades by copying from regime1 and reclassifying
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
    print(f'  Classified {len(regime_trades)} trades ({unknowns} Unknown)')

    # 3. Compute regime6 stats
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
        description='Compute SPY 10/20 EMA + VIX EMA regime periods (regime6)')
    parser.add_argument('--start', default=WARMUP_START,
                        help=f'Start date for data download (default: {WARMUP_START})')
    parser.add_argument('--end', help='End date (default: today)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show periods without writing to data.json')
    args = parser.parse_args()

    end_date = args.end or datetime.now().strftime('%Y-%m-%d')

    # 1. Download SPY and VIX data
    spy_df = download_spy(args.start, end_date)
    vix_df = download_vix(args.start, end_date)

    # 2. Classify each trading day
    daily_colors = classify_days(spy_df, vix_df)
    print(f'  Classified {len(daily_colors)} trading days from {REGIME_START}')

    # 3. Generate periods
    periods = generate_periods(daily_colors)

    # 4. Update data.json
    update_data_json(periods, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
