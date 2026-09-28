import { setContent, q, escapeHtml } from "../utilities/tools.js";
import { openPopup, closePopup } from "../utilities/popups.js";

// Pallet yang sudah di-Add tapi belum di-submit.
let state = [];

// Pallet yang sedang dipilih di form (satu baris dari StockController).
let selectedPallet = null;

export function outbound(){
    selectedPallet = null;

    setContent(`
        <h2>Outbound</h2>
        <div>
            <label for="destination">Outbound To</label>
            <select id="destination">
                <option value="">-- pilih --</option>
                <option value="PRODUKSI">Produksi</option>
                <option value="QUALITY">Quality</option>
            </select><hr>

            <label for="item-code">Item Code</label>     <input type="text" id="item-code">
            <button type="button" id="btn-choose">Pilih Pallet</button><br>
            <label for="item-name">Item Name</label>     <input type="text" id="item-name" disabled><br>
            <label for="exp-date">Expired Date</label>   <input type="text" id="exp-date" disabled><br>
            <label for="pallet-number">Pallet</label>    <input type="text" id="pallet-number" disabled><br>
            <label for="bin">Bin</label>                 <input type="text" id="bin" disabled><br>
            <label for="qty-available">Stok Pallet</label> <input type="text" id="qty-available" disabled><hr>

            <label for="qty-fisik">Quantity</label>      <input type="number" id="qty-fisik" min="0" step="any">
                                                         <input type="text" id="uom-fisik" disabled size="6"><br>
            <label for="qty-sap">Qty SAP</label>         <input type="text" id="qty-sap" disabled>
                                                         <input type="text" id="uom-sap" disabled size="6"><br>
            <label for="remark">Remark</label>           <input type="text" id="remark"><hr>
            <button type="button" id="btn-add">Add</button>
        </div>

        <table border="1">
            <thead>
                <tr>
                    <th>Item Code</th><th>Description</th><th>Exp Date</th><th>Pallet</th><th>Bin</th><th>Tujuan</th>
                    <th>Qty</th><th>UoM</th><th>Qty SAP</th><th>UoM SAP</th><th>Remark</th><th></th>
                </tr>
            </thead>
            <tbody id="preview-body"></tbody>
        </table>

        <button type="button" id="btn-submit">Submit</button>
    `);

    q('#item-code').addEventListener('input', handleItemCodeInput);
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

    if (itemCode.length === 9) {
        loadPallets(itemCode);
    }
}

async function loadPallets(itemCode){
    if (!itemCode) return;

    const res = await fetch(`/wms-rmpm/controller/StockController.php?item_code=${encodeURIComponent(itemCode)}`);
    const data = await res.json();

    // Abaikan jawaban basi (input sudah berubah / sudah pindah halaman).
    if (q('#item-code')?.value.trim() !== itemCode) return;

    if (!res.ok) {
        alert(data.error);
        return;
    }

    // Pallet yang sudah ada di daftar tidak ditawarkan lagi.
    const pallets = data.filter(pallet => !state.some(row => samePallet(row, pallet)));

    if (pallets.length === 0) {
        alert(`Tidak ada stok tersisa untuk item ${itemCode}`);
    } else if (pallets.length === 1) {
        selectPallet(pallets[0]);
    } else {
        showPalletPopup(pallets);
    }
}

function showPalletPopup(pallets){
    const box = openPopup(`
        <h3>Pilih pallet: ${escapeHtml(pallets[0].description)}</h3>
        <p>Urut dari expired paling dekat (FEFO).</p>
        <table border="1">
            <thead>
                <tr><th>Exp Date</th><th>Pallet</th><th>Bin</th><th>Qty</th><th></th></tr>
            </thead>
            <tbody>
                ${pallets.map((pallet, index) => `
                    <tr>
                        <td>${escapeHtml(pallet.exp_date)}</td>
                        <td>${escapeHtml(pallet.pallet_number)}</td>
                        <td>${escapeHtml(pallet.bin)}</td>
                        <td>${escapeHtml(pallet.qty_actual)} ${escapeHtml(pallet.uom_fisik)}</td>
                        <td><button type="button" class="btn-pick" data-index="${index}">Pilih</button></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <button type="button" id="btn-close-popup">Batal</button>
    `);

    // Listener ini "mengingat" array pallets milik popup ini (closure),
    // jadi data-index cukup menunjuk posisinya di array itu.
    box.addEventListener('click', (e) => {
        if (e.target.id === 'btn-close-popup') {
            closePopup();
            return;
        }

        const button = e.target.closest('.btn-pick');
        if (!button) return;

        selectPallet(pallets[Number(button.dataset.index)]);
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
        alert('Pilih tujuan outbound');
        return;
    }
    if (!selectedPallet) {
        alert('Pilih pallet dulu');
        return;
    }
    if (!(qtyFisik > 0)) {
        alert('Quantity harus lebih dari 0');
        return;
    }

    const available = parseFloat(selectedPallet.qty_actual);
    if (qtyFisik > available) {
        alert(`Quantity melebihi stok pallet (${available})`);
        return;
    }
    if (state.some(row => samePallet(row, selectedPallet))) {
        alert('Pallet ini sudah ada di daftar');
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
    q('#preview-body').innerHTML = state.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td>${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td>${escapeHtml(row.pallet_number)}</td>
            <td>${escapeHtml(row.bin)}</td>
            <td>${escapeHtml(row.destination)}</td>
            <td>${escapeHtml(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td>${escapeHtml(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td>${escapeHtml(row.remark)}</td>
            <td><button type="button" class="btn-delete" data-index="${index}">Hapus</button></td>
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
        alert('Belum ada pallet yang di-Add');
        return;
    }

    const button = q('#btn-submit');
    button.disabled = true;

    try {
        const res = await fetch('/wms-rmpm/controller/Outbound.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state),
        });
        const data = await res.json();

        if (data.success) {
            alert('Berhasil disimpan: ' + data.transaction_code);
            state = [];
            renderPreview();
        } else {
            alert('Gagal: ' + data.error);
        }
    } catch (err) {
        alert('Tidak bisa menghubungi server: ' + err.message);
    } finally {
        button.disabled = false;
    }
}