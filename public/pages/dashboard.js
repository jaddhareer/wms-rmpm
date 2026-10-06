import { setContent, q, escapeHtml, formatNumber } from "../utilities/tools.js";

// Dashboard: okupansi saat ini (meter per lokasi) + pergerakan pallet inbound/outbound
// per periode (grafik batang Chart.js).
//
// Chart.js dimuat di index.html sebagai <script> biasa (file lokal di public/vendor),
// jadi di sini tersedia sebagai variabel global window.Chart.

const API = '/wms-rmpm/controller/DashboardController.php';

const PERIODS = [
    ['daily',   'Harian (14 hari)'],
    ['weekly',  'Mingguan (12 minggu)'],
    ['monthly', 'Bulanan (12 bulan)'],
    ['yearly',  'Tahunan (5 tahun)'],
];

// Warna seri (palet kategorikal yang sudah divalidasi aman untuk buta warna).
const SERIES = [
    { key: 'inbound',  label: 'Inbound',  color: '#2a78d6' },
    { key: 'outbound', label: 'Outbound', color: '#eb6834' },
];

const RANGES = [
    ['week',  '7 hari terakhir'],
    ['month', '30 hari terakhir'],
    ['year',  '1 tahun terakhir'],
];

// Warna garis per lokasi (4 slot pertama palet kategorikal, urutan tetap).
const LOCATION_COLORS = {
    GUDANG_40: '#2a78d6',
    GUDANG_50: '#eb6834',
    FLOOR_40:  '#1baf7a',
    FLOOR_50:  '#eda100',
};

let period = 'daily';
let range = 'month';
let requestId = 0;

// Instance Chart.js yang sedang tampil. Wajib di-destroy sebelum halaman digambar ulang,
// karena Chart.js memasang listener resize sendiri yang tidak ikut hilang bersama canvas.
let chart = null;       // grafik batang pergerakan
let trendChart = null;  // grafik garis okupansi harian

