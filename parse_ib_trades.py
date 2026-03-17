"""
Parse Interactive Brokers CSV trade reports and generate data.json for the dashboard.
Handles 2024, 2025, and 2026 annual/period statements.
"""

import csv
import json
import io
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

# Force UTF-8 output on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class Execution:
    asset_category: str
    symbol: str
    datetime_str: str
    date: str
    quantity: float
    trade_price: float
    proceeds: float
    commission: float
    basis: float
    realized_pnl: float
    code: str

@dataclass
class RoundTrip:
    symbol: str
    asset_category: str
    side: str
    entry_date: str
    exit_date: str
    quantity: float
    entry_price: float
    exit_price: float
    pnl: float
    fees: float
    status: str

# ── CSV Parsing ───────────────────────────────────────────────────────────────

def parse_csv(filepath):
    """Parse an IB CSV file and return a list of Execution objects."""
    executions = []
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if not line.startswith('Trades,Data,Order,'):
                continue
            # Parse the CSV line properly (handles quoted fields with commas)
            row = list(csv.reader([line]))[0]
            if len(row) < 16:
                continue

            asset_category = row[3].strip()
            symbol = row[5].strip()
            datetime_str = row[6].strip().strip('"')
            date = datetime_str.split(',')[0].strip()
            quantity = float(row[7].replace(',', '').strip())
            trade_price = float(row[8].strip()) if row[8].strip() else 0
            proceeds = float(row[10].replace(',', '').strip()) if row[10].strip() else 0
            commission = float(row[11].replace(',', '').strip()) if row[11].strip() else 0
            basis = float(row[12].replace(',', '').strip()) if row[12].strip() else 0
            realized_pnl = float(row[13].replace(',', '').strip()) if row[13].strip() else 0
            code = row[15].strip() if len(row) > 15 else ''

            executions.append(Execution(
                asset_category=asset_category,
                symbol=symbol,
                datetime_str=datetime_str,
                date=date,
                quantity=quantity,
                trade_price=trade_price,
                proceeds=proceeds,
                commission=commission,
                basis=basis,
                realized_pnl=realized_pnl,
                code=code,
            ))
    return executions

# ── Round-Trip Grouping ───────────────────────────────────────────────────────

def build_trip(symbol, asset_category, entries, exits, is_open=False):
    """Build a RoundTrip from entry and exit execution records."""
    if not entries:
        return None

    side = 'Buy' if entries[0]['qty'] > 0 else 'Sell'
    total_qty = sum(abs(e['qty']) for e in entries)
    entry_cost = sum(abs(e['qty']) * e['price'] for e in entries)
    avg_entry = entry_cost / total_qty if total_qty else 0

    if exits:
        exit_proceeds = sum(abs(e['qty']) * e['price'] for e in exits)
        total_exit_qty = sum(abs(e['qty']) for e in exits)
        avg_exit = exit_proceeds / total_exit_qty if total_exit_qty else 0
    else:
        avg_exit = 0

    entry_date = min(e['date'] for e in entries)
    exit_date = max(e['date'] for e in exits) if exits else entry_date
    pnl = sum(e.get('pnl', 0) for e in exits)
    fees = sum(e['comm'] for e in entries) + sum(e['comm'] for e in exits)

    return RoundTrip(
        symbol=symbol,
        asset_category=asset_category,
        side=side,
        entry_date=entry_date,
        exit_date=exit_date,
        quantity=round(total_qty, 4),
        entry_price=round(avg_entry, 6),
        exit_price=round(avg_exit, 6),
        pnl=round(pnl, 2),
        fees=round(fees, 2),
        status='Open' if is_open else 'Closed',
    )


