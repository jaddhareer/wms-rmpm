// Dropdown sederhana: tombol + panel yang muncul di bawahnya (mis. checklist filter Jenis).
//
// Markup yang diharapkan:
//   <div class="dropdown">
//       <button type="button" class="dropdown-toggle" aria-expanded="false">...</button>
//       <div class="dropdown-menu">...isi bebas (checkbox, dll.)...</div>
//   </div>
//
// Panel tertutup saat: tombolnya diklik lagi, klik di luar dropdown, atau tekan Esc.
// Klik DI DALAM panel (mis. mencentang checkbox) tidak menutupnya, jadi bisa pilih beberapa.
// Tampilan buka/tutup diatur kelas 'open' (lihat .dropdown di style.css).

let openRoot = null; // dropdown yang sedang terbuka (hanya satu)

// Pasang perilaku pada satu dropdown. Dipanggil setiap kali halaman menggambar dropdown-nya.
export function dropdown(root){
    root.querySelector('.dropdown-toggle').addEventListener('click', () => {
        if (openRoot === root) closeDropdown();
        else openDropdown(root);
    });
}

function openDropdown(root){
    closeDropdown();
    root.classList.add('open');
    root.querySelector('.dropdown-toggle').setAttribute('aria-expanded', 'true');
    openRoot = root;
}

export function closeDropdown(){
    if (!openRoot) return;
    openRoot.classList.remove('open');
    openRoot.querySelector('.dropdown-toggle').setAttribute('aria-expanded', 'false');
    openRoot = null;
}

// Listener di document dipasang SEKALI saat modul ini pertama di-import, bukan setiap
// halaman digambar ulang (kalau per render, listener-nya menumpuk setiap kali menu dibuka).
document.addEventListener('pointerdown', (e) => {
    if (openRoot && !openRoot.contains(e.target)) closeDropdown();
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openRoot) return;
    const toggle = openRoot.querySelector('.dropdown-toggle');
    closeDropdown();
    toggle.focus(); // fokus kembali ke tombolnya, supaya keyboard tidak "hilang"
});
