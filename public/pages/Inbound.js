import { setContent, q, escapeHtml, binDatalistHtml } from "../utilities/tools.js";
import { autocomplete } from "../utilities/autocomplete.js";

const MATERIAL_API = 'controller/MaterialController.php';

// Item code selalu 9 digit angka. Pola ini membedakan "scan / ketik item code penuh"
// (langsung dicari persis) dari "ketik deskripsi" (pakai saran autocomplete).
const ITEM_CODE_PATTERN = /^\d{9}$/;

// Pallet yang sudah di-Add tapi belum di-submit.
let state = [];

// Data material master untuk item code yang sedang diketik (hasil fetch).
let currentMaterial = null;

export function inbound(){
    currentMaterial = null;

    setContent(`
        <h2>Inbound</h2>
        <div>
            <label for="source">Supplier</label>                     <input type="text" id="source"><hr>
            <label for="item-code">Item Code</label>                 <input type="text" id="item-code" size="30" placeholder="scan item code / ketik deskripsi"><br>
            <label for="item-name">Item Name</label>                 <input type="text" id="item-name" disabled><br>
            <label for="exp-date">Expired Date</label>               <input type="date" id="exp-date"><br>
            <label for="qty-fisik">Quantity</label>                  <input type="number" id="qty-fisik" min="0" step="any">
                                                                     <input type="text" id="uom-fisik" disabled size="6"><br>
            <label for="conversion-factor">Conversion Factor</label> <input type="number" id="conversion-factor" min="0" step="any"><br>
            <label for="qty-sap">GR Qty</label>                      <input type="text" id="qty-sap" disabled>
                                                                     <input type="text" id="uom-sap" disabled size="6"><hr>
            <label for="bin">Bin</label>                             <input type="text" id="bin" list="bin-options" placeholder="kosong = STAGE">${binDatalistHtml()}<br>
            <label for="remark">Remark</label>                       <input type="text" id="remark"><hr>
            <button type="button" id="btn-add">Add</button>
        </div>

        <table border="1">
            <thead>
                <tr>
                    <th>Item Code</th><th>Description</th><th>Supplier</th><th>Exp Date</th><th>Pallet</th>
                    <th>Qty</th><th>UoM</th><th>Faktor</th><th>Qty SAP</th><th>UoM SAP</th><th>Bin</th><th>Remark</th><th></th>
                </tr>
            </thead>
            <tbody id="preview-body"></tbody>
        </table>

        <button type="button" id="btn-submit">Submit</button>
    `);

    q('#btn-add').addEventListener('click', handleAdd);
    q('#btn-submit').addEventListener('click', handleSubmit);
    q('#item-code').addEventListener('input', handleItemCodeInput);
    // Ketik deskripsi -> muncul saran -> diklik -> isi input diganti item code.
    autocomplete(q('#item-code'), {
        search:     searchMaterial,
        renderItem: (m) => `${escapeHtml(m.item_name)} <small style="color:#666">${escapeHtml(m.item_code)}</small>`,
        onSelect:   selectMaterial,
    });
    q('#qty-fisik').addEventListener('input', calculateQtySap);
    q('#conversion-factor').addEventListener('input', calculateQtySap);
    // Satu listener di tbody untuk semua tombol hapus (event delegation),
    // karena baris-baris di dalamnya dibuat ulang setiap renderPreview().
    q('#preview-body').addEventListener('click', handleDeleteRow);

    renderPreview();
}

// Saran autocomplete dari material master.
async function searchMaterial(term){
    // Item code penuh sudah dicari persis oleh handleItemCodeInput, tidak perlu saran.
    if (ITEM_CODE_PATTERN.test(term)) return null;

    const res = await fetch(`${MATERIAL_API}?q=${encodeURIComponent(term)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    return data.data;
}

// Saran diklik: input diganti item code, lalu field lain diisi dari data saran itu.
// Data saran sudah lengkap (uom, faktor), jadi tidak perlu fetch lagi.
function selectMaterial(material){
    q('#item-code').value = material.item_code;
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

    const res = await fetch(`${MATERIAL_API}?item_code=${encodeURIComponent(itemCode)}`);
    const data = await res.json();

    // Selama menunggu fetch, operator bisa sudah mengubah isi input
    // atau pindah halaman. Jawaban yang sudah basi diabaikan.
    if (q('#item-code')?.value.trim() !== itemCode) return;

    if (!res.ok) {
        alert(data.error);
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
        alert('Item Code belum valid');
        return;
    }
    if (!expDate) {
        alert('Expired Date wajib diisi');
        return;
    }
    if (!(qtyFisik > 0)) {
        alert('Quantity harus lebih dari 0');
        return;
    }
    if (!(conversionFactor > 0)) {
        alert('Conversion Factor harus lebih dari 0');
        return;
    }

    const res = await fetch(`controller/PalletController.php?item_code=${encodeURIComponent(itemCode)}&exp_date=${encodeURIComponent(expDate)}`);
    const data = await res.json();

    if (!res.ok) {
        alert(data.error);
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
    q('#preview-body').innerHTML = state.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td>${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.source)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td>${escapeHtml(row.pallet_number)}</td>
            <td>${escapeHtml(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td>${escapeHtml(row.conversion_factor)}</td>
            <td>${escapeHtml(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td>${escapeHtml(row.bin)}</td>
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
    button.disabled = true; // cegah submit dobel kalau tombol diklik dua kali

    try {
        const res = await fetch('controller/Inbound.php', {
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