#!/usr/bin/env python3
"""
Compute CNHNL (Cumulative Net Highs - Net Lows) regime periods.

Replicates Matt Caruso's Net Highs/Lows v6 indicator (TradingView):
1. Get NASDAQ Composite equities only (close > $2, price*vol > $10K)
2. Compute daily new 52-week highs and lows
3. 3-day consecutive state machine: Green after 3 positive days, Red after 3 negative
4. Apply 1-day lag (indicator seen at close, applied to next trading day)
5. Generate regime periods and update data.json

Reference: https://www.tradingview.com/script/eP814cAv-US-Markets-Net-New-Highs-Lows/
Settings: Nasdaq only, 3-day consecutive background coloring.
"""

import argparse
import json
import os
import pickle
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import yfinance as yf


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(SCRIPT_DIR, 'data.json')
TICKER_CACHE = os.path.join(SCRIPT_DIR, 'nasdaq_equities.txt')
OHLCV_CACHE = os.path.join(SCRIPT_DIR, 'cnhnl_cache.pkl')

SKIP_KEYWORDS = [
    'WARRANT', 'UNIT', 'RIGHT', 'PREFERRED', 'DEPOSITARY',
    'ACQUISITION', '% NOTES', 'DEBT', 'BOND',
]


# -- Phase 1: NASDAQ Equity Universe -------------------------------------------

def get_nasdaq_equities(refresh=False):
    """Fetch NASDAQ-listed common stocks only (matching TradingView Nasdaq setting)."""
    if not refresh and os.path.exists(TICKER_CACHE):
        with open(TICKER_CACHE, 'r') as f:
            tickers = [line.strip() for line in f if line.strip()]
        print(f'  Loaded {len(tickers)} NASDAQ tickers from cache')
        return tickers

    print('  Downloading NASDAQ ticker list...')
    tickers = []
    url = 'https://api.nasdaq.com/api/screener/stocks?offset=0&exchange=NASDAQ&limit=10000'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f'  NASDAQ API error: {e}')
        data = {}

    for row in data.get('data', {}).get('table', {}).get('rows', []):
        symbol = row.get('symbol', '').strip()
        name = row.get('name', '').upper()
        if any(kw in name for kw in SKIP_KEYWORDS):
            continue
        if not symbol or ' ' in symbol:
            continue
        tickers.append(symbol)

    with open(TICKER_CACHE, 'w') as f:
        f.write('\n'.join(sorted(tickers)))
    print(f'  Found {len(tickers)} NASDAQ equities')
    return tickers


# -- Phase 2: Download Historical OHLCV ----------------------------------------

