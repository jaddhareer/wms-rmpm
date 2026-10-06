import { setContent, q, escapeHtml, debounce, formatNumber, downloadFile } from "../utilities/tools.js";
import { openPopup, closePopup } from "../utilities/popups.js";
import { paginationHtml } from "../utilities/pagination.js";

const API = '/wms-rmpm/controller/TransactionController.php';
const TYPES = ['INBOUND', 'OUTBOUND', 'MUTASI', 'RETUR'];

function emptyFilters(){
    return {
        code: '', types: [], description: '', source: '', destination: '',
        date_from: '', time_from: '', date_to: '', time_to: '',
    };
}

// State halaman ini. Hidup di scope modul, jadi filter & halaman tetap tersimpan
// saat operator pindah menu lalu kembali lagi ke sini.
const state = {
    filters: emptyFilters(),
    page: 1,
};

// Nomor request terakhir. Dipakai untuk mengabaikan jawaban yang sudah basi.
let requestId = 0;

export function transactions(){
    const f = state.filters;

    // Nilai awal input diambil dari state -> filter lama muncul lagi saat halaman dibuka ulang.
    setContent(`
        <h2>Histori Transaksi</h2>

        <div id="trx-filters">
            <input type="text" data-filter="code" placeholder="ID Transaksi" value="${escapeHtml(f.code)}">

            <details style="display:inline-block; vertical-align:top;">
                <summary id="type-summary">${escapeHtml(typeSummary())}</summary>
                ${TYPES.map(t => `
                    <label>
                        <input type="checkbox" data-filter="types" value="${t}" ${f.types.includes(t) ? 'checked' : ''}> ${t}
                    </label><br>
                `).join('')}
            </details>

            <input type="text" data-filter="description" placeholder="Description / item code (pisah koma)" value="${escapeHtml(f.description)}" size="32">
            <input type="text" data-filter="source" placeholder="Source" value="${escapeHtml(f.source)}">
            <input type="text" data-filter="destination" placeholder="Destination" value="${escapeHtml(f.destination)}">
            <br>
            <label>Dari
                <input type="date" data-filter="date_from" value="${escapeHtml(f.date_from)}">
                <input type="time" data-filter="time_from" value="${escapeHtml(f.time_from)}">
            </label>
            <label>Sampai
                <input type="date" data-filter="date_to" value="${escapeHtml(f.date_to)}">
                <input type="time" data-filter="time_to" value="${escapeHtml(f.time_to)}">
            </label>
            <button type="button" id="btn-reset">Reset Filter</button>
            <button type="button" id="btn-export">Export Excel</button>
        </div>

        <p id="trx-info">Memuat...</p>

        <table border="1">
            <thead>
                <tr>
                    <th>ID Transaksi</th><th>Jenis</th><th>Item Code</th><th>Description</th><th>Exp Date</th><th>Pallet</th>
                    <th>From</th><th>To</th><th>Qty</th><th>UoM</th><th>Qty SAP</th><th>UoM SAP</th>
                    <th>User</th><th>Remark</th><th>Date Time</th>
                </tr>
            </thead>
            <tbody id="trx-body"></tbody>
        </table>

        <div id="trx-pagination" style="margin-top:8px;"></div>
    `);

    // Satu fungsi load yang sudah di-debounce, dipakai untuk semua perubahan filter.
    const debouncedLoad = debounce(loadData, 300);

    // Event delegation: SATU listener di wadah filter menangkap semua input di dalamnya
    // (teks, checkbox, tanggal, jam), karena event 'input' "naik" (bubble) ke parent.
    q('#trx-filters').addEventListener('input', (e) => {
        if (!e.target.dataset.filter) return;

        readFiltersFromForm();
        state.page = 1;                                   // filter berubah -> kembali ke halaman 1
        q('#type-summary').textContent = typeSummary();
        debouncedLoad();
    });

    q('#btn-reset').addEventListener('click', () => {
        state.filters = emptyFilters();
        state.page = 1;
        transactions();                                   // render ulang dengan filter kosong
    });

    q('#btn-export').addEventListener('click', handleExport);

    // Klik nomor halaman. Tombolnya dibuat ulang setiap render -> delegation di wadahnya.
    q('#trx-pagination').addEventListener('click', (e) => {
        const button = e.target.closest('.page-btn');
        if (!button || button.disabled) return;

        state.page = Number(button.dataset.page);
        loadData();                                       // pindah halaman tidak perlu debounce
    });

    // Klik ID transaksi -> popup detail.
    q('#trx-body').addEventListener('click', (e) => {
        const button = e.target.closest('.trx-code');
        if (!button) return;

        showDetail(button.dataset.code);
    });

    loadData();
}

// Salin nilai form ke state.filters (form -> state). Setelah ini state yang jadi acuan.
function readFiltersFromForm(){
    const box = q('#trx-filters');

    box.querySelectorAll('[data-filter]').forEach(input => {
        if (input.dataset.filter !== 'types') {
            state.filters[input.dataset.filter] = input.value.trim();
        }
    });

    state.filters.types = [...box.querySelectorAll('[data-filter="types"]:checked')]
        .map(checkbox => checkbox.value);
}

function typeSummary(){
    return state.filters.types.length ? state.filters.types.join(', ') : 'Semua jenis';
}

