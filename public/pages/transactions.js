import { setContent, q, escapeHtml, debounce, formatNumber, downloadFile } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { openPopup, closePopup } from "../utilities/popups.js";
import { paginationHtml } from "../utilities/pagination.js";
import { dropdown } from "../utilities/dropdown.js";
import { navigateTo } from "../utilities/router.js";

const API = 'controller/TransactionController.php';
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

// Panel filter di HP (< 640px) bisa dibuka-tutup, supaya tabel langsung terlihat.
// Di layar lebar panel selalu tampil (lihat .filter-bar di style.css).
let filtersOpen = false;

export function transactions(){
    const f = state.filters;

    // Nilai awal input diambil dari state -> filter lama muncul lagi saat halaman dibuka ulang.
    setContent(`
        <div class="page-header">
            <h2>Histori Transaksi</h2>
            <button type="button" id="btn-export" class="btn-success" data-icon="download">Export Excel</button>
        </div>

        <section class="card filter-bar${filtersOpen ? ' open' : ''}" id="trx-filters">
            <button type="button" class="filter-toggle" data-icon="filter" aria-expanded="${filtersOpen}" aria-controls="trx-filter-fields">
                Filter <span class="badge" id="filter-count"></span>
            </button>
            <div class="filter-fields" id="trx-filter-fields">
                <div class="field">
                    <label for="f-code">ID Transaksi</label>
                    <input type="text" id="f-code" data-filter="code" placeholder="RMPM..." value="${escapeHtml(f.code)}">
                </div>
                <div class="field grow">
                    <label for="f-description">Description / Item Code</label>
                    <input type="text" id="f-description" data-filter="description" placeholder="pisah dengan koma" value="${escapeHtml(f.description)}">
                </div>
                <div class="field">
                    <label for="f-source">Source</label>
                    <input type="text" id="f-source" data-filter="source" value="${escapeHtml(f.source)}">
                </div>
                <div class="field">
                    <label for="f-destination">Destination</label>
                    <input type="text" id="f-destination" data-filter="destination" value="${escapeHtml(f.destination)}">
                </div>
                <div class="field fit">
                    <span class="field-label" id="type-label">Jenis</span>
                    <div class="dropdown" id="type-dropdown">
                        <button type="button" class="dropdown-toggle" aria-expanded="false" aria-labelledby="type-label type-summary">
                            <span id="type-summary">${escapeHtml(typeSummary())}</span>
                        </button>
                        <div class="dropdown-menu" role="group" aria-label="Pilih jenis transaksi">
                            ${TYPES.map(t => `
                                <label class="check-item">
                                    <input type="checkbox" data-filter="types" value="${t}" ${f.types.includes(t) ? 'checked' : ''}>
                                    ${typeBadge(t)}
                                </label>
                            `).join('')}
                            <p class="dropdown-hint">Tidak ada yang dicentang = semua jenis</p>
                        </div>
                    </div>
                </div>
                <div class="field fit">
                    <label for="f-date-from">Tanggal &amp; jam</label>
                    <div class="date-range">
                        <span class="range-part" data-label="Dari">
                            <input type="date" id="f-date-from" data-filter="date_from" value="${escapeHtml(f.date_from)}" aria-label="Dari tanggal">
                            <input type="time" data-filter="time_from" value="${escapeHtml(f.time_from)}" aria-label="Dari jam">
                        </span>
                        <span class="range-sep" aria-hidden="true">s/d</span>
                        <span class="range-part" data-label="Sampai">
                            <input type="date" data-filter="date_to" value="${escapeHtml(f.date_to)}" aria-label="Sampai tanggal">
                            <input type="time" data-filter="time_to" value="${escapeHtml(f.time_to)}" aria-label="Sampai jam">
                        </span>
                    </div>
                </div>
                <button type="button" id="btn-reset" data-icon="reset" title="Kosongkan semua filter">Reset</button>
            </div>
        </section>

        <section class="card">
            <p class="table-info" id="trx-info">Memuat...</p>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID Transaksi</th><th>Jenis</th><th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th>
                            <th>From</th><th>To</th><th class="num">Qty</th><th>UoM</th><th class="num">Qty SAP</th><th>UoM SAP</th>
                            <th>User</th><th>Remark</th><th>Date Time</th>
                        </tr>
                    </thead>
                    <tbody id="trx-body"></tbody>
                </table>
            </div>
            <div class="pagination" id="trx-pagination"></div>
        </section>
    `);

    // Satu fungsi load yang sudah di-debounce, dipakai untuk semua perubahan filter.
    const debouncedLoad = debounce(loadData, 300);

    // Event delegation: SATU listener di wadah filter menangkap semua input di dalamnya
    // (teks, checkbox, tanggal, jam), karena event 'input' "naik" (bubble) ke parent.
    q('#trx-filters').addEventListener('input', (e) => {
        if (!e.target.dataset.filter) return;

        readFiltersFromForm();
        renderFilterCount();
        q('#type-summary').textContent = typeSummary();
        state.page = 1;                                   // filter berubah -> kembali ke halaman 1
        debouncedLoad();
    });

    q('.filter-toggle').addEventListener('click', toggleFilters);

    // Jenis: checklist yang tersembunyi di dropdown (buka/tutup diatur dropdown.js).
    // Centang/hapus centang tetap tertangkap listener 'input' di atas.
    dropdown(q('#type-dropdown'));

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

    renderFilterCount();
    loadData();
}

