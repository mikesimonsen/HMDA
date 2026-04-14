/* HMDA Explorer — main application */

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

let data = {};
let charts = {};

/* ---- Data loading ---- */
async function loadData() {
  const [national, geographic] = await Promise.all([
    fetch("data/national.json").then(r => r.json()),
    fetch("data/geographic.json").then(r => r.json()),
  ]);
  data = { national, geographic };
  renderAll();
}

/* ---- Formatting helpers ---- */
const fmt = {
  num: n => n == null ? "—" : Number(n).toLocaleString("en-US"),
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

/* ---- Render functions ---- */
function renderAll() {
  renderNational();
  renderGeographic();
}

function renderNational() {
  const n = data.national;
  const s = n.summary;

  // Summary cards
  document.getElementById("nat-summary").innerHTML = `
    <div class="stat-card"><div class="label">Total Applications</div><div class="value">${fmt.num(s.total_apps)}</div></div>
    <div class="stat-card"><div class="label">Loans Originated</div><div class="value">${fmt.num(s.originated)}</div><div class="sub">${fmt.pct(s.originated / s.total_apps * 100)} of applications</div></div>
    <div class="stat-card"><div class="label">Active Lenders</div><div class="value">${fmt.num(s.lender_count)}</div></div>
    <div class="stat-card"><div class="label">Total Volume</div><div class="value">${fmt.billions(s.total_volume_b)}</div></div>
    <div class="stat-card"><div class="label">Avg Loan Amount</div><div class="value">${fmt.dollar(s.avg_loan)}</div></div>
    <div class="stat-card"><div class="label">Avg Interest Rate</div><div class="value">${fmt.rate(s.avg_rate)}</div></div>
  `;

  // Action taken chart
  renderDonut("chart-action", n.by_action.map(r => r.label), n.by_action.map(r => r.count), "Application Outcomes");

  // Action table
  const actionTbody = n.by_action.map(r => `
    <tr><td>${r.label}</td><td class="num" data-sort="${r.count}">${fmt.num(r.count)}</td>
    <td class="num">${fmt.pct(r.pct)}</td><td class="num">${fmt.dollar(r.avg_loan)}</td></tr>
  `).join("");
  document.getElementById("table-action").querySelector("tbody").innerHTML = actionTbody;
  makeSortable(document.getElementById("table-action"));

  // Loan type chart
  renderDonut("chart-loan-type",
    n.by_loan_type.map(r => r.label),
    n.by_loan_type.map(r => r.count),
    "Loan Type"
  );

  // Loan purpose chart
  renderDonut("chart-loan-purpose",
    n.by_loan_purpose.map(r => r.label),
    n.by_loan_purpose.map(r => r.count),
    "Loan Purpose"
  );

  // Rate distribution bar chart
  const rateBuckets = n.rate_distribution.filter(r => r.bucket !== "Exempt/NA");
  renderBar("chart-rates",
    rateBuckets.map(r => r.bucket),
    rateBuckets.map(r => r.count),
    "Originated Loans by Interest Rate"
  );

  // Denial reasons bar chart
  renderHBar("chart-denials",
    n.denial_reasons.slice(0, 8).map(r => r.label),
    n.denial_reasons.slice(0, 8).map(r => r.count),
    "Top Denial Reasons"
  );
}

function renderGeographic() {
  const g = data.geographic;

  // State table
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

  // State rankings charts
  const rankings = g.rankings;

  renderHBar("chart-vol-rank",
    rankings.by_volume.map(s => s.state),
    rankings.by_volume.map(s => s.originated),
    "Top 10 States by Originations"
  );

  renderHBar("chart-expensive-rank",
    rankings.most_expensive.map(s => s.state),
    rankings.most_expensive.map(s => s.avg_loan),
    "Highest Avg Loan Amount", true
  );

  renderHBar("chart-denial-rank",
    rankings.highest_denial.map(s => s.state),
    rankings.highest_denial.map(s => s.deny_pct),
    "Highest Denial Rates (%)"
  );

  renderHBar("chart-rate-rank",
    rankings.highest_rate.map(s => s.state),
    rankings.highest_rate.map(s => s.avg_rate),
    "Highest Avg Interest Rates (%)"
  );

  // County table
  const countyTable = document.getElementById("table-counties");
  countyTable.querySelector("tbody").innerHTML = g.top_counties.map(c => `
    <tr>
      <td>${c.fips}</td>
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

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function renderDonut(canvasId, labels, values, title) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 1 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, padding: 12, font: { size: 12 } } },
        title: { display: !!title, text: title, font: { size: 14, weight: "600" } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return ` ${ctx.label}: ${fmt.num(ctx.raw)} (${(ctx.raw / total * 100).toFixed(1)}%)`;
            }
          }
        }
      }
    }
  });
}

function renderBar(canvasId, labels, values, title) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: COLORS[0], borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: !!title, text: title, font: { size: 14, weight: "600" } },
        tooltip: { callbacks: { label: ctx => " " + fmt.num(ctx.raw) } }
      },
      scales: {
        y: { ticks: { callback: v => fmt.num(v) } }
      }
    }
  });
}

function renderHBar(canvasId, labels, values, title, isDollar = false) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: COLORS[0], borderRadius: 4 }]
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: !!title, text: title, font: { size: 14, weight: "600" } },
        tooltip: { callbacks: { label: ctx => " " + (isDollar ? fmt.dollar(ctx.raw) : fmt.num(ctx.raw)) } }
      },
      scales: {
        x: { ticks: { callback: v => isDollar ? fmt.dollar(v) : fmt.num(v) } }
      }
    }
  });
}

/* ---- Init ---- */
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  loadData();
});
