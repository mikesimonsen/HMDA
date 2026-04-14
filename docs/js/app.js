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
  action: null,
  loanType: null,
  loanPurpose: null,
};

/* ---- Data loading ---- */
async function loadData() {
  const [cube, geographic] = await Promise.all([
    fetch("data/cube.json").then(r => r.json()),
    fetch("data/geographic.json").then(r => r.json()),
  ]);
  data = { cube, geographic };
  renderAll();
}

/* ---- Filtering engine ---- */
function filterMain(overrides = {}) {
  const f = { ...filters, ...overrides };
  return data.cube.main.filter(r =>
    (f.action == null || r.action_taken === f.action) &&
    (f.loanType == null || r.loan_type === f.loanType) &&
    (f.loanPurpose == null || r.loan_purpose === f.loanPurpose)
  );
}

function filterRates(overrides = {}) {
  const f = { ...filters, ...overrides };
  return data.cube.rates.filter(r =>
    (f.loanType == null || r.loan_type === f.loanType) &&
    (f.loanPurpose == null || r.loan_purpose === f.loanPurpose)
  );
}

function filterDenials(overrides = {}) {
  const f = { ...filters, ...overrides };
  return data.cube.denials.filter(r =>
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

/* ---- Formatting helpers ---- */
const fmt = {
  num: n => n == null ? "—" : Number(n).toLocaleString("en-US", {maximumFractionDigits: 0}),
  pct: n => n == null ? "—" : n.toFixed(1) + "%",
  dollar: n => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", {maximumFractionDigits: 0}),
  billions: n => n == null ? "—" : "$" + n.toFixed(1) + "B",
  rate: n => n == null ? "—" : n.toFixed(3) + "%",
};

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
  const el = document.getElementById("active-filters");
  const chips = [];

  if (filters.action != null)
    chips.push({ key: "action", label: ACTION_LABELS[filters.action] || filters.action });
  if (filters.loanType != null)
    chips.push({ key: "loanType", label: LOAN_TYPE_LABELS[filters.loanType] || filters.loanType });
  if (filters.loanPurpose != null)
    chips.push({ key: "loanPurpose", label: LOAN_PURPOSE_LABELS[filters.loanPurpose] || filters.loanPurpose });

  if (chips.length === 0) {
    el.innerHTML = '<span class="filter-hint">Click any chart segment to filter</span>';
    return;
  }

  el.innerHTML = chips.map(c => `
    <span class="filter-chip" data-key="${c.key}">
      ${c.label} <button>&times;</button>
    </span>
  `).join("") + '<button class="filter-clear">Clear all</button>';

  el.querySelectorAll(".filter-chip button").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.parentElement.dataset.key;
      filters[key] = null;
      renderNational();
    });
  });
  el.querySelector(".filter-clear").addEventListener("click", () => {
    filters = { action: null, loanType: null, loanPurpose: null };
    renderNational();
  });
}

/* ---- Render functions ---- */
function renderAll() {
  renderNational();
  renderGeographic();
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

  // --- Action Taken donut (always aggregates across action, ignores action filter for its own chart) ---
  const byAction = groupBy(filterMain({ action: null }), "action_taken");
  const actionEntries = Object.entries(byAction)
    .map(([code, rows]) => ({ code, ...aggregate(rows) }))
    .sort((a, b) => b.count - a.count);

  renderFilterDonut("chart-action",
    actionEntries.map(e => ACTION_LABELS[e.code] || e.code),
    actionEntries.map(e => e.count),
    actionEntries.map(e => e.code),
    "Application Outcomes",
    "action",
    filters.action
  );

  // Action table
  const totalForPct = actionEntries.reduce((s, e) => s + e.count, 0);
  document.getElementById("table-action").querySelector("tbody").innerHTML = actionEntries.map(e => `
    <tr><td>${ACTION_LABELS[e.code] || e.code}</td>
    <td class="num" data-sort="${e.count}">${fmt.num(e.count)}</td>
    <td class="num" data-sort="${e.count/totalForPct*100}">${fmt.pct(e.count / totalForPct * 100)}</td>
    <td class="num" data-sort="${e.avgLoan}">${fmt.dollar(e.avgLoan)}</td></tr>
  `).join("");
  makeSortable(document.getElementById("table-action"));

  // --- Loan Type donut (ignores loanType filter for its own chart) ---
  const byType = groupBy(filterMain({ loanType: null }), "loan_type");
  const typeEntries = Object.entries(byType)
    .map(([code, rows]) => ({ code, ...aggregate(rows) }))
    .sort((a, b) => b.count - a.count);

  renderFilterDonut("chart-loan-type",
    typeEntries.map(e => LOAN_TYPE_LABELS[e.code] || e.code),
    typeEntries.map(e => e.count),
    typeEntries.map(e => e.code),
    "Loan Type",
    "loanType",
    filters.loanType
  );

  // --- Loan Purpose donut (ignores loanPurpose filter for its own chart) ---
  const byPurpose = groupBy(filterMain({ loanPurpose: null }), "loan_purpose");
  const purposeEntries = Object.entries(byPurpose)
    .map(([code, rows]) => ({ code, ...aggregate(rows) }))
    .sort((a, b) => b.count - a.count);

  renderFilterDonut("chart-loan-purpose",
    purposeEntries.map(e => LOAN_PURPOSE_LABELS[e.code] || e.code),
    purposeEntries.map(e => e.count),
    purposeEntries.map(e => e.code),
    "Loan Purpose",
    "loanPurpose",
    filters.loanPurpose
  );

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
}

