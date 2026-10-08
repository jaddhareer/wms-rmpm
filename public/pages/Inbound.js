import { setContent, q, escapeHtml, binDatalistHtml, emptyRowHtml } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { materialAutocomplete, ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";

const MATERIAL_API = 'controller/MaterialController.php';

// Pallet yang sudah di-Add tapi belum di-submit.
let state = [];

// Data material master untuk item code yang sedang diketik (hasil fetch).
let currentMaterial = null;

export function inbound(){
    currentMaterial = null;

    setContent(`
        <div class="page-header"><h2>Inbound</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field">
                    <label for="source">Supplier</label>
                    <input type="text" id="source">
                </div>
                <hr>
                <div class="field">
                    <label for="item-code">Item Code</label>
                    <input type="text" id="item-code">
                </div>
                <div class="field wide">
                    <label for="item-name">Item Name</label>
                    <input type="text" id="item-name" disabled>
                </div>
                <div class="field">
                    <label for="exp-date">Expired Date</label>
                    <input type="date" id="exp-date">
                </div>
                <div class="field">
                    <label for="qty-fisik">Quantity</label>
                    <div class="input-group">
                        <input type="number" id="qty-fisik" min="0" step="any">
                        <input type="text" id="uom-fisik" class="unit" disabled aria-label="UoM">
                    </div>
                </div>
                <div class="field">
                    <label for="conversion-factor">Conversion Factor</label>
                    <input type="number" id="conversion-factor" min="0" step="any">
                </div>
                <div class="field">
                    <label for="qty-sap">GR Qty</label>
                    <div class="input-group">
                        <input type="text" id="qty-sap" disabled>
                        <input type="text" id="uom-sap" class="unit" disabled aria-label="UoM SAP">
                    </div>
                </div>
                <hr>
                <div class="field">
                    <label for="bin">Bin</label>
                    <input type="text" id="bin" list="bin-options" placeholder="kosong = STAGE">${binDatalistHtml()}
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
                            <th>Item Code</th><th>Description</th><th>Supplier</th><th>Exp Date</th><th class="num">Pallet</th>
                            <th class="num">Qty</th><th>UoM</th><th class="num">Faktor</th><th class="num">Qty SAP</th><th>UoM SAP</th>
                            <th>Bin</th><th>Remark</th><th></th>
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

    q('#btn-add').addEventListener('click', handleAdd);
    q('#btn-submit').addEventListener('click', handleSubmit);
    q('#item-code').addEventListener('input', handleItemCodeInput);
    // Ketik deskripsi -> muncul saran -> diklik -> isi input diganti item code.
    // Inbound: semua material boleh (barang baru datang, stoknya memang belum ada).
    materialAutocomplete(q('#item-code'), { onSelect: selectMaterial });
    q('#qty-fisik').addEventListener('input', calculateQtySap);
    q('#conversion-factor').addEventListener('input', calculateQtySap);
    // Satu listener di tbody untuk semua tombol hapus (event delegation),
    // karena baris-baris di dalamnya dibuat ulang setiap renderPreview().
    q('#preview-body').addEventListener('click', handleDeleteRow);

    renderPreview();
}

// Saran dipilih (input sudah berisi item code): isi field lain dari data saran itu.
// Data saran sudah lengkap (uom, faktor), jadi tidak perlu fetch lagi.
function selectMaterial(material){
    currentMaterial = material;
    fillMaterialFields();
    q('#exp-date').focus();
}

async function handleItemCodeInput(){
    const itemCode = q('#item-code').value.trim();

    currentMaterial = null;
    fillMaterialFields();

    // Hanya item code penuh yang dicari persis. Deskripsi yang kebetulan
    // 9 huruf (mis. "quadriple") tidak boleh memicu alert "tidak ada".
    if (!ITEM_CODE_PATTERN.test(itemCode)) return;

    const res = await apiFetch(`${MATERIAL_API}?item_code=${encodeURIComponent(itemCode)}`);
    const data = await res.json();

    // Selama menunggu fetch, operator bisa sudah mengubah isi input
    // atau pindah halaman. Jawaban yang sudah basi diabaikan.
    if (q('#item-code')?.value.trim() !== itemCode) return;

    if (!res.ok) {
        toast(data.error, 'error');
        return;
    }

    currentMaterial = data;
    fillMaterialFields();
}

function fillMaterialFields(){
    q('#item-name').value         = currentMaterial?.item_name ?? '';
    q('#uom-fisik').value         = currentMaterial?.uom_fisik ?? '';
    q('#uom-sap').value           = currentMaterial?.uom_sap ?? '';
    // Isi default dari material master. Operator boleh menimpanya untuk barang
    // yang faktornya berbeda; nilai itu bertahan sampai item code diganti.
    q('#conversion-factor').value = currentMaterial ? parseFloat(currentMaterial.conversion_factor) : '';
    calculateQtySap();
}

// Hanya untuk ditampilkan ke operator. Server menghitung ulang dari qty x faktor.
function calculateQtySap(){
    const qty = parseFloat(q('#qty-fisik').value);
    const factor = parseFloat(q('#conversion-factor').value);

    q('#qty-sap').value = (qty > 0 && factor > 0) ? (qty * factor).toFixed(3) : '';
}

async function handleAdd(){
    const itemCode = q('#item-code').value.trim();
    const expDate  = q('#exp-date').value;
    const qtyFisik = parseFloat(q('#qty-fisik').value);
    const conversionFactor = parseFloat(q('#conversion-factor').value);

    if (!currentMaterial || currentMaterial.item_code !== itemCode) {
        toast('Item Code belum valid', 'warning');
        return;
    }
    if (!expDate) {
        toast('Expired Date wajib diisi', 'warning');
        return;
    }
    if (!(qtyFisik > 0)) {
        toast('Quantity harus lebih dari 0', 'warning');
        return;
    }
    if (!(conversionFactor > 0)) {
        toast('Conversion Factor harus lebih dari 0', 'warning');
        return;
    }

    const res = await apiFetch(`controller/PalletController.php?item_code=${encodeURIComponent(itemCode)}&exp_date=${encodeURIComponent(expDate)}`);
    const data = await res.json();

    if (!res.ok) {
        toast(data.error, 'error');
        return;
    }

    // Server hanya tahu pallet yang sudah tersimpan. Pallet di state belum,
    // jadi nomor yang sudah dipakai di state dilewati di sini.
    let palletNumber = data.pallet_number;
    const usedNumbers = state
        .filter(row => row.item_code === itemCode && row.exp_date === expDate)
        .map(row => row.pallet_number);

    while (usedNumbers.includes(palletNumber)) {
        palletNumber++;
    }

    state.push({
        item_code:     itemCode,
        description:   currentMaterial.item_name,
        exp_date:      expDate,
        pallet_number: palletNumber,
        source:        q('#source').value.trim(),
        qty_actual:    qtyFisik,
        uom_fisik:     currentMaterial.uom_fisik,
        conversion_factor: conversionFactor,
        qty_sap:       q('#qty-sap').value,
        uom_sap:       currentMaterial.uom_sap,
        bin:           q('#bin').value.trim().toUpperCase() || 'STAGE',
        remark:        q('#remark').value.trim(),
    });

    q('#qty-fisik').value = '';
    q('#bin').value = '';
    calculateQtySap();
    q('#qty-fisik').focus();

    renderPreview();
}

function renderPreview(){
    q('#preview-count').textContent = state.length;

    if (state.length === 0) {
        q('#preview-body').innerHTML = emptyRowHtml(13, 'Belum ada pallet. Isi form di atas lalu klik Add.');
        return;
    }

    q('#preview-body').innerHTML = state.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td class="wrap">${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.source)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td class="num">${escapeHtml(row.pallet_number)}</td>
            <td class="num">${escapeHtml(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td class="num">${escapeHtml(row.conversion_factor)}</td>
            <td class="num">${escapeHtml(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td>${escapeHtml(row.bin)}</td>
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
    button.disabled = true; // cegah submit dobel kalau tombol diklik dua kali

    try {
        const res = await apiFetch('controller/Inbound.php', {
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