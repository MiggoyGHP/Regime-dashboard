"""
Parse Interactive Brokers CSV trade reports and generate data.json for the dashboard.
Handles 2024, 2025, and 2026 annual/period statements.
"""

import csv
import json
import io
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime as _dt
from typing import Optional
import pickle
import openpyxl
import yfinance as yf

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
    strategy: str = ''
    entry_legs: list = field(default_factory=list)
    exit_legs: list = field(default_factory=list)

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

def _legs_by_date(execs):
    """Collapse per-execution fills into one weighted-avg leg per trading day."""
    by_date = defaultdict(lambda: {'qty': 0.0, 'notional': 0.0})
    for e in execs:
        q = abs(e['qty'])
        by_date[e['date']]['qty'] += q
        by_date[e['date']]['notional'] += q * e['price']
    return [
        {
            'date': d,
            'qty': round(v['qty'], 4),
            'price': round(v['notional'] / v['qty'], 6) if v['qty'] else 0,
        }
        for d, v in sorted(by_date.items())
    ]


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
        entry_legs=_legs_by_date(entries),
        exit_legs=_legs_by_date(exits) if exits else [],
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

# ── Options Combo Detection ──────────────────────────────────────────────────

def parse_option_symbol(symbol):
    """Parse 'AAPL 16FEB24 180 P' → (underlying, expiry, strike, opt_type) or None."""
    parts = symbol.strip().split()
    if len(parts) >= 4:
        try:
            strike = float(parts[2])
            return (parts[0], parts[1], strike, parts[3])
        except ValueError:
            return None
    return None


def fmt_strike(strike):
    """Format strike: 5130.0 → '5130', 72.5 → '72.5'."""
    return str(int(strike)) if strike == int(strike) else str(strike)


def identify_strategy(legs):
    """Identify the options strategy from grouped legs."""
    calls = [l for l in legs if l['opt_type'] == 'C']
    puts = [l for l in legs if l['opt_type'] == 'P']
    buys = [l for l in legs if l['trade'].side == 'Buy']
    sells = [l for l in legs if l['trade'].side == 'Sell']
    n = len(legs)

    if n == 4 and len(calls) == 2 and len(puts) == 2:
        return 'Iron Condor'
    elif n == 2 and len(buys) == 1 and len(sells) == 1:
        if len(calls) == 2:
            sell_strike = [l['strike'] for l in legs if l['trade'].side == 'Sell'][0]
            buy_strike = [l['strike'] for l in legs if l['trade'].side == 'Buy'][0]
            return 'Bear Call Spread' if sell_strike < buy_strike else 'Bull Call Spread'
        elif len(puts) == 2:
            sell_strike = [l['strike'] for l in legs if l['trade'].side == 'Sell'][0]
            buy_strike = [l['strike'] for l in legs if l['trade'].side == 'Buy'][0]
            return 'Bull Put Spread' if sell_strike > buy_strike else 'Bear Put Spread'
    return f'{n}-Leg Combo'


def build_combo_symbol(underlying, expiry, strategy, legs):
    """Build a descriptive symbol for a combo trade."""
    if strategy == 'Iron Condor':
        calls = sorted([l for l in legs if l['opt_type'] == 'C'], key=lambda l: l['strike'])
        puts = sorted([l for l in legs if l['opt_type'] == 'P'], key=lambda l: l['strike'])
        return (f"{underlying} IC "
                f"{fmt_strike(calls[0]['strike'])}/{fmt_strike(calls[1]['strike'])}C "
                f"{fmt_strike(puts[0]['strike'])}/{fmt_strike(puts[1]['strike'])}P "
                f"{expiry}")
    elif 'Call Spread' in strategy:
        strikes = sorted([l['strike'] for l in legs])
        abbr = 'BCS' if strategy == 'Bear Call Spread' else 'BullCS'
        return f"{underlying} {abbr} {fmt_strike(strikes[0])}/{fmt_strike(strikes[1])}C {expiry}"
    elif 'Put Spread' in strategy:
        strikes = sorted([l['strike'] for l in legs])
        abbr = 'BPS' if strategy == 'Bull Put Spread' else 'BearPS'
        return f"{underlying} {abbr} {fmt_strike(strikes[0])}/{fmt_strike(strikes[1])}P {expiry}"
    else:
        return f"{underlying} {strategy} {expiry}"