// state -> query string, mis. "types=INBOUND%2COUTBOUND&description=sodium&page=2".
// URLSearchParams otomatis meng-encode karakter khusus (spasi, koma, &), jadi tidak perlu
// encodeURIComponent satu per satu. Filter yang kosong tidak ikut dikirim.
function buildQuery(includePage = true){
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(state.filters)) {
        const text = Array.isArray(value) ? value.join(',') : value;
        if (text) params.set(key, text);
    }
    if (includePage) params.set('page', state.page);

    return params.toString();
}

async function loadData(){
    const myRequest = ++requestId;

    try {
        const res = await fetch(`${API}?${buildQuery()}`);
        const result = await res.json();

        // Jawaban basi: sudah ada request yang lebih baru, atau operator sudah pindah menu.
        if (myRequest !== requestId || !q('#trx-body')) return;

        if (!result.success) {
            q('#trx-info').textContent = 'Gagal memuat data: ' + result.error;
            return;
        }

        const p = result.pagination;
        state.page = p.page; // server bisa mengoreksi halaman yang di luar jangkauan

        renderRows(result.data);
        renderInfo(p);
        q('#trx-pagination').innerHTML = paginationHtml(p.page, p.total_pages);

    } catch (err) {
        if (myRequest !== requestId || !q('#trx-info')) return;
        q('#trx-info').textContent = 'Tidak bisa menghubungi server: ' + err.message;
    }
}

// Asal & tujuan: bin kalau ada, kalau tidak nama supplier / PRODUKSI / QUALITY.
function fromOf(row){ return row.source_bin || row.source || ''; }
function toOf(row){ return row.destination_bin || row.destination || ''; }

function renderRows(rows){
    q('#trx-body').innerHTML = rows.map(row => `
        <tr>
            <td><button type="button" class="trx-code" data-code="${escapeHtml(row.transaction_code)}">${escapeHtml(row.transaction_code)}</button></td>
            <td>${escapeHtml(row.transaction_type)}</td>
            <td>${escapeHtml(row.item_code)}</td>
            <td>${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td>${escapeHtml(row.pallet_number)}</td>
            <td>${escapeHtml(fromOf(row))}</td>
            <td>${escapeHtml(toOf(row))}</td>
            <td style="text-align:right">${formatNumber(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td style="text-align:right">${formatNumber(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td>${escapeHtml(row.user_name)}</td>
            <td>${escapeHtml(row.remark)}</td>
            <td>${escapeHtml(row.created_at)}</td>
        </tr>
    `).join('');
}

function renderInfo(p){
    if (p.total === 0) {
        q('#trx-info').textContent = 'Tidak ada transaksi yang cocok dengan filter.';
        return;
    }

    const first = (p.page - 1) * p.per_page + 1;
    const last = Math.min(p.page * p.per_page, p.total);

    q('#trx-info').textContent = `Menampilkan ${first}–${last} dari ${p.total} baris`;
}

async function showDetail(code){
    try {
        const res = await fetch(`${API}?detail=${encodeURIComponent(code)}`);
        const result = await res.json();

        if (!result.success || result.data.length === 0) {
            alert('Detail transaksi tidak ditemukan');
            return;
        }

        const rows = result.data;
        const head = rows[0]; // semua baris satu dokumen punya jenis, user, dan waktu yang sama

        const box = openPopup(`
            <h3>${escapeHtml(code)}</h3>
            <p>
                Jenis: <b>${escapeHtml(head.transaction_type)}</b><br>
                Waktu: ${escapeHtml(head.created_at)}<br>
                User: ${escapeHtml(head.user_name)}<br>
                Jumlah: ${rows.length} pallet
            </p>
            <table border="1">
                <thead>
                    <tr>
                        <th>Item Code</th><th>Description</th><th>Exp Date</th><th>Pallet</th>
                        <th>From</th><th>To</th><th>Qty</th><th>UoM</th><th>Qty SAP</th><th>UoM SAP</th><th>Remark</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => `
                        <tr>
                            <td>${escapeHtml(row.item_code)}</td>
                            <td>${escapeHtml(row.description)}</td>
                            <td>${escapeHtml(row.exp_date)}</td>
                            <td>${escapeHtml(row.pallet_number)}</td>
                            <td>${escapeHtml(fromOf(row))}</td>
                            <td>${escapeHtml(toOf(row))}</td>
                            <td style="text-align:right">${formatNumber(row.qty_actual)}</td>
                            <td>${escapeHtml(row.uom_fisik)}</td>
                            <td style="text-align:right">${formatNumber(row.qty_sap)}</td>
                            <td>${escapeHtml(row.uom_sap)}</td>
                            <td>${escapeHtml(row.remark)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <br>
            <button type="button" id="btn-close-popup">Tutup</button>
        `);

        box.querySelector('#btn-close-popup').addEventListener('click', closePopup);

    } catch (err) {
        alert('Tidak bisa menghubungi server: ' + err.message);
    }
}
async function handleExport(){
    const button = q('#btn-export');
    button.disabled = true;
    button.textContent = 'Menyiapkan file...';

    try {
        // Filter yang sama dengan tabel, tapi semua halaman.
        await downloadFile(`${API}?${buildQuery(false)}&export=1`, 'transaksi-rmpm.xlsx');
    } catch (err) {
        alert('Export gagal: ' + err.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Export Excel';
    }
}