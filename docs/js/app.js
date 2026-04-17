/* HMDA Explorer — main application with interactive filtering */

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",
  LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
  MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",
  NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",PR:"Puerto Rico",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"
};

const ACTION_LABELS = {
  "1":"Loan originated","2":"Approved, not accepted","3":"Denied",
  "4":"Withdrawn","5":"File closed","6":"Purchased by institution",
  "7":"Preapproval denied","8":"Preapproval approved, not accepted"
};
const LOAN_TYPE_LABELS = {"1":"Conventional","2":"FHA","3":"VA","4":"USDA/RHS"};
const LOAN_PURPOSE_LABELS = {
  "1":"Purchase","2":"Home Improvement","31":"Refinance",
  "32":"Cash-out Refinance","4":"Other","5":"Not Applicable"
};
const DENIAL_REASON_LABELS = {
  "1":"Debt-to-income ratio","2":"Employment history","3":"Credit history",
  "4":"Collateral","5":"Insufficient cash","6":"Unverifiable information",
  "7":"Credit application incomplete","8":"Mortgage insurance denied","9":"Other"
};

const RATE_BUCKET_ORDER = ["Under 4%","4-5%","5-6%","6-7%","7-8%","8-9%","9%+"];

let data = {};
let charts = {};

/* ---- Active filters (null = all) ---- */
let filters = {
  year: null,
  action: null,
  loanType: null,
  loanPurpose: null,
  dti: null,
  ltv: null,
  purchaser: null,
  spread: null,
  lien: null,
  nonAm: null,
};

/* ---- Quality dimension config shared between renderers ---- */
const QUALITY_DIMS = [
  { key: "dti",       field: "d",  chart: "chart-dti",       label: "DTI",            orderKey: "dti" },
  { key: "ltv",       field: "l",  chart: "chart-ltv",       label: "CLTV",           orderKey: "ltv" },
  { key: "purchaser", field: "pu", chart: "chart-purchaser", label: "Purchaser",      labels: "purchaser" },
  { key: "spread",    field: "rs", chart: "chart-spread",    label: "Rate Spread",    orderKey: "spread" },
  { key: "lien",      field: "li", chart: "chart-lien",      label: "Lien",           labels: "lien" },
  { key: "nonAm",     field: "nm", chart: "chart-nonam",     label: "Non-Am",         labels: "non_am", orderKey: "non_am" },
];

const QUALITY_CHIP_LABELS = {
  dti: "DTI",
  ltv: "CLTV",
  purchaser: "Purchaser",
  spread: "Spread",
  lien: "Lien",
  nonAm: "Features",
};

/* ---- Data loading ---- */
async function loadData() {
  const [cube, geographic, lenders, quality] = await Promise.all([
    fetch("data/cube.json").then(r => r.json()),
    fetch("data/geographic.json").then(r => r.json()),
    fetch("data/lenders.json").then(r => r.json()),
    fetch("data/quality.json").then(r => r.json()),
  ]);
  data = { cube, geographic, lenders, quality };

  // Build lookup indexes for fast filtering
  data.lenderIndex = buildIndex(lenders.cube, "l");
  data.stateIndex = buildIndex(geographic.state_cube, "state");
  data.countyIndex = buildIndex(geographic.county_cube, "fips");

  renderAll();
}

function buildIndex(rows, key) {
  const idx = {};
  for (const r of rows) {
    const k = r[key];
    if (!idx[k]) idx[k] = [];
    idx[k].push(r);
  }
  return idx;
}

/* ---- Filtering engine ---- */
function filterMain(overrides = {}) {
  const f = { ...filters, ...overrides };
  return data.cube.main.filter(r =>
    (f.year == null || r.y === f.year) &&
    (f.action == null || r.action_taken === f.action) &&
    (f.loanType == null || r.loan_type === f.loanType) &&
    (f.loanPurpose == null || r.loan_purpose === f.loanPurpose)
  );
}

function filterRates(overrides = {}) {
  const f = { ...filters, ...overrides };
  return data.cube.rates.filter(r =>
    (f.year == null || r.y === f.year) &&
    (f.loanType == null || r.loan_type === f.loanType) &&
    (f.loanPurpose == null || r.loan_purpose === f.loanPurpose)
  );
}

function filterDenials(overrides = {}) {
  const f = { ...filters, ...overrides };
  return data.cube.denials.filter(r =>
    (f.year == null || r.y === f.year) &&
    (f.loanType == null || r.loan_type === f.loanType) &&
    (f.loanPurpose == null || r.loan_purpose === f.loanPurpose)
  );
}

function aggregate(rows) {
  let count = 0, sumLoan = 0, sumRate = 0, rateCount = 0;
  for (const r of rows) {
    count += r.count;
    sumLoan += r.sum_loan_amount;
    sumRate += r.sum_rate;
    rateCount += r.rate_count;
  }
  return { count, sumLoan, avgLoan: count ? sumLoan / count : null, avgRate: rateCount ? sumRate / rateCount : null };
}

function groupBy(rows, key) {
  const map = {};
  for (const r of rows) {
    const k = r[key];
    if (!map[k]) map[k] = [];
    map[k].push(r);
  }
  return map;
}

/* Build year-stacked series: returns { years, entries } where each entry is
 * { code, label, data: [count per year] }, sorted by total count desc. Used
 * for all stacked-area charts that distribute a category over time.
 */
function buildYearSeries(rows, codeKey, countKey, yearKey, labelFn, orderedCodes = null) {
  const yearsSet = new Set();
  const totals = {};
  const perYear = {};
  for (const r of rows) {
    const y = r[yearKey];
    const code = r[codeKey];
    yearsSet.add(y);
    if (!perYear[code]) perYear[code] = {};
    perYear[code][y] = (perYear[code][y] || 0) + r[countKey];
    totals[code] = (totals[code] || 0) + r[countKey];
  }
  const years = [...yearsSet].sort();
  let codes = Object.keys(perYear);
  if (orderedCodes) {
    const orderIdx = new Map(orderedCodes.map((c, i) => [c, i]));
    codes.sort((a, b) => (orderIdx.get(a) ?? 999) - (orderIdx.get(b) ?? 999));
  } else {
    codes.sort((a, b) => totals[b] - totals[a]);
  }
  const entries = codes.map(code => ({
    code,
    label: labelFn ? labelFn(code) : code,
    data: years.map(y => perYear[code][y] || 0),
  }));
  return { years, entries };
}