def group_round_trips(executions):
    """Group executions into round-trip trades per symbol."""
    by_symbol = defaultdict(list)
    for ex in executions:
        by_symbol[ex.symbol].append(ex)

    trips = []

    for symbol, execs in by_symbol.items():
        execs.sort(key=lambda e: e.datetime_str)
        position = 0.0
        trip_entries = []
        trip_exits = []
        current_asset_cat = execs[0].asset_category

        for ex in execs:
            codes = set(ex.code.replace(' ', '').split(';'))
            current_asset_cat = ex.asset_category
            is_open = 'O' in codes
            is_close = 'C' in codes

            # Handle C;O;P flip trades (close existing + open new in one execution)
            if is_close and is_open:
                close_qty = -position  # qty needed to flatten
                open_qty = ex.quantity - close_qty
                total_abs = abs(ex.quantity)
                close_ratio = abs(close_qty) / total_abs if total_abs else 0

                # Close portion
                trip_exits.append({
                    'qty': close_qty,
                    'price': ex.trade_price,
                    'date': ex.date,
                    'comm': ex.commission * close_ratio,
                    'pnl': ex.realized_pnl,
                })

                # Finalize the current trip
                trip = build_trip(symbol, current_asset_cat, trip_entries, trip_exits)
                if trip:
                    trips.append(trip)

                # Start new trip with open portion
                position = open_qty
                trip_entries = [{
                    'qty': open_qty,
                    'price': ex.trade_price,
                    'date': ex.date,
                    'comm': ex.commission * (1 - close_ratio),
                }]
                trip_exits = []
                continue

            if is_open:
                # Starting a new trip or adding to current
                if abs(position) < 0.01:
                    trip_entries = []
                    trip_exits = []
                trip_entries.append({
                    'qty': ex.quantity,
                    'price': ex.trade_price,
                    'date': ex.date,
                    'comm': ex.commission,
                })
                position += ex.quantity

            elif is_close:
                trip_exits.append({
                    'qty': ex.quantity,
                    'price': ex.trade_price,
                    'date': ex.date,
                    'comm': ex.commission,
                    'pnl': ex.realized_pnl,
                })
                position += ex.quantity

                # Trip complete when position is flat
                if abs(position) < 0.01:
                    trip = build_trip(symbol, current_asset_cat, trip_entries, trip_exits)
                    if trip:
                        trips.append(trip)
                    trip_entries = []
                    trip_exits = []
                    position = 0.0

        # Handle remaining open positions
        if abs(position) > 0.01 and trip_entries:
            trip = build_trip(symbol, current_asset_cat, trip_entries, trip_exits, is_open=True)
            if trip:
                trips.append(trip)

    return trips

# ── Regime Color Assignment ───────────────────────────────────────────────────

def get_regime_color(date_str, periods):
    for p in periods:
        if p['start'] <= date_str <= p['end']:
            return p['color']
    return 'Unknown'


def assign_regime_colors(trades, all_regime_periods):
    """Assign regime colors to trades based on exit date, for each regime definition."""
    result = {}
    for regime_key, periods in all_regime_periods.items():
        regime_trades = []
        for i, t in enumerate(trades):
            trade_dict = {
                'tradeId': i,
                'date': t.exit_date,  # backward compat
                'entryDate': t.entry_date,
                'exitDate': t.exit_date,
                'symbol': t.symbol,
                'side': t.side,
                'type': t.asset_category,
                'qty': t.quantity,
                'entry': t.entry_price,
                'exit': t.exit_price,
                'pnl': t.pnl,
                'fees': t.fees,
                'status': t.status,
                'regimeColor': get_regime_color(t.exit_date, periods),
            }
            regime_trades.append(trade_dict)
        result[regime_key] = regime_trades
    return result

# ── Equity Curve ──────────────────────────────────────────────────────────────

def build_equity_curve(trades):
    """Build daily equity curve from closed trades, summing P&L by exit date."""
    daily = defaultdict(lambda: {'pnl': 0.0, 'count': 0})
    for t in trades:
        if t.status == 'Closed':
            daily[t.exit_date]['pnl'] += t.pnl
            daily[t.exit_date]['count'] += 1

    sorted_dates = sorted(daily.keys())
    curve = []
    cum_pnl = 0.0
    peak = 0.0

    for date in sorted_dates:
        day = daily[date]
        cum_pnl += day['pnl']
        peak = max(peak, cum_pnl)
        drawdown = cum_pnl - peak
        curve.append({
            'date': date,
            'dailyPnL': round(day['pnl'], 2),
            'cumPnL': round(cum_pnl, 2),
            'trades': day['count'],
            'peak': round(peak, 2),
            'drawdown': round(drawdown, 2),
            'regimeColor': 'Unknown',
        })
    return curve

# ── Regime Stats ──────────────────────────────────────────────────────────────

