import { setContent, q } from "../utilities/tools.js";

// State module ini punya scope sendiri (tidak bocor ke global, tidak diekspor) --
// aman dipakai sebagai "keranjang" pallet yang sudah di-Add tapi belum di-submit.
let state = [];

export function inbound(){
    setContent(`
        <h2>Inbound Plant</h2>
        <div>
            <label for="source">Supplier</label>        <input type="text" id="source"><hr>
            <label for="item-code">Item Code</label>    <input type="text" id="item-code"><br>
            <label for="item-name">Item Name</label>    <input type="text" id="item-name"><br>
            <label for="exp-date">Expired Date</label>  <input type="date" id="exp-date"><br>
            <label for="qty-fisik">Quantity</label>     <input type="number" id="qty-fisik"><br>
            <label for="uom-fisik">Uom</label>          <input type="text" id="uom-fisik"><br>
            <label for="qty-sap">GR Qty</label>         <input type="number" id="qty-sap"><br>
            <label for="uom-sap">GR UoM</label>         <input type="text" id="uom-sap"><hr>
            <label for="bin">Bin</label>                <input type="text" id="bin"><br>
            <label for="remark">Remark</label>          <input type="text" id="remark"><hr>
            <button type="button" id="btn-add">Add</button>
        </div>

        <table id="preview-table" border="1">
            <thead>
                <tr>
                    <th>Item Code</th><th>Exp Date</th><th>Pallet</th>
                    <th>Qty Fisik</th><th>Qty SAP</th><th>Bin</th>
                </tr>
            </thead>
            <tbody id="preview-body"></tbody>
        </table>

        <button type="button" id="btn-submit">Submit</button>
    `);

    // Dipasang SETELAH setContent, karena setContent mengganti innerHTML --
    // elemen lama (dan listener lamanya) sudah dibuang, ini pasang ke elemen yang baru.
    q('#btn-add').addEventListener('click', handleAdd);
    q('#btn-submit').addEventListener('click', handleSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
    const itemCodeInput = q('#item-code');
    const qtyFisikInput = q('#qty-fisik');

    itemCodeInput?.addEventListener('input', async (e) => {
        const itemCode = e.target.value.trim();
        if (itemCode.length === 9) {
            await autoFillItemDetails(itemCode);
        }
    });

    qtyFisikInput?.addEventListener('input', async (e) => {
        const itemCode = itemCodeInput.value.trim();
        if (itemCode.length === 9) {
            await autoFillItemDetails(itemCode);
        }
    });
});

async function autoFillItemDetails(itemCode){
    const url = `/wms-rmpm/controller/MaterialController.php?item_code=${encodeURIComponent(itemCode)}`;
    const res = await fetch(url);
    const data = await res.json();
    q('#item-name').value = data.item_name || '';
    q('#uom-fisik').value = data.uom_fisik || '';
    q('#uom-sap').value = data.uom_sap || '';

    const conversionFactor = data.conversion_factor || 1;
    q('#qty-sap').value = q('#qty-fisik').value * conversionFactor;
}

async function handleAdd(){
    const itemCode = q('#item-code').value.trim();
    const expDate  = q('#exp-date').value;

    if (!itemCode || !expDate) {
        alert('Item Code dan Expired Date wajib diisi');
        return;
    }

    // Path absolut (bukan "../controller/...") karena fetch() di-resolve relatif ke
    // URL halaman (index.html), BUKAN relatif ke lokasi file Inbound.js ini --
    // beda dengan `import` di baris paling atas file ini, yang resolve-nya relatif
    // ke file modul itu sendiri. Sesuaikan "/wms-rmpm/" kalau alias XAMPP-mu beda.
    const url = `/wms-rmpm/controller/PalletController.php?item_code=${encodeURIComponent(itemCode)}&exp_date=${encodeURIComponent(expDate)}`;
    const res = await fetch(url);
    const data = await res.json();

    let palletNumber = data.pallet_number;

    // Server cuma tahu yang sudah ada di database. Pallet yang sudah di-Add ke state
    // tapi belum di-submit belum ada di database -- disesuaikan di sini, di frontend.
    const usedNumbers = state
        .filter(row => row.item_code === itemCode && row.exp_date === expDate)
        .map(row => row.pallet_number);

    while (usedNumbers.includes(palletNumber)) {
        palletNumber++;
    }

    state.push({
        item_code: itemCode,
        description: q('#item-name').value.trim(),
        exp_date: expDate,
        pallet_number: palletNumber,
        source: q('#source').value.trim(),
        qty_actual: q('#qty-fisik').value,
        uom_fisik: q('#uom-fisik').value.trim(),
        qty_sap: q('#qty-sap').value,
        uom_sap: q('#uom-sap').value.trim(),
        bin: q('#bin').value.trim() ? q('#bin').value.trim() : 'Stage',
        remark: q('#remark').value.trim(),
    });

    q('#qty-fisik').value = '';
    q('#bin').value = '';
    q('#qty-fisik').focus();

    renderPreview();
}

function renderPreview(){
    const body = q('#preview-body');
    body.innerHTML = state.map(row => `
        <tr>
            <td>${row.item_code}</td>
            <td>${row.exp_date}</td>
            <td>${row.pallet_number}</td>
            <td>${row.qty_actual}</td>
            <td>${row.qty_sap}</td>
            <td>${row.bin}</td>
        </tr>
    `).join('');
}

async function handleSubmit(){
    if (state.length === 0) {
        alert('Belum ada pallet yang di-Add');
        return;
    }

    const res = await fetch('/wms-rmpm/controller/TransactionController.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
    });

    const data = await res.json();

    if (data.success) {
        alert('Berhasil disimpan: ' + data.transaction_codes.join(', '));
        state = [];
        renderPreview();
    } else {
        alert('Gagal: ' + data.error);
    }
}