export function dashboard(){
    if (chart) {
        chart.destroy();
        chart = null;
    }
    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }

    setContent(`
        <style>
            .dash { --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781; --surface: #fcfcfb; }
            .dash h3 { margin: 20px 0 8px; }
            .dash-cards { display: flex; flex-wrap: wrap; gap: 12px; }
            .dash-card { flex: 1 1 200px; max-width: 280px; border: 1px solid rgba(11,11,11,.12); border-radius: 8px; padding: 12px 14px; background: var(--surface); }
            .dash-card-label { color: var(--ink-2); font-size: 14px; }
            .dash-card-value { font-size: 28px; font-weight: 600; color: var(--ink); margin: 2px 0; }
            .dash-card-cap { font-size: 14px; font-weight: 400; color: var(--ink-2); }
            .dash-meter { height: 8px; border-radius: 4px; overflow: hidden; margin: 6px 0; }
            .dash-meter > div { height: 100%; border-radius: 4px; }
            .dash-card-foot { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink-2); }
            .dash-status::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; background: var(--dot); }
            .dash-racks { font-size: 12px; color: var(--muted); margin-top: 4px; }
            .dash-note { font-size: 13px; color: var(--ink-2); }
            .dash-filters { margin-bottom: 8px; }
            .dash-chart { margin: 0; max-width: 920px; transition: opacity .15s; }
            .dash-chart.loading { opacity: .5; }
            .dash-legend { display: flex; gap: 16px; font-size: 13px; color: var(--ink-2); margin-bottom: 4px; }
            .dash-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
            .dash-canvas { position: relative; height: 280px; }
        </style>

        <div class="dash">
            <h2>Dashboard</h2>

            <h3>Okupansi saat ini</h3>
            <div class="dash-cards" id="occ-cards">Memuat...</div>
            <p class="dash-note" id="occ-note"></p>

            <h3>Pergerakan pallet</h3>
            <div class="dash-filters">
                <label>Periode
                    <select id="period">
                        ${PERIODS.map(([value, label]) =>
                            `<option value="${value}" ${value === period ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </label>
            </div>
            <figure class="dash-chart" id="mv-figure">
                <div class="dash-legend" id="mv-legend"></div>
                <div class="dash-canvas"><canvas id="mv-canvas" aria-label="Jumlah pallet inbound dan outbound per periode" role="img"></canvas></div>
                <details>
                    <summary class="dash-note">Lihat sebagai tabel</summary>
                    <table border="1" id="mv-table"></table>
                </details>
            </figure>

            <h3>Deviasi okupansi harian</h3>
            <div class="dash-filters">
                <label>Rentang
                    <select id="range">
                        ${RANGES.map(([value, label]) =>
                            `<option value="${value}" ${value === range ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </label>
                <span class="dash-note">Persentase posisi pallet terisi di akhir tiap hari, dihitung dari riwayat transaksi.</span>
            </div>
            <figure class="dash-chart" id="tr-figure">
                <div class="dash-legend" id="tr-legend"></div>
                <div class="dash-canvas"><canvas id="tr-canvas" aria-label="Persentase okupansi harian per lokasi" role="img"></canvas></div>
                <p class="dash-note" id="tr-note"></p>
                <details>
                    <summary class="dash-note">Lihat sebagai tabel</summary>
                    <table border="1" id="tr-table"></table>
                </details>
            </figure>
        </div>
    `);

    q('#period').addEventListener('change', (e) => {
        period = e.target.value;
        loadData();
    });

    q('#range').addEventListener('change', (e) => {
        range = e.target.value;
        loadData();
    });

    loadData();
}

async function loadData(){
    const myRequest = ++requestId;
    q('#mv-figure')?.classList.add('loading'); // grafik lama tetap terlihat (redup) selama memuat
    q('#tr-figure')?.classList.add('loading');

    try {
        const res = await fetch(`${API}?period=${encodeURIComponent(period)}&range=${encodeURIComponent(range)}`);
        const result = await res.json();

        if (myRequest !== requestId || !q('#occ-cards')) return; // jawaban basi / sudah pindah menu

        if (!result.success) {
            q('#occ-cards').textContent = 'Gagal memuat data: ' + result.error;
            return;
        }

        renderOccupancy(result.occupancy);
        renderMovements(result.movements);
        renderTrend(result.trend);

    } catch (err) {
        if (myRequest !== requestId || !q('#occ-cards')) return;
        q('#occ-cards').textContent = 'Tidak bisa menghubungi server: ' + err.message;
    } finally {
        if (myRequest === requestId) {
            q('#mv-figure')?.classList.remove('loading');
            q('#tr-figure')?.classList.remove('loading');
        }
    }
}

// ---------------------------------------------------------
// Okupansi: satu kartu + meter per lokasi
// ---------------------------------------------------------

// Tingkat kepenuhan. Warna status selalu didampingi teks, tidak berdiri sendiri.
function levelOf(percent){
    if (percent >= 95) return { fill: '#d03b3b', track: '#f6d0d0', dot: '#d03b3b', text: 'Penuh' };
    if (percent >= 80) return { fill: '#fab219', track: '#fdeac0', dot: '#fab219', text: 'Hampir penuh' };
    return { fill: '#2a78d6', track: '#cde2fb', dot: null, text: '' };
}

function renderOccupancy(occ){
    q('#occ-cards').innerHTML = occ.locations.map(loc => {
        const level = levelOf(loc.percent);
        const racks = Object.entries(loc.racks || {});

        return `
            <div class="dash-card">
                <div class="dash-card-label">${escapeHtml(loc.label)}</div>
                <div class="dash-card-value">
                    ${formatNumber(loc.pallets)} <span class="dash-card-cap">/ ${formatNumber(loc.capacity)} pallet</span>
                </div>
                <div class="dash-meter" style="background:${level.track}"
                     role="meter" aria-valuemin="0" aria-valuemax="${loc.capacity}" aria-valuenow="${loc.pallets}"
                     aria-label="${escapeHtml(loc.label)}">
                    <div style="width:${Math.min(100, loc.percent)}%; background:${level.fill}"></div>
                </div>
                <div class="dash-card-foot">
                    <span>${formatNumber(loc.percent)}% terisi</span>
                    ${level.text ? `<span class="dash-status" style="--dot:${level.dot}">${level.text}</span>` : ''}
                </div>
                ${racks.length
                    ? `<div class="dash-racks">${racks.map(([rack, n]) => `Rak ${escapeHtml(rack)}: ${formatNumber(n)}`).join(' · ')}</div>`
                    : ''}
            </div>
        `;
    }).join('');

    const notes = [];
    if (occ.stage_pallets > 0) {
        notes.push(`${formatNumber(occ.stage_pallets)} pallet di STAGE tidak dihitung ke okupansi.`);
    }
    if (occ.unknown_bins.length > 0) {
        const list = occ.unknown_bins.map(u => `${u.bin} (${u.pallets})`).join(', ');
        notes.push(`Bin tidak dikenal, tidak dihitung: ${list}. Periksa penulisan bin-nya.`);
    }
    q('#occ-note').textContent = notes.join(' ');
}

// ---------------------------------------------------------
// Pergerakan: grafik batang Chart.js (inbound & outbound per periode)
// ---------------------------------------------------------

function renderMovements(mv){
    const datasets = SERIES.map(s => ({
        label: s.label,
        data: mv[s.key],
        backgroundColor: s.color,
        hoverBackgroundColor: s.color + 'cc',              // sedikit lebih terang saat di-hover
        maxBarThickness: 24,                               // batang tipis, sisa ruang dibiarkan kosong
        borderRadius: { topLeft: 4, topRight: 4 },          // ujung atas membulat, dasar persegi
        borderSkipped: 'bottom',
        borderColor: '#fcfcfb',                            // garis warna latar = celah antar batang
        borderWidth: { left: 1, right: 1 },
    }));

    if (chart) {
        // Sudah ada grafik di halaman ini (ganti periode): cukup ganti datanya, lalu update.
        chart.data.labels = mv.labels;
        chart.data.datasets.forEach((ds, i) => { ds.data = datasets[i].data; });
        chart.update();
    } else {
        chart = new window.Chart(q('#mv-canvas'), {
            type: 'bar',
            data: { labels: mv.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,                // tinggi mengikuti .dash-canvas (280px)
                locale: 'id-ID',                           // angka 1.234 (format Indonesia)
                interaction: { mode: 'index', intersect: false }, // hover satu periode -> semua seri
                plugins: {
                    legend: { display: false },            // pakai legenda HTML sendiri (ada totalnya)
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)} pallet`,
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#898781' },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#898781', precision: 0 }, // jumlah pallet selalu bilangan bulat
                        grid: { color: '#e1e0d9' },
                        border: { display: false },
                    },
                },
            },
        });
    }

    // Legenda (2 seri) + total periode.
    q('#mv-legend').innerHTML = SERIES.map(s => {
        const total = mv[s.key].reduce((a, b) => a + b, 0);
        return `<span><i style="background:${s.color}"></i>${s.label}: <b>${formatNumber(total)}</b> pallet</span>`;
    }).join('');

    // Tabel: versi aksesibel dari grafik, semua angka bisa dibaca tanpa hover.
    q('#mv-table').innerHTML = `
        <thead><tr><th>Periode</th>${SERIES.map(s => `<th>${s.label}</th>`).join('')}</tr></thead>
        <tbody>${mv.labels.map((label, i) => `
            <tr><td>${escapeHtml(label)}</td>${SERIES.map(s => `<td style="text-align:right">${formatNumber(mv[s.key][i])}</td>`).join('')}</tr>
        `).join('')}</tbody>`;
}

// ---------------------------------------------------------
// Okupansi harian: grafik garis Chart.js, satu garis per lokasi (dalam persen,
// supaya Gudang 40 berkapasitas 1000 dan Floor 50 berkapasitas 20 bisa dibandingkan
// pada satu sumbu yang sama).
// ---------------------------------------------------------

function renderTrend(trend){
    const fewPoints = trend.labels.length <= 31; // titik hanya digambar kalau tidak terlalu rapat

    const datasets = trend.series.map(s => ({
        label: s.label,
        data: s.percent,
        pallets: s.pallets,              // dipakai tooltip (bukan properti bawaan Chart.js)
        capacity: s.capacity,
        borderColor: LOCATION_COLORS[s.key],
        backgroundColor: LOCATION_COLORS[s.key],
        borderWidth: 2,
        pointRadius: fewPoints ? 4 : 0,      // titik minimal 8px
        pointHoverRadius: 5,
        pointBorderColor: '#fcfcfb',     // cincin warna latar di sekeliling titik
        pointBorderWidth: 2,
        tension: 0,                      // garis lurus antar hari, tidak dihaluskan
    }));

    const maxPercent = Math.max(100, ...trend.series.flatMap(s => s.percent));

    if (trendChart) {
        trendChart.data.labels = trend.labels;
        trendChart.data.datasets = datasets;
        trendChart.options.scales.y.max = Math.ceil(maxPercent / 10) * 10;
        trendChart.update();
    } else {
        trendChart = new window.Chart(q('#tr-canvas'), {
            type: 'line',
            data: { labels: trend.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                locale: 'id-ID',
                interaction: { mode: 'index', intersect: false }, // satu tooltip berisi semua lokasi
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const ds = ctx.dataset;
                                const n = ds.pallets[ctx.dataIndex];
                                return ` ${ds.label}: ${formatNumber(ctx.parsed.y)}% (${formatNumber(n)} / ${formatNumber(ds.capacity)} pallet)`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#898781', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
                    },
                    y: {
                        min: 0,
                        max: Math.ceil(maxPercent / 10) * 10,
                        ticks: { color: '#898781', callback: (v) => `${v}%` },
                        grid: { color: '#e1e0d9' },
                        border: { display: false },
                    },
                },
            },
        });
    }

    // Legenda: warna garis + okupansi hari terakhir.
    q('#tr-legend').innerHTML = trend.series.map(s => {
        const last = s.percent[s.percent.length - 1];
        return `<span><i style="background:${LOCATION_COLORS[s.key]}"></i>${escapeHtml(s.label)}: <b>${formatNumber(last)}%</b></span>`;
    }).join('');

    // Kalau riwayat (dari ledger) tidak cocok dengan stok sekarang, beri tahu.
    q('#tr-note').textContent = trend.mismatch.length
        ? `Perhatian: riwayat transaksi tidak cocok dengan stok saat ini untuk ${trend.mismatch.join(', ')}. ` +
          'Kemungkinan ada data stok yang diubah langsung di database tanpa lewat transaksi.'
        : '';

    // Tabel: tanggal terbaru di atas.
    const rows = trend.labels.map((label, i) => ({ label, i })).reverse();
    q('#tr-table').innerHTML = `
        <thead><tr><th>Tanggal</th>${trend.series.map(s => `<th>${escapeHtml(s.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(({ label, i }) => `
            <tr><td>${escapeHtml(label)}</td>${trend.series.map(s =>
                `<td style="text-align:right">${formatNumber(s.percent[i])}% (${formatNumber(s.pallets[i])})</td>`).join('')}</tr>
        `).join('')}</tbody>`;
}
