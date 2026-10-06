import { setContent, q, escapeHtml, debounce, formatNumber, binDatalistHtml, downloadFile } from "../utilities/tools.js";
import { openPopup, closePopup } from "../utilities/popups.js";
import { paginationHtml } from "../utilities/pagination.js";

// Struktur halaman ini sama dengan transactions.js:
// state { filters, page } -> query string -> controller -> render tabel + paginasi.

const API = '/wms-rmpm/controller/StockOverviewController.php';

function emptyFilters(){
    return { description: '', exp_from: '', exp_to: '', bin: '' };
}

// Disimpan di scope modul: filter & halaman tetap ada saat operator kembali ke menu ini.
const state = {
    filters: emptyFilters(),
    page: 1,
};

let requestId = 0;

export function stock(){
    const f = state.filters;

    setContent(`
        <h2>Stock Overview</h2>

        <div id="stock-filters">
            <input type="text" data-filter="description" placeholder="Description / item code (pisah koma)" value="${escapeHtml(f.description)}" size="32">
            <label>Exp dari <input type="date" data-filter="exp_from" value="${escapeHtml(f.exp_from)}"></label>
            <label>sampai <input type="date" data-filter="exp_to" value="${escapeHtml(f.exp_to)}"></label>
            <input type="text" data-filter="bin" list="bin-options" placeholder="Bin" value="${escapeHtml(f.bin)}">
            ${binDatalistHtml()}
            <button type="button" id="btn-reset">Reset Filter</button>
            <button type="button" id="btn-export">Export Excel</button>
        </div>

        <p id="stock-info">Memuat...</p>

        <table border="1">
            <thead>
                <tr>
                    <th>Item Code</th><th>Description</th><th>Exp Date</th><th>Pallet</th><th>Bin</th>
                    <th>Qty</th><th>UoM</th><th>Qty SAP</th><th>UoM SAP</th><th>Remark</th>
                </tr>
            </thead>
            <tbody id="stock-body"></tbody>
        </table>

        <div id="stock-pagination" style="margin-top:8px;"></div>
    `);

    const debouncedLoad = debounce(loadData, 300);

    // Satu listener untuk semua input filter (event delegation).
    q('#stock-filters').addEventListener('input', (e) => {
        if (!e.target.dataset.filter) return;

        readFiltersFromForm();
        state.page = 1;
        debouncedLoad();
    });

    q('#btn-reset').addEventListener('click', () => {
        state.filters = emptyFilters();
        state.page = 1;
        stock();
    });

    q('#btn-export').addEventListener('click', handleExport);

    q('#stock-pagination').addEventListener('click', (e) => {
        const button = e.target.closest('.page-btn');
        if (!button || button.disabled) return;

        state.page = Number(button.dataset.page);
        loadData();
    });

    q('#stock-body').addEventListener('click', (e) => {
        const button = e.target.closest('.lot-link');
        if (!button) return;

        showLotDetail(button.dataset.item, button.dataset.exp);
    });

    loadData();
}

function readFiltersFromForm(){
    q('#stock-filters').querySelectorAll('[data-filter]').forEach(input => {
        state.filters[input.dataset.filter] = input.value.trim();
    });
}

// Filter yang terisi -> query string. includePage = false untuk export (semua halaman).
function buildQuery(includePage = true){
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(state.filters)) {
        if (value) params.set(key, value);
    }
    if (includePage) params.set('page', state.page);

    return params.toString();
}

async function loadData(){
    const myRequest = ++requestId;

    try {
        const res = await fetch(`${API}?${buildQuery()}`);
        const result = await res.json();

        if (myRequest !== requestId || !q('#stock-body')) return; // jawaban basi

        if (!result.success) {
            q('#stock-info').textContent = 'Gagal memuat data: ' + result.error;
            return;
        }

        const p = result.pagination;
        state.page = p.page;

        renderRows(result.data);
        renderInfo(p);
        q('#stock-pagination').innerHTML = paginationHtml(p.page, p.total_pages);

    } catch (err) {
        if (myRequest !== requestId || !q('#stock-info')) return;
        q('#stock-info').textContent = 'Tidak bisa menghubungi server: ' + err.message;
    }
}