/* ---- Formatting helpers ---- */
const fmt = {
  num: n => n == null ? "—" : Number(n).toLocaleString("en-US", {maximumFractionDigits: 0}),
  pct: n => n == null ? "—" : n.toFixed(1) + "%",
  dollar: n => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", {maximumFractionDigits: 0}),
  billions: n => n == null ? "—" : "$" + n.toFixed(1) + "B",
  rate: n => n == null ? "—" : n.toFixed(3) + "%",
};

function onFilterChange() {
  renderNational();
  renderLenders();
  renderGeographic();
  renderQuality();
}

/* ---- Navigation ---- */
function initNav() {
  document.querySelectorAll("nav a").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const target = link.dataset.section;
      document.querySelectorAll("nav a").forEach(a => a.classList.remove("active"));
      link.classList.add("active");
      document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
      document.getElementById(target).classList.add("active");
    });
  });
}

/* ---- Sortable table helper ---- */
function makeSortable(tableEl) {
  const headers = tableEl.querySelectorAll("th");
  let currentSort = { col: -1, asc: true };

  headers.forEach((th, colIdx) => {
    th.addEventListener("click", () => {
      const tbody = tableEl.querySelector("tbody");
      const rows = Array.from(tbody.querySelectorAll("tr"));
      const asc = currentSort.col === colIdx ? !currentSort.asc : false;
      rows.sort((a, b) => {
        const aVal = a.children[colIdx]?.dataset.sort ?? a.children[colIdx]?.textContent ?? "";
        const bVal = b.children[colIdx]?.dataset.sort ?? b.children[colIdx]?.textContent ?? "";
        const aNum = parseFloat(aVal.replace(/[,$%]/g, ""));
        const bNum = parseFloat(bVal.replace(/[,$%]/g, ""));
        if (!isNaN(aNum) && !isNaN(bNum)) return asc ? aNum - bNum : bNum - aNum;
        return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
      rows.forEach(r => tbody.appendChild(r));
      headers.forEach(h => h.classList.remove("sorted-asc", "sorted-desc"));
      th.classList.add(asc ? "sorted-asc" : "sorted-desc");
      currentSort = { col: colIdx, asc };
    });
  });
}

/* ---- Filter chip display ---- */
function renderFilterBar() {
  renderFilterChips("active-filters", "Click any chart segment to filter");
}

/* ---- Render functions ---- */
function renderAll() {
  renderNational();
  renderLenders();
  renderGeographic();
  renderQuality();
}

function renderNational() {
  renderFilterBar();

  // Compute summary from filtered cube
  const allRows = filterMain();
  const agg = aggregate(allRows);
  const origRows = filterMain({ action: filters.action === "1" ? "1" : null }).filter(r => r.action_taken === "1");
  const origAgg = aggregate(origRows);

  document.getElementById("nat-summary").innerHTML = `
    <div class="stat-card"><div class="label">Applications</div><div class="value">${fmt.num(agg.count)}</div></div>
    <div class="stat-card"><div class="label">Originated</div><div class="value">${fmt.num(origAgg.count)}</div>
      <div class="sub">${agg.count ? fmt.pct(origAgg.count / agg.count * 100) : "—"} of filtered</div></div>
    <div class="stat-card"><div class="label">Total Volume</div><div class="value">${fmt.billions(origAgg.sumLoan / 1e9)}</div></div>
    <div class="stat-card"><div class="label">Avg Loan Amount</div><div class="value">${fmt.dollar(agg.avgLoan)}</div></div>
    <div class="stat-card"><div class="label">Avg Interest Rate</div><div class="value">${origAgg.avgRate ? fmt.rate(origAgg.avgRate) : "—"}</div>
      <div class="sub">originated loans</div></div>
  `;

  // --- Action Taken stacked area (ignores year + action filters so it always spans full timeline) ---
  const actionSeries = buildYearSeries(
    filterMain({ year: null, action: null }),
    "action_taken", "count", "y",
    code => ACTION_LABELS[code] || code
  );
  renderFilterStackedArea("chart-action", actionSeries.years, actionSeries.entries,
    "Application Outcomes", "action", filters.action);

  // Action table (still aggregated under current filters, ignoring the action filter so user sees the full breakdown)
  const byActionForTable = groupBy(filterMain({ action: null }), "action_taken");
  const actionEntries = Object.entries(byActionForTable)
    .map(([code, rows]) => ({ code, ...aggregate(rows) }))
    .sort((a, b) => b.count - a.count);
  const totalForPct = actionEntries.reduce((s, e) => s + e.count, 0);
  document.getElementById("table-action").querySelector("tbody").innerHTML = actionEntries.map(e => `
    <tr><td>${ACTION_LABELS[e.code] || e.code}</td>
    <td class="num" data-sort="${e.count}">${fmt.num(e.count)}</td>
    <td class="num" data-sort="${e.count/totalForPct*100}">${fmt.pct(e.count / totalForPct * 100)}</td>
    <td class="num" data-sort="${e.avgLoan}">${fmt.dollar(e.avgLoan)}</td></tr>
  `).join("");
  makeSortable(document.getElementById("table-action"));

  // --- Loan Type stacked area ---
  const typeSeries = buildYearSeries(
    filterMain({ year: null, loanType: null }),
    "loan_type", "count", "y",
    code => LOAN_TYPE_LABELS[code] || code
  );
  renderFilterStackedArea("chart-loan-type", typeSeries.years, typeSeries.entries,
    "Loan Type", "loanType", filters.loanType);

  // --- Loan Purpose stacked area ---
  const purposeSeries = buildYearSeries(
    filterMain({ year: null, loanPurpose: null }),
    "loan_purpose", "count", "y",
    code => LOAN_PURPOSE_LABELS[code] || code
  );
  renderFilterStackedArea("chart-loan-purpose", purposeSeries.years, purposeSeries.entries,
    "Loan Purpose", "loanPurpose", filters.loanPurpose);

  // --- Rate distribution ---
  const rateRows = filterRates();
  const byBucket = {};
  for (const r of rateRows) {
    byBucket[r.rate_bucket] = (byBucket[r.rate_bucket] || 0) + r.count;
  }
  const rateBuckets = RATE_BUCKET_ORDER.filter(b => byBucket[b]);
  renderBar("chart-rates",
    rateBuckets,
    rateBuckets.map(b => byBucket[b] || 0),
    "Originated Loans by Interest Rate"
  );

  // --- Denial reasons ---
  const denialRows = filterDenials();
  const byReason = {};
  for (const r of denialRows) {
    const label = DENIAL_REASON_LABELS[r.reason] || r.reason;
    byReason[label] = (byReason[label] || 0) + r.count;
  }
  const denialEntries = Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 8);
  renderHBar("chart-denials",
    denialEntries.map(e => e[0]),
    denialEntries.map(e => e[1]),
    "Top Denial Reasons"
  );

  // --- Time series (ignores year filter to always show all years) ---
  const byYear = {};
  const tsRows = filterMain({ year: null }); // ignore year filter for time series
  for (const r of tsRows) {
    if (!byYear[r.y]) byYear[r.y] = { apps: 0, orig: 0, denied: 0, sumLoan: 0, sumRate: 0, rateCount: 0 };
    const y = byYear[r.y];
    y.apps += r.count;
    y.sumLoan += r.sum_loan_amount;
    y.sumRate += r.sum_rate;
    y.rateCount += r.rate_count;
    if (r.action_taken === "1") y.orig += r.count;
    if (r.action_taken === "3") y.denied += r.count;
  }
  const years = Object.keys(byYear).sort();
  data.availableYears = years;

  // Volume time series
  renderTimeSeries("chart-timeseries",
    years,
    [
      { label: "Applications", data: years.map(y => byYear[y].apps), color: COLORS[0] },
      { label: "Originated", data: years.map(y => byYear[y].orig), color: COLORS[1] },
      { label: "Denied", data: years.map(y => byYear[y].denied), color: COLORS[4] },
    ],
    "Application Volume by Year"
  );

  // Avg rate time series
  renderTimeSeries("chart-rate-trend",
    years,
    [{ label: "Avg Rate (%)", data: years.map(y => byYear[y].rateCount ? byYear[y].sumRate / byYear[y].rateCount : null), color: COLORS[3] }],
    "Average Interest Rate by Year"
  );

  // Update year selector
  renderYearSelector(years);
}

/* ---- Compact cube helpers (shared by lenders, states, counties) ---- */
function filterCompact(rows) {
  return rows.filter(r =>
    (filters.year == null || r.y === filters.year) &&
    (filters.action == null || r.a === filters.action) &&
    (filters.loanType == null || r.t === filters.loanType) &&
    (filters.loanPurpose == null || r.p === filters.loanPurpose)
  );
}

function activeFilterDescription() {
  const parts = [];
  if (filters.year != null) parts.push(filters.year);
  if (filters.action != null) parts.push(ACTION_LABELS[filters.action]);
  if (filters.loanType != null) parts.push(LOAN_TYPE_LABELS[filters.loanType]);
  if (filters.loanPurpose != null) parts.push(LOAN_PURPOSE_LABELS[filters.loanPurpose]);
  return parts.length ? parts.join(" + ") : "";
}

function qualityChipLabel(key) {
  const val = filters[key];
  if (val == null) return null;
  if (key === "purchaser") return data.quality?.labels.purchaser[val] || val;
  if (key === "lien") return data.quality?.labels.lien[val] || val;
  if (key === "nonAm") return data.quality?.labels.non_am[val] || val;
  return val; // DTI/LTV/spread buckets are human-readable already
}

function renderFilterChips(elId, hint) {
  const el = document.getElementById(elId);
  const chips = [];
  if (filters.year != null) chips.push({key: "year", label: filters.year});
  if (filters.action != null) chips.push({key: "action", label: ACTION_LABELS[filters.action]});
  if (filters.loanType != null) chips.push({key: "loanType", label: LOAN_TYPE_LABELS[filters.loanType]});
  if (filters.loanPurpose != null) chips.push({key: "loanPurpose", label: LOAN_PURPOSE_LABELS[filters.loanPurpose]});
  for (const k of ["dti", "ltv", "purchaser", "spread", "lien", "nonAm"]) {
    if (filters[k] != null) {
      chips.push({key: k, label: `${QUALITY_CHIP_LABELS[k]}: ${qualityChipLabel(k)}`});
    }
  }

  if (chips.length === 0) {
    el.innerHTML = `<span class="filter-hint">${hint}</span>`;
    return;
  }
  el.innerHTML = chips.map(c => `
    <span class="filter-chip" data-key="${c.key}">${c.label} <button>&times;</button></span>
  `).join("") + '<button class="filter-clear">Clear all</button>';
  el.querySelectorAll(".filter-chip button").forEach(btn => {
    btn.addEventListener("click", () => { filters[btn.parentElement.dataset.key] = null; onFilterChange(); });
  });
  el.querySelector(".filter-clear").addEventListener("click", () => {
    filters = {
      year: null, action: null, loanType: null, loanPurpose: null,
      dti: null, ltv: null, purchaser: null, spread: null, lien: null, nonAm: null,
    };
    onFilterChange();
  });
}


function aggregateCompact(rows) {
  let count = 0, sumLoan = 0, sumRate = 0, rateCount = 0;
  let originated = 0, denied = 0, origLoan = 0, origRate = 0, origRateCount = 0;
  for (const r of rows) {
    count += r.c;
    sumLoan += r.s;
    if (r.a === "1") {
      originated += r.c;
      origLoan += r.s;
      origRate += r.r;
      origRateCount += r.rc;
    }
    if (r.a === "3") denied += r.c;
  }
  return {
    apps: count, originated, denied,
    sumLoan: origLoan,
    avgLoan: count ? sumLoan / count : null,
    avgRate: origRateCount ? origRate / origRateCount : null,
    origPct: count ? originated / count * 100 : null,
    denyPct: count ? denied / count * 100 : null,
  };
}

function renderLenders() {
  if (!data.lenders) return;

  const names = data.lenders.names;
  const statesMap = data.lenders.states;
  const index = data.lenderIndex;

  // Title and filter chips
  const filterDesc = activeFilterDescription();
  document.getElementById("lender-table-title").textContent = filterDesc
    ? `Lenders — ${filterDesc}` : "Top Lenders";
  renderFilterChips("lender-filters", "Filters from the Overview page apply here. Click chart segments on the Overview tab to filter.");

  // Aggregate per lender with current filters
  const lenderStats = [];
  for (const [lei, rows] of Object.entries(index)) {
    const filtered = filterCompact(rows);
    if (filtered.length === 0) continue;

    const agg = aggregateCompact(filtered);
    const name = names[lei] || lei;
    const topStates = (statesMap[lei] || []).map(s => s.state).join(", ");

    lenderStats.push({ lei, name, topStates, ...agg });
  }

  // Sort by apps desc
  lenderStats.sort((a, b) => b.apps - a.apps);

  // Summary cards
  const totalLenders = lenderStats.length;
  const totalApps = lenderStats.reduce((s, l) => s + l.apps, 0);
  const totalOrig = lenderStats.reduce((s, l) => s + l.originated, 0);
  const totalVol = lenderStats.reduce((s, l) => s + l.sumLoan, 0);

  document.getElementById("lender-summary").innerHTML = `
    <div class="stat-card"><div class="label">Active Lenders</div><div class="value">${fmt.num(totalLenders)}</div></div>
    <div class="stat-card"><div class="label">Applications</div><div class="value">${fmt.num(totalApps)}</div></div>
    <div class="stat-card"><div class="label">Originated</div><div class="value">${fmt.num(totalOrig)}</div></div>
    <div class="stat-card"><div class="label">Total Volume</div><div class="value">${fmt.billions(totalVol / 1e9)}</div></div>
  `;

  // Lender table with search
  const lenderFilterInput = document.getElementById("lender-filter");
  function renderLenderTable(search = "") {
    const filtered = search
      ? lenderStats.filter(l => l.name.toLowerCase().includes(search))
      : lenderStats.slice(0, 100);

    document.getElementById("table-lenders").querySelector("tbody").innerHTML = filtered.map(l => `
      <tr>
        <td title="${l.lei}">${l.name}</td>
        <td class="num" data-sort="${l.apps}">${fmt.num(l.apps)}</td>
        <td class="num" data-sort="${l.originated}">${fmt.num(l.originated)}</td>
        <td class="num" data-sort="${l.denied}">${fmt.num(l.denied)}</td>
        <td class="num" data-sort="${l.origPct}">${fmt.pct(l.origPct)}</td>
        <td class="num" data-sort="${l.denyPct}">${fmt.pct(l.denyPct)}</td>
        <td class="num" data-sort="${l.sumLoan}">${fmt.billions(l.sumLoan / 1e9)}</td>
        <td class="num" data-sort="${l.avgLoan}">${fmt.dollar(l.avgLoan)}</td>
        <td class="num" data-sort="${l.avgRate}">${l.avgRate ? fmt.rate(l.avgRate) : "—"}</td>
        <td style="font-size:0.8rem;color:var(--text-secondary)">${l.topStates}</td>
      </tr>
    `).join("");
    makeSortable(document.getElementById("table-lenders"));
  }

  renderLenderTable();
  // Remove old listener by replacing the input element
  const newInput = lenderFilterInput.cloneNode(true);
  lenderFilterInput.parentNode.replaceChild(newInput, lenderFilterInput);
  newInput.addEventListener("input", e => renderLenderTable(e.target.value.toLowerCase()));

  // Charts — top 15 by originations
  const top15Vol = lenderStats.filter(l => l.originated > 0).slice(0, 15);
  renderHBar("chart-lender-vol",
    top15Vol.map(l => l.name.length > 30 ? l.name.slice(0, 28) + "…" : l.name),
    top15Vol.map(l => l.originated),
    "Top 15 by Originations"
  );

  // Top 15 highest denial rate (min 1000 apps)
  const highDenial = lenderStats
    .filter(l => l.apps >= 1000 && l.denyPct != null)
    .sort((a, b) => b.denyPct - a.denyPct)
    .slice(0, 15);
  renderHBar("chart-lender-denial",
    highDenial.map(l => l.name.length > 30 ? l.name.slice(0, 28) + "…" : l.name),
    highDenial.map(l => l.denyPct),
    "Highest Denial Rates (min 1,000 apps)"
  );
}

function renderGeographic() {
  if (!data.geographic) return;

  const countyNames = data.geographic.county_names;

  // Filter chips
  const filterDesc = activeFilterDescription();
  renderFilterChips("geo-filters", "Filters from the Overview page apply here. Click chart segments on the Overview tab to filter.");
  renderFilterChips("county-filters", "Filters from the Overview page apply here. Click chart segments on the Overview tab to filter.");

  document.getElementById("geo-table-title").textContent = filterDesc
    ? `All States — ${filterDesc}` : "All States";
  document.getElementById("county-table-title").textContent = filterDesc
    ? `Top Counties — ${filterDesc}` : "Top Counties by Volume";

  // --- Aggregate states from cube ---
  const stateStats = [];
  for (const [state, rows] of Object.entries(data.stateIndex)) {
    const filtered = filterCompact(rows);
    if (filtered.length === 0) continue;
    const agg = aggregateCompact(filtered);
    stateStats.push({ state, ...agg });
  }
  stateStats.sort((a, b) => b.apps - a.apps);

  // State table with search
  const stateFilter = document.getElementById("state-filter");
  const stateTable = document.getElementById("table-states");

  function renderStateTable(search = "") {
    const filtered = search
      ? stateStats.filter(s => s.state.toLowerCase().includes(search) ||
          (STATE_NAMES[s.state] || "").toLowerCase().includes(search))
      : stateStats;

    stateTable.querySelector("tbody").innerHTML = filtered.map(s => `
      <tr>
        <td><strong>${s.state}</strong> <span style="color:var(--text-secondary);font-size:0.8rem">${STATE_NAMES[s.state] || ""}</span></td>
        <td class="num" data-sort="${s.apps}">${fmt.num(s.apps)}</td>
        <td class="num" data-sort="${s.originated}">${fmt.num(s.originated)}</td>
        <td class="num" data-sort="${s.sumLoan}">${fmt.billions(s.sumLoan / 1e9)}</td>
        <td class="num" data-sort="${s.origPct}">${fmt.pct(s.origPct)}</td>
        <td class="num" data-sort="${s.denyPct}">${fmt.pct(s.denyPct)}</td>
        <td class="num" data-sort="${s.avgLoan}">${fmt.dollar(s.avgLoan)}</td>
        <td class="num" data-sort="${s.avgRate}">${s.avgRate ? fmt.rate(s.avgRate) : "—"}</td>
      </tr>
    `).join("");
    makeSortable(stateTable);
  }

  renderStateTable();
  // Replace input to clear old listeners
  const newStateFilter = stateFilter.cloneNode(true);
  stateFilter.parentNode.replaceChild(newStateFilter, stateFilter);
  newStateFilter.addEventListener("input", e => renderStateTable(e.target.value.toLowerCase()));

  // State ranking charts (computed from filtered data)
  const byVolume = [...stateStats].sort((a, b) => b.originated - a.originated).slice(0, 10);
  const byAvgLoan = [...stateStats].filter(s => s.avgLoan != null).sort((a, b) => b.avgLoan - a.avgLoan).slice(0, 10);
  const byDenial = [...stateStats].filter(s => s.denyPct != null && s.apps >= 1000).sort((a, b) => b.denyPct - a.denyPct).slice(0, 10);
  const byRate = [...stateStats].filter(s => s.avgRate != null && s.apps >= 1000).sort((a, b) => b.avgRate - a.avgRate).slice(0, 10);

  renderHBar("chart-vol-rank", byVolume.map(s => s.state), byVolume.map(s => s.originated), "Top 10 States by Originations");
  renderHBar("chart-expensive-rank", byAvgLoan.map(s => s.state), byAvgLoan.map(s => s.avgLoan), "Highest Avg Loan Amount", true);
  renderHBar("chart-denial-rank", byDenial.map(s => s.state), byDenial.map(s => s.denyPct), "Highest Denial Rates (%)");
  renderHBar("chart-rate-rank", byRate.map(s => s.state), byRate.map(s => s.avgRate), "Highest Avg Interest Rates (%)");

  // --- Aggregate counties from cube ---
  // FHA % ignores the loan-type filter so it always reflects FHA share of
  // the county's originated loans under the other active filters.
  const countyStats = [];
  for (const [fips, rows] of Object.entries(data.countyIndex)) {
    const filtered = filterCompact(rows);
    if (filtered.length === 0) continue;
    const agg = aggregateCompact(filtered);

    let fhaOrig = 0, allOrig = 0;
    for (const r of rows) {
      if (filters.year != null && r.y !== filters.year) continue;
      if (filters.loanPurpose != null && r.p !== filters.loanPurpose) continue;
      if (r.a !== "1") continue;
      allOrig += r.c;
      if (r.t === "2") fhaOrig += r.c;
    }
    const fhaPct = allOrig ? fhaOrig / allOrig * 100 : null;

    const state = rows[0].state;
    const name = countyNames[fips] || "Unknown";
    countyStats.push({ fips, state, name, fhaPct, ...agg });
  }
  countyStats.sort((a, b) => b.apps - a.apps);

  const countyTable = document.getElementById("table-counties");
  countyTable.querySelector("tbody").innerHTML = countyStats.slice(0, 100).map(c => `
    <tr>
      <td>${c.fips}</td>
      <td>${c.name}</td>
      <td>${c.state}</td>
      <td class="num" data-sort="${c.originated}">${fmt.num(c.originated)}</td>
      <td class="num" data-sort="${c.sumLoan}">${fmt.billions(c.sumLoan / 1e9)}</td>
      <td class="num" data-sort="${c.origPct}">${fmt.pct(c.origPct)}</td>
      <td class="num" data-sort="${c.denyPct}">${fmt.pct(c.denyPct)}</td>
      <td class="num" data-sort="${c.fhaPct ?? -1}">${c.fhaPct != null ? fmt.pct(c.fhaPct) : "—"}</td>
      <td class="num" data-sort="${c.avgLoan}">${fmt.dollar(c.avgLoan)}</td>
    </tr>
  `).join("");
  makeSortable(countyTable);
}

/* ---- Loan Quality tab ---- */
function filterQuality(ignoreDims = []) {
  // Applies every active filter except the ones in ignoreDims. The stacked-
  // area charts pass both "year" and their own dim so the chart always spans
  // all years and shows the full distribution under other active filters.
  const ignore = new Set(Array.isArray(ignoreDims) ? ignoreDims : [ignoreDims]);
  return data.quality.cube.filter(r => {
    if (!ignore.has("year")       && filters.year       != null && r.y  !== filters.year) return false;
    if (!ignore.has("action")     && filters.action     != null && r.a  !== filters.action) return false;
    if (!ignore.has("loanType")   && filters.loanType   != null && r.t  !== filters.loanType) return false;
    if (!ignore.has("loanPurpose")&& filters.loanPurpose!= null && r.p  !== filters.loanPurpose) return false;
    if (!ignore.has("dti")        && filters.dti        != null && r.d  !== filters.dti) return false;
    if (!ignore.has("ltv")        && filters.ltv        != null && r.l  !== filters.ltv) return false;
    if (!ignore.has("purchaser")  && filters.purchaser  != null && r.pu !== filters.purchaser) return false;
    if (!ignore.has("spread")     && filters.spread     != null && r.rs !== filters.spread) return false;
    if (!ignore.has("lien")       && filters.lien       != null && r.li !== filters.lien) return false;
    if (!ignore.has("nonAm")      && filters.nonAm      != null && r.nm !== filters.nonAm) return false;
    return true;
  });
}

function qualityLabelFor(dim, code) {
  if (dim.labels) return data.quality.labels[dim.labels][code] || code;
  return code;
}

function qualityOrderFor(dim, codes) {
  if (!dim.orderKey) return [...codes].sort((a, b) => {
    // Fall back to count-desc (handled by caller) — here return as-is.
    return 0;
  });
  const order = data.quality.orders[dim.orderKey];
  return [...codes].sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

function renderQuality() {
  if (!data.quality) return;

  renderFilterChips("quality-filters",
    "Click any segment to filter. Overview filters (year, action, type, purpose) apply here too.");

  // --- Summary across fully-filtered rows ---
  const fullyFiltered = filterQuality();
  let count = 0, volume = 0, rateSum = 0, rateCount = 0;
  for (const r of fullyFiltered) {
    count += r.c;
    volume += r.s;
    rateSum += r.r;
    rateCount += r.rc;
  }
  const avgRate = rateCount ? rateSum / rateCount : null;
  const avgLoan = count ? volume / count : null;

  document.getElementById("quality-summary").innerHTML = `
    <div class="stat-card"><div class="label">Records in Slice</div><div class="value">${fmt.num(count)}</div></div>
    <div class="stat-card"><div class="label">Volume</div><div class="value">${fmt.billions(volume / 1e9)}</div></div>
    <div class="stat-card"><div class="label">Avg Loan</div><div class="value">${fmt.dollar(avgLoan)}</div></div>
    <div class="stat-card"><div class="label">Avg Interest Rate</div><div class="value">${avgRate ? fmt.rate(avgRate) : "—"}</div></div>
  `;

  // --- Render one stacked-area chart per quality dimension ---
  // Each chart ignores the year filter and its own dim filter so it always
  // spans all years and shows the full category breakdown.
  const detailRows = [];
  for (const dim of QUALITY_DIMS) {
    const rows = filterQuality(["year", dim.key]);

    // Determine code ordering — use known orders where defined, else count desc
    let orderedCodes = null;
    if (dim.orderKey) {
      orderedCodes = data.quality.orders[dim.orderKey];
    }
    const series = buildYearSeries(
      rows, dim.field, "c", "y",
      code => qualityLabelFor(dim, code),
      orderedCodes
    );
    renderFilterStackedArea(dim.chart, series.years, series.entries,
      dim.label, dim.key, filters[dim.key]);

    // Detail rows: use the fully-filtered rows so they reflect every active
    // filter including the dim itself. Sum volume + rate per bucket.
    const perBucket = {};
    for (const r of fullyFiltered) {
      const k = r[dim.field];
      if (!perBucket[k]) perBucket[k] = { c: 0, s: 0, r: 0, rc: 0 };
      perBucket[k].c += r.c;
      perBucket[k].s += r.s;
      perBucket[k].r += r.r;
      perBucket[k].rc += r.rc;
    }
    const bucketCodes = Object.keys(perBucket).filter(k => perBucket[k].c > 0);
    const sortedBuckets = dim.orderKey
      ? qualityOrderFor(dim, bucketCodes)
      : bucketCodes.sort((a, b) => perBucket[b].c - perBucket[a].c);
    const totalInDim = bucketCodes.reduce((s, k) => s + perBucket[k].c, 0);
    for (const k of sortedBuckets) {
      const b = perBucket[k];
      detailRows.push({
        dim: dim.label,
        bucket: qualityLabelFor(dim, k),
        count: b.c,
        pct: totalInDim ? b.c / totalInDim * 100 : 0,
        volume: b.s,
        avgRate: b.rc ? b.r / b.rc : null,
      });
    }
  }

  const detailTable = document.getElementById("table-quality-detail");
  detailTable.querySelector("tbody").innerHTML = detailRows.map(r => `
    <tr>
      <td>${r.dim}</td>
      <td>${r.bucket}</td>
      <td class="num" data-sort="${r.count}">${fmt.num(r.count)}</td>
      <td class="num" data-sort="${r.pct}">${fmt.pct(r.pct)}</td>
      <td class="num" data-sort="${r.volume}">${fmt.billions(r.volume / 1e9)}</td>
      <td class="num" data-sort="${r.avgRate ?? -1}">${r.avgRate != null ? fmt.rate(r.avgRate) : "—"}</td>
    </tr>
  `).join("");
  makeSortable(detailTable);
}

/* ---- Chart helpers (Chart.js) ---- */
const COLORS = [
  "#2563eb","#16a34a","#ea580c","#9333ea","#dc2626",
  "#0891b2","#ca8a04","#be185d","#4f46e5","#059669"
];
const COLORS_MUTED = [
  "#93b4f4","#86d4a0","#f4b88a","#c999f0","#f09393",
  "#7dd3e3","#e4cf7a","#e08daf","#a5a0f0","#7dd4b5"
];

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function renderFilterStackedArea(canvasId, years, seriesEntries, title, filterKey, activeCode) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");

  const datasets = seriesEntries.map((s, i) => {
    const baseColor = COLORS[i % COLORS.length];
    const mutedColor = COLORS_MUTED[i % COLORS_MUTED.length];
    const isActive = activeCode != null && s.code === activeCode;
    const color = (activeCode == null || isActive) ? baseColor : mutedColor;
    return {
      label: s.label,
      data: s.data,
      backgroundColor: color + "cc",
      borderColor: color,
      borderWidth: isActive ? 2.5 : 1,
      fill: true,
      tension: 0.25,
      pointRadius: isActive ? 3 : 0,
      pointHoverRadius: 5,
      _code: s.code,
    };
  });

  charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: { labels: years, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
        title: { display: true, text: title + (activeCode != null ? " (filtered)" : ""), font: { size: 14, weight: "600" } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt.num(ctx.raw)}`,
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => fmt.num(v) } }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const clickedCode = datasets[elements[0].datasetIndex]._code;
        filters[filterKey] = filters[filterKey] === clickedCode ? null : clickedCode;
        onFilterChange();
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? "pointer" : "default";
      }
    }
  });
}

function renderBar(canvasId, labels, values, title) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: COLORS[0], borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: !!title, text: title, font: { size: 14, weight: "600" } },
        tooltip: { callbacks: { label: ctx => " " + fmt.num(ctx.raw) } }
      },
      scales: { y: { ticks: { callback: v => fmt.num(v) } } }
    }
  });
}

function renderHBar(canvasId, labels, values, title, isDollar = false) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: COLORS[0], borderRadius: 4 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: !!title, text: title, font: { size: 14, weight: "600" } },
        tooltip: { callbacks: { label: ctx => " " + (isDollar ? fmt.dollar(ctx.raw) : fmt.num(ctx.raw)) } }
      },
      scales: { x: { ticks: { callback: v => isDollar ? fmt.dollar(v) : fmt.num(v) } } }
    }
  });
}

function renderTimeSeries(canvasId, labels, datasets, title) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.color + "22",
        fill: false,
        tension: 0.2,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2.5,
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: !!title, text: title, font: { size: 14, weight: "600" } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${typeof ctx.raw === "number" && ctx.raw < 100 ? ctx.raw.toFixed(3) + "%" : fmt.num(ctx.raw)}` } },
      },
      scales: {
        y: { ticks: { callback: v => v >= 1000 ? fmt.num(v) : v } },
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const clickedYear = labels[idx];
        filters.year = filters.year === clickedYear ? null : clickedYear;
        onFilterChange();
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? "pointer" : "default";
      }
    }
  });
}

