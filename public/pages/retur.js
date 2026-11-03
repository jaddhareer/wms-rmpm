import { setContent, q, escapeHtml, formatNumber, formatQtySap, binDatalistHtml, emptyRowHtml, QTY_SAP_DECIMALS } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { replaceParams } from "../utilities/router.js";
import { binButtonsHtml } from "../utilities/binPicker.js";

// Retur: barang dari PRODUKSI/QUALITY/OTHER kembali ke gudang, ke nomor pallet asalnya.
// Alur: muat dokumen OUTBOUND -> pilih pallet -> isi qty (dan bin kalau pallet sudah kosong)
//       -> Add ke daftar -> Submit.
// Per pallet ada dua isian:
// - Qty Retur Utuh: unit utuh dalam UoM fisik (mis. 5 ROLL), kembali ke pallet asal.
//   Qty SAP dihitung otomatis.
// - Tidak Utuh: unit yang sudah terpakai sebagian (mis. ROLL yang tinggal 1,2 KG), ditimbang dan
//   ditambahkan SATU PER SATU dalam UoM SAP. Setiap unit = 1 unit fisik dengan beratnya sendiri,
//   jadi satu baris di daftar & ledger (remark diawali [TIDAK UTUH]). Server memasukkan semua unit
//   tidak utuh satu pallet asal ke SATU pallet sisa baru (lihat ReturController.php).

const API = 'controller/ReturController.php';

// State halaman (scope modul).
let refCode = '';        // kode dokumen outbound yang sedang dimuat
let lines = [];          // pallet-pallet dokumen itu (dari server)
let selected = null;     // pallet yang sedang dipilih di form
let partials = [];       // berat unit tidak utuh pallet terpilih (UoM SAP), belum di-Add
let cart = [];           // baris yang sudah di-Add, belum di-submit (satu pallet boleh beberapa baris)
let requestId = 0;

// Masih ada isian yang belum di-Submit? (lihat hasUnsubmitted di Inbound.js)
export function hasUnsubmitted(){
    return cart.length > 0 || partials.length > 0;
}

// params datang dari router, mis. { code: 'RMPMOB26090007' } saat dibuka dari popup transaksi.
export function retur(params = {}){
    setContent(`
        <div class="page-header"><h2>Retur</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field wide">
                    <label for="ref-code">ID Transaksi Outbound</label>
                    <div class="input-group">
                        <input type="text" id="ref-code" placeholder="RMPMOB...">
                        <button type="button" id="btn-load" class="btn-primary" data-icon="search">Muat</button>
                    </div>
                    <p class="hint" id="ref-info"></p>
                </div>
            </div>

            <div class="table-wrap mt">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th><th>Asal</th>
                            <th class="num">Keluar</th><th class="num">Sudah Diretur</th><th class="num">Sisa</th>
                            <th>Posisi Pallet Sekarang</th><th></th>
                        </tr>
                    </thead>
                    <tbody id="lines-body"></tbody>
                </table>
            </div>
        </section>

        <section class="card">
            <h3 class="card-title">Pallet Dipilih</h3>
            <div class="callout" id="sel-info">Belum ada. Klik Pilih pada tabel pallet di atas.</div>
            <div class="form-grid">
                <div class="field">
                    <label for="qty">Qty Retur Utuh</label>
                    <div class="input-group">
                        <input type="number" id="qty" min="0" step="any" disabled>
                        <span class="unit" id="sel-uom"></span>
                    </div>
                </div>
                <div class="field">
                    <label for="qty-sap">Qty SAP Utuh</label>
                    <div class="input-group">
                        <input type="text" id="qty-sap" disabled>
                        <span class="unit" id="sel-uom-sap"></span>
                    </div>
                </div>
                <div class="field wide">
                    <label for="partial-qty" id="partial-label">Tidak Utuh</label>
                    <div class="input-group">
                        <input type="number" id="partial-qty" min="0" step="any" placeholder="berat" disabled>
                        <span class="unit" id="partial-uom"></span>
                        <button type="button" id="btn-add-partial" class="btn-soft" data-icon="plus" disabled>Tambah</button>
                    </div>
                    <small class="hint" id="partial-hint"></small>
                    <ol class="partial-list" id="partial-list"></ol>
                </div>
                <div class="field wide">
                    <label for="bin">Bin</label>
                    <div class="input-group">
                        <input type="text" id="bin" list="bin-options" disabled>
                        ${binButtonsHtml('bin')}
                    </div>${binDatalistHtml()}
                    <small class="hint" id="bin-hint"></small>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-add" class="btn-soft" data-icon="plus" disabled>Add</button>
            </div>
        </section>

        <section class="card">
            <h3 class="card-title">Daftar Retur <span class="badge" id="cart-count">0</span></h3>
            <div class="form-grid mb">
                <div class="field full">
                    <label for="remark">Remark</label>
                    <input type="text" id="remark" maxlength="200" placeholder="opsional, ditambahkan setelah 'Retur dari transaksi ...'">
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th><th>Kondisi</th>
                            <th class="num">Qty</th><th>UoM</th><th class="num">Qty SAP</th><th>Bin</th><th></th>
                        </tr>
                    </thead>
                    <tbody id="cart-body"></tbody>
                </table>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-submit" class="btn-primary" data-icon="save">Submit</button>
            </div>
        </section>
    `);

    q('#btn-load').addEventListener('click', () => loadReference(q('#ref-code').value));
    q('#ref-code').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadReference(q('#ref-code').value);
    });
    q('#lines-body').addEventListener('click', handlePick);
    q('#qty').addEventListener('input', syncQty);
    q('#btn-add-partial').addEventListener('click', handleAddPartial);
    q('#partial-qty').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAddPartial();
    });
    q('#partial-list').addEventListener('click', handleDeletePartial);
    q('#btn-add').addEventListener('click', handleAdd);
    q('#cart-body').addEventListener('click', handleDeleteCart);
    q('#btn-submit').addEventListener('click', handleSubmit);

    renderCart();
    renderLines();

    // Dibuka dengan ID (dari popup transaksi) -> langsung muat dokumen itu.
    // Dibuka dari menu tanpa ID -> tampilkan lagi dokumen terakhir (kalau ada).
    const code = (params.code || refCode || '').trim();
    if (code) {
        q('#ref-code').value = code;
        loadReference(code);
    }
}

