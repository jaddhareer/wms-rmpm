// Popup sederhana yang bisa dipakai semua halaman.
// Tampilannya diatur di style.css (#popup-overlay, #popup-box).

// Buka popup berisi html. Mengembalikan elemen kotak popup-nya,
// supaya pemanggil bisa memasang event listener di situ (event delegation).
export function openPopup(html){
    closePopup(); // pastikan hanya ada satu popup

    const overlay = document.createElement('div');
    overlay.id = 'popup-overlay';

    const box = document.createElement('div');
    box.id = 'popup-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = html;

    overlay.appendChild(box);

    // Klik area gelap di luar kotak = tutup popup.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePopup();
    });

    document.body.appendChild(overlay);
    return box;
}

export function closePopup(){
    document.getElementById('popup-overlay')?.remove();
}

// Dialog konfirmasi, pengganti confirm() bawaan browser (tampilannya seragam dengan aplikasi).
// Mengembalikan Promise: true = tombol konfirmasi ditekan, false = Batal / Esc / klik di luar.
//
//   const ok = await confirmDialog({
//       title: 'Logout?', message: '...', confirmText: 'Logout', icon: 'logout', danger: true,
//   });
//   if (!ok) return;
//
// danger: true = aksi berisiko (tombol merah, fokus awal di Batal supaya Enter tidak langsung
// menjalankannya). icon = nama data-icon di icons.css (nilai dari kode, bukan dari user).
//
// Overlay-nya terpisah dari openPopup() (sama seperti popup login ulang di auth.js), jadi
// popup lain yang sedang terbuka tidak ikut tertutup.
export function confirmDialog({ title, message = '', confirmText = 'OK', cancelText = 'Batal', icon = 'alert-triangle', danger = false }){
    const previousFocus = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
        <div class="dialog${danger ? ' dialog-danger' : ''}" role="alertdialog" aria-modal="true"
             aria-labelledby="dialog-title" aria-describedby="dialog-message">
            <span class="dialog-icon" data-icon="${icon}" aria-hidden="true"></span>
            <h3 id="dialog-title"></h3>
            <p id="dialog-message"></p>
            <div class="dialog-actions">
                <button type="button" class="dialog-cancel" data-icon="x"></button>
                <button type="button" class="dialog-confirm ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-icon="${icon}"></button>
            </div>
        </div>
    `;

    // Teks lewat textContent: judul/pesan bisa berisi data user (mis. username), jadi aman.
    overlay.querySelector('#dialog-title').textContent = title;
    overlay.querySelector('#dialog-message').textContent = message;

    const cancelButton = overlay.querySelector('.dialog-cancel');
    const confirmButton = overlay.querySelector('.dialog-confirm');
    cancelButton.textContent = cancelText;
    confirmButton.textContent = confirmText;

    document.body.appendChild(overlay);
    (danger ? cancelButton : confirmButton).focus();

    return new Promise(resolve => {
        const close = (result) => {
            overlay.remove();
            previousFocus?.focus?.(); // fokus kembali ke tombol yang membuka dialog
            resolve(result);
        };

        cancelButton.addEventListener('click', () => close(false));
        confirmButton.addEventListener('click', () => close(true));

        // Klik area gelap di luar kotak = batal.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        });

        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close(false);
            } else if (e.key === 'Tab') {
                // Fokus tetap berputar di dua tombol dialog, tidak lari ke halaman di belakangnya.
                e.preventDefault();
                (document.activeElement === cancelButton ? confirmButton : cancelButton).focus();
            }
        });
    });
}

// Popup pilihan berbentuk tabel (mis. pilih pallet): SELURUH BARIS bisa diklik,
// tidak perlu tombol "Pilih". Baris di template ditulis:
//     <tr class="pick-row" data-index="0" tabindex="0">...</tr>
// tabindex="0" = baris bisa difokus dengan Tab, lalu dipilih dengan Enter / Spasi.
// onPick(index) dipanggil dengan data-index baris yang dipilih.
export function onRowPick(box, onPick){
    box.addEventListener('click', (e) => {
        const row = e.target.closest('.pick-row');
        if (row) onPick(Number(row.dataset.index));
    });

    box.addEventListener('keydown', (e) => {
        const row = e.target.closest('.pick-row');
        if (row && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault(); // Spasi jangan menggulung popup
            onPick(Number(row.dataset.index));
        }
    });
}