function renderGeographic() {
  const g = data.geographic;
  const stateFilter = document.getElementById("state-filter");
  const stateTable = document.getElementById("table-states");

  function renderStateTable(filter = "") {
    const filtered = g.states.filter(s =>
      !filter || s.state.toLowerCase().includes(filter) ||
      (STATE_NAMES[s.state] || "").toLowerCase().includes(filter)
    );
    stateTable.querySelector("tbody").innerHTML = filtered.map(s => `
      <tr>
        <td><strong>${s.state}</strong> <span style="color:var(--text-secondary);font-size:0.8rem">${STATE_NAMES[s.state] || ""}</span></td>
        <td class="num" data-sort="${s.apps}">${fmt.num(s.apps)}</td>
        <td class="num" data-sort="${s.originated}">${fmt.num(s.originated)}</td>
        <td class="num" data-sort="${s.volume_b}">${fmt.billions(s.volume_b)}</td>
        <td class="num" data-sort="${s.orig_pct}">${fmt.pct(s.orig_pct)}</td>
        <td class="num" data-sort="${s.deny_pct}">${fmt.pct(s.deny_pct)}</td>
        <td class="num" data-sort="${s.avg_loan}">${fmt.dollar(s.avg_loan)}</td>
        <td class="num" data-sort="${s.avg_rate}">${fmt.rate(s.avg_rate)}</td>
      </tr>
    `).join("");
    makeSortable(stateTable);
  }

  renderStateTable();
  stateFilter.addEventListener("input", e => renderStateTable(e.target.value.toLowerCase()));

  const rankings = g.rankings;
  renderHBar("chart-vol-rank", rankings.by_volume.map(s => s.state), rankings.by_volume.map(s => s.originated), "Top 10 States by Originations");
  renderHBar("chart-expensive-rank", rankings.most_expensive.map(s => s.state), rankings.most_expensive.map(s => s.avg_loan), "Highest Avg Loan Amount", true);
  renderHBar("chart-denial-rank", rankings.highest_denial.map(s => s.state), rankings.highest_denial.map(s => s.deny_pct), "Highest Denial Rates (%)");
  renderHBar("chart-rate-rank", rankings.highest_rate.map(s => s.state), rankings.highest_rate.map(s => s.avg_rate), "Highest Avg Interest Rates (%)");

  const countyTable = document.getElementById("table-counties");
  countyTable.querySelector("tbody").innerHTML = g.top_counties.map(c => `
    <tr>
      <td>${c.fips}</td>
      <td>${c.county_name || "Unknown"}</td>
      <td>${c.state}</td>
      <td class="num" data-sort="${c.originated}">${fmt.num(c.originated)}</td>
      <td class="num" data-sort="${c.volume_b}">${fmt.billions(c.volume_b)}</td>
      <td class="num" data-sort="${c.orig_pct}">${fmt.pct(c.orig_pct)}</td>
      <td class="num" data-sort="${c.deny_pct}">${fmt.pct(c.deny_pct)}</td>
      <td class="num" data-sort="${c.avg_loan}">${fmt.dollar(c.avg_loan)}</td>
    </tr>
  `).join("");
  makeSortable(countyTable);
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

function renderFilterDonut(canvasId, labels, values, codes, title, filterKey, activeCode) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");

  // Highlight active segment, mute others
  const bgColors = labels.map((_, i) => {
    if (activeCode == null) return COLORS[i % COLORS.length];
    return codes[i] === activeCode ? COLORS[i % COLORS.length] : COLORS_MUTED[i % COLORS_MUTED.length];
  });

  const borderColors = labels.map((_, i) => {
    if (activeCode != null && codes[i] === activeCode) return "#1e40af";
    return "#fff";
  });

  const borderWidths = labels.map((_, i) => {
    if (activeCode != null && codes[i] === activeCode) return 3;
    return 1;
  });

  charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: borderWidths,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, padding: 12, font: { size: 12 } } },
        title: { display: true, text: title + (activeCode != null ? " (filtered)" : ""), font: { size: 14, weight: "600" } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return ` ${ctx.label}: ${fmt.num(ctx.raw)} (${(ctx.raw / total * 100).toFixed(1)}%)`;
            }
          }
        }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const clickedCode = codes[idx];
        // Toggle: click same segment again to clear
        if (filters[filterKey] === clickedCode) {
          filters[filterKey] = null;
        } else {
          filters[filterKey] = clickedCode;
        }
        renderNational();
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

/* ---- Init ---- */
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  loadData();
});