function renderYearSelector(years) {
  const el = document.getElementById("year-selector");
  if (!el) return;
  el.innerHTML = '<button class="year-btn' + (filters.year == null ? ' active' : '') + '" data-year="">All Years</button>' +
    years.map(y => `<button class="year-btn${filters.year === y ? ' active' : ''}" data-year="${y}">${y}</button>`).join("");
  el.querySelectorAll(".year-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const y = btn.dataset.year;
      filters.year = y === "" ? null : y;
      onFilterChange();
    });
  });
}

/* ---- Compare States ---- */
let compareState = {
  selectedStates: [],
  metric: "originations",
  loanType: null,
  loanPurpose: null,
  lastData: null, // { years, series: [{state, values}] }
};

const COMPARE_COLORS = [
  "#2563eb","#dc2626","#16a34a","#ea580c","#9333ea",
  "#0891b2","#ca8a04","#be185d","#4f46e5","#059669",
  "#6366f1","#d97706","#0d9488","#e11d48","#7c3aed",
  "#2dd4bf","#f59e0b","#ec4899","#8b5cf6","#14b8a6"
];

const METRIC_LABELS = {
  originations: "Originations",
  applications: "Applications",
  volume: "Origination Volume ($)",
  avgLoan: "Avg Loan Amount ($)",
  avgRate: "Avg Interest Rate (%)",
  origPct: "Origination Rate (%)",
  denyPct: "Denial Rate (%)",
};

