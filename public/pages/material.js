import { setContent, q, escapeHtml, debounce, formatNumber, emptyRowHtml } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { openPopup, closePopup } from "../utilities/popups.js";
import { paginationHtml } from "../utilities/pagination.js";
import { ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";

// Menu Material (admin): daftar material master, tambah, dan edit.
//
// Aturannya dicek di SERVER (MaterialMasterController.php): item code 9 digit dan tidak bisa
// diubah, UoM terkunci kalau item sudah punya transaksi, faktor baru hanya untuk Inbound
// berikutnya. Di sini input yang terkunci hanya dinonaktifkan supaya admin tidak mencoba
// sesuatu yang pasti ditolak.

const API = 'controller/MaterialMasterController.php';

// Disimpan di scope modul: pencarian & halaman tetap ada saat kembali ke menu ini.
const state = { keyword: '', page: 1 };

let materials = [];  // isi halaman yang tampil
let uoms = [];       // UoM yang sudah ada, saran di form supaya penulisannya seragam
let requestId = 0;   // penanda jawaban basi

export function material(){
    setContent(`
        <div class="page-header">
            <h2>Material Master</h2>
            <button type="button" id="btn-add-material" class="btn-primary" data-icon="plus">Tambah Material</button>
        </div>

        <section class="card filter-bar open">
            <div class="filter-fields">
                <div class="field grow">
                    <label for="f-material">Description / Item Code</label>
                    <input type="text" id="f-material" value="${escapeHtml(state.keyword)}" placeholder="mis. vitamin b1">
                </div>
            </div>
        </section>

        <section class="card">
            <p class="table-info" id="material-info">Memuat...</p>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>UoM</th><th>UoM SAP</th>
                            <th class="num">Conversion Factor</th><th>Last Update</th><th>Aksi</th>
                        </tr>
                    </thead>
                    <tbody id="material-body"></tbody>
                </table>
            </div>
            <div class="pagination" id="material-pagination"></div>
        </section>
    `);

    q('#btn-add-material').addEventListener('click', () => showMaterialForm(null));

    const debouncedLoad = debounce(loadData, 300);
    q('#f-material').addEventListener('input', (e) => {
        state.keyword = e.target.value.trim();
        state.page = 1;
        debouncedLoad();
    });

    q('#material-pagination').addEventListener('click', (e) => {
        const button = e.target.closest('.page-btn');
        if (!button || button.disabled) return;

        state.page = Number(button.dataset.page);
        loadData();
    });

    // Event delegation: tombol Edit di setiap baris dibuat ulang setiap render.
    q('#material-body').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action="edit"]');
        if (!button) return;

        const item = materials.find(m => m.item_code === button.dataset.code);
        if (item) showMaterialForm(item);
    });

    loadData();
}

async function loadData(){
    const myRequest = ++requestId;

    const params = new URLSearchParams({ action: 'list', page: state.page });
    if (state.keyword) params.set('q', state.keyword);

    try {
        const res = await apiFetch(`${API}?${params}`);
        const result = await res.json();

        // Jawaban basi: sudah ada request yang lebih baru, atau sudah pindah menu.
        if (myRequest !== requestId || !q('#material-body')) return;

        if (!result.success) {
            q('#material-info').textContent = 'Gagal memuat data: ' + result.error;
            return;
        }

        const p = result.pagination;
        state.page = p.page; // server bisa mengoreksi halaman yang di luar jangkauan
        materials = result.data;
        uoms = result.uoms;

        renderRows();
        renderInfo(p);
        q('#material-pagination').innerHTML = paginationHtml(p.page, p.total_pages);

    } catch (err) {
        if (myRequest !== requestId || !q('#material-info')) return;
        q('#material-info').textContent = 'Tidak bisa menghubungi server: ' + err.message;
    }
}

function renderRows(){
    if (materials.length === 0) {
        q('#material-body').innerHTML = emptyRowHtml(7, 'Tidak ada material yang cocok.');
        return;
    }

    q('#material-body').innerHTML = materials.map(m => `
        <tr>
            <td>${escapeHtml(m.item_code)}</td>
            <td class="wrap">${escapeHtml(m.description)}</td>
            <td>${escapeHtml(m.uom_fisik)}</td>
            <td>${escapeHtml(m.uom_sap)}</td>
            <td class="num">${formatNumber(m.conversion_factor)}</td>
            <td>${escapeHtml(m.updated_at)}</td>
            <td><button type="button" class="btn-sm" data-action="edit" data-code="${escapeHtml(m.item_code)}" data-icon="edit">Edit</button></td>
        </tr>
    `).join('');
}

function renderInfo(p){
    if (p.total === 0) {
        q('#material-info').textContent = 'Tidak ada material yang cocok dengan pencarian.';
        return;
    }

    const first = (p.page - 1) * p.per_page + 1;
    const last = Math.min(p.page * p.per_page, p.total);

    q('#material-info').textContent = `Menampilkan ${first}–${last} dari ${p.total} material`;
}

// Tambah Material (item = null) atau Edit Material.
// Kalau server menolak, pesannya tampil DI POPUP dan isian tidak hilang.
function showMaterialForm(item){
    const isNew = item === null;
    const uomLocked = !isNew && item.used;
    const lock = uomLocked ? 'disabled' : '';

    const box = openPopup(`
        <h3>${isNew ? 'Tambah Material' : 'Edit Material'}</h3>
        <form class="form-stack">
            <label class="field"><span class="field-label">Item Code</span>
                ${isNew
                    ? '<input name="item_code" required inputmode="numeric" maxlength="9" autocomplete="off">'
                    : `<input value="${escapeHtml(item.item_code)}" disabled>`}
                ${isNew ? '<small class="hint">9 digit angka. Tidak bisa diubah setelah dibuat.</small>' : ''}
            </label>
            <label class="field"><span class="field-label">Description</span>
                <input name="description" required maxlength="150" value="${escapeHtml(item?.description)}">
            </label>
            <label class="field"><span class="field-label">UoM</span>
                <input name="uom_fisik" required maxlength="10" list="uom-options" value="${escapeHtml(item?.uom_fisik)}" ${lock}>
            </label>
            <label class="field"><span class="field-label">UoM SAP</span>
                <input name="uom_sap" required maxlength="10" list="uom-options" value="${escapeHtml(item?.uom_sap)}" ${lock}>
                ${uomLocked ? '<small class="hint">UoM tidak bisa diubah karena item ini sudah punya transaksi.</small>' : ''}
            </label>
            <label class="field"><span class="field-label">Conversion Factor <small>(qty SAP per 1 UoM)</small></span>
                <input name="conversion_factor" type="number" required min="0.0001" step="any"
                       value="${isNew ? '' : escapeHtml(Number(item.conversion_factor))}">
                ${isNew ? '' : '<small class="hint">Hanya untuk Inbound berikutnya. Pallet yang sudah ada tetap memakai faktornya sendiri.</small>'}
            </label>
            <datalist id="uom-options">${uoms.map(u => `<option value="${escapeHtml(u)}">`).join('')}</datalist>
            <p class="form-error"></p>
            <div class="form-actions">
                <button type="submit" class="btn-primary" data-icon="save">Simpan</button>
                <button type="button" class="btn-cancel" data-icon="x">Batal</button>
            </div>
        </form>
    `);

    const form = box.querySelector('form');
    const errorBox = form.querySelector('.form-error');
    const button = form.querySelector('button[type="submit"]');

    box.querySelector('.btn-cancel').addEventListener('click', closePopup);
    box.querySelector(isNew ? '[name="item_code"]' : '[name="description"]').focus();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.textContent = '';

        // Input yang disabled (UoM terkunci) tetap terbaca nilainya.
        const f = form.elements;
        const body = {
            item_code:         isNew ? f.item_code.value.trim() : item.item_code,
            description:       f.description.value.trim(),
            uom_fisik:         f.uom_fisik.value.trim(),
            uom_sap:           f.uom_sap.value.trim(),
            conversion_factor: f.conversion_factor.value,
        };

        if (!ITEM_CODE_PATTERN.test(body.item_code)) {
            errorBox.textContent = 'Item code harus 9 digit angka';
            f.item_code.focus();
            return;
        }

        button.disabled = true; // cegah submit dobel
        try {
            const res = await apiFetch(`${API}?action=${isNew ? 'create' : 'update'}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);

            closePopup();
            toast(`Material ${body.item_code} ${isNew ? 'ditambahkan' : 'disimpan'}`, 'success');

            // Material baru langsung dicari, supaya terlihat di tabel.
            if (isNew) {
                state.keyword = body.item_code;
                state.page = 1;
                q('#f-material').value = body.item_code;
            }
            loadData();
        } catch (err) {
            errorBox.textContent = err.message; // textContent: aman tanpa escapeHtml
        } finally {
            button.disabled = false;
        }
    });
}