def detect_and_merge_combos(trades):
    """Post-process round trips to detect and merge multi-leg option combos."""
    stock_trades = []
    option_trades = []

    for t in trades:
        if t.asset_category == 'Equity and Index Options':
            option_trades.append(t)
        else:
            stock_trades.append(t)

    if not option_trades:
        return trades

    # Parse option info for each leg
    option_info = []
    unparseable = []
    for t in option_trades:
        parsed = parse_option_symbol(t.symbol)
        if parsed:
            underlying, expiry, strike, opt_type = parsed
            option_info.append({
                'trade': t,
                'underlying': underlying,
                'expiry': expiry,
                'strike': strike,
                'opt_type': opt_type,
            })
        else:
            unparseable.append(t)

    # Group by (underlying, expiry, entry_date)
    groups = defaultdict(list)
    for info in option_info:
        key = (info['underlying'], info['expiry'], info['trade'].entry_date)
        groups[key].append(info)

    merged_trades = list(stock_trades) + unparseable
    combo_count = 0

    for key, legs in groups.items():
        underlying, expiry, entry_date = key

        if len(legs) < 2:
            # Single-leg option: assign strategy name
            leg = legs[0]
            t = leg['trade']
            opt_label = 'Call' if leg['opt_type'] == 'C' else 'Put'
            t.strategy = f"Long {opt_label}" if t.side == 'Buy' else f"Short {opt_label}"
            merged_trades.append(t)
            continue

        # Check for mixed directions (both buy and sell) → combo
        sides = set(l['trade'].side for l in legs)
        if len(sides) < 2:
            # All same direction = not a combo, keep individual legs
            for l in legs:
                t = l['trade']
                opt_label = 'Call' if l['opt_type'] == 'C' else 'Put'
                t.strategy = f"Long {opt_label}" if t.side == 'Buy' else f"Short {opt_label}"
                merged_trades.append(t)
            continue

        # ── This is a combo! ──
        strategy = identify_strategy(legs)
        combo_symbol = build_combo_symbol(underlying, expiry, strategy, legs)

        # Combined metrics
        total_pnl = sum(l['trade'].pnl for l in legs)
        total_fees = sum(l['trade'].fees for l in legs)
        combo_entry_date = min(l['trade'].entry_date for l in legs)
        combo_exit_date = max(l['trade'].exit_date for l in legs)
        qty = min(l['trade'].quantity for l in legs)

        # Net entry/exit price per unit
        # Sell legs contribute +price (premium received), buy legs contribute -price (premium paid)
        net_entry = 0
        net_exit = 0
        for l in legs:
            t = l['trade']
            if t.side == 'Sell':
                net_entry += t.entry_price
                net_exit += t.exit_price
            else:
                net_entry -= t.entry_price
                net_exit -= t.exit_price

        combo_side = 'Sell' if net_entry > 0 else 'Buy'

        combo = RoundTrip(
            symbol=combo_symbol,
            asset_category='Equity and Index Options',
            side=combo_side,
            entry_date=combo_entry_date,
            exit_date=combo_exit_date,
            quantity=round(qty, 4),
            entry_price=round(abs(net_entry), 6),
            exit_price=round(abs(net_exit), 6),
            pnl=round(total_pnl, 2),
            fees=round(total_fees, 2),
            status='Closed' if all(l['trade'].status == 'Closed' for l in legs) else 'Open',
            strategy=strategy,
        )

        merged_trades.append(combo)
        combo_count += 1
        print(f'  COMBO: {combo_symbol} ({strategy}) → P&L: ${total_pnl:,.2f}')

    single_opts = len([t for t in merged_trades if t.asset_category == 'Equity and Index Options' and not t.strategy.startswith(('Iron', 'Bear', 'Bull'))])
    print(f'\nOptions combo detection: {combo_count} combos merged, {single_opts} single-leg options kept')
    return merged_trades


# ── Regime Color Assignment ───────────────────────────────────────────────────

