import { setContent, q, escapeHtml } from "../utilities/tools.js";
import { openPopup, closePopup } from "../utilities/popups.js";

export function bintobin(){
    setContent(`
        <h2>Bin to Bin</h2>
        <div>
            <label for="source">Source Bin</label> <input type="text" id="source-bin" placeholder="A-01-A-01">
            <label for="target-bin">Target Bin</label> <input type="text" id="target-bin" placeholder="A-01-A-02"><hr>
            <label for="item-code">Item Code</label> <input type="text" id="item-code"><br>
            <label for="exp-date">Expired Date</label> <input type="date" id="exp-date"><br>
            <label for="pallet-number">Pallet Number</label> <input type="text" id="pallet-number"><br>
            <label for="qty">Quantity</label> <input type="number" id="qty" min="0" step="any" disabled><br>
            <button type="button" id="btn-move">Move</button>
        </div>
    `)

    q('#btn-move').addEventListener('click', handleMove);
    q('#source-bin').addEventListener('input', autoFillData);
    q('#item-code').addEventListener('input', autoFillData);
}

async function autoFillData(){
    const sourceBin = q('#source-bin').value.trim() ? q('#source-bin').value.trim() : null;
    const itemCode = q('#item-code').value.trim() ? q('#item-code').value.trim() : null;
    if (sourceBin && sourceBin.length === 9) {
        const response = await fetch(`controller/StockController.php?source_bin=${encodeURIComponent(sourceBin)}`);
        const data = await response.json();
        if (data.length === 0) {
            alert(`Tidak ada stok tersisa untuk bin ${sourceBin}`);
        } else if (data.length === 1) {
            q('#item-code').value = data[0].item_code || '';
            q('#exp-date').value = data[0].exp_date || '';
            q('#pallet-number').value = data[0].pallet_number || '';
            q('#qty').value = data[0].qty_actual || '';
            q('#target-bin').focus();
        } else {
            const box = openPopup(`
                    <h3>Pilih pallet: ${escapeHtml(data[0].description)}</h3>
                    <p>Urut dari expired paling dekat (FEFO).</p>
                    <table border="1">
                        <thead>
                            <tr><th>Exp Date</th><th>Pallet</th><th>Bin</th><th>Qty</th><th></th></tr>
                        </thead>
                        <tbody>
                            ${data.map((pallet, index) => `
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
            box.addEventListener('click', (e) => {
                    if (e.target.id === 'btn-close-popup') {
                        closePopup();
                        return;
                    }
            
                    const button = e.target.closest('.btn-pick');
                    if (!button) return;
            
                    q('#item-code').value = data[Number(button.dataset.index)].item_code || '';
                    q('#exp-date').value = data[Number(button.dataset.index)].exp_date || '';
                    q('#pallet-number').value = data[Number(button.dataset.index)].pallet_number || '';
                    q('#qty').value = data[Number(button.dataset.index)].qty_actual || '';
                    closePopup();
                    q('#target-bin').focus();
                });
        }
    } else if (itemCode && itemCode.length === 9) {
        const response = await fetch(`controller/StockController.php?item_code=${encodeURIComponent(itemCode)}`);
        const data = await response.json();
        if (data.length === 0) {
            alert(`Tidak ada stok tersisa untuk item ${itemCode}`);
        } else if (data.length === 1) {
            q('#source-bin').value = data[0].bin || '';
            q('#exp-date').value = data[0].exp_date || '';
            q('#pallet-number').value = data[0].pallet_number || '';
            q('#qty').value = data[0].qty_actual || '';
            q('#target-bin').focus();
        } else {
            const box = openPopup(`
                    <h3>Pilih pallet: ${escapeHtml(data[0].description)}</h3>
                    <p>Urut dari expired paling dekat (FEFO).</p>
                    <table border="1">
                        <thead>
                            <tr><th>Exp Date</th><th>Pallet</th><th>Bin</th><th>Qty</th><th></th></tr>
                        </thead>
                        <tbody>
                            ${data.map((pallet, index) => `
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
            box.addEventListener('click', (e) => {
                    if (e.target.id === 'btn-close-popup') {
                        closePopup();
                        return;
                    }
            
                    const button = e.target.closest('.btn-pick');
                    if (!button) return;
            
                    q('#source-bin').value = data[Number(button.dataset.index)].bin || '';
                    q('#exp-date').value = data[Number(button.dataset.index)].exp_date || '';
                    q('#pallet-number').value = data[Number(button.dataset.index)].pallet_number || '';
                    q('#qty').value = data[Number(button.dataset.index)].qty_actual || '';
                    closePopup();
                    q('#target-bin').focus();
                });
        }
        
    }

}

async function handleMove(){
    const sourceBin = q('#source-bin').value.trim();
    const targetBin = q('#target-bin').value.trim();
    const itemCode = q('#item-code').value.trim();
    const expDate = q('#exp-date').value;
    const palletNumber = q('#pallet-number').value.trim();
    const qty = Number(q('#qty').value);
    const response = await fetch(`controller/StockController.php?source_bin=${encodeURIComponent(sourceBin)}`);
    const data = await response.json();
    const conversionFactor = data[0]?.conversion_factor || 1;
    const qtySap = data[0]?.qty_sap || 0;
    const uomFisik = data[0]?.uom_fisik || '';
    const uomSap = data[0]?.uom_sap || '';

    if (!sourceBin || !targetBin || !itemCode || !expDate || !palletNumber || !qty) {
        alert('Semua field harus diisi.');
        return;
    }

    let moveData = {
        source_bin: sourceBin,
        target_bin: targetBin,
        item_code: itemCode,
        exp_date: expDate,
        pallet_number: palletNumber,
        qty_actual: qty,
        uom_fisik: uomFisik,
        conversion_factor: conversionFactor,
        qty_sap: qtySap,
        uom_sap: uomSap
    };

    const button = q('#btn-move');
    button.disabled = true;

    try {
        const moveResponse = await fetch('controller/BinToBin.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(moveData)
        });
        const result = await moveResponse.json();
        if (result.success) {
            alert('BintoBin berhasil.');
        } else {
            alert('Error: ' + result.error);
        }

        sourceBin.value = '';
        targetBin.value = '';
        itemCode.value = '';
        expDate.value = '';
        palletNumber.value = '';
        qty.value = '';
    } catch (err) {
        alert('Tidak bisa menghubungi server: ' + err.message);
    } finally {
        button.disabled = false;
    }
}