def download_ohlcv(tickers, start_date, end_date, batch_size=500, use_cache=True):
    """Download daily OHLCV for all tickers via yfinance batch download."""
    if use_cache and os.path.exists(OHLCV_CACHE):
        with open(OHLCV_CACHE, 'rb') as f:
            cache = pickle.load(f)
        if cache.get('start', '') <= start_date and cache.get('end', '') >= end_date:
            print(f'  Using cached OHLCV data ({cache["start"]} to {cache["end"]})')
            return cache['high'], cache['low'], cache['close'], cache['volume']

    print(f'  Downloading OHLCV for {len(tickers)} tickers ({start_date} to {end_date})...')
    all_high, all_low, all_close, all_volume = [], [], [], []

    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(tickers) + batch_size - 1) // batch_size
        print(f'    Batch {batch_num}/{total_batches} ({len(batch)} tickers)...', end=' ')
        t0 = time.time()
        try:
            df = yf.download(
                batch, start=start_date, end=end_date,
                threads=True, progress=False, auto_adjust=True,
            )
        except Exception as e:
            print(f'ERROR: {e}')
            continue
        elapsed = time.time() - t0
        if df.empty:
            print(f'empty ({elapsed:.1f}s)')
            continue
        if isinstance(df.columns, pd.MultiIndex):
            all_high.append(df['High'])
            all_low.append(df['Low'])
            all_close.append(df['Close'])
            all_volume.append(df['Volume'])
        else:
            all_high.append(df[['High']].rename(columns={'High': batch[0]}))
            all_low.append(df[['Low']].rename(columns={'Low': batch[0]}))
            all_close.append(df[['Close']].rename(columns={'Close': batch[0]}))
            all_volume.append(df[['Volume']].rename(columns={'Volume': batch[0]}))
        print(f'{elapsed:.1f}s')

    if not all_high:
        raise RuntimeError('No OHLCV data downloaded')

    high = pd.concat(all_high, axis=1).loc[:, lambda x: ~x.columns.duplicated()]
    low = pd.concat(all_low, axis=1).loc[:, lambda x: ~x.columns.duplicated()]
    close = pd.concat(all_close, axis=1).loc[:, lambda x: ~x.columns.duplicated()]
    volume = pd.concat(all_volume, axis=1).loc[:, lambda x: ~x.columns.duplicated()]
    print(f'  Downloaded: {high.shape[1]} tickers, {high.shape[0]} trading days')

    cache = {'start': start_date, 'end': end_date,
             'high': high, 'low': low, 'close': close, 'volume': volume}
    with open(OHLCV_CACHE, 'wb') as f:
        pickle.dump(cache, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(f'  Cached to {OHLCV_CACHE}')
    return high, low, close, volume


# -- Phase 3: Compute Daily CNHNL -----------------------------------------------

def compute_daily_cnhnl(high, low, close, volume, lookback=252):
    """
    Compute daily net new highs - new lows for NASDAQ stocks.

    For each trading day:
    1. Filter: prior close > $2, prior close * prior volume > $10K
    2. New high if today's high == rolling 252-day max
    3. New low if today's low == rolling 252-day min
    4. daily_net = count(new_highs) - count(new_lows)
    """
    print(f'  Computing CNHNL (lookback={lookback})...')

    prev_close = close.shift(1)
    prev_volume = volume.shift(1)
    qualified = (prev_close > 2) & (prev_close * prev_volume > 10000)

    rolling_high = high.rolling(lookback, min_periods=lookback).max()
    rolling_low = low.rolling(lookback, min_periods=lookback).min()

    is_new_high = (high == rolling_high) & qualified & high.notna()
    is_new_low = (low == rolling_low) & qualified & low.notna()

    new_highs = is_new_high.sum(axis=1)
    new_lows = is_new_low.sum(axis=1)
    daily_net = new_highs - new_lows

    valid_start = daily_net.index[daily_net.index >= high.index[lookback - 1]]
    daily_net = daily_net.loc[valid_start]
    new_highs = new_highs.loc[valid_start]
    new_lows = new_lows.loc[valid_start]

    result = pd.DataFrame({
        'new_highs': new_highs,
        'new_lows': new_lows,
        'daily_net': daily_net,
    })

    print(f'  CNHNL computed: {len(result)} trading days '
          f'({result.index[0].strftime("%Y-%m-%d")} to {result.index[-1].strftime("%Y-%m-%d")})')
    print(f'  Avg daily: highs={new_highs.mean():.0f}, lows={new_lows.mean():.0f}, '
          f'net={daily_net.mean():.1f}')
    return result


# -- Phase 4: 3-Day Consecutive State Machine -----------------------------------

def classify_3day_sticky(daily_net_series, n_confirm=3):
    """
    3-day consecutive state machine matching TradingView indicator:
    - Green: after N consecutive days with net > 0 (bullish breadth)
    - Red:   after N consecutive days with net < 0 (bearish breadth)
    - Yellow: transition (state hasn't been confirmed yet)

    Once in a state, it stays until the opposite state is confirmed.
    """
    dates = daily_net_series.index
    net_values = daily_net_series.values
    colors = []
    state = 'Yellow'  # initial state before any confirmation

    for i in range(len(net_values)):
        if i >= n_confirm - 1:
            recent = net_values[i - n_confirm + 1:i + 1]
            if all(v > 0 for v in recent):
                state = 'Green'
            elif all(v < 0 for v in recent):
                state = 'Red'
            # Otherwise keep current state (sticky)
        colors.append(state)

    return pd.Series(colors, index=dates)


def load_existing_regime3():
    """Load existing regime3 periods from data.json."""
    with open(DATA_JSON, 'r') as f:
        data = json.load(f)
    return sorted(data['regimePeriods']['regime3'], key=lambda p: p['start'])


def calibrate(cnhnl_df, existing_periods):
    """Validate 3-day sticky classifier against existing regime3 periods."""
    print('\n-- Calibration --')

    known_colors = {}
    for p in existing_periods:
        start = datetime.strptime(p['start'], '%Y-%m-%d')
        end = datetime.strptime(p['end'], '%Y-%m-%d')
        d = start
        while d <= end:
            if d.weekday() < 5:
                known_colors[d.strftime('%Y-%m-%d')] = p['color']
            d += timedelta(days=1)
    print(f'  Known daily colors: {len(known_colors)} trading days')

    # Compute the 3-day sticky classification for all CNHNL days
    state_colors = classify_3day_sticky(cnhnl_df['daily_net'])
    cnhnl_dates = cnhnl_df.index.strftime('%Y-%m-%d').tolist()
    sorted_cnhnl = sorted(cnhnl_dates)
    state_map = {d: c for d, c in zip(cnhnl_dates, state_colors)}

    # Compare with 1-day lag: state from day T -> regime color for day T+1
    correct = 0
    total = 0
    conf = {c: {p: 0 for p in ['Green', 'Yellow', 'Red']} for c in ['Green', 'Yellow', 'Red']}

    for date_str, actual_color in sorted(known_colors.items()):
        prior = None
        for cd in reversed(sorted_cnhnl):
            if cd < date_str:
                prior = cd
                break
        if prior and prior in state_map:
            pred = state_map[prior]
            conf[actual_color][pred] += 1
            if pred == actual_color:
                correct += 1
            total += 1

    accuracy = correct / total if total else 0
    print(f'  Accuracy (3-day sticky + 1-day lag): {correct}/{total} = {accuracy:.1%}')
    print(f'\n  Confusion matrix (rows=actual, cols=predicted):')
    print(f'  {"":>10} {"Green":>8} {"Yellow":>8} {"Red":>8}')
    for actual in ['Green', 'Yellow', 'Red']:
        g, y, r = conf[actual]['Green'], conf[actual]['Yellow'], conf[actual]['Red']
        print(f'  {actual:>10} {g:>8} {y:>8} {r:>8}')

    return accuracy


# -- Phase 5: Generate New Periods -----------------------------------------------

def generate_periods(cnhnl_df, start_date, end_date, existing_periods):
    """
    Generate regime periods using 3-day sticky state machine with 1-day lag.

    Initializes state from the last existing regime period color, so continuity
    is maintained at the boundary.
    """
    print(f'\n-- Generating periods ({start_date} to {end_date}) --')

    # Compute state colors for all CNHNL days
    state_colors = classify_3day_sticky(cnhnl_df['daily_net'])
    cnhnl_dates = cnhnl_df.index.strftime('%Y-%m-%d').tolist()
    sorted_cnhnl = sorted(cnhnl_dates)
    state_map = {d: c for d, c in zip(cnhnl_dates, state_colors)}

    # Override: seed the state machine from the last existing period
    # This ensures continuity (if existing data ends Green, we start Green)
    if existing_periods:
        last_period = max(existing_periods, key=lambda p: p['end'])
        last_color = last_period['color']
        last_end = last_period['end']
        # Find CNHNL dates around the boundary and set their state
        # to match the existing data (so we start from the right state)
        print(f'  Seeding from last existing period: {last_end} = {last_color}')

    # Generate all trading days in target range
    trading_days = []
    d = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')
    while d <= end:
        if d.weekday() < 5:
            trading_days.append(d.strftime('%Y-%m-%d'))
        d += timedelta(days=1)

    # Classify each day using prior trading day's state (1-day lag)
    daily_colors = []
    for date_str in trading_days:
        prior = None
        for cd in reversed(sorted_cnhnl):
            if cd < date_str:
                prior = cd
                break
        if prior and prior in state_map:
            color = state_map[prior]
        else:
            color = 'Unknown'
        daily_colors.append((date_str, color))

    if not daily_colors:
        print('  No trading days to classify')
        return []

    # Group consecutive same-color days into periods
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
                'color': cur_color, 'start': cur_start, 'end': cur_end,
                'duration': (e - s).days + 1,
            })
            cur_color = color
            cur_start = date_str
            cur_end = date_str

    s = datetime.strptime(cur_start, '%Y-%m-%d')
    e = datetime.strptime(cur_end, '%Y-%m-%d')
    periods.append({
        'color': cur_color, 'start': cur_start, 'end': cur_end,
        'duration': (e - s).days + 1,
    })

    periods = [p for p in periods if p['color'] != 'Unknown']
    print(f'  Generated {len(periods)} periods:')
    for p in periods:
        print(f"    {p['start']} to {p['end']} = {p['color']} ({p['duration']}d)")
    return periods


