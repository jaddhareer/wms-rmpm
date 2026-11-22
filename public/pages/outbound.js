import { setContent, q, escapeHtml, emptyRowHtml, formatNumber, formatQtySap, sumByUnit, QTY_SAP_DECIMALS } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { openPalletChecklist } from "../utilities/palletChecklist.js";
import { materialAutocomplete, ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";
import { replaceParams } from "../utilities/router.js";
import { scanButtonHtml } from "../utilities/scanner.js";

// Alur: pilih Outbound To (+ remark) -> scan / ketik item code -> popup checklist pallet item itu
// (FEFO) -> centang beberapa pallet -> Add -> semua pallet yang dicentang masuk daftar dengan qty
// satu pallet penuh. Qty yang diambil sebagian diubah langsung di tabel Daftar Pallet.

// Pallet yang sudah di-Add tapi belum di-submit. Satu baris = satu pallet.
let state = [];

// Item yang checklist-nya ingin dibuka saat form belum siap (Outbound To belum dipilih, atau
// Other tanpa remark). Dibuka otomatis setelah isian itu dilengkapi.
// { itemCode, preselect: { exp, pallet } | null } atau null.
let pending = null;

// Penanda fetch daftar pallet: jawaban yang sudah basi (scan berikutnya sudah jalan) diabaikan.
let requestId = 0;

// Masih ada pallet yang belum di-Submit? (lihat hasUnsubmitted di Inbound.js)
export function hasUnsubmitted(){
    return state.length > 0;
}

// params dari router. Dibuka dari popup Stock Overview -> { item, exp, pallet }:
// checklist item itu dibuka dengan pallet tersebut sudah dicentang.
export function outbound(params = {}){
    pending = null;

    setContent(`
        <div class="page-header"><h2>Outbound</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field">
                    <label for="destination">Outbound To</label>
                    <!-- Pilihan ini SAMA dengan $allowedDestinations di controller/Outbound.php (ubah keduanya). -->
                    <select id="destination">
                        <option value="">-- pilih --</option>
                        <option value="FERMENTASI">Fermentasi</option>
                        <option value="DRYING">Drying</option>
                        <option value="PACKAGING">Packaging</option>
                        <option value="PROPAGATION">Propagation</option>
                        <option value="QUALITY">Quality</option>
                        <option value="OTHER">Other</option>
                    </select>
                </div>
                <div class="field wide">
                    <label for="remark">Remark</label>
                    <input type="text" id="remark" maxlength="255">
                </div>
                <hr>
                <div class="field wide">
                    <label for="item-code">Item Code</label>
                    <div class="input-group">
                        <input type="text" id="item-code">
                        ${scanButtonHtml('item-code', 'item')}
                        <button type="button" id="btn-choose" data-icon="list">Pilih Pallet</button>
                    </div>
                    <small class="hint">Scan / pilih item, lalu centang pallet yang keluar. Tujuan & remark di atas ikut ke setiap pallet yang di-Add.</small>
                </div>
            </div>
        </section>

        <section class="card">
            <h3 class="card-title">
                Daftar Pallet <span class="badge" id="preview-count">0</span>
                <span class="card-summary" id="preview-total"></span>
            </h3>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th><th>Bin</th><th>Tujuan</th>
                            <th class="num">Stok Pallet</th><th class="num">Qty</th><th>UoM</th><th class="num">Qty SAP</th><th>UoM SAP</th><th>Remark</th><th></th>
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

    q('#destination').addEventListener('change', () => {
        updateRemarkRule();
        resumePending();
    });
    q('#remark').addEventListener('change', resumePending);
    q('#item-code').addEventListener('input', handleItemCodeInput);
    // Ketik deskripsi -> pilih saran -> sama seperti scan item code: checklist pallet dibuka.
    // Hanya material yang masih ada stoknya yang disarankan.
    materialAutocomplete(q('#item-code'), {
        inStockOnly: true,
        onSelect: (material) => openChecklist(material.item_code),
    });
    q('#btn-choose').addEventListener('click', () => openChecklist(q('#item-code').value.trim()));
    q('#btn-submit').addEventListener('click', handleSubmit);
    // Event delegation di tbody: baris digambar ulang setiap renderPreview().
    q('#preview-body').addEventListener('click', handleDeleteRow);
    q('#preview-body').addEventListener('input', handleQtyInput);

    renderPreview();

    if (params.item && params.exp && params.pallet) {
        // Parameter ini perintah sekali pakai, bukan isi halaman. URL dibersihkan supaya
        // refresh / back-forward tidak membuka checklist yang sama lagi.
        replaceParams('outbound');
        q('#item-code').value = params.item;
        openChecklist(params.item, { exp: params.exp, pallet: params.pallet });
    }
}

// Tujuan OTHER (mis. barang rusak): alasan barang keluar wajib ditulis di remark.
// Server memeriksa aturan yang sama (Outbound.php).
function updateRemarkRule(){
    const required = q('#destination').value === 'OTHER';
    q('#remark').required = required;
    q('#remark').placeholder = required ? 'Wajib: alasan barang keluar' : '';
}

// Isian form yang harus lengkap sebelum checklist dibuka (tujuan & remark dicap ke setiap
// pallet saat Add), atau null kalau sudah siap.
function formProblem(){
    if (!q('#destination').value) {
        return { message: 'Pilih Outbound To dulu, daftar pallet terbuka setelahnya', field: q('#destination') };
    }
    if (q('#destination').value === 'OTHER' && !q('#remark').value.trim()) {
        return { message: 'Tujuan Other wajib diisi remark (alasan barang keluar)', field: q('#remark') };
    }
    return null;
}

// Outbound To / remark baru dilengkapi: buka checklist yang tadi tertunda (kalau item code-nya
// masih sama).
function resumePending(){
    if (!pending) return;

    if (q('#item-code').value.trim() !== pending.itemCode) {
        pending = null;
        return;
    }
    openChecklist(pending.itemCode, pending.preselect);
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

    // Hanya item code penuh (9 digit). Deskripsi diketik -> lewat saran autocomplete.
    if (ITEM_CODE_PATTERN.test(itemCode)) {
        openChecklist(itemCode);
    }
}

// Muat pallet item ini (yang masih ada stoknya dan belum di daftar) lalu tampilkan checklist.
// preselect = { exp, pallet }: pallet itu langsung dicentang (dibuka dari Stock Overview).
async function openChecklist(itemCode, preselect = null){
    if (!itemCode) return;

    // Tombol "Pilih Pallet" bisa diklik saat input masih berisi deskripsi.
    if (!ITEM_CODE_PATTERN.test(itemCode)) {
        toast('Item code belum valid: scan item code atau pilih dari saran', 'warning');
        return;
    }

    const problem = formProblem();
    if (problem) {
        pending = { itemCode, preselect };
        toast(problem.message, 'warning');
        problem.field.focus();
        return;
    }
    pending = null;

    const myRequest = ++requestId;
    let data;
    try {
        const res = await apiFetch(`controller/StockController.php?item_code=${encodeURIComponent(itemCode)}`);
        data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
        if (myRequest === requestId) toast('Gagal memuat pallet: ' + err.message, 'error');
        return;
    }

    // Abaikan jawaban basi (scan berikutnya sudah jalan / input berubah / pindah halaman).
    if (myRequest !== requestId || q('#item-code')?.value.trim() !== itemCode) return;

    if (data.length === 0) {
        toast(`Tidak ada stok tersisa untuk item ${itemCode}`, 'warning');
        return;
    }

    // Pallet yang sudah ada di daftar tidak ditawarkan lagi.
    const pallets = data.filter(pallet => !state.some(row => samePallet(row, pallet)));

    if (preselect) {
        const wanted = { item_code: itemCode, exp_date: preselect.exp, pallet_number: preselect.pallet };
        if (state.some(row => samePallet(row, wanted))) {
            toast(`Pallet ${preselect.pallet} sudah ada di daftar`, 'warning');
        } else if (!pallets.some(p => samePallet(p, wanted))) {
            toast(`Pallet ${preselect.pallet} (${itemCode}, exp ${preselect.exp}) sudah tidak ada stoknya`, 'warning');
        }
    }

    if (pallets.length === 0) {
        toast(`Semua pallet item ${itemCode} sudah ada di daftar`, 'warning');
        return;
    }

    openPalletChecklist({
        title: `Pilih pallet: ${pallets[0].description}`,
        hint: 'Urut dari expired paling dekat (FEFO). Centang pallet yang keluar; qty yang diambil sebagian diubah di Daftar Pallet setelah Add.',
        pallets,
        isPreselected: (pallet) => Boolean(preselect)
            && pallet.exp_date === preselect.exp && Number(pallet.pallet_number) === Number(preselect.pallet),
        onAdd: addPallets,
    });
}

// Masukkan pallet-pallet yang dicentang ke daftar, masing-masing qty satu pallet penuh.
// Return false kalau form belum siap (popup tetap terbuka).
function addPallets(pallets){
    const problem = formProblem();
    if (problem) {
        toast(problem.message, 'warning');
        return false;
    }

    const destination = q('#destination').value;
    const remark = q('#remark').value.trim();
    const added = pallets.filter(pallet => !state.some(row => samePallet(row, pallet)));

    for (const pallet of added) {
        const row = {
            item_code:     pallet.item_code,
            description:   pallet.description,
            exp_date:      pallet.exp_date,
            pallet_number: Number(pallet.pallet_number),
            bin:           pallet.bin,
            destination:   destination,
            // Isi pallet saat dipilih: batas qty dan dasar hitung qty SAP di tabel.
            available:     parseFloat(pallet.qty_actual),
            available_sap: parseFloat(pallet.qty_sap),
            conversion_factor: parseFloat(pallet.conversion_factor),
            qty_actual:    parseFloat(pallet.qty_actual),  // default: satu pallet penuh
            qty_sap:       '',
            uom_fisik:     pallet.uom_fisik,
            uom_sap:       pallet.uom_sap,
            remark:        remark,
        };
        row.qty_sap = qtySapOf(row);
        state.push(row);
    }

    toast(`${added.length} pallet ditambahkan ke daftar`, 'success');

    // Remark stok (mis. REJECT dari Stock Overview) hanya diinformasikan, tidak memblokir.
    const remarks = added.filter(p => p.remark).map(p => `pallet ${p.pallet_number} exp ${p.exp_date}: ${p.remark}`);
    if (remarks.length > 0) toast(`Remark ${remarks.join(' · ')}`, 'info');

    // Siap untuk scan item berikutnya.
    q('#item-code').value = '';
    q('#item-code').focus();

    renderPreview();
    return true;
}

// Qty SAP satu baris daftar (teks 4 desimal), atau '' kalau qty belum valid.
// Hanya untuk ditampilkan. Server menghitung ulang sendiri.
function qtySapOf(row){
    const qty = row.qty_actual;
    if (!(qty > 0)) return '';

    // Ambil pallet habis -> sisa qty SAP pallet persis (sama dengan aturan di Outbound.php).
    if (Math.abs(qty - row.available) < 0.0005) {
        return row.available_sap.toFixed(QTY_SAP_DECIMALS);
    }
    return row.conversion_factor > 0 ? (qty * row.conversion_factor).toFixed(QTY_SAP_DECIMALS) : '';
}

// Pesan kalau qty baris ini belum benar, atau null.
function qtyProblem(row){
    if (!(row.qty_actual > 0)) return 'quantity harus lebih dari 0';
    if (row.qty_actual > row.available) return `quantity melebihi stok pallet (${formatNumber(row.available)} ${row.uom_fisik})`;
    return null;
}

function renderTotal(){
    // textContent (bukan innerHTML), jadi UoM dari database aman tanpa escapeHtml.
    q('#preview-total').textContent = state.length === 0 ? '' :
        `Total: ${sumByUnit(state, 'qty_actual', 'uom_fisik', formatNumber)}`
        + ` · Qty SAP: ${sumByUnit(state, 'qty_sap', 'uom_sap', formatQtySap)}`;
}

function renderPreview(){
    q('#preview-count').textContent = state.length;
    renderTotal();

    if (state.length === 0) {
        q('#preview-body').innerHTML = emptyRowHtml(13, 'Belum ada pallet. Scan item code, centang pallet, lalu klik Add.');
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
            <td class="num">${formatNumber(row.available)}</td>
            <td class="num">
                <input type="number" class="cell-qty${qtyProblem(row) ? ' is-invalid' : ''}" data-index="${index}"
                       min="0" max="${row.available}" step="any" value="${Number.isFinite(row.qty_actual) ? row.qty_actual : ''}"
                       aria-label="Qty pallet ${escapeHtml(row.pallet_number)} exp ${escapeHtml(row.exp_date)}">
            </td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td class="num cell-sap">${escapeHtml(row.qty_sap)}</td>
            <td>${escapeHtml(row.uom_sap)}</td>
            <td class="wrap">${escapeHtml(row.remark)}</td>
            <td><button type="button" class="btn-delete btn-sm btn-danger" data-index="${index}" data-icon="trash">Hapus</button></td>
        </tr>
    `).join('');
}

// Qty diubah di tabel -> simpan ke state, hitung ulang qty SAP baris itu dan total.
// Tabel TIDAK digambar ulang (kursor & fokus operator akan hilang), cukup sel yang berubah.
function handleQtyInput(e){
    const input = e.target.closest('.cell-qty');
    const row = input && state[Number(input.dataset.index)];
    if (!row) return;

    row.qty_actual = parseFloat(input.value); // NaN kalau dikosongkan
    row.qty_sap = qtySapOf(row);

    input.classList.toggle('is-invalid', qtyProblem(row) !== null);
    input.closest('tr').querySelector('.cell-sap').textContent = row.qty_sap;
    renderTotal();
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

    // Qty yang diketik di tabel dicek dulu. Server tetap mengecek ulang stoknya (Outbound.php).
    const invalid = state.findIndex(row => qtyProblem(row) !== null);
    if (invalid >= 0) {
        const row = state[invalid];
        toast(`Baris ${invalid + 1} (pallet ${row.pallet_number}): ${qtyProblem(row)}`, 'warning');
        q(`.cell-qty[data-index="${invalid}"]`)?.focus();
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
