import { setContent, q } from "../utilities/tools.js";

// State module ini punya scope sendiri (tidak bocor ke global, tidak diekspor) --
// aman dipakai sebagai "keranjang" pallet yang sudah di-Add tapi belum di-submit.
let state = [];

export function outbound(){
    setContent(`
        <h2>outbound Plant</h2>
        <div>
            <label for="destination">Destination</label>        <input type="text" id="destination"><hr>
            <label for="item-code">Item Code</label>    <input type="text" id="item-code"><br>
            <label for="item-name">Item Name</label>    <input type="text" id="item-name" disabled><br>
            <label for="exp-date">Expired Date</label>  <input type="date" id="exp-date"><br>
            <label for="pallet-number">Pallet Number</label>  <input type="number" id="pallet-number"><br>
            <label for="qty-fisik">Quantity</label>     <input type="number" id="qty-fisik"><br>
            <label for="qty-sap">TP Qty</label>         <input type="number" id="qty-sap" disabled><br>
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
    q('#item-code').addEventListener('input', () => autoFillItemDetails(q('#item-code').value.trim()));
    q('#qty-fisik').addEventListener('input', calculateQtySAP);
    renderPreview();
}

async function autoFillItemDetails(itemCode){
    if (itemCode.length === 9) {
        const url = `/wms-rmpm/controller/StockController.php?item_code=${encodeURIComponent(itemCode)}`;
        const res = await fetch(url);
        const data = await res.json();
        if(data.length === 1){
            q('#item-name').value = data.description || '';
            q('#exp-date').value = data.exp_date || '';
            q('#pallet-number').value = data.pallet_number || '';
            q('#bin').value = data.bin || '';
            q('#qty-sap').value = q('#qty-fisik').value * (parseFloat(data.conversion_factor) || 0);
        } else {
            openModal(`
                <h3>Item Code ${itemCode} tidak ditemukan</h3>
                <p>Silakan periksa kembali atau hubungi admin.</p>
                <button id="close-modal">Close</button>
            `);
            q('#close-modal').addEventListener('click', closeModal);
        }
    }
}

async function handleAdd(){
    const itemCode = q('#item-code').value.trim();
    const expDate  = q('#exp-date').value;
    const requestedPalletNumber = parseInt(q('#pallet-number').value) || 0;
    const qtyFisik = parseFloat(q('#qty-fisik').value) || 0;

    if (!itemCode || !expDate) {
        alert('Item Code dan Expired Date wajib diisi');
        return;
    }

    if (qtyFisik <= 0) {
        alert('Quantity Fisik harus lebih dari 0');
        return;
    }
    // Cek apakah pallet number sudah ada di state
    const existingPallet = state.find(row => row.pallet_number === requestedPalletNumber);
    
    if (existingPallet) {
        alert('Pallet Number sudah ada di daftar');
        return;
    }

    state.push({
        item_code: itemCode,
        description: q('#item-name').value.trim(),
        exp_date: expDate,
        pallet_number: requestedPalletNumber,
        destination: q('#destination').value.trim(),
        qty_actual: parseFloat(q('#qty-fisik').value) || 0,
        uom_fisik: q('#uom-fisik').value.trim(),
        conversion_factor: parseFloat(q('#conversion-factor').value) || 0,
        qty_sap: parseFloat(q('#qty-sap').value) || 0,
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

    const res = await fetch('/wms-rmpm/controller/outbound.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
    });

    const data = await res.json();

    if (data.success) {
        alert('Berhasil disimpan: ' + data.transaction_code)
        state = [];
        renderPreview();
    } else {
        alert('Gagal: ' + data.error);
    }
}