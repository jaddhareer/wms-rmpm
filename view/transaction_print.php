<?php
// VIEW halaman cetak transaksi. Hanya menampilkan data yang sudah disiapkan
// controller/TransactionPrint.php: $code, $head, $rows, $summary, $doc,
// $commonRemark, $fromOf, $toOf. Tidak ada query di sini.
// Semua teks dari database ditulis lewat e() supaya aman (escape HTML).
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Judul tab = nama file default saat "Save as PDF" -->
    <title><?= e($code) ?></title>
    <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: #111;
            padding: 24px;
            overflow-x: hidden;
        }

        /* Toolbar (tidak ikut tercetak) */
        .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
        .toolbar button {
            min-height: 36px; padding: 6px 16px; font-size: 14px; cursor: pointer;
            border: 1px solid #1769aa; border-radius: 6px; background: #1769aa; color: #fff;
        }
        .toolbar button:disabled { opacity: .45; cursor: not-allowed; }
        .toolbar .hint { color: #8a5a00; font-size: 12px; }

        /* Kepala dokumen */
        .doc-head { display: flex; justify-content: space-between; align-items: flex-end;
                    gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; }
        .doc-org { font-size: 11px; letter-spacing: .08em; color: #555; text-transform: uppercase; }
        .doc-title { margin: 2px 0 0; font-size: 18px; }
        .doc-code { font-size: 16px; font-weight: bold; white-space: nowrap; }

        .info { display: grid; grid-template-columns: max-content 1fr max-content 1fr;
                gap: 4px 12px; margin-top: 12px; }
        .info dt { color: #555; }
        .info dd { margin: 0; font-weight: bold; }

        h3 { font-size: 13px; margin: 20px 0 6px; }

        .table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        table { width: 100%; min-width: 720px; border-collapse: collapse; }
        th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
        th { background: #f0f0f0; font-size: 11px; }
        td.num, th.num { text-align: right; white-space: nowrap; }
        td.nowrap { white-space: nowrap; }
        tr { break-inside: avoid; }

        /* Tanda tangan */
        .sig-section { margin-top: 28px; break-inside: avoid; }
        .sig-grid { display: flex; gap: 40px; flex-wrap: wrap; }
        .sig-box { width: 260px; }
        .sig-label { font-weight: bold; margin-bottom: 6px; }
        .sig-pad-wrap {
            position: relative; width: 100%; height: 100px;
            border: 1px dashed #999; cursor: pointer; background: #fff;
        }
        .sig-pad-wrap:hover { border-color: #1769aa; }
        .sig-placeholder {
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            color: #999; pointer-events: none; text-align: center; padding: 0 8px;
        }
        .sig-img { display: none; max-width: 100%; max-height: 100%; margin: 0 auto; }
        .sig-line { border-top: 1px solid #111; margin-top: 4px; }
        .sig-name-input {
            width: 100%; min-height: 36px; margin-top: 6px; padding: 6px;
            font-size: 15px; border: 1px solid #ccc; border-radius: 5px;
        }
        .sig-name-print { display: none; margin-top: 6px; font-weight: bold; }
        .sig-role { font-size: 11px; color: #666; margin-top: 2px; }

        /* Popup tanda tangan */
        .sig-overlay {
            display: none; position: fixed; inset: 0; z-index: 1000; padding: 12px;
            background: rgba(0, 0, 0, .55); align-items: center; justify-content: center;
        }
        .sig-overlay.active { display: flex; }
        .sig-modal {
            width: min(720px, 100%); max-height: calc(100dvh - 24px); overflow: hidden;
            background: #fff; padding: 18px; border-radius: 12px; box-shadow: 0 10px 35px rgba(0, 0, 0, .25);
        }
        .sig-modal-title { font-weight: bold; margin-bottom: 12px; font-size: 16px; }
        .sig-modal canvas {
            display: block; width: 100%; height: 220px;
            border: 1px solid #999; border-radius: 6px; background: #fff; touch-action: none;
        }
        .sig-actions { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 8px; margin-top: 14px; }
        .sig-actions button {
            min-height: 44px; padding: 8px 12px; font-size: 14px; cursor: pointer;
            border: 1px solid #bbb; border-radius: 6px; background: #fff;
        }
        .sig-actions .primary { color: #fff; border-color: #1769aa; background: #1769aa; }
        body.modal-open { overflow: hidden; }

        /* HP: popup muncul dari bawah, kanvas mengisi sisa layar */
        @media (max-width: 600px) {
            body { padding: 12px; }
            .info { grid-template-columns: max-content 1fr; }
            .sig-grid { gap: 24px; }
            .sig-box { width: 100%; max-width: 320px; }
            .sig-overlay { align-items: flex-end; padding: 0; }
            .sig-modal {
                width: 100%; height: 70dvh; max-height: 70dvh;
                display: flex; flex-direction: column; padding: 16px; border-radius: 16px 16px 0 0;
            }
            .sig-modal canvas { flex: 1 1 0; height: 0; min-height: 0; }
            .sig-actions { grid-template-columns: 1fr 1fr; }
            .sig-actions button { font-size: 16px; }
            .sig-actions .primary { grid-column: 1 / -1; }
        }

        @page { size: A4; margin: 12mm; }
        @media print {
            body { padding: 0; overflow: visible; }
            .no-print, .sig-overlay, .sig-placeholder, .sig-name-input { display: none !important; }
            .sig-pad-wrap { border: none; cursor: default; }
            .sig-name-print { display: block; }
            .table-wrap { overflow: visible; }
            table { min-width: 0; }
            th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <button type="button" id="btn-print" disabled>Print / Save as PDF</button>
        <span class="hint" id="print-hint">Lengkapi tanda tangan dan nama kedua pihak untuk mencetak.</span>
    </div>

    <div class="doc-head">
        <div>
            <div class="doc-org">Warehouse RMPM</div>
            <h2 class="doc-title"><?= e($doc['title']) ?></h2>
        </div>
        <div class="doc-code"><?= e($code) ?></div>
    </div>

    <dl class="info">
        <dt>Tanggal</dt>     <dd><?= e(date('d/m/Y H:i', strtotime($head['created_at']))) ?></dd>
        <dt>Dibuat oleh</dt> <dd><?= e($head['user_name'] ?? '-') ?></dd>
        <dt>Jumlah</dt>      <dd><?= count($rows) ?> pallet</dd>
        <?php if ($head['reference_code']): ?>
            <dt>Referensi</dt> <dd><?= e($head['reference_code']) ?></dd>
        <?php endif; ?>
        <?php if ($commonRemark !== null && $commonRemark !== ''): ?>
            <dt>Remark</dt> <dd style="grid-column: span 3"><?= e($commonRemark) ?></dd>
        <?php endif; ?>
    </dl>

    <h3>Detail Pallet</h3>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th class="num">No</th><th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th>
                    <th class="num">Qty</th><th class="num">Qty SAP</th><th>Dari</th><th>Ke</th>
                    <?php if ($commonRemark === null): ?><th>Remark</th><?php endif; ?>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($rows as $i => $r): ?>
                <tr>
                    <td class="num"><?= $i + 1 ?></td>
                    <td class="nowrap"><?= e($r['item_code']) ?></td>
                    <td><?= e($r['description']) ?></td>
                    <td class="nowrap"><?= e($r['exp_date']) ?></td>
                    <td class="num"><?= e($r['pallet_number']) ?></td>
                    <td class="num"><?= formatNumber($r['qty_actual']) ?> <?= e($r['uom_fisik']) ?></td>
                    <td class="num"><?= formatNumber($r['qty_sap']) ?> <?= e($r['uom_sap']) ?></td>
                    <td class="nowrap"><?= e($fromOf($r)) ?></td>
                    <td class="nowrap"><?= e($toOf($r)) ?></td>
                    <?php if ($commonRemark === null): ?><td><?= e($r['remark']) ?></td><?php endif; ?>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <h3>Ringkasan per Lot</h3>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>Item Code</th><th>Description</th><th>Exp Date</th>
                    <th class="num">Jumlah Pallet</th><th class="num">Total Qty</th><th class="num">Total Qty SAP</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($summary as $s): ?>
                <tr>
                    <td class="nowrap"><?= e($s['item_code']) ?></td>
                    <td><?= e($s['description']) ?></td>
                    <td class="nowrap"><?= e($s['exp_date']) ?></td>
                    <td class="num"><?= $s['pallets'] ?></td>
                    <td class="num"><?= formatNumber($s['qty_actual']) ?> <?= e($s['uom_fisik']) ?></td>
                    <td class="num"><?= formatNumber($s['qty_sap']) ?> <?= e($s['uom_sap']) ?></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <div class="sig-section">
        <h3>Tanda Tangan Serah Terima</h3>
        <div class="sig-grid">
            <?php foreach ($doc['signs'] as $i => $sign): ?>
            <div class="sig-box" data-index="<?= $i ?>" data-role="<?= e($sign['role']) ?>">
                <div class="sig-label"><?= e($sign['label']) ?></div>
                <div class="sig-pad-wrap">
                    <div class="sig-placeholder">Klik untuk tanda tangan</div>
                    <img class="sig-img" alt="Tanda tangan <?= e($sign['role']) ?>">
                </div>
                <div class="sig-line"></div>
                <input type="text" class="sig-name-input" placeholder="Ketik nama lengkap">
                <div class="sig-name-print">&nbsp;</div>
                <div class="sig-role"><?= e($sign['role']) ?></div>
            </div>
            <?php endforeach; ?>
        </div>
    </div>

    <div class="sig-overlay no-print" id="sig-overlay">
        <div class="sig-modal" role="dialog" aria-modal="true" aria-labelledby="sig-title">
            <div class="sig-modal-title" id="sig-title">Tanda Tangan</div>
            <canvas id="sig-canvas"></canvas>
            <div class="sig-actions">
                <button type="button" id="sig-clear">Hapus</button>
                <button type="button" id="sig-cancel">Batal</button>
                <button type="button" id="sig-save" class="primary">Simpan</button>
            </div>
        </div>
    </div>

    <!-- signature_pad disimpan lokal (seperti Chart.js), tidak butuh internet -->
    <script src="../public/vendor/signature_pad.umd.min.js"></script>
    <script>
        // Tanda tangan HANYA ada di halaman ini (untuk dicetak / disimpan sebagai PDF),
        // tidak disimpan ke database.
        const boxes     = [...document.querySelectorAll('.sig-box')];
        const signed    = boxes.map(() => '');   // gambar tanda tangan (data URL) per kotak
        const overlay   = document.getElementById('sig-overlay');
        const canvas    = document.getElementById('sig-canvas');
        const btnPrint  = document.getElementById('btn-print');
        let pad = null;       // objek SignaturePad, dibuat saat popup pertama kali dibuka
        let active = null;    // index kotak yang sedang diisi
        let resizeTimer = null;

        function pixelRatio(){
            return Math.max(window.devicePixelRatio || 1, 1);
        }

        // Ukuran gambar kanvas disamakan dengan ukuran tampilnya (x pixel ratio),
        // kalau tidak, garis tanda tangan jadi buram atau meleset dari jari/mouse.
        function fitCanvas(){
            const rect = canvas.getBoundingClientRect();
            const ratio = pixelRatio();
            canvas.width  = Math.max(1, Math.round(rect.width * ratio));
            canvas.height = Math.max(1, Math.round(rect.height * ratio));
            canvas.getContext('2d').scale(ratio, ratio);
        }

        function drawSaved(dataUrl){
            pad.clear();
            if (dataUrl) {
                pad.fromDataURL(dataUrl, { ratio: pixelRatio(), width: canvas.clientWidth, height: canvas.clientHeight });
            }
        }

        function openPad(index){
            active = index;
            document.getElementById('sig-title').textContent = 'Tanda Tangan - ' + boxes[index].dataset.role;
            overlay.classList.add('active');
            document.body.classList.add('modal-open');

            if (!pad) {
                pad = new SignaturePad(canvas, {
                    backgroundColor: 'rgb(255,255,255)',
                    minWidth: 0.8,
                    maxWidth: 2.5,
                    throttle: 8,
                });
            }

            // Tunggu popup tampil dulu supaya ukuran kanvas sudah benar.
            requestAnimationFrame(() => {
                fitCanvas();
                drawSaved(signed[index]); // buka lagi -> tanda tangan sebelumnya bisa diperbaiki
            });
        }

        function closePad(){
            overlay.classList.remove('active');
            document.body.classList.remove('modal-open');
            active = null;
        }

        function savePad(){
            if (!pad || pad.isEmpty()) {
                alert('Tanda tangan masih kosong.');
                return;
            }

            const dataUrl = pad.toDataURL('image/png');
            const box = boxes[active];
            signed[active] = dataUrl;

            const img = box.querySelector('.sig-img');
            img.src = dataUrl;
            img.style.display = 'block';
            box.querySelector('.sig-placeholder').style.display = 'none';

            closePad();
            updatePrintState();
        }

        // Print hanya bisa kalau SEMUA kotak sudah ada tanda tangan dan nama.
        function updatePrintState(){
            const ready = boxes.every((box, i) =>
                signed[i] !== '' && box.querySelector('.sig-name-input').value.trim() !== ''
            );
            btnPrint.disabled = !ready;
            document.getElementById('print-hint').style.display = ready ? 'none' : '';
        }

        boxes.forEach((box, index) => {
            box.querySelector('.sig-pad-wrap').addEventListener('click', () => openPad(index));

            // Nama diketik di input (tidak tercetak), lalu disalin ke teks yang tercetak.
            box.querySelector('.sig-name-input').addEventListener('input', (e) => {
                box.querySelector('.sig-name-print').textContent = e.target.value.trim() || ' ';
                updatePrintState();
            });
        });

        document.getElementById('sig-clear').addEventListener('click', () => pad?.clear());
        document.getElementById('sig-cancel').addEventListener('click', closePad);
        document.getElementById('sig-save').addEventListener('click', savePad);

        // Klik area gelap di luar kotak / tombol Esc = batal.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePad(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('active')) closePad();
        });

        btnPrint.addEventListener('click', () => {
            if (!btnPrint.disabled) window.print();
        });

        // HP diputar / jendela diubah ukurannya saat popup terbuka: ukur ulang kanvas
        // tanpa menghilangkan coretan yang sudah ada.
        window.addEventListener('resize', () => {
            if (!pad || active === null) return;

            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const current = pad.isEmpty() ? '' : pad.toDataURL('image/png');
                fitCanvas();
                drawSaved(current);
            }, 150);
        });
    </script>
</body>
</html>