def compute_regime_stats(regime_trades):
    """Compute stats per regime in the format expected by the dashboard."""
    stats = {}
    for regime_key, trades in regime_trades.items():
        color_groups = defaultdict(list)
        for t in trades:
            if t['status'] == 'Closed':
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

            regime_stats[color] = {
                '# Trades': n,
                'Total P&L': round(total_pnl, 2),
                'Avg P&L per Trade': round(total_pnl / n, 2) if n else 0,
                'Median P&L': round(sorted(pnls)[n // 2], 2) if n else 0,
                'Win Rate': round(len(winners) / n, 4) if n else 0,
                '# Winners': len(winners),
                '# Losers': len(losers),
                'Best Trade': round(max(pnls), 2) if pnls else 0,
                'Worst Trade': round(min(pnls), 2) if pnls else 0,
                'Profit Factor': round(gross_profit / gross_loss, 4) if gross_loss > 0 else 0,
            }

        stats[regime_key] = regime_stats
    return stats

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    csv_files = [
        r'C:\Users\Miggoy\Downloads\U1673914_U1673914_20240101_20241231_AS_Fv2_d0fc5081635c91ff597577ea72b837bb.csv',
        r'C:\Users\Miggoy\Downloads\U1673914_U1673914_20250101_20251231_AS_Fv2_a9c19bd58d06226befd0508dd6ac4c1e.csv',
        r'C:\Users\Miggoy\Downloads\U1673914_20260101_20260313.csv',
    ]

    # 1. Parse all executions
    all_executions = []
    for path in csv_files:
        execs = parse_csv(path)
        print(f'Parsed {path.split(chr(92))[-1]}: {len(execs)} executions')
        all_executions.extend(execs)
    print(f'Total executions: {len(all_executions)}')

    # 2. Group into round-trip trades
    trades = group_round_trips(all_executions)
    trades.sort(key=lambda t: (t.exit_date, t.entry_date, t.symbol))

    closed = [t for t in trades if t.status == 'Closed']
    opened = [t for t in trades if t.status == 'Open']
    stocks = [t for t in closed if t.asset_category == 'Stocks']
    options = [t for t in closed if t.asset_category != 'Stocks']

    print(f'\nRound-trip trades: {len(trades)} ({len(closed)} closed, {len(opened)} open)')
    print(f'  Stocks: {len(stocks)}, Options: {len(options)}')

    total_pnl = sum(t.pnl for t in closed)
    print(f'  Total P&L (closed): ${total_pnl:,.2f}')

    # Show open positions
    if opened:
        print(f'\nOpen positions ({len(opened)}):')
        for t in opened:
            print(f'  {t.symbol}: {t.side} {t.quantity} @ {t.entry_price:.2f} (entry {t.entry_date})')

    # 3. Load existing regime periods
    with open('data.json', 'r') as f:
        old_data = json.load(f)
    regime_periods = old_data['regimePeriods']

    # 4. Assign regime colors
    regime_trades = assign_regime_colors(closed, regime_periods)

    # 5. Build equity curve
    equity_curve = build_equity_curve(closed)
    print(f'\nEquity curve: {len(equity_curve)} trading days')
    if equity_curve:
        print(f'  Date range: {equity_curve[0]["date"]} to {equity_curve[-1]["date"]}')
        print(f'  Final cumPnL: ${equity_curve[-1]["cumPnL"]:,.2f}')

    # 6. Compute regime stats
    regime_stats = compute_regime_stats(regime_trades)

    # Print summary per regime
    for rk in ['regime1', 'regime2', 'regime3']:
        all_stats = regime_stats[rk].get('All', {})
        n = all_stats.get('# Trades', 0)
        pnl = all_stats.get('Total P&L', 0)
        wr = all_stats.get('Win Rate', 0)
        print(f'  {rk}: {n} trades, P&L: ${pnl:,.2f}, Win rate: {wr:.1%}')

    # 7. Validate uniqueness of (symbol, entryDate)
    seen = set()
    dupes = 0
    for t in regime_trades['regime1']:
        key = (t['symbol'], t['entryDate'])
        if key in seen:
            dupes += 1
            print(f'  WARNING: duplicate key {key}')
        seen.add(key)
    if dupes == 0:
        print(f'\n  (symbol, entryDate) uniqueness: OK ({len(seen)} unique keys)')
    else:
        print(f'\n  WARNING: {dupes} duplicate (symbol, entryDate) keys')

    # 8. Write output
    output = {
        'equityCurve': equity_curve,
        'regimeTrades': regime_trades,
        'regimeStats': regime_stats,
        'regimePeriods': regime_periods,
    }

    with open('data.json', 'w') as f:
        json.dump(output, f)

    print(f'\nWritten data.json with {len(closed)} trades, {len(equity_curve)} equity curve days')


if __name__ == '__main__':
    main()
