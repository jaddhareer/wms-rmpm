// Popup sederhana yang bisa dipakai semua halaman.

// Buka popup berisi html. Mengembalikan elemen kotak popup-nya,
// supaya pemanggil bisa memasang event listener di situ (event delegation).
export function openPopup(html){
    closePopup(); // pastikan hanya ada satu popup

    const overlay = document.createElement('div');
    overlay.id = 'popup-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; z-index:1000;';

    const box = document.createElement('div');
    box.id = 'popup-box';
    box.style.cssText = 'background:#fff; padding:16px; max-width:90vw; max-height:80vh; overflow:auto;';
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