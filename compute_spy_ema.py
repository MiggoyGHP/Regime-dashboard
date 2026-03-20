#!/usr/bin/env python3
"""
Compute SPY EMA regime periods (regime4).

Classification rules based on SPY price vs 20EMA and 50EMA:
- Green:  SPY Close > 20EMA AND 20EMA > 50EMA
- Yellow: SPY Close < 20EMA AND SPY Close > 50EMA AND 20EMA > 50EMA
- Red:    SPY Close < 50EMA (or 20EMA < 50EMA with price above 50EMA)

Generates regime periods and updates data.json with regimePeriods['regime4'],
regimeTrades['regime4'], and regimeStats['regime4'].
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
WARMUP_START = '2023-09-01'  # ~70 trading days before first trade (2024-01-04) for 50EMA warmup
REGIME_START = '2024-01-01'  # Only generate periods from this date onward


# -- Download & Compute --------------------------------------------------------

def download_spy(start, end):
    """Download SPY daily OHLC data via yfinance."""
    print(f'Downloading SPY data from {start} to {end}...')
    df = yf.download('SPY', start=start, end=end, progress=False)
    if df.empty:
        print('ERROR: No SPY data returned', file=sys.stderr)
        sys.exit(1)
    # Flatten multi-level columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    print(f'  Got {len(df)} trading days')
    return df


def classify_days(df):
    """Classify each trading day as Green/Yellow/Red based on EMA rules.

    Returns a list of (date_str, color) tuples starting from REGIME_START.
    """
    close = df['Close']
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()

    daily_colors = []
    for i in range(len(df)):
        date_str = df.index[i].strftime('%Y-%m-%d')
        if date_str < REGIME_START:
            continue

        c = close.iloc[i]
        e20 = ema20.iloc[i]
        e50 = ema50.iloc[i]

        if c > e20 and e20 > e50:
            color = 'Green'
        elif c < e20 and c > e50 and e20 > e50:
            color = 'Yellow'
        else:
            # Covers: close < 50EMA, or 20EMA < 50EMA (bearish structure)
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
    """Write regime4 periods, trades, and stats to data.json."""
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
            print(f'    {p["color"]:6s}  {p["start"]} → {p["end"]}  ({p["duration"]}d)')
        return

    # 1. Set regime periods
    data['regimePeriods']['regime4'] = periods

    # 2. Create regime4 trades by copying from regime1 and reclassifying
    sorted_periods = sorted(periods, key=lambda p: p['start'])
    regime4_trades = copy.deepcopy(data['regimeTrades']['regime1'])

    reclassified = 0
    for t in regime4_trades:
        new_color = get_regime_color(t['entryDate'], sorted_periods)
        if t['regimeColor'] != new_color:
            reclassified += 1
        t['regimeColor'] = new_color

    data['regimeTrades']['regime4'] = regime4_trades

    unknowns = sum(1 for t in regime4_trades if t['regimeColor'] == 'Unknown')
    print(f'  Classified {len(regime4_trades)} trades ({unknowns} Unknown)')

    # 3. Compute regime4 stats
    color_groups = defaultdict(list)
    for t in regime4_trades:
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

    data['regimeStats']['regime4'] = regime_stats

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
    parser = argparse.ArgumentParser(description='Compute SPY EMA regime periods (regime4)')
    parser.add_argument('--start', default=WARMUP_START,
                        help=f'Start date for SPY download (default: {WARMUP_START})')
    parser.add_argument('--end', help='End date (default: today)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show periods without writing to data.json')
    args = parser.parse_args()

    end_date = args.end or datetime.now().strftime('%Y-%m-%d')

    # 1. Download SPY data
    df = download_spy(args.start, end_date)

    # 2. Classify each trading day
    daily_colors = classify_days(df)
    print(f'  Classified {len(daily_colors)} trading days from {REGIME_START}')

    # 3. Generate periods
    periods = generate_periods(daily_colors)

    # 4. Update data.json
    update_data_json(periods, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
