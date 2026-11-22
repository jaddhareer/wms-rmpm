import { setContent, q, escapeHtml, binDatalistHtml, emptyRowHtml, formatNumber, formatQtySap, sumByUnit, QTY_SAP_DECIMALS } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { materialAutocomplete, ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";
import { scanButtonHtml } from "../utilities/scanner.js";
import { binButtonsHtml } from "../utilities/binPicker.js";

const MATERIAL_API = 'controller/MaterialController.php';

// Batas Jumlah Pallet sekali Add. Pengaman salah ketik (mis. 80 padahal 8), bukan batas gudang:
// lebih dari ini cukup di-Add dua kali.
const PALLET_COUNT_MAX = 100;

// Pallet yang sudah di-Add tapi belum di-submit. Satu baris = satu pallet.
// Bin (wajib, awalnya kosong) & remark per baris diisi langsung di tabel Daftar Pallet.
let state = [];

// true setelah Submit ditolak karena ada bin kosong: isian bin yang masih kosong ditandai merah
// (tidak sejak awal, supaya baris yang baru di-Add tidak langsung tampil merah semua).
let showBinErrors = false;

// Data material master untuk item code yang sedang diketik (hasil fetch).
let currentMaterial = null;

// Masih ada pallet yang belum di-Submit? main.js tidak memuat ulang aplikasi otomatis
// (saat ada versi baru) selama ini true, karena daftarnya hanya ada di memori.
export function hasUnsubmitted(){
    return state.length > 0;
}

export function inbound(){
    currentMaterial = null;
    showBinErrors = false;

    setContent(`
        <div class="page-header"><h2>Inbound</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field">
                    <label for="source">Supplier</label>
                    <input type="text" id="source" placeholder="wajib diisi">
                </div>
                <hr>
                <div class="field">
                    <label for="item-code">Item Code</label>
                    <div class="input-group">
                        <input type="text" id="item-code">
                        ${scanButtonHtml('item-code', 'item')}
                    </div>
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
                    <label for="qty-fisik">Qty per Pallet</label>
                    <div class="input-group">
                        <input type="number" id="qty-fisik" min="0" step="any">
                        <input type="text" id="uom-fisik" class="unit" disabled aria-label="UoM">
                    </div>
                </div>
                <div class="field">
                    <label for="pallet-count">Jumlah Pallet</label>
                    <input type="number" id="pallet-count" min="1" max="${PALLET_COUNT_MAX}" step="1" value="1" inputmode="numeric">
                    <small class="hint" id="add-total"></small>
                </div>
                <div class="field">
                    <label for="conversion-factor">Conversion Factor</label>
                    <input type="number" id="conversion-factor" min="0" step="any">
                </div>
                <div class="field">
                    <label for="qty-sap">GR Qty per Pallet</label>
                    <div class="input-group">
                        <input type="text" id="qty-sap" disabled>
                        <input type="text" id="uom-sap" class="unit" disabled aria-label="UoM SAP">
                    </div>
                </div>
                <hr>
                <div class="field wide">
                    <label for="remark">Remark</label>
                    <input type="text" id="remark" maxlength="255">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-add" class="btn-soft" data-icon="plus">Add</button>
            </div>
        </section>

        <section class="card">
            <h3 class="card-title">
                Daftar Pallet <span class="badge" id="preview-count">0</span>
                <span class="card-summary" id="preview-total"></span>
            </h3>
            <p class="table-info">Isi bin setiap pallet di tabel (ketik, Pilih Bin, atau scan QR rak). Semua bin wajib diisi sebelum Submit.</p>
            ${binDatalistHtml()}
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
    q('#pallet-count').addEventListener('input', renderAddTotal);
    // Listener di tbody untuk semua tombol hapus dan isian bin/remark (event delegation),
    // karena baris-baris di dalamnya dibuat ulang setiap renderPreview().
    q('#preview-body').addEventListener('click', handleDeleteRow);
    q('#preview-body').addEventListener('input', handleRowInput);
    q('#preview-body').addEventListener('change', handleRowChange);

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

// Qty SAP satu pallet, dibulatkan 4 desimal seperti calculateQtySap() di server, atau null.
// Hanya untuk ditampilkan ke operator. Server menghitung ulang dari qty x faktor.
function qtySapPerPallet(){
    const qty = parseFloat(q('#qty-fisik').value);
    const factor = parseFloat(q('#conversion-factor').value);

    return (qty > 0 && factor > 0) ? Number((qty * factor).toFixed(QTY_SAP_DECIMALS)) : null;
}

function calculateQtySap(){
    const qtySap = qtySapPerPallet();
    q('#qty-sap').value = qtySap === null ? '' : qtySap.toFixed(QTY_SAP_DECIMALS);
    renderAddTotal();
}

// Total yang akan di-Add, di bawah Jumlah Pallet, mis. "Total 160 Sak (4.000,0000 KG)".
// Hanya tampil kalau lebih dari 1 pallet (1 pallet = sama dengan isian qty-nya).
function renderAddTotal(){
    const qty = parseFloat(q('#qty-fisik').value);
    const count = Number(q('#pallet-count').value);
    const qtySap = qtySapPerPallet();

    const show = qty > 0 && Number.isInteger(count) && count > 1;
    // textContent: UoM dari database aman tanpa escapeHtml.
    q('#add-total').textContent = !show ? '' :
        `Total ${formatNumber(qty * count)} ${currentMaterial?.uom_fisik ?? ''}`
        + (qtySap === null ? '' : ` (${formatQtySap(qtySap * count)} ${currentMaterial?.uom_sap ?? ''})`);
}

async function handleAdd(){
    const itemCode = q('#item-code').value.trim();
    const expDate  = q('#exp-date').value;
    const qtyFisik = parseFloat(q('#qty-fisik').value);
    const palletCount = Number(q('#pallet-count').value);
    const conversionFactor = parseFloat(q('#conversion-factor').value);

    // Supplier wajib: tersimpan di pallet (tidak bisa diubah lagi) dan dipakai untuk memilih
    // pallet saat Outbound / syarat Gabung di Bin to Bin. Server memeriksa aturan yang sama.
    if (!q('#source').value.trim()) {
        toast('Supplier wajib diisi', 'warning');
        q('#source').focus();
        return;
    }
    if (!currentMaterial || currentMaterial.item_code !== itemCode) {
        toast('Item Code belum valid', 'warning');
        return;
    }
    if (!expDate) {
        toast('Expired Date wajib diisi', 'warning');
        return;
    }
    if (!(qtyFisik > 0)) {
        toast('Qty per Pallet harus lebih dari 0', 'warning');
        return;
    }
    if (!Number.isInteger(palletCount) || palletCount < 1 || palletCount > PALLET_COUNT_MAX) {
        toast(`Jumlah Pallet harus bilangan bulat 1 sampai ${PALLET_COUNT_MAX}`, 'warning');
        q('#pallet-count').focus();
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

    const row = {
        item_code:     itemCode,
        description:   currentMaterial.item_name,
        exp_date:      expDate,
        // Nomor pallet berikutnya di server (yang sudah tersimpan). Nomor tampilan tiap baris
        // dihitung dari sini oleh renumberPallets().
        pallet_base:   Number(data.pallet_number),
        pallet_number: 0,
        source:        q('#source').value.trim(),
        qty_actual:    qtyFisik,
        uom_fisik:     currentMaterial.uom_fisik,
        conversion_factor: conversionFactor,
        qty_sap:       q('#qty-sap').value,
        uom_sap:       currentMaterial.uom_sap,
        bin:           '',   // diisi per pallet di tabel, wajib sebelum Submit
        remark:        q('#remark').value.trim(),
    };

    // Satu Add = sebanyak Jumlah Pallet baris, isinya sama. Bin & remark per baris diisi di tabel.
    for (let i = 0; i < palletCount; i++) {
        state.push({ ...row });
    }
    renumberPallets();

    toast(`${palletCount} pallet ditambahkan ke daftar`, 'success');

    // Remark tetap (biasanya sama untuk satu kedatangan). Jumlah Pallet kembali 1, supaya Add
    // berikutnya (mis. 1 pallet sisa) tidak ikut terduplikasi tanpa sengaja.
    q('#qty-fisik').value = '';
    q('#pallet-count').value = '1';
    calculateQtySap();
    q('#qty-fisik').focus();

    renderPreview();
}

// Nomor pallet di daftar = nomor yang akan diberikan server: Inbound.php memberi MAX+1 berurutan
// sesuai urutan baris, per item + exp. Dihitung ulang setiap daftar berubah, jadi setelah satu
// baris dihapus nomor di belakangnya ikut maju (sama dengan yang nanti tersimpan).
function renumberPallets(){
    const next = new Map(); // "item|exp" -> nomor berikutnya

    for (const row of state) {
        const key = `${row.item_code}|${row.exp_date}`;
        const number = next.get(key) ?? row.pallet_base;
        row.pallet_number = number;
        next.set(key, number + 1);
    }
}

function renderPreview(){
    q('#preview-count').textContent = state.length;

    // textContent (bukan innerHTML), jadi UoM dari database aman tanpa escapeHtml.
    q('#preview-total').textContent = state.length === 0 ? '' :
        `Total: ${sumByUnit(state, 'qty_actual', 'uom_fisik', formatNumber)}`
        + ` · GR Qty: ${sumByUnit(state, 'qty_sap', 'uom_sap', formatQtySap)}`;

    if (state.length === 0) {
        q('#preview-body').innerHTML = emptyRowHtml(13, 'Belum ada pallet. Isi form di atas lalu klik Add.');
        return;
    }

    // Bin & remark berupa isian: diketik langsung di baris (handleRowInput menyimpan ke state).
    // id input bin dipakai tombol Pilih Bin / scan di sampingnya (binButtonsHtml).
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
            <td>
                <div class="input-group cell-bin">
                    <input type="text" id="row-bin-${index}" data-field="bin" data-index="${index}" list="bin-options"
                           class="${showBinErrors && !row.bin ? 'is-invalid' : ''}" value="${escapeHtml(row.bin)}"
                           placeholder="wajib diisi" aria-label="Bin pallet ${escapeHtml(row.pallet_number)}">
                    ${binButtonsHtml(`row-bin-${index}`)}
                </div>
            </td>
            <td>
                <input type="text" class="cell-text" data-field="remark" data-index="${index}" maxlength="255"
                       value="${escapeHtml(row.remark)}" aria-label="Remark pallet ${escapeHtml(row.pallet_number)}">
            </td>
            <td><button type="button" class="btn-delete btn-sm btn-danger" data-index="${index}" data-icon="trash">Hapus</button></td>
        </tr>
    `).join('');
}

// Ketik di isian bin / remark sebuah baris -> langsung disimpan ke state. Tabel TIDAK digambar
// ulang di sini (kursor dan fokus operator akan hilang). Scan / Pilih Bin juga lewat sini,
// karena setInputValue() mengirim event 'input'.
function handleRowInput(e){
    const input = e.target.closest('[data-field]');
    const row = input && state[Number(input.dataset.index)];
    if (!row) return;

    if (input.dataset.field === 'bin') {
        row.bin = input.value.trim().toUpperCase();
        input.classList.toggle('is-invalid', showBinErrors && row.bin === '');
    } else {
        row[input.dataset.field] = input.value.trim();
    }
}

// Selesai mengetik bin (pindah isian): tampilkan versi yang disimpan, mis. "a-01-a-01" -> "A-01-A-01".
function handleRowChange(e){
    const input = e.target.closest('[data-field="bin"]');
    const row = input && state[Number(input.dataset.index)];
    if (row) input.value = row.bin;
}

function handleDeleteRow(e){
    const button = e.target.closest('.btn-delete');
    if (!button) return;

    state.splice(Number(button.dataset.index), 1);
    renumberPallets();
    renderPreview();
}

async function handleSubmit(){
    if (state.length === 0) {
        toast('Belum ada pallet yang di-Add', 'warning');
        return;
    }

    // Bin wajib diisi per pallet. Server memeriksa aturan yang sama (Inbound.php).
    const emptyBins = state.filter(row => row.bin === '').length;
    if (emptyBins > 0) {
        showBinErrors = true;
        renderPreview();
        toast(`${emptyBins} pallet belum diisi bin-nya`, 'warning');
        q('#preview-body .is-invalid')?.focus();
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
            showBinErrors = false;
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