function initCompare() {
  const metricEl = document.getElementById("compare-metric");
  const loanTypeEl = document.getElementById("compare-loan-type");
  const loanPurposeEl = document.getElementById("compare-loan-purpose");
  const searchEl = document.getElementById("compare-state-search");
  const dropdownEl = document.getElementById("compare-state-dropdown");

  metricEl.addEventListener("change", () => {
    compareState.metric = metricEl.value;
    renderCompareChart();
  });

  loanTypeEl.addEventListener("change", () => {
    compareState.loanType = loanTypeEl.value || null;
    renderCompareChart();
  });

  loanPurposeEl.addEventListener("change", () => {
    compareState.loanPurpose = loanPurposeEl.value || null;
    renderCompareChart();
  });

  // State search + dropdown
  searchEl.addEventListener("focus", () => showStateDropdown(searchEl.value));
  searchEl.addEventListener("input", () => showStateDropdown(searchEl.value));

  document.addEventListener("click", e => {
    if (!e.target.closest(".compare-state-search-wrap")) {
      dropdownEl.style.display = "none";
    }
  });

  // Quick pick buttons
  document.querySelectorAll(".compare-quick-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.clear) {
        compareState.selectedStates = [];
      } else {
        const states = btn.dataset.states.split(",");
        compareState.selectedStates = [...states];
      }
      renderSelectedTags();
      renderCompareChart();
    });
  });

  // CSV download
  document.getElementById("compare-download-csv").addEventListener("click", downloadCompareCSV);
}

