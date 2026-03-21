/**
 * Test: Verify regime stats field names in data.json match what the dashboard JS expects.
 *
 * The dashboard reads these fields from regimeStats to render regime color cards:
 *   - 'Avg P&L'           → Avg P&L per regime
 *   - 'Max Win'            → Best trade per regime
 *   - 'Avg Holding Period' → Average holding period per regime
 *
 * And from the 'All' stats for the summary card:
 *   - 'Median P&L'         → Median P&L across all trades
 *
 * If these fields are missing or named differently, the dashboard shows $0.00 / —.
 */

const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

let failures = 0;

function assert(condition, msg) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// Fields the dashboard JS reads from each regime color stats object
const REQUIRED_REGIME_FIELDS = ['Avg P&L', 'Max Win', 'Avg Holding Period'];

// Fields the dashboard JS reads from the 'All' stats object (optional - gracefully falls back to 0)
const OPTIONAL_ALL_FIELDS = ['Median P&L'];

for (const regimeKey of ['regime1', 'regime2', 'regime3']) {
  const regimeStats = data.regimeStats[regimeKey];
  assert(regimeStats, `${regimeKey} exists in regimeStats`);
  if (!regimeStats) continue;

  for (const color of ['Green', 'Yellow', 'Red']) {
    const s = regimeStats[color];
    assert(s, `${regimeKey}.${color} exists`);
    if (!s) continue;

    for (const field of REQUIRED_REGIME_FIELDS) {
      assert(field in s, `${regimeKey}.${color} has field '${field}'`);
      // For regimes with trades, values should be non-zero
      if (s['# Trades'] > 0 && field !== 'Avg Holding Period') {
        assert(s[field] !== 0 && s[field] !== undefined,
          `${regimeKey}.${color}['${field}'] is non-zero (got ${s[field]})`);
      }
    }
  }

  // Check 'All' stats (optional fields - just warn, don't fail)
  const all = regimeStats.All;
  if (all) {
    for (const field of OPTIONAL_ALL_FIELDS) {
      if (!(field in all)) {
        console.log(`INFO: ${regimeKey}.All missing optional field '${field}' (will show $0.00)`);
      }
    }
  }
}

// Also verify the Python script produces matching field names
const pyPath = path.join(__dirname, 'parse_ib_trades.py');
const pyContent = fs.readFileSync(pyPath, 'utf-8');

assert(pyContent.includes("'Avg P&L'"), "Python script uses field name 'Avg P&L'");
assert(pyContent.includes("'Max Win'"), "Python script uses field name 'Max Win'");
assert(pyContent.includes("'Avg Holding Period'"), "Python script uses field name 'Avg Holding Period'");
assert(!pyContent.includes("'Avg P&L per Trade'"), "Python script does NOT use old name 'Avg P&L per Trade'");
assert(!pyContent.includes("'Best Trade'"), "Python script does NOT use old name 'Best Trade'");
assert(!pyContent.includes("'Avg Holding Days'"), "Python script does NOT use old name 'Avg Holding Days'");

// Verify the JS dashboard reads the correct field names
const jsPath = path.join(__dirname, 'app.js');
const jsContent = fs.readFileSync(jsPath, 'utf-8');

assert(jsContent.includes("s['Avg P&L']"), "JS reads s['Avg P&L']");
assert(jsContent.includes("s['Max Win']"), "JS reads s['Max Win']");
assert(jsContent.includes("s['Avg Holding Period']"), "JS reads s['Avg Holding Period']");
assert(!jsContent.includes("s['Avg P&L per Trade']"), "JS does NOT read old s['Avg P&L per Trade']");
assert(!jsContent.includes("s['Best Trade']"), "JS does NOT read old s['Best Trade']");
assert(!jsContent.includes("s['Avg Holding Days']"), "JS does NOT read old s['Avg Holding Days']");

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
