import { setContent, q, escapeHtml, binDatalistHtml, fetchPallet, formatNumber, debounce } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { openPopup, closePopup, onRowPick } from "../utilities/popups.js";
import { materialAutocomplete, ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";
import { replaceParams } from "../utilities/router.js";
import { scanButtonHtml } from "../utilities/scanner.js";
import { binButtonsHtml } from "../utilities/binPicker.js";

// Pallet asal yang sedang dipilih (baris dari StockController): isi pallet, UoM, supplier, faktor.
// null = belum dipilih, atau identitas pallet diketik/diubah manual.
let selected = null;
// Pallet berisi di target bin (semua item). Calon pallet tujuan gabung = yang item + exp-nya sama.
let targetBinPallets = [];
let targetRequestId = 0;

// params dari router. Dibuka dari popup Stock Overview -> { item, exp, pallet }:
// form langsung terisi pallet itu, operator tinggal mengisi Target Bin.
export function bintobin(params = {}){
    selected = null;
    targetBinPallets = [];

    setContent(`
        <div class="page-header"><h2>Bin to Bin</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field">
                    <label for="source-bin">Source Bin</label>
                    <div class="input-group">
                        <input type="text" id="source-bin" placeholder="A-01-A-01">
                        ${binButtonsHtml('source-bin')}
                    </div>
                </div>
                <div class="field">
                    <label for="target-bin">Target Bin</label>
                    <div class="input-group">
                        <input type="text" id="target-bin" list="bin-options" placeholder="A-01-A-02">
                        ${binButtonsHtml('target-bin')}
                    </div>${binDatalistHtml()}
                </div>
                <hr>
                <div class="field">
                    <label for="item-code">Item Code</label>
                    <div class="input-group">
                        <input type="text" id="item-code">
                        ${scanButtonHtml('item-code', 'item')}
                    </div>
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
                    <div class="input-group">
                        <input type="number" id="qty" min="0" step="any">
                        <span class="unit" id="qty-unit"></span>
                    </div>
                    <small class="hint" id="qty-hint"></small>
                </div>
                <div class="field wide">
                    <label for="target-pallet">Pallet Tujuan</label>
                    <select id="target-pallet"></select>
                    <small class="hint" id="target-hint"></small>
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
    q('#item-code').addEventListener('input', () => {
        clearSelected();
        autoFillData('item');
    });
    // Identitas pallet diubah manual -> isi pallet yang tadi dipilih tidak berlaku lagi.
    q('#exp-date').addEventListener('input', clearSelected);
    q('#pallet-number').addEventListener('input', clearSelected);
    // Qty diubah -> pindah utuh atau sebagian, pilihan Pallet Tujuan menyesuaikan.
    q('#qty').addEventListener('input', renderTarget);
    q('#target-bin').addEventListener('input', debounce(loadTargetPallets));
    q('#target-pallet').addEventListener('change', renderTargetHint);
    // Ketik deskripsi -> pilih saran -> sama seperti scan item code.
    // Hanya material yang masih ada stoknya yang disarankan.
    materialAutocomplete(q('#item-code'), {
        inStockOnly: true,
        onSelect: () => autoFillData('item'),
    });

    renderTarget();

    if (params.item && params.exp && params.pallet) {
        preselectPallet(params);
    }
}

// Dibuka dari popup Stock Overview: isi form dari stok terbaru pallet itu.
async function preselectPallet({ item, exp, pallet }){
    // Parameter ini perintah sekali pakai, bukan isi halaman. URL dibersihkan supaya
    // refresh / back-forward tidak mengisi pallet yang sama lagi.
    replaceParams('bintobin');

    q('#item-code').value = item;

    let found;
    try {
        found = await fetchPallet(item, exp, pallet);
    } catch (err) {
        toast('Gagal memuat pallet: ' + err.message, 'error');
        return;
    }

    // Abaikan jawaban basi (item code sudah diganti / sudah pindah halaman).
    if (q('#item-code')?.value.trim() !== item) return;

    if (!found) {
        toast(`Pallet ${pallet} (${item}, exp ${exp}) sudah tidak ada stoknya`, 'warning');
        return;
    }

    fillPallet(found);
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
            fillPallet(data[0]);
        } else {
            pickPallet(data);
        }
    } else if (mode === 'item' && itemCode && ITEM_CODE_PATTERN.test(itemCode)) {
        // Hanya item code 9 digit angka. Deskripsi 9 huruf (mis. "quadriple") tidak
        // boleh ikut mencari stok; deskripsi dipilih lewat saran autocomplete.
        const response = await apiFetch(`controller/StockController.php?item_code=${encodeURIComponent(itemCode)}`);
        const data = await response.json();
        if (data.length === 0) {
            toast(`Tidak ada stok tersisa untuk item ${itemCode}`, 'warning');
        } else if (data.length === 1) {
            fillPallet(data[0]);
        } else {
            pickPallet(data);
        }
    }

}

// Lebih dari satu pallet cocok -> operator memilih lewat popup.
function pickPallet(data){
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
            closePopup();
            fillPallet(data[index]);
        });
}

// Isi form dari satu pallet (baris StockController) dan jadikan pallet asal terpilih.
// Qty terisi semua isi pallet (pindah utuh); operator boleh menguranginya.
function fillPallet(pallet){
    selected = pallet;
    q('#source-bin').value     = pallet.bin || '';
    q('#item-code').value      = pallet.item_code || '';
    q('#exp-date').value       = pallet.exp_date || '';
    q('#pallet-number').value  = pallet.pallet_number || '';
    q('#qty').value            = Number(pallet.qty_actual) || '';
    q('#qty-unit').textContent = pallet.uom_fisik || '';
    renderTarget();
    q('#target-bin').focus();
}

function clearSelected(){
    if (selected) {
        selected = null;
        q('#qty').value = '';
        q('#qty-unit').textContent = '';
    }
    renderTarget();
}

// Isi target bin dicari setiap kali Target Bin berubah (lewat debounce).
// requestId: jawaban lama yang datang terlambat (bin sudah diganti) diabaikan.
async function loadTargetPallets(){
    const myRequest = ++targetRequestId;
    const targetBin = q('#target-bin')?.value.trim();

    if (!targetBin) {
        targetBinPallets = [];
        renderTarget();
        return;
    }

    try {
        const response = await apiFetch(`controller/StockController.php?source_bin=${encodeURIComponent(targetBin)}`);
        const data = await response.json();
        if (myRequest !== targetRequestId) return;
        targetBinPallets = Array.isArray(data) ? data : [];
    } catch (err) {
        if (myRequest !== targetRequestId) return;
        targetBinPallets = [];
        toast('Gagal memuat isi target bin: ' + err.message, 'error');
    }
    renderTarget();
}

// Qty lebih kecil dari isi pallet = pindah sebagian (wajib digabung ke pallet tujuan).
function isPartial(){
    const qtyText = q('#qty').value;
    return Boolean(selected) && qtyText !== '' && Number(qtyText) < Number(selected.qty_actual) - 0.0005;
}

// Calon pallet tujuan: pallet item + exp yang sama di target bin, selain pallet asal.
function targetCandidates(){
    const itemCode = q('#item-code').value.trim();
    const expDate = q('#exp-date').value;
    const palletNumber = Number(q('#pallet-number').value);

    return targetBinPallets.filter(p =>
        p.item_code === itemCode && p.exp_date === expDate && Number(p.pallet_number) !== palletNumber);
}

// Alasan pallet tidak boleh digabung (cek yang sama ada di BinToBin.php). '' = boleh.
function mismatchReason(pallet){
    if (!selected) return '';
    const supplierOf = p => (p.supplier ?? '').trim().toLowerCase();
    if (supplierOf(pallet) !== supplierOf(selected)) return 'beda supplier';
    if (Math.abs(Number(pallet.conversion_factor) - Number(selected.conversion_factor)) > 0.00005) return 'beda faktor konversi';
    return '';
}

// Gambar ulang pilihan Pallet Tujuan + keterangan qty. Dipanggil setiap kali pallet asal,
// qty, atau isi target bin berubah.
function renderTarget(){
    const select = q('#target-pallet');
    if (!select) return; // sudah pindah halaman (jawaban fetch datang terlambat)

    const palletNumber = q('#pallet-number').value.trim();
    const partial = isPartial();
    const options = [
        {
            value: '',
            label: palletNumber ? `Pindah utuh (pallet ${palletNumber} ikut pindah)` : 'Pindah utuh',
            disabled: partial,
        },
        ...targetCandidates().map(p => {
            const reason = mismatchReason(p);
            return {
                value: String(p.pallet_number),
                label: `Gabung ke pallet ${p.pallet_number} (isi ${formatNumber(p.qty_actual)} ${p.uom_fisik})` + (reason ? ` - ${reason}` : ''),
                disabled: Boolean(reason),
            };
        }),
    ];

    // Pilihan sebelumnya dipertahankan selama masih boleh. Kalau tidak: qty sebagian ->
    // gabung ke pallet pertama yang boleh, qty utuh -> pindah utuh (perilaku Bin to Bin lama).
    const allowed = options.filter(o => !o.disabled).map(o => o.value);
    let chosen = select.value;
    if (!allowed.includes(chosen)) chosen = partial ? (allowed[0] ?? '') : '';

    select.innerHTML = options.map(o => `
        <option value="${escapeHtml(o.value)}"${o.disabled ? ' disabled' : ''}${o.value === chosen ? ' selected' : ''}>${escapeHtml(o.label)}</option>
    `).join('');

    q('#qty-hint').textContent = selected
        ? `Isi pallet: ${formatNumber(selected.qty_actual)} ${selected.uom_fisik}. Kurangi untuk pindah sebagian.`
        : '';
    renderTargetHint();
}

// Keterangan di bawah Pallet Tujuan: apa yang terjadi kalau Move ditekan.
function renderTargetHint(){
    const hint = q('#target-hint');
    if (!hint) return;

    const targetBin    = q('#target-bin').value.trim().toUpperCase();
    const targetPallet = q('#target-pallet').value;
    const palletNumber = q('#pallet-number').value.trim();
    const qtyText      = q('#qty').value;
    const candidates   = targetCandidates();
    let text = '';

    if (targetPallet) {
        text = qtyText === ''
            ? `Semua isi pallet ${palletNumber} ditumpuk ke pallet ${targetPallet}.`
            : `${formatNumber(qtyText)} ${selected?.uom_fisik ?? ''} dari pallet ${palletNumber} ditumpuk ke pallet ${targetPallet}`
                + (isPartial() ? '.' : `, pallet ${palletNumber} jadi kosong.`);
    } else if (isPartial()) {
        text = targetBin
            ? `Pindah sebagian harus digabung ke pallet item & exp yang sama. Di ${targetBin} tidak ada pallet yang bisa digabung.`
            : 'Pindah sebagian: isi Target Bin yang berisi pallet item & exp yang sama.';
    } else if (candidates.length > 0) {
        text = `Di ${targetBin} ada pallet ${candidates.map(p => p.pallet_number).join(', ')} (item & exp sama). `
            + 'Pilih "Gabung" kalau isinya ditumpuk ke pallet itu.';
    }

    hint.textContent = text;
}

async function handleMove(){
    const sourceBin    = q('#source-bin').value.trim();
    const targetBin    = q('#target-bin').value.trim();
    const itemCode     = q('#item-code').value.trim();
    const expDate      = q('#exp-date').value;
    const palletNumber = q('#pallet-number').value.trim();
    const qtyText      = q('#qty').value.trim();
    const targetPallet = q('#target-pallet').value;

    if (!sourceBin || !targetBin || !itemCode || !expDate || !palletNumber) {
        toast('Semua field harus diisi.', 'warning');
        return;
    }

    const qty = Number(qtyText);
    if (qtyText !== '' && !(qty > 0)) {
        toast('Quantity harus lebih dari 0.', 'warning');
        return;
    }
    if (selected && qty > Number(selected.qty_actual) + 0.0005) {
        toast(`Quantity melebihi isi pallet (${formatNumber(selected.qty_actual)} ${selected.uom_fisik}).`, 'warning');
        return;
    }
    if (isPartial() && !targetPallet) {
        toast('Pindah sebagian harus digabung ke pallet di target bin. Pilih Pallet Tujuan.', 'warning');
        return;
    }

    // Identitas pallet + bin asal & tujuan + qty + pallet tujuan. Qty SAP dihitung server
    // dari faktor pallet. qty kosong = semua isi pallet, target_pallet kosong = pindah utuh.
    const moveData = {
        source_bin:    sourceBin,
        target_bin:    targetBin,
        item_code:     itemCode,
        exp_date:      expDate,
        pallet_number: palletNumber,
        qty_actual:    qtyText === '' ? null : qty,
        target_pallet: targetPallet ? Number(targetPallet) : null,
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
            q('#qty-unit').textContent = '';
            selected = null;
            targetBinPallets = [];
            targetRequestId++; // isi target bin yang masih dimuat tidak dipakai lagi
            renderTarget();
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