function showStateDropdown(search) {
  const dropdownEl = document.getElementById("compare-state-dropdown");
  const term = (search || "").toLowerCase();

  const states = Object.entries(STATE_NAMES)
    .filter(([code, name]) =>
      !term || code.toLowerCase().includes(term) || name.toLowerCase().includes(term)
    )
    .sort((a, b) => a[1].localeCompare(b[1]));

  if (states.length === 0) {
    dropdownEl.style.display = "none";
    return;
  }

  dropdownEl.innerHTML = states.map(([code, name]) => {
    const selected = compareState.selectedStates.includes(code);
    return `<div class="compare-dropdown-item${selected ? " selected" : ""}" data-code="${code}">
      <span>${code} — ${name}</span>
      <span>${selected ? "&#10003;" : ""}</span>
    </div>`;
  }).join("");

  dropdownEl.style.display = "block";

  dropdownEl.querySelectorAll(".compare-dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      const code = item.dataset.code;
      const idx = compareState.selectedStates.indexOf(code);
      if (idx >= 0) {
        compareState.selectedStates.splice(idx, 1);
      } else {
        compareState.selectedStates.push(code);
      }
      renderSelectedTags();
      renderCompareChart();
      // Refresh dropdown to show updated checkmarks
      showStateDropdown(document.getElementById("compare-state-search").value);
    });
  });
}