# -- Phase 6: Update data.json --------------------------------------------------

def update_data_json(new_periods, dry_run=False):
    """Append new regime3 periods and recompute regime3 stats."""
    print(f'\n-- Updating data.json --')

    with open(DATA_JSON, 'r') as f:
        data = json.load(f)

    existing = data['regimePeriods']['regime3']
    existing_end = max(p['end'] for p in existing)
    print(f'  Existing regime3: {len(existing)} periods, ends at {existing_end}')

    new_to_add = [p for p in new_periods if p['start'] > existing_end]
    if not new_to_add:
        print('  No new periods to add (all overlap with existing data)')
        return

    print(f'  Adding {len(new_to_add)} new periods')
    if dry_run:
        print('  DRY RUN -- not writing to data.json')
        return

    # 1. Add new regime periods
    data['regimePeriods']['regime3'] = existing + new_to_add
    data['regimePeriods']['regime3'].sort(key=lambda p: p['start'])

    # 2. Reclassify regime3 trades using updated periods
    sorted_periods = sorted(data['regimePeriods']['regime3'], key=lambda p: p['start'])

    def get_regime_color(date_str):
        for p in sorted_periods:
            if p['start'] <= date_str <= p['end']:
                return p['color']
        for i in range(len(sorted_periods) - 1):
            if sorted_periods[i]['end'] < date_str < sorted_periods[i + 1]['start']:
                return sorted_periods[i]['color']
        return 'Unknown'

    reclassified = 0
    for t in data['regimeTrades']['regime3']:
        old_color = t['regimeColor']
        new_color = get_regime_color(t['entryDate'])
        if old_color != new_color:
            t['regimeColor'] = new_color
            reclassified += 1

    unknowns = sum(1 for t in data['regimeTrades']['regime3'] if t['regimeColor'] == 'Unknown')
    print(f'  Reclassified {reclassified} trades ({unknowns} still Unknown)')

    # 3. Recompute regime3 stats
    trades = data['regimeTrades']['regime3']
    color_groups = defaultdict(list)
    for t in trades:
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

    data['regimeStats']['regime3'] = regime_stats

    # Print summary
    for color in ['Green', 'Yellow', 'Red', 'Unknown']:
        if color in regime_stats:
            s = regime_stats[color]
            print(f'    {color}: {s["# Trades"]} trades, ${s["Total P&L"]:,.2f}, '
                  f'WR {s["Win Rate"]:.1%}')

    with open(DATA_JSON, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

    total = len(data['regimePeriods']['regime3'])
    new_end = max(p['end'] for p in data['regimePeriods']['regime3'])
    print(f'  Written: {total} total periods, ends at {new_end}')


# -- Main -----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Compute CNHNL regime periods')
    parser.add_argument('--start', help='Start date for new periods (default: auto)')
    parser.add_argument('--end', help='End date (default: today)')
    parser.add_argument('--calibrate-only', action='store_true',
                        help='Only run calibration, skip period generation')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show new periods without writing to data.json')
    parser.add_argument('--no-cache', action='store_true',
                        help='Force fresh data download')
    parser.add_argument('--refresh-tickers', action='store_true',
                        help='Re-download NASDAQ ticker list')
    parser.add_argument('--batch-size', type=int, default=500,
                        help='yfinance download batch size')
    args = parser.parse_args()

    print('=== CNHNL Regime Period Computation ===\n')

    existing_periods = load_existing_regime3()
    existing_end = max(p['end'] for p in existing_periods)
    existing_start = min(p['start'] for p in existing_periods)

    end_date = args.end or datetime.now().strftime('%Y-%m-%d')
    if args.start:
        new_start = args.start
    else:
        last_end = datetime.strptime(existing_end, '%Y-%m-%d')
        new_start = (last_end + timedelta(days=1)).strftime('%Y-%m-%d')

    dl_start = (datetime.strptime(existing_start, '%Y-%m-%d') -
                timedelta(days=400)).strftime('%Y-%m-%d')

    print(f'  Existing regime3: {existing_start} to {existing_end} ({len(existing_periods)} periods)')
    print(f'  New periods target: {new_start} to {end_date}')
    print(f'  Download range: {dl_start} to {end_date}\n')

    # Phase 1: NASDAQ tickers only
    print('Phase 1: NASDAQ equity universe')
    tickers = get_nasdaq_equities(refresh=args.refresh_tickers)

    # Phase 2: Download OHLCV
    print('\nPhase 2: Historical OHLCV data')
    high, low, close, volume = download_ohlcv(
        tickers, dl_start, end_date,
        batch_size=args.batch_size, use_cache=not args.no_cache,
    )

    # Phase 3: Compute CNHNL
    print('\nPhase 3: Daily CNHNL computation')
    cnhnl_df = compute_daily_cnhnl(high, low, close, volume)

    # Phase 4: Calibrate
    print('\nPhase 4: Calibrate against existing regime3')
    accuracy = calibrate(cnhnl_df, existing_periods)

    if args.calibrate_only:
        print('\n(--calibrate-only: stopping here)')
        return

    # Phase 5: Generate new periods
    new_periods = generate_periods(cnhnl_df, new_start, end_date, existing_periods)
    if not new_periods:
        print('No new periods generated')
        return

    # Phase 6: Update data.json (periods + trades + stats)
    update_data_json(new_periods, dry_run=args.dry_run)

    if not args.dry_run:
        print('\nDone!')


if __name__ == '__main__':
    main()