def get_regime_color(date_str, sorted_periods):
    """Assign regime color with gap tolerance for holiday gaps."""
    # 1. Exact match within a period
    for p in sorted_periods:
        if p['start'] <= date_str <= p['end']:
            return p['color']
    # 2. If date falls in a gap between periods, use preceding period's color
    for i in range(len(sorted_periods) - 1):
        if sorted_periods[i]['end'] < date_str < sorted_periods[i+1]['start']:
            return sorted_periods[i]['color']
    # 3. Beyond data range → Unknown (user will provide updated data later)
    return 'Unknown'


def assign_regime_colors(trades, all_regime_periods):
    """Assign regime colors to trades based on entry date, for each regime definition."""
    result = {}
    for regime_key, periods in all_regime_periods.items():
        sorted_periods = sorted(periods, key=lambda p: p['start'])
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
                'strategy': t.strategy,
                'primaryStrategy': '',
                'tradeType': '',
                'regimeColor': get_regime_color(t.entry_date, sorted_periods),
                'entryLegs': t.entry_legs,
                'exitLegs': t.exit_legs,
            }
            regime_trades.append(trade_dict)
        result[regime_key] = regime_trades
    return result

# ── TMS Tags ─────────────────────────────────────────────────────────────────

def load_tms_tags(script_dir):
    """Load primary_strategy and trade_type from TMS data.csv."""
    from datetime import datetime
    tms_path = os.path.join(script_dir, 'TMS data.csv')
    tms_lookup = {}
    try:
        with open(tms_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                symbol = row['symbol'].strip()
                fbd = row['first_buy_date'].strip()
                if not fbd:
                    continue
                entry_date = datetime.strptime(fbd, '%m/%d/%Y').strftime('%Y-%m-%d')
                key = (symbol, entry_date)
                tms_lookup[key] = {
                    'primaryStrategy': row['primary_strategy'].strip(),
                    'tradeType': row['trade_type'].strip(),
                }
        print(f'  TMS tags loaded: {len(tms_lookup)} unique (symbol, date) keys')
    except FileNotFoundError:
        print('  WARNING: TMS data.csv not found, tags will be empty')
    return tms_lookup

def apply_tms_tags(regime_trades, tms_lookup):
    """Apply TMS strategy and trade type tags to regime trades."""
    matched = 0
    total = 0
    for regime_key, trades in regime_trades.items():
        for t in trades:
            total += 1
            key = (t['symbol'], t['entryDate'])
            if key in tms_lookup:
                t['primaryStrategy'] = tms_lookup[key]['primaryStrategy']
                t['tradeType'] = tms_lookup[key]['tradeType']
                matched += 1
    n_regimes = len(regime_trades)
    if n_regimes and total:
        print(f'  TMS tag matching: {matched // n_regimes}/{total // n_regimes} trades matched '
              f'({matched // n_regimes / (total // n_regimes) * 100:.1f}%)')

# ── Mothersheet Orders (planned entry / cut / risk) ──────────────────────────

def _fnum(s):
    """Parse a number cell that may contain commas or a trailing %."""
    if s is None:
        return None
    s = str(s).replace(',', '').strip().rstrip('%')
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None

MOTHERSHEET_FORWARD_DAYS = 10   # sheet DateAdded → dashboard entry (watchlist delay)
MOTHERSHEET_BACKWARD_DAYS = 2   # tolerance for backdated sheet entries

def load_mothersheet_orders(script_dir):
    """Load planned entry / cut / risk data from Golden Hotpot Mothersheet yearly Orders CSVs.

    Column mapping (verified against sizing math on filled rows):
      VAR         → $ risk per trade
      Entry Limit → planned entry price (what we sized against)
      Sizing      → full stop-loss price (Shares ≈ VAR / |EntryStop - Sizing|)
      Cut         → planned discretionary cut / trailing exit
      Return      → self-recorded R-multiple
      'Date'/untitled col after '7 day % change' → fill date (2024 is untitled)

    Returns a dict  symbol → sorted list of aggregated rows, where each row has
    an `anchorDate` (fillDate if present, else dateAdded) and the merged payload.
    Rows sharing the same (symbol, anchorDate) are merged: sum VAR/Shares,
    share-weighted mean of prices and recordedR. Matching-to-trades with a
    date window is done in apply_mothersheet_orders().
    """
    from datetime import datetime
    files = [
        'Golden Hotpot Mothersheet 2024 - Orders.csv',
        'Golden Hotpot Mothersheet 2025 - Orders.csv',
        'Golden Hotpot Mothersheet 2026 - Orders.csv',
    ]
    raw_rows = []
    total_filled_seen = 0
    for fname in files:
        path = os.path.join(script_dir, fname)
        if not os.path.exists(path):
            print(f'  WARNING: {fname} not found, skipping')
            continue
        with open(path, 'r', encoding='utf-8-sig') as f:
            all_rows = list(csv.reader(f))

        header_idx = None
        for i, row in enumerate(all_rows):
            cells = [c.strip() for c in row]
            if 'Stock' in cells and 'VAR' in cells and 'Order Filled' in cells:
                header_idx = i
                break
        if header_idx is None:
            print(f'  WARNING: {fname}: no header row found, skipping')
            continue

        header = [c.strip() for c in all_rows[header_idx]]
        col = {name: header.index(name) for name in (
            'Stock', 'Date Added', 'VAR', 'Entry Stop', 'Entry Limit',
            'Sizing', 'Cut', 'Shares', 'Order Filled', 'Cancel Order', 'Return',
        ) if name in header}
        if 'Date' in header:
            col['FillDate'] = header.index('Date')
        elif '7 day % change' in header:
            col['FillDate'] = header.index('7 day % change') + 1

        def _iso(raw):
            raw = (raw or '').strip()
            if not raw:
                return None
            try:
                return datetime.strptime(raw, '%m/%d/%Y').strftime('%Y-%m-%d')
            except ValueError:
                return None

        file_filled = 0
        for row in all_rows[header_idx + 1:]:
            def get(name):
                idx = col.get(name)
                if idx is None or idx >= len(row):
                    return ''
                return row[idx].strip()

            if get('Order Filled').upper() != 'TRUE':
                continue
            if get('Cancel Order').upper() == 'TRUE':
                continue
            stock = get('Stock').upper()
            if not stock:
                continue

            date_added = _iso(get('Date Added'))
            fill_date = _iso(get('FillDate'))
            anchor = fill_date or date_added
            if anchor is None:
                continue

            file_filled += 1
            raw_rows.append({
                'symbol': stock,
                'anchorDate': anchor,
                'dateAdded': date_added,
                'fillDate': fill_date,
                'plannedEntry': _fnum(get('Entry Limit')) or _fnum(get('Entry Stop')),
                'plannedStop': _fnum(get('Sizing')),
                'plannedCut': _fnum(get('Cut')),
                'riskDollars': _fnum(get('VAR')),
                'plannedShares': _fnum(get('Shares')),
                'recordedR': _fnum(get('Return')),
            })
        total_filled_seen += file_filled
        print(f'  {fname}: {file_filled} filled rows')

    # Merge rows that share the exact same (symbol, anchorDate).
    groups = defaultdict(list)
    for r in raw_rows:
        groups[(r['symbol'], r['anchorDate'])].append(r)

    by_symbol = defaultdict(list)
    for (symbol, anchor), rows in groups.items():
        def _wavg(field):
            weighted = [(r[field], r['plannedShares'] or 1) for r in rows if r[field] is not None]
            if not weighted:
                return None
            num = sum(v * w for v, w in weighted)
            den = sum(w for _, w in weighted)
            return round(num / den, 4) if den else None

        risk_vals = [r['riskDollars'] for r in rows if r['riskDollars'] is not None]
        share_vals = [r['plannedShares'] for r in rows if r['plannedShares'] is not None]
        by_symbol[symbol].append({
            'anchorDate': anchor,
            'fillDate': rows[0]['fillDate'],
            'dateAdded': rows[0]['dateAdded'],
            'plannedEntry': _wavg('plannedEntry'),
            'plannedStop': _wavg('plannedStop'),
            'plannedCut': _wavg('plannedCut'),
            'riskDollars': round(sum(risk_vals), 2) if risk_vals else None,
            'plannedShares': round(sum(share_vals), 2) if share_vals else None,
            'recordedR': _wavg('recordedR'),
            'rowCount': len(rows),
        })

    total_sheet_rows = 0
    for symbol in by_symbol:
        by_symbol[symbol].sort(key=lambda r: r['anchorDate'])
        total_sheet_rows += len(by_symbol[symbol])

    print(f'  Mothersheet orders: {total_filled_seen} filled rows -> '
          f'{total_sheet_rows} aggregated entries across {len(by_symbol)} symbols')
    return dict(by_symbol)


def apply_mothersheet_orders(regime_trades, by_symbol):
    """Attach planned entry/cut/risk and compute rMultiple on each stock trade.

    Matching rule (per dashboard stock trade, greedy by entry date):
      - look at same-symbol sheet rows not yet consumed
      - accept offset (dashboard_entry - sheet_anchor) in [-BACK, +FORWARD] days
      - prefer smallest non-negative offset (watchlist-then-entered is the dominant case)
      - then smallest |offset|
      - consume the chosen row so it can't match a second trade
    Options trades and un-matched stock trades get null fields so the JSON
    schema is uniform for the UI.
    """
    from datetime import datetime
    if not regime_trades:
        return

    first_regime = next(iter(regime_trades))
    canonical = sorted(regime_trades[first_regime], key=lambda t: t['entryDate'])
    stock_total = sum(1 for t in canonical if t['type'] == 'Stocks')

    consumed_ids = set()
    enrichment_by_tradeid = {}
    total_sheet_rows = sum(len(rows) for rows in by_symbol.values())
    consumed_count = 0

    for t in canonical:
        if t['type'] != 'Stocks':
            continue
        underlying = t['symbol'].split(' ')[0].upper()
        rows = by_symbol.get(underlying)
        if not rows:
            continue
        try:
            edate = datetime.strptime(t['entryDate'], '%Y-%m-%d')
        except ValueError:
            continue

        best = None
        best_key = None
        for row in rows:
            if id(row) in consumed_ids:
                continue
            rdate = datetime.strptime(row['anchorDate'], '%Y-%m-%d')
            offset = (edate - rdate).days
            if offset < -MOTHERSHEET_BACKWARD_DAYS or offset > MOTHERSHEET_FORWARD_DAYS:
                continue
            sort_key = (0 if offset >= 0 else 1, abs(offset))
            if best is None or sort_key < best_key:
                best = row
                best_key = sort_key
        if best is None:
            continue
        consumed_ids.add(id(best))
        consumed_count += 1
        enrichment_by_tradeid[t['tradeId']] = best

    for trades in regime_trades.values():
        for t in trades:
            t['plannedEntry'] = None
            t['plannedStop'] = None
            t['plannedCut'] = None
            t['riskDollars'] = None
            t['plannedShares'] = None
            t['recordedR'] = None
            t['rMultiple'] = None
            data = enrichment_by_tradeid.get(t['tradeId'])
            if not data:
                continue
            t['plannedEntry'] = data['plannedEntry']
            t['plannedStop'] = data['plannedStop']
            t['plannedCut'] = data['plannedCut']
            t['riskDollars'] = data['riskDollars']
            t['plannedShares'] = data['plannedShares']
            t['recordedR'] = data['recordedR']
            if data['riskDollars']:
                t['rMultiple'] = round(t['pnl'] / data['riskDollars'], 3)

    pct = (consumed_count / stock_total * 100) if stock_total else 0
    print(f'  Mothersheet matching: {consumed_count}/{stock_total} stock trades enriched '
          f'({pct:.1f}%; window [-{MOTHERSHEET_BACKWARD_DAYS}d, +{MOTHERSHEET_FORWARD_DAYS}d])')
    leftover = total_sheet_rows - consumed_count
    if leftover > 0:
        print(f'  Filled orders with no dashboard trade: {leftover} '
              f'(likely scalps/side trades not in fund)')

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

# ── Overlay Data (SPX, VIX, MMTH) ────────────────────────────────────────────

def _download_yf_series(ticker, label, start_date, end_date):
    """Download a single yfinance ticker and return as [{time, value}]."""
    try:
        df = yf.download(ticker, start=start_date, end=end_date, auto_adjust=True, progress=False)
        data = [
            {'time': d.strftime('%Y-%m-%d'), 'value': round(float(row['Close'].iloc[0]), 2)}
            for d, row in df.iterrows()
        ]
        print(f'  {label}: {len(data)} data points')
        return data
    except Exception as e:
        print(f'  {label} download failed: {e}')
        return []

def build_overlay_data(equity_curve):
    """Download SPX/VIX from yfinance and load MMTH from Excel, aligned to equity curve dates."""
    if not equity_curve:
        return {}

    start_date = equity_curve[0]['date']
    end_date = equity_curve[-1]['date']
    overlays = {}

    overlays['spx'] = _download_yf_series('^GSPC', 'SPX', start_date, end_date)
    overlays['vix'] = _download_yf_series('^VIX', 'VIX', start_date, end_date)

    # MMTH from Excel
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        mmth_path = os.path.join(script_dir, 'MMTH data.xlsx')
        wb = openpyxl.load_workbook(mmth_path, read_only=True)
        ws = wb['Sheet1']
        mmth_data = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            dt = row[0]   # Time column
            latest = row[4]  # Latest column (close value)
            if dt and latest is not None:
                date_str = dt.strftime('%Y-%m-%d')
                if start_date <= date_str <= end_date:
                    mmth_data.append({'time': date_str, 'value': round(float(latest), 2)})
        wb.close()
        # Excel is sorted newest-first, so sort chronologically
        mmth_data.sort(key=lambda x: x['time'])
        overlays['mmth'] = mmth_data
        print(f'  MMTH: {len(overlays["mmth"])} data points')
    except Exception as e:
        print(f'  MMTH load failed: {e}')
        overlays['mmth'] = []

    return overlays

# ── OHLC Data Sync ────────────────────────────────────────────────────────────

def sync_ohlc_data(trades):
    """Download missing OHLC data for any traded symbols not already in ohlc.json."""
    ohlc_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ohlc.json')
    with open(ohlc_path, 'r') as f:
        ohlc = json.load(f)

    # Collect unique base tickers from trades
    symbols = set()
    for t in trades:
        base = t.symbol.split(' ')[0]
        symbols.add(base)

    missing = sorted(symbols - set(ohlc.keys()))
    if not missing:
        print(f'OHLC sync: all {len(symbols)} traded symbols present')
        return

    print(f'OHLC sync: {len(missing)} missing symbols to download: {", ".join(missing)}')

    # Use same date range as existing data
    start_date = '2023-01-03'
    end_date = _dt.now().strftime('%Y-%m-%d')

    added = 0
    for sym in missing:
        try:
            df = yf.download(sym, start=start_date, end=end_date, auto_adjust=True, progress=False)
            if df.empty:
                print(f'  {sym}: no data returned')
                continue
            candles = []
            for d, row in df.iterrows():
                candles.append({
                    't': d.strftime('%Y-%m-%d'),
                    'o': round(float(row['Open'].iloc[0]), 4),
                    'h': round(float(row['High'].iloc[0]), 4),
                    'l': round(float(row['Low'].iloc[0]), 4),
                    'c': round(float(row['Close'].iloc[0]), 4),
                    'v': int(row['Volume'].iloc[0]),
                })
            ohlc[sym] = candles
            added += 1
            print(f'  {sym}: {len(candles)} candles')
        except Exception as e:
            print(f'  {sym}: download failed: {e}')

    if added > 0:
        with open(ohlc_path, 'w') as f:
            json.dump(ohlc, f)
        print(f'OHLC sync: added {added} symbols, total now {len(ohlc)}')

def sync_earnings_data(trades):
    """Fetch historical + upcoming earnings dates for every traded symbol.

    Returns dict: { symbol: ["YYYY-MM-DD", ...] } sorted ascending.
    Cached to earnings_cache.pkl to avoid re-hitting yfinance on every run.
    """
    root = os.path.dirname(os.path.abspath(__file__))
    cache_path = os.path.join(root, 'earnings_cache.pkl')

    cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'rb') as f:
                cache = pickle.load(f)
        except Exception:
            cache = {}

    symbols = sorted({t.symbol.split(' ')[0] for t in trades})
    missing = [s for s in symbols if s not in cache]
    if missing:
        print(f'Earnings sync: fetching {len(missing)} symbols')
        for sym in missing:
            try:
                ticker = yf.Ticker(sym)
                df = ticker.get_earnings_dates(limit=80)
                if df is None or df.empty:
                    cache[sym] = []
                    continue
                dates = sorted({d.strftime('%Y-%m-%d') for d in df.index})
                cache[sym] = dates
                print(f'  {sym}: {len(dates)} earnings dates')
            except Exception as e:
                print(f'  {sym}: fetch failed: {e}')
                cache[sym] = []
        try:
            with open(cache_path, 'wb') as f:
                pickle.dump(cache, f)
        except Exception as e:
            print(f'  earnings cache save failed: {e}')
    else:
        print(f'Earnings sync: all {len(symbols)} symbols cached')

    return {s: cache.get(s, []) for s in symbols}


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

            avg_win = (gross_profit / len(winners)) if winners else 0
            avg_loss = (gross_loss / len(losers)) if losers else 0
            edge_ratio = round(avg_win / avg_loss, 4) if avg_loss > 0 else 0

            # Average holding period in days
            holding_days = []
            for t in ctrades:
                if t.get('entryDate') and t.get('exitDate'):
                    try:
                        d1 = _dt.strptime(t['entryDate'], '%Y-%m-%d')
                        d2 = _dt.strptime(t['exitDate'], '%Y-%m-%d')
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
                'Avg Holding Period': avg_hold,
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

    # 2b. Detect and merge option combos
    print(f'\nPre-combo round trips: {len(trades)}')
    trades = detect_and_merge_combos(trades)
    trades.sort(key=lambda t: (t.exit_date, t.entry_date, t.symbol))

    closed = [t for t in trades if t.status == 'Closed']
    opened = [t for t in trades if t.status == 'Open']
    stocks = [t for t in closed if t.asset_category == 'Stocks']
    options = [t for t in closed if t.asset_category != 'Stocks']
    combos = [t for t in options if t.strategy in ('Iron Condor', 'Bear Call Spread', 'Bull Put Spread', 'Bull Call Spread', 'Bear Put Spread')]
    single_opts = [t for t in options if t not in combos]

    print(f'\nRound-trip trades: {len(trades)} ({len(closed)} closed, {len(opened)} open)')
    print(f'  Stocks: {len(stocks)}, Options: {len(options)} ({len(combos)} combos, {len(single_opts)} single-leg)')

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

    # 4b. Apply TMS strategy/trade type tags
    print('\nLoading TMS tags...')
    script_dir = os.path.dirname(os.path.abspath(__file__))
    tms_lookup = load_tms_tags(script_dir)
    apply_tms_tags(regime_trades, tms_lookup)

    # 4c. Apply Mothersheet planned entry/cut/risk → R-multiple
    print('\nLoading Mothersheet orders...')
    orders_lookup = load_mothersheet_orders(script_dir)
    apply_mothersheet_orders(regime_trades, orders_lookup)

    # 5. Build equity curve
    equity_curve = build_equity_curve(closed)
    print(f'\nEquity curve: {len(equity_curve)} trading days')
    if equity_curve:
        print(f'  Date range: {equity_curve[0]["date"]} to {equity_curve[-1]["date"]}')
        print(f'  Final cumPnL: ${equity_curve[-1]["cumPnL"]:,.2f}')

    # 5b. Build overlay data (SPX, VIX, MMTH)
    print('\nBuilding overlay data...')
    overlays = build_overlay_data(equity_curve)

    # 5c. Sync OHLC data for any missing symbols
    print('\nSyncing OHLC data...')
    sync_ohlc_data(closed)

    # 5d. Sync earnings dates for all traded symbols
    print('\nSyncing earnings dates...')
    earnings_dates = sync_earnings_data(closed)

    # 6. Compute regime stats
    regime_stats = compute_regime_stats(regime_trades)

    # Print summary per regime
    for rk in sorted(regime_stats.keys()):
        all_stats = regime_stats[rk].get('All', {})
        n = all_stats.get('# Trades', 0)
        pnl = all_stats.get('Total P&L', 0)
        wr = all_stats.get('Win Rate', 0)
        print(f'  {rk}: {n} trades, P&L: ${pnl:,.2f}, Win rate: {wr:.1%}')

    # 7. Validate uniqueness of (symbol, entryDate)
    seen = set()
    dupes = 0
    first_regime_key = next(iter(regime_trades))
    for t in regime_trades[first_regime_key]:
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
        'overlays': overlays,
        'earningsDates': earnings_dates,
    }

    with open('data.json', 'w') as f:
        json.dump(output, f)

    print(f'\nWritten data.json with {len(closed)} trades, {len(equity_curve)} equity curve days')


if __name__ == '__main__':
    main()