function renderSelectedTags() {
  const el = document.getElementById("compare-selected-states");
  el.innerHTML = compareState.selectedStates.map((code, i) =>
    `<span class="compare-tag" style="background:${COMPARE_COLORS[i % COMPARE_COLORS.length]}">${code} <button data-code="${code}">&times;</button></span>`
  ).join("");

  el.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      compareState.selectedStates = compareState.selectedStates.filter(c => c !== btn.dataset.code);
      renderSelectedTags();
      renderCompareChart();
    });
  });
}

function computeCompareData() {
  if (!data.stateIndex || compareState.selectedStates.length === 0) return null;

  const metric = compareState.metric;
  const allYears = new Set();
  const series = [];

  for (const stateCode of compareState.selectedStates) {
    const rows = data.stateIndex[stateCode];
    if (!rows) continue;

    // Filter by loan type and purpose
    const filtered = rows.filter(r =>
      (compareState.loanType == null || r.t === compareState.loanType) &&
      (compareState.loanPurpose == null || r.p === compareState.loanPurpose)
    );

    // Group by year
    const byYear = {};
    for (const r of filtered) {
      if (!byYear[r.y]) byYear[r.y] = [];
      byYear[r.y].push(r);
      allYears.add(r.y);
    }

    // Compute metric per year
    const values = {};
    for (const [year, yearRows] of Object.entries(byYear)) {
      const agg = aggregateCompact(yearRows);
      switch (metric) {
        case "originations": values[year] = agg.originated; break;
        case "applications": values[year] = agg.apps; break;
        case "volume": values[year] = agg.sumLoan; break;
        case "avgLoan": values[year] = agg.avgLoan; break;
        case "avgRate": values[year] = agg.avgRate; break;
        case "origPct": values[year] = agg.origPct; break;
        case "denyPct": values[year] = agg.denyPct; break;
      }
    }

    series.push({ state: stateCode, values });
  }

  const years = Array.from(allYears).sort();
  return { years, series };
}