// Daftar bin bisa panjang (satu lot di banyak rak). Tampilkan 3 pertama, sisanya diringkas.
function binSummary(bins){
    const list = (bins || '').split(', ').filter(Boolean);
    if (list.length <= 3) return list.join(', ');
    return `${list.slice(0, 3).join(', ')} +${list.length - 3} lagi`;
}

function renderRows(rows){
    q('#stock-body').innerHTML = rows.map(row => `
        <tr>
            <td>
                <button type="button" class="lot-link"
                        data-item="${escapeHtml(row.item_code)}" data-exp="${escapeHtml(row.exp_date)}">
                    ${escapeHtml(row.item_code)}
                </button>
            </td>
            <td>${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td style="text-align:right">${escapeHtml(row.pallet_count)}</td>
            <td title="${escapeHtml(row.bins)}">${escapeHtml(binSummary(row.bins))}</td>
            <td style="text-align:right">${formatNumber(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td style="text-align:right">${formatNumber(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td>${escapeHtml(row.remarks)}</td>
        </tr>
    `).join('');
}

function renderInfo(p){
    if (p.total === 0) {
        q('#stock-info').textContent = 'Tidak ada stok yang cocok dengan filter.';
        return;
    }

    const first = (p.page - 1) * p.per_page + 1;
    const last = Math.min(p.page * p.per_page, p.total);

    q('#stock-info').textContent = `Menampilkan ${first}–${last} dari ${p.total} lot (item + exp date)`;
}

async function showLotDetail(itemCode, expDate){
    try {
        // Filter aktif ikut dikirim, supaya isi popup cocok dengan baris yang diklik.
        const params = new URLSearchParams(buildQuery(false));
        params.set('detail_item', itemCode);
        params.set('detail_exp', expDate);

        const res = await fetch(`${API}?${params}`);
        const result = await res.json();

        if (!result.success || result.data.length === 0) {
            alert('Detail stok tidak ditemukan');
            return;
        }

        const rows = result.data;
        const head = rows[0];
        const totalQty = rows.reduce((sum, r) => sum + parseFloat(r.qty_actual), 0);
        const totalSap = rows.reduce((sum, r) => sum + parseFloat(r.qty_sap), 0);

        const box = openPopup(`
            <h3>${escapeHtml(head.item_code)} — ${escapeHtml(head.description)}</h3>
            <p>
                Exp Date: <b>${escapeHtml(head.exp_date)}</b><br>
                ${rows.length} pallet, total ${formatNumber(totalQty)} ${escapeHtml(head.uom_fisik)}
                (${formatNumber(totalSap)} ${escapeHtml(head.uom_sap)})
            </p>
            <table border="1">
                <thead>
                    <tr>
                        <th>Pallet</th><th>Bin</th><th>Qty</th><th>UoM</th><th>Faktor</th>
                        <th>Qty SAP</th><th>UoM SAP</th><th>Remark</th><th>Last Update</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td style="text-align:right">${escapeHtml(r.pallet_number)}</td>
                            <td>${escapeHtml(r.bin)}</td>
                            <td style="text-align:right">${formatNumber(r.qty_actual)}</td>
                            <td>${escapeHtml(r.uom_fisik)}</td>
                            <td style="text-align:right">${formatNumber(r.conversion_factor)}</td>
                            <td style="text-align:right">${formatNumber(r.qty_sap)}</td>
                            <td>${escapeHtml(r.uom_sap)}</td>
                            <td>${escapeHtml(r.remark)}</td>
                            <td>${escapeHtml(r.updated_at)}</td>
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
        // Filter yang sama dengan tabel, tapi semua halaman, per pallet.
        await downloadFile(`${API}?${buildQuery(false)}&export=1`, 'stock-rmpm.xlsx');
    } catch (err) {
        alert('Export gagal: ' + err.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Export Excel';
    }
}