// Kunci identitas pallet.
function keyOf(row){
    return `${row.item_code}|${row.exp_date}|${Number(row.pallet_number)}`;
}

// Sisa yang boleh diretur untuk satu pallet, dikurangi yang sudah ada di daftar (cart).
// Dibulatkan supaya selisih pecahan float (0.30000000000000004) tidak ikut tampil.
function remainingOf(line){
    const inCart = cart.filter(c => keyOf(c) === keyOf(line)).reduce((sum, c) => sum + c.qty_actual, 0);
    return Math.max(0, round(parseFloat(line.qty_out) - parseFloat(line.qty_returned) - inCart, 3));
}

// Sama, dalam qty SAP.
function remainingSapOf(line){
    const inCart = cart.filter(c => keyOf(c) === keyOf(line)).reduce((sum, c) => sum + c.qty_sap, 0);
    return Math.max(0, round(parseFloat(line.sap_out) - parseFloat(line.sap_returned) - inCart, QTY_SAP_DECIMALS));
}

function round(value, decimals){
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

// Satu sel angka: qty fisik, dengan qty SAP di baris kedua.
function qtyCellHtml(qty, uomFisik, qtySap, uomSap){
    return `${formatNumber(qty)} ${escapeHtml(uomFisik)}`
        + `<br><span class="hint">${formatQtySap(qtySap)} ${escapeHtml(uomSap)}</span>`;
}

async function loadReference(rawCode){
    const code = rawCode.trim().toUpperCase();
    if (!code) {
        toast('Isi ID transaksi outbound dulu', 'warning');
        return;
    }

    // Ganti dokumen -> daftar retur dokumen sebelumnya dikosongkan.
    if (code !== refCode) {
        cart = [];
        renderCart();
    }

    const myRequest = ++requestId;
    q('#ref-info').textContent = 'Memuat...';

    try {
        const res = await apiFetch(`${API}?code=${encodeURIComponent(code)}`);
        const result = await res.json();

        if (myRequest !== requestId || !q('#lines-body')) return; // jawaban basi

        selectLine(null);

        if (!result.success) {
            refCode = '';
            lines = [];
            renderLines();
            q('#ref-info').textContent = result.error;
            return;
        }

        refCode = result.reference_code;
        lines = result.data;
        q('#ref-code').value = refCode;
        replaceParams('retur', { code: refCode }); // URL ikut dokumen yang tampil
        q('#ref-info').textContent = `Dokumen ${refCode}, keluar ${lines[0].created_at}, ${lines.length} pallet.`;
        renderLines();

    } catch (err) {
        if (myRequest !== requestId || !q('#ref-info')) return;
        q('#ref-info').textContent = 'Tidak bisa menghubungi server: ' + err.message;
    }
}

function renderLines(){
    if (lines.length === 0) {
        q('#lines-body').innerHTML = emptyRowHtml(10, 'Isi ID transaksi outbound lalu klik Muat.');
        return;
    }

    q('#lines-body').innerHTML = lines.map((line, index) => {
        const remaining = remainingOf(line);
        const remainingSap = remainingSapOf(line);
        const stockQty = parseFloat(line.stock_qty);
        const position = stockQty > 0
            ? `${line.stock_bin} (isi ${formatNumber(stockQty)})`
            : 'kosong';

        return `
            <tr>
                <td>${escapeHtml(line.item_code)}</td>
                <td class="wrap">${escapeHtml(line.description)}</td>
                <td>${escapeHtml(line.exp_date)}</td>
                <td class="num">${escapeHtml(line.pallet_number)}</td>
                <td>${escapeHtml(line.destination)}</td>
                <td class="num">${qtyCellHtml(line.qty_out, line.uom_fisik, line.sap_out, line.uom_sap)}</td>
                <td class="num">${qtyCellHtml(line.qty_returned, line.uom_fisik, line.sap_returned, line.uom_sap)}</td>
                <td class="num">${qtyCellHtml(remaining, line.uom_fisik, remainingSap, line.uom_sap)}</td>
                <td>${escapeHtml(position)}</td>
                <td>
                    ${remaining > 0
                        ? `<button type="button" class="btn-pick btn-sm btn-soft" data-index="${index}" data-icon="check">Pilih</button>`
                        : '<span class="badge badge-active" data-icon="check">Selesai</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

function handlePick(e){
    const button = e.target.closest('.btn-pick');
    if (!button) return;

    selectLine(lines[Number(button.dataset.index)]);
}

// Isi form sesuai pallet yang dipilih. Aturan bin:
// - pallet sudah kosong -> bin wajib diisi (pallet "hidup lagi" di lokasi baru)
// - pallet masih ada isi -> barang ditaruh ke pallet yang sama, bin tidak berubah
// - pallet ini sudah ada di daftar -> bin mengikuti baris itu (server menaruh semua di bin yang sama)
function selectLine(line){
    selected = line;
    partials = [];

    const ready = Boolean(line);
    q('#qty').disabled = !ready;
    q('#partial-qty').disabled = !ready;
    q('#btn-add-partial').disabled = !ready;
    q('#btn-add').disabled = !ready;
    q('#partial-qty').value = '';

    if (!line) {
        q('#sel-info').textContent = 'Belum ada. Klik Pilih pada tabel pallet di atas.';
        q('#qty').value = '';
        q('#qty-sap').value = '';
        q('#partial-label').textContent = 'Tidak Utuh';
        q('#bin').value = '';
        q('#bin').disabled = true;
        q('#bin-hint').textContent = '';
        q('#sel-uom').textContent = '';
        q('#sel-uom-sap').textContent = '';
        q('#partial-uom').textContent = '';
        renderPartials();
        return;
    }

    q('#sel-info').textContent = `${line.item_code} ${line.description}, exp ${line.exp_date}, pallet ${line.pallet_number}`;
    q('#sel-uom').textContent = line.uom_fisik;
    q('#sel-uom-sap').textContent = line.uom_sap;
    q('#partial-uom').textContent = line.uom_sap;
    q('#partial-label').textContent = `${line.uom_fisik} Tidak Utuh`;
    q('#qty').value = remainingOf(line);   // default: semua sisa kembali utuh

    const palletEmpty = parseFloat(line.stock_qty) <= 0;
    const binInCart = cart.find(c => keyOf(c) === keyOf(line))?.bin;
    q('#bin').disabled = !palletEmpty || Boolean(binInCart);
    q('#bin').value = palletEmpty ? (binInCart ?? '') : line.stock_bin;
    q('#bin-hint').textContent = !palletEmpty
        ? 'Pallet masih ada isinya: barang retur masuk ke pallet yang sama, bin tetap.'
        : binInCart
            ? 'Pallet ini sudah ada di daftar: bin mengikuti baris sebelumnya.'
            : 'Pallet sudah kosong: isi bin tempat barang retur ditaruh.';

    syncQty();
    renderPartials();
    q('#qty').focus();
}

// Qty SAP unit utuh, aturan sama dengan server (lihat ReturController.php): qty x faktor.
// Retur semua sisa dan bedanya hanya selisih pembulatan -> qty SAP = sisa persis. Kalau sebagian
// sudah kembali tidak utuh, sisa SAP lebih besar dari sisa unit x faktor: tetap qty x faktor.
function wholeSapOf(qty){
    const remaining = remainingOf(selected);
    const remainingSap = remainingSapOf(selected);
    const factor = parseFloat(selected.conversion_factor);
    const calculated = round(qty * factor, QTY_SAP_DECIMALS);

    const isAllRemaining = Math.abs(qty - remaining) < 0.0005
        && Math.abs(remainingSap - calculated) <= 0.0005 * factor + 0.00005;

    return isAllRemaining ? remainingSap : Math.min(calculated, remainingSap);
}

// Hanya untuk ditampilkan. Server menghitung ulang sendiri.
function syncQty(){
    if (!selected) return;

    const qty = parseFloat(q('#qty').value);
    q('#qty-sap').value = qty > 0 ? wholeSapOf(qty).toFixed(QTY_SAP_DECIMALS) : '';
}

// Satu unit tidak utuh = satu berat. Dicek di sini supaya salah ketik langsung ketahuan;
// batas total (utuh + tidak utuh <= sisa) dicek saat Add.
function handleAddPartial(){
    if (!selected) return;

    const weight = round(parseFloat(q('#partial-qty').value), QTY_SAP_DECIMALS);
    const factor = parseFloat(selected.conversion_factor);
    const { uom_fisik: uom, uom_sap: uomSap } = selected;

    if (!(weight > 0)) {
        toast(`Isi berat ${uom} tidak utuh (${uomSap})`, 'warning');
        q('#partial-qty').focus();
        return;
    }
    if (weight >= factor) {
        toast(`${uom} tidak utuh harus kurang dari 1 ${uom} (${formatQtySap(factor)} ${uomSap}). ${uom} utuh diisi di Qty Retur Utuh.`, 'warning');
        q('#partial-qty').focus();
        return;
    }

    partials.push(weight);
    q('#partial-qty').value = '';
    q('#partial-qty').focus(); // siap untuk unit berikutnya
    renderPartials();
}

function handleDeletePartial(e){
    const button = e.target.closest('button[data-partial]');
    if (!button) return;

    partials.splice(Number(button.dataset.partial), 1);
    renderPartials();
}

// Daftar unit tidak utuh pallet terpilih + petunjuk/total di bawah input.
function renderPartials(){
    if (!selected) {
        q('#partial-hint').textContent = '';
        q('#partial-list').innerHTML = '';
        return;
    }

    const { uom_fisik: uom, uom_sap: uomSap } = selected;

    if (partials.length === 0) {
        q('#partial-hint').textContent = `Ada ${uom} yang sudah terpakai sebagian? Timbang satu per satu, isi beratnya, `
            + `lalu klik Tambah (1 ${uom} utuh = ${formatNumber(selected.conversion_factor)} ${uomSap}). `
            + `Masing-masing dihitung 1 ${uom} dan masuk pallet baru di bin yang sama.`;
    } else {
        const total = round(partials.reduce((sum, w) => sum + w, 0), QTY_SAP_DECIMALS);
        q('#partial-hint').textContent = `${partials.length} ${uom} tidak utuh, total ${formatQtySap(total)} ${uomSap}. `
            + `Masuk pallet baru di bin yang sama.`;
    }

    // Tombol hapus = tombol ikon saja: isinya harus benar-benar kosong (lihat :empty di style.css).
    q('#partial-list').innerHTML = partials.map((weight, index) => `
        <li>${escapeHtml(uom)} ${index + 1}: ${formatQtySap(weight)} ${escapeHtml(uomSap)}<button type="button" class="btn-sm"
            data-partial="${index}" data-icon="x" aria-label="Hapus ${escapeHtml(uom)} tidak utuh ${index + 1}"></button></li>
    `).join('');
}

// Satu kali Add bisa menghasilkan beberapa baris: satu baris utuh (kalau ada) + satu baris
// per unit tidak utuh. Pallet yang sama boleh di-Add lagi selama masih ada sisa.
function handleAdd(){
    if (!selected) return;

    const qtyText = q('#qty').value.trim();
    const qty = qtyText === '' ? 0 : parseFloat(qtyText);
    const remaining = remainingOf(selected);
    const remainingSap = remainingSapOf(selected);
    const palletEmpty = parseFloat(selected.stock_qty) <= 0;
    const bin = q('#bin').value.trim().toUpperCase();
    const { uom_fisik: uom, uom_sap: uomSap } = selected;

    if (!(qty >= 0)) {
        toast('Qty retur utuh tidak valid', 'warning');
        return;
    }
    if (qty === 0 && partials.length === 0) {
        toast(`Isi Qty Retur Utuh, atau tambahkan ${uom} tidak utuh`, 'warning');
        return;
    }
    // Setiap unit tidak utuh dihitung 1 unit fisik.
    if (qty + partials.length > remaining + 0.0005) {
        toast(partials.length > 0
            ? `Utuh + tidak utuh maksimal ${formatNumber(remaining)} ${uom} (sekarang ${formatNumber(qty)} + ${partials.length})`
            : `Qty retur utuh maksimal ${formatNumber(remaining)} ${uom}`, 'warning');
        return;
    }

    // Total dicek dalam qty SAP: unit tidak utuh dicatat dengan beratnya.
    const wholeSap = qty > 0 ? wholeSapOf(qty) : 0;
    const total = round(wholeSap + partials.reduce((sum, w) => sum + w, 0), QTY_SAP_DECIMALS);
    if (total > remainingSap + 0.00005) {
        toast(`Total retur ${formatQtySap(total)} ${uomSap} melebihi sisa ${formatQtySap(remainingSap)} ${uomSap}.`
            + (partials.length > 0 ? ` Kurangi Qty Retur Utuh.` : ''), 'warning');
        return;
    }
    if (palletEmpty && !bin) {
        toast('Pallet sudah kosong, bin wajib diisi', 'warning');
        return;
    }

    const base = {
        item_code:     selected.item_code,
        description:   selected.description,
        exp_date:      selected.exp_date,
        pallet_number: Number(selected.pallet_number),
        uom_fisik:     uom,
        uom_sap:       uomSap,
        bin:           palletEmpty ? bin : selected.stock_bin,
    };

    if (qty > 0) {
        cart.push({ ...base, qty_actual: qty, qty_sap: wholeSap, input_unit: 'fisik' });
    }
    for (const weight of partials) {
        cart.push({ ...base, qty_actual: 1, qty_sap: weight, input_unit: 'sap' });
    }

    selectLine(null);
    renderCart();
    renderLines(); // kolom "Sisa" ikut berkurang
}

function renderCart(){
    q('#cart-count').textContent = cart.length;

    if (cart.length === 0) {
        q('#cart-body').innerHTML = emptyRowHtml(10, 'Belum ada pallet retur. Pilih pallet, isi qty, lalu klik Add.');
        return;
    }

    q('#cart-body').innerHTML = cart.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td class="wrap">${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td class="num">${escapeHtml(row.pallet_number)}</td>
            <td>${row.input_unit === 'sap' ? 'Tidak utuh (pallet baru)' : 'Utuh'}</td>
            <td class="num">${formatNumber(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td class="num">${formatQtySap(row.qty_sap)} ${escapeHtml(row.uom_sap)}</td>
            <td>${escapeHtml(row.bin)}</td>
            <td><button type="button" class="btn-delete btn-sm btn-danger" data-index="${index}" data-icon="trash">Hapus</button></td>
        </tr>
    `).join('');
}

function handleDeleteCart(e){
    const button = e.target.closest('.btn-delete');
    if (!button) return;

    cart.splice(Number(button.dataset.index), 1);
    renderCart();
    renderLines();
}

async function handleSubmit(){
    if (!refCode || cart.length === 0) {
        toast('Belum ada pallet yang di-Add', 'warning');
        return;
    }

    const button = q('#btn-submit');
    button.disabled = true;

    // Bentuk "object berisi array": satu dokumen referensi, banyak baris.
    const payload = {
        reference_code: refCode,
        remark: q('#remark').value.trim(),
        items: cart.map(c => ({
            item_code: c.item_code,
            exp_date: c.exp_date,
            pallet_number: c.pallet_number,
            qty_actual: c.qty_actual,
            qty_sap: c.qty_sap,
            input_unit: c.input_unit,
            bin: c.bin,
        })),
    };

    try {
        const res = await apiFetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await res.json();

        if (result.success) {
            // Pesan server menyebut nomor pallet sisa (unit tidak utuh), untuk label pallet fisiknya.
            toast(result.message || 'Retur berhasil disimpan: ' + result.transaction_code, 'success');
            cart = [];
            q('#remark').value = '';
            renderCart();
            loadReference(refCode); // muat ulang supaya "Sudah Diretur" & posisi pallet terbaru
        } else {
            toast('Gagal: ' + result.error, 'error');
        }
    } catch (err) {
        toast('Tidak bisa menghubungi server: ' + err.message, 'error');
    } finally {
        button.disabled = false;
    }
}