function renderCompareChart() {
  const chartCard = document.getElementById("compare-chart-card");
  const tableCard = document.getElementById("compare-table-card");

  if (compareState.selectedStates.length === 0) {
    chartCard.style.display = "none";
    tableCard.style.display = "none";
    compareState.lastData = null;
    return;
  }

  const result = computeCompareData();
  if (!result || result.series.length === 0) {
    chartCard.style.display = "none";
    tableCard.style.display = "none";
    return;
  }

  compareState.lastData = result;
  chartCard.style.display = "block";
  tableCard.style.display = "block";

  const metric = compareState.metric;
  const metricLabel = METRIC_LABELS[metric];

  // Filter description
  const parts = [metricLabel];
  if (compareState.loanType) parts.push(LOAN_TYPE_LABELS[compareState.loanType]);
  if (compareState.loanPurpose) parts.push(LOAN_PURPOSE_LABELS[compareState.loanPurpose]);
  const title = parts.join(" — ");

  document.getElementById("compare-chart-title").textContent = title;
  document.getElementById("compare-table-title").textContent = title;

  // Format helper for this metric
  const fmtMetric = v => {
    if (v == null) return "—";
    if (metric === "volume") return fmt.billions(v / 1e9);
    if (metric === "avgLoan") return fmt.dollar(v);
    if (metric === "avgRate") return fmt.rate(v);
    if (metric === "origPct" || metric === "denyPct") return fmt.pct(v);
    return fmt.num(v);
  };

  // Chart
  destroyChart("chart-compare");
  const ctx = document.getElementById("chart-compare").getContext("2d");
  const datasets = result.series.map((s, i) => ({
    label: `${s.state} — ${STATE_NAMES[s.state] || s.state}`,
    data: result.years.map(y => s.values[y] ?? null),
    borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
    backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length] + "22",
    fill: false,
    tension: 0.2,
    pointRadius: 5,
    pointHoverRadius: 7,
    borderWidth: 2.5,
    spanGaps: true,
  }));

  const isDollar = metric === "volume" || metric === "avgLoan";
  const isPct = metric === "avgRate" || metric === "origPct" || metric === "denyPct";

  charts["chart-compare"] = new Chart(ctx, {
    type: "line",
    data: { labels: result.years, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtMetric(ctx.raw)}`
          }
        },
        legend: {
          position: "top",
          labels: { boxWidth: 14, padding: 16, font: { size: 12 } }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => {
              if (isDollar && v >= 1e9) return "$" + (v / 1e9).toFixed(0) + "B";
              if (isDollar) return fmt.dollar(v);
              if (isPct) return v.toFixed(1) + "%";
              return fmt.num(v);
            }
          }
        }
      }
    }
  });

  // Data table
  const thead = document.querySelector("#table-compare thead");
  const tbody = document.querySelector("#table-compare tbody");

  thead.innerHTML = `<tr><th>Year</th>${result.series.map(s => `<th class="num">${s.state}</th>`).join("")}</tr>`;
  tbody.innerHTML = result.years.map(y =>
    `<tr><td>${y}</td>${result.series.map(s =>
      `<td class="num" data-sort="${s.values[y] ?? ""}">${fmtMetric(s.values[y])}</td>`
    ).join("")}</tr>`
  ).join("");
  makeSortable(document.getElementById("table-compare"));
}

function downloadCompareCSV() {
  const result = compareState.lastData;
  if (!result) return;

  const metric = compareState.metric;
  const metricLabel = METRIC_LABELS[metric];

  // Header row
  const headers = ["Year", ...result.series.map(s => `${s.state} - ${STATE_NAMES[s.state] || s.state}`)];
  const rows = [headers.join(",")];

  // Data rows
  for (const y of result.years) {
    const vals = result.series.map(s => {
      const v = s.values[y];
      return v != null ? v : "";
    });
    rows.push([y, ...vals].join(","));
  }

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  // Build filename
  const states = result.series.map(s => s.state).join("-");
  a.download = `hmda_${metric}_${states}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---- Per-chart CSV download ----
 * Reads straight from the live Chart.js instance so the CSV reflects whatever
 * the user currently sees (filters applied, category ordering, etc).
 */
function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadChartCSV(chartId, title) {
  const chart = charts[chartId];
  if (!chart) return;
  const labels = chart.data.labels || [];
  const datasets = chart.data.datasets || [];
  if (!labels.length || !datasets.length) return;

  const singleUnlabeled = datasets.length === 1 && !datasets[0].label;
  const valueCols = singleUnlabeled
    ? [title || "Value"]
    : datasets.map((ds, i) => ds.label || `Series ${i + 1}`);

  const lines = [["Category", ...valueCols].map(csvEscape).join(",")];
  for (let i = 0; i < labels.length; i++) {
    const row = [labels[i], ...datasets.map(ds => ds.data[i] ?? "")];
    lines.push(row.map(csvEscape).join(","));
  }

  const slug = (title || chartId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hmda_${slug || "chart"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function attachCsvButtons() {
  document.querySelectorAll(".card").forEach(card => {
    const canvas = card.querySelector("canvas");
    if (!canvas) return;
    if (card.querySelector(".chart-csv-btn, .compare-csv-btn")) return;
    const h2 = card.querySelector("h2");
    if (!h2) return;

    const title = h2.textContent.trim();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chart-csv-btn";
    btn.textContent = "CSV";
    btn.title = "Download chart data as CSV";
    btn.addEventListener("click", () => downloadChartCSV(canvas.id, title));

    h2.classList.add("has-csv-btn");
    h2.appendChild(btn);
  });
}

/* ---- Init ---- */
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  loadData().then(() => {
    initCompare();
    attachCsvButtons();
  });
});