function toggleFilters(){
    filtersOpen = !filtersOpen;
    q('#trx-filters').classList.toggle('open', filtersOpen);
    q('.filter-toggle').setAttribute('aria-expanded', String(filtersOpen));
}

// Jumlah filter yang terisi, tampil di tombol "Filter" (HP): tetap terlihat ada filter
// aktif walaupun panelnya sedang ditutup. Teks dan array (types) sama-sama punya .length.
function renderFilterCount(){
    const count = Object.values(state.filters).filter(value => value.length > 0).length;
    q('#filter-count').textContent = count || '';
}

// Teks tombol dropdown Jenis: "Semua jenis", "INBOUND, RETUR", atau "3 jenis".
function typeSummary(){
    const types = state.filters.types;
    if (types.length === 0) return 'Semua jenis';
    if (types.length <= 2) return types.join(', ');
    return `${types.length} jenis`;
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

// Ikon per jenis transaksi = ikon menunya (lihat MENU_GROUPS di main.js).
const TYPE_ICONS = { INBOUND: 'inbound', OUTBOUND: 'outbound', MUTASI: 'swap', RETUR: 'undo' };

// Jenis transaksi sebagai badge berwarna + ikon (warnanya di style.css: .badge-inbound, dst.).
function typeBadge(type){
    const icon = TYPE_ICONS[type] ? ` data-icon="${TYPE_ICONS[type]}"` : '';
    return `<span class="badge badge-${escapeHtml(String(type).toLowerCase())}"${icon}>${escapeHtml(type)}</span>`;
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
        const res = await apiFetch(`${API}?${buildQuery()}`);
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
            <td><button type="button" class="trx-code link-btn" data-code="${escapeHtml(row.transaction_code)}">${escapeHtml(row.transaction_code)}</button></td>
            <td>${typeBadge(row.transaction_type)}</td>
            <td>${escapeHtml(row.item_code)}</td>
            <td class="wrap">${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td class="num">${escapeHtml(row.pallet_number)}</td>
            <td>${escapeHtml(fromOf(row))}</td>
            <td>${escapeHtml(toOf(row))}</td>
            <td class="num">${formatNumber(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td class="num">${formatNumber(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td>${escapeHtml(row.user_name)}</td>
            <td class="wrap">${escapeHtml(row.remark)}</td>
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
        const res = await apiFetch(`${API}?detail=${encodeURIComponent(code)}`);
        const result = await res.json();

        if (!result.success || result.data.length === 0) {
            toast('Detail transaksi tidak ditemukan', 'error');
            return;
        }

        const rows = result.data;
        const head = rows[0]; // semua baris satu dokumen punya jenis, user, dan waktu yang sama

        const box = openPopup(`
            <h3>${escapeHtml(code)}</h3>
            <dl class="meta-list">
                <dt>Jenis</dt>  <dd>${typeBadge(head.transaction_type)}</dd>
                <dt>Waktu</dt>  <dd>${escapeHtml(head.created_at)}</dd>
                <dt>User</dt>   <dd>${escapeHtml(head.user_name)}</dd>
                <dt>Jumlah</dt> <dd>${rows.length} pallet</dd>
            </dl>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th>
                            <th>From</th><th>To</th><th class="num">Qty</th><th>UoM</th><th class="num">Qty SAP</th><th>UoM SAP</th><th>Remark</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                <td>${escapeHtml(row.item_code)}</td>
                                <td class="wrap">${escapeHtml(row.description)}</td>
                                <td>${escapeHtml(row.exp_date)}</td>
                                <td class="num">${escapeHtml(row.pallet_number)}</td>
                                <td>${escapeHtml(fromOf(row))}</td>
                                <td>${escapeHtml(toOf(row))}</td>
                                <td class="num">${formatNumber(row.qty_actual)}</td>
                                <td>${escapeHtml(row.uom_fisik)}</td>
                                <td class="num">${formatNumber(row.qty_sap)}</td>
                                <td>${escapeHtml(row.uom_sap)}</td>
                                <td class="wrap">${escapeHtml(row.remark)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="form-actions">
                ${head.transaction_type === 'OUTBOUND'
                    ? `<button type="button" id="btn-retur" class="btn-soft" data-icon="undo">Retur</button>`
                    : ''}
                <button type="button" id="btn-print" class="btn-primary" data-icon="printer">Print</button>
                <button type="button" id="btn-close-popup" data-icon="x">Tutup</button>
            </div>
        `);

        box.querySelector('#btn-close-popup').addEventListener('click', closePopup);

        // Print: halaman cetak (dengan tanda tangan) dibuka di tab baru,
        // halaman SPA ini tetap di tempatnya.
        box.querySelector('#btn-print').addEventListener('click', () => {
            window.open(`controller/TransactionPrint.php?code=${encodeURIComponent(code)}`, '_blank');
        });

        // Hanya dokumen OUTBOUND yang bisa diretur -> buka menu Retur dengan ID ini terisi.
        box.querySelector('#btn-retur')?.addEventListener('click', () => {
            closePopup();
            navigateTo('retur', { code });
        });

    } catch (err) {
        toast('Tidak bisa menghubungi server: ' + err.message, 'error');
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
        toast('Export gagal: ' + err.message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Export Excel';
    }
}