import { setContent, q, escapeHtml, emptyRowHtml } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { openPopup, closePopup, onRowPick } from "../utilities/popups.js";
import { materialAutocomplete, ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";

// Pallet yang sudah di-Add tapi belum di-submit.
let state = [];

// Pallet yang sedang dipilih di form (satu baris dari StockController).
let selectedPallet = null;

export function outbound(){
    selectedPallet = null;

    setContent(`
        <div class="page-header"><h2>Outbound</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field">
                    <label for="destination">Outbound To</label>
                    <select id="destination">
                        <option value="">-- pilih --</option>
                        <option value="PRODUKSI">Produksi</option>
                        <option value="QUALITY">Quality</option>
                    </select>
                </div>
                <hr>
                <div class="field wide">
                    <label for="item-code">Item Code</label>
                    <div class="input-group">
                        <input type="text" id="item-code">
                        <button type="button" id="btn-choose" data-icon="list">Pilih Pallet</button>
                    </div>
                </div>
                <div class="field wide">
                    <label for="item-name">Item Name</label>
                    <input type="text" id="item-name" disabled>
                </div>
                <div class="field">
                    <label for="exp-date">Expired Date</label>
                    <input type="text" id="exp-date" disabled>
                </div>
                <div class="field">
                    <label for="pallet-number">Pallet</label>
                    <input type="text" id="pallet-number" disabled>
                </div>
                <div class="field">
                    <label for="bin">Bin</label>
                    <input type="text" id="bin" disabled>
                </div>
                <div class="field">
                    <label for="qty-available">Stok Pallet</label>
                    <input type="text" id="qty-available" disabled>
                </div>
                <hr>
                <div class="field">
                    <label for="qty-fisik">Quantity</label>
                    <div class="input-group">
                        <input type="number" id="qty-fisik" min="0" step="any">
                        <input type="text" id="uom-fisik" class="unit" disabled aria-label="UoM">
                    </div>
                </div>
                <div class="field">
                    <label for="qty-sap">Qty SAP</label>
                    <div class="input-group">
                        <input type="text" id="qty-sap" disabled>
                        <input type="text" id="uom-sap" class="unit" disabled aria-label="UoM SAP">
                    </div>
                </div>
                <div class="field wide">
                    <label for="remark">Remark</label>
                    <input type="text" id="remark">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-add" class="btn-soft" data-icon="plus">Add</button>
            </div>
        </section>

        <section class="card">
            <h3 class="card-title">Daftar Pallet <span class="badge" id="preview-count">0</span></h3>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th><th>Bin</th><th>Tujuan</th>
                            <th class="num">Qty</th><th>UoM</th><th class="num">Qty SAP</th><th>UoM SAP</th><th>Remark</th><th></th>
                        </tr>
                    </thead>
                    <tbody id="preview-body"></tbody>
                </table>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-submit" class="btn-primary" data-icon="save">Submit</button>
            </div>
        </section>
    `);

    q('#item-code').addEventListener('input', handleItemCodeInput);
    // Ketik deskripsi -> pilih saran -> sama seperti scan item code: daftar pallet dimuat.
    // Hanya material yang masih ada stoknya yang disarankan.
    materialAutocomplete(q('#item-code'), {
        inStockOnly: true,
        onSelect: (material) => loadPallets(material.item_code),
    });
    q('#btn-choose').addEventListener('click', () => loadPallets(q('#item-code').value.trim()));
    q('#qty-fisik').addEventListener('input', calculateQtySap);
    q('#btn-add').addEventListener('click', handleAdd);
    q('#btn-submit').addEventListener('click', handleSubmit);
    q('#preview-body').addEventListener('click', handleDeleteRow);

    renderPreview();
}

// Identitas pallet = item_code + exp_date + pallet_number.
// Number() karena dari PHP angka bisa datang sebagai string ("3" vs 3).
function samePallet(a, b){
    return a.item_code === b.item_code
        && a.exp_date === b.exp_date
        && Number(a.pallet_number) === Number(b.pallet_number);
}

function handleItemCodeInput(){
    const itemCode = q('#item-code').value.trim();
    selectPallet(null);

    // Hanya item code penuh (9 digit). Deskripsi diketik -> lewat saran autocomplete.
    if (ITEM_CODE_PATTERN.test(itemCode)) {
        loadPallets(itemCode);
    }
}

async function loadPallets(itemCode){
    if (!itemCode) return;

    // Tombol "Pilih Pallet" bisa diklik saat input masih berisi deskripsi.
    if (!ITEM_CODE_PATTERN.test(itemCode)) {
        toast('Item code belum valid: scan item code atau pilih dari saran', 'warning');
        return;
    }

    const res = await apiFetch(`controller/StockController.php?item_code=${encodeURIComponent(itemCode)}`);
    const data = await res.json();

    // Abaikan jawaban basi (input sudah berubah / sudah pindah halaman).
    if (q('#item-code')?.value.trim() !== itemCode) return;

    if (!res.ok) {
        toast(data.error, 'error');
        return;
    }

    // Pallet yang sudah ada di daftar tidak ditawarkan lagi.
    const pallets = data.filter(pallet => !state.some(row => samePallet(row, pallet)));

    if (pallets.length === 0) {
        toast(`Tidak ada stok tersisa untuk item ${itemCode}`, 'warning');
    } else if (pallets.length === 1) {
        selectPallet(pallets[0]);
    } else {
        showPalletPopup(pallets);
    }
}

function showPalletPopup(pallets){
    const box = openPopup(`
        <h3>Pilih pallet: ${escapeHtml(pallets[0].description)}</h3>
        <p class="hint">Urut dari expired paling dekat (FEFO). Klik baris untuk memilih.</p>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Exp Date</th><th class="num">Pallet</th><th>Bin</th><th class="num">Qty</th><th></th></tr>
                </thead>
                <tbody>
                    ${pallets.map((pallet, index) => `
                        <tr class="pick-row" data-index="${index}" tabindex="0">
                            <td>${escapeHtml(pallet.exp_date)}</td>
                            <td class="num">${escapeHtml(pallet.pallet_number)}</td>
                            <td>${escapeHtml(pallet.bin)}</td>
                            <td class="num">${escapeHtml(pallet.qty_actual)} ${escapeHtml(pallet.uom_fisik)}</td>
                            <td class="pick-arrow" data-icon="chevron-right"></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div class="form-actions">
            <button type="button" id="btn-close-popup" data-icon="x">Batal</button>
        </div>
    `);

    box.querySelector('#btn-close-popup').addEventListener('click', closePopup);

    // Callback ini "mengingat" array pallets milik popup ini (closure),
    // jadi data-index cukup menunjuk posisinya di array itu.
    onRowPick(box, (index) => {
        selectPallet(pallets[index]);
        closePopup();
    });
}

function selectPallet(pallet){
    selectedPallet = pallet;

    q('#item-name').value     = pallet?.description ?? '';
    q('#exp-date').value      = pallet?.exp_date ?? '';
    q('#pallet-number').value = pallet?.pallet_number ?? '';
    q('#bin').value           = pallet?.bin ?? '';
    q('#qty-available').value = pallet?.qty_actual ?? '';
    q('#uom-fisik').value     = pallet?.uom_fisik ?? '';
    q('#uom-sap').value       = pallet?.uom_sap ?? '';

    // Default: ambil satu pallet penuh. Operator bisa ubah kalau ambil sebagian.
    q('#qty-fisik').value     = pallet ? parseFloat(pallet.qty_actual) : '';

    calculateQtySap();
}

// Hanya untuk ditampilkan. Server menghitung ulang sendiri.
function calculateQtySap(){
    const qty = parseFloat(q('#qty-fisik').value);
    const factor = parseFloat(selectedPallet?.conversion_factor);

    q('#qty-sap').value = (qty > 0 && factor > 0) ? (qty * factor).toFixed(3) : '';
}

function handleAdd(){
    const destination = q('#destination').value;
    const qtyFisik = parseFloat(q('#qty-fisik').value);

    if (!destination) {
        toast('Pilih tujuan outbound', 'warning');
        return;
    }
    if (!selectedPallet) {
        toast('Pilih pallet dulu', 'warning');
        return;
    }
    if (!(qtyFisik > 0)) {
        toast('Quantity harus lebih dari 0', 'warning');
        return;
    }

    const available = parseFloat(selectedPallet.qty_actual);
    if (qtyFisik > available) {
        toast(`Quantity melebihi stok pallet (${available})`, 'warning');
        return;
    }
    if (state.some(row => samePallet(row, selectedPallet))) {
        toast('Pallet ini sudah ada di daftar', 'warning');
        return;
    }

    state.push({
        item_code:     selectedPallet.item_code,
        description:   selectedPallet.description,
        exp_date:      selectedPallet.exp_date,
        pallet_number: Number(selectedPallet.pallet_number),
        bin:           selectedPallet.bin,
        destination:   destination,
        qty_actual:    qtyFisik,
        uom_fisik:     selectedPallet.uom_fisik,
        qty_sap:       q('#qty-sap').value,
        uom_sap:       selectedPallet.uom_sap,
        remark:        q('#remark').value.trim(),
    });

    q('#item-code').value = '';
    selectPallet(null);
    q('#item-code').focus();

    renderPreview();
}

function renderPreview(){
    q('#preview-count').textContent = state.length;

    if (state.length === 0) {
        q('#preview-body').innerHTML = emptyRowHtml(12, 'Belum ada pallet. Pilih pallet di atas lalu klik Add.');
        return;
    }

    q('#preview-body').innerHTML = state.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td class="wrap">${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td class="num">${escapeHtml(row.pallet_number)}</td>
            <td>${escapeHtml(row.bin)}</td>
            <td>${escapeHtml(row.destination)}</td>
            <td class="num">${escapeHtml(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td class="num">${escapeHtml(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td class="wrap">${escapeHtml(row.remark)}</td>
            <td><button type="button" class="btn-delete btn-sm btn-danger" data-index="${index}" data-icon="trash">Hapus</button></td>
        </tr>
    `).join('');
}

function handleDeleteRow(e){
    const button = e.target.closest('.btn-delete');
    if (!button) return;

    state.splice(Number(button.dataset.index), 1);
    renderPreview();
}

async function handleSubmit(){
    if (state.length === 0) {
        toast('Belum ada pallet yang di-Add', 'warning');
        return;
    }

    const button = q('#btn-submit');
    button.disabled = true;

    try {
        const res = await apiFetch('controller/Outbound.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state),
        });
        const data = await res.json();

        if (data.success) {
            toast('Berhasil disimpan: ' + data.transaction_code, 'success');
            state = [];
            renderPreview();
        } else {
            toast('Gagal: ' + data.error, 'error');
        }
    } catch (err) {
        toast('Tidak bisa menghubungi server: ' + err.message, 'error');
    } finally {
        button.disabled = false;
    }
}