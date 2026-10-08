import { setContent, q, escapeHtml, binDatalistHtml } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { openPopup, closePopup, onRowPick } from "../utilities/popups.js";
import { materialAutocomplete, ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";

export function bintobin(){
    setContent(`
        <div class="page-header"><h2>Bin to Bin</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field">
                    <label for="source-bin">Source Bin</label>
                    <input type="text" id="source-bin" placeholder="A-01-A-01">
                </div>
                <div class="field">
                    <label for="target-bin">Target Bin</label>
                    <input type="text" id="target-bin" list="bin-options" placeholder="A-01-A-02">${binDatalistHtml()}
                </div>
                <hr>
                <div class="field">
                    <label for="item-code">Item Code</label>
                    <input type="text" id="item-code">
                </div>
                <div class="field">
                    <label for="exp-date">Expired Date</label>
                    <input type="date" id="exp-date">
                </div>
                <div class="field">
                    <label for="pallet-number">Pallet Number</label>
                    <input type="text" id="pallet-number">
                </div>
                <div class="field">
                    <label for="qty">Quantity</label>
                    <input type="number" id="qty" min="0" step="any" disabled>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-move" class="btn-primary" data-icon="swap">Move</button>
            </div>
        </section>
    `)

    q('#btn-move').addEventListener('click', handleMove);
    // Source bin: dicari otomatis begitu panjangnya 9 karakter (hasil scan QR rak).
    // Pallet di floor tidak punya QR bin -> operator cukup scan item code.
    q('#source-bin').addEventListener('input', () => autoFillData('bin'));
    q('#item-code').addEventListener('input', () => autoFillData('item'));
    // Ketik deskripsi -> pilih saran -> sama seperti scan item code.
    // Hanya material yang masih ada stoknya yang disarankan.
    materialAutocomplete(q('#item-code'), {
        inStockOnly: true,
        onSelect: () => autoFillData('item'),
    });
}

// mode = input mana yang memicu: 'bin' (source bin) atau 'item' (item code).
async function autoFillData(mode){
    const sourceBin = q('#source-bin').value.trim() ? q('#source-bin').value.trim() : null;
    const itemCode = q('#item-code').value.trim() ? q('#item-code').value.trim() : null;
    if (mode === 'bin' && sourceBin && sourceBin.length === 9) {
        const response = await apiFetch(`controller/StockController.php?source_bin=${encodeURIComponent(sourceBin)}`);
        const data = await response.json();
        if (data.length === 0) {
            toast(`Tidak ada stok tersisa untuk bin ${sourceBin}`, 'warning');
        } else if (data.length === 1) {
            q('#item-code').value = data[0].item_code || '';
            q('#exp-date').value = data[0].exp_date || '';
            q('#pallet-number').value = data[0].pallet_number || '';
            q('#qty').value = data[0].qty_actual || '';
            q('#target-bin').focus();
        } else {
            const box = openPopup(`
                    <h3>Pilih pallet: ${escapeHtml(data[0].description)}</h3>
                    <p class="hint">Urut dari expired paling dekat (FEFO). Klik baris untuk memilih.</p>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr><th>Exp Date</th><th class="num">Pallet</th><th>Bin</th><th class="num">Qty</th><th></th></tr>
                            </thead>
                            <tbody>
                                ${data.map((pallet, index) => `
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
            onRowPick(box, (index) => {
                    q('#item-code').value = data[index].item_code || '';
                    q('#exp-date').value = data[index].exp_date || '';
                    q('#pallet-number').value = data[index].pallet_number || '';
                    q('#qty').value = data[index].qty_actual || '';
                    closePopup();
                    q('#target-bin').focus();
                });
        }
    } else if (mode === 'item' && itemCode && ITEM_CODE_PATTERN.test(itemCode)) {
        // Hanya item code 9 digit angka. Deskripsi 9 huruf (mis. "quadriple") tidak
        // boleh ikut mencari stok; deskripsi dipilih lewat saran autocomplete.
        const response = await apiFetch(`controller/StockController.php?item_code=${encodeURIComponent(itemCode)}`);
        const data = await response.json();
        if (data.length === 0) {
            toast(`Tidak ada stok tersisa untuk item ${itemCode}`, 'warning');
        } else if (data.length === 1) {
            q('#source-bin').value = data[0].bin || '';
            q('#exp-date').value = data[0].exp_date || '';
            q('#pallet-number').value = data[0].pallet_number || '';
            q('#qty').value = data[0].qty_actual || '';
            q('#target-bin').focus();
        } else {
            const box = openPopup(`
                    <h3>Pilih pallet: ${escapeHtml(data[0].description)}</h3>
                    <p class="hint">Urut dari expired paling dekat (FEFO). Klik baris untuk memilih.</p>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr><th>Exp Date</th><th class="num">Pallet</th><th>Bin</th><th class="num">Qty</th><th></th></tr>
                            </thead>
                            <tbody>
                                ${data.map((pallet, index) => `
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
            onRowPick(box, (index) => {
                    q('#source-bin').value = data[index].bin || '';
                    q('#exp-date').value = data[index].exp_date || '';
                    q('#pallet-number').value = data[index].pallet_number || '';
                    q('#qty').value = data[index].qty_actual || '';
                    closePopup();
                    q('#target-bin').focus();
                });
        }
        
    }

}

async function handleMove(){
    const sourceBin    = q('#source-bin').value.trim();
    const targetBin    = q('#target-bin').value.trim();
    const itemCode     = q('#item-code').value.trim();
    const expDate      = q('#exp-date').value;
    const palletNumber = q('#pallet-number').value.trim();

    if (!sourceBin || !targetBin || !itemCode || !expDate || !palletNumber) {
        toast('Semua field harus diisi.', 'warning');
        return;
    }

    // Cukup identitas pallet + bin asal + bin tujuan.
    // Qty dan qty SAP dibaca server dari database.
    const moveData = {
        source_bin:    sourceBin,
        target_bin:    targetBin,
        item_code:     itemCode,
        exp_date:      expDate,
        pallet_number: palletNumber,
    };

    const button = q('#btn-move');
    button.disabled = true;

    try {
        const moveResponse = await apiFetch('controller/BinToBin.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(moveData),
        });
        const result = await moveResponse.json();

        if (result.success) {
            toast(result.message, 'success');

            // Kosongkan lewat ELEMEN-nya (q(...)), bukan lewat variabel string di atas.
            q('#source-bin').value = '';
            q('#target-bin').value = '';
            q('#item-code').value = '';
            q('#exp-date').value = '';
            q('#pallet-number').value = '';
            q('#qty').value = '';
            q('#source-bin').focus();
        } else {
            // Form tidak dikosongkan, supaya operator cukup membetulkan yang salah.
            toast('Gagal: ' + result.error, 'error');
        }
    } catch (err) {
        toast('Tidak bisa menghubungi server: ' + err.message, 'error');
    } finally {
        button.disabled = false;
    }
}