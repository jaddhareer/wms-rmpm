// Autocomplete: kotak saran yang muncul di bawah sebuah <input> saat diketik.
//
// Kenapa tidak pakai <datalist>? Datalist hanya bisa memasukkan "value" yang sama
// dengan yang dicari, dan cara menyaringnya beda-beda per browser. Di sini user
// mengetik DESKRIPSI, tapi yang masuk ke input harus ITEM CODE. Itu tidak bisa
// diatur dengan datalist, jadi kotak sarannya dibuat sendiri.
//
// Pemakaian:
//   autocomplete(inputEl, {
//       search:     async (term) => [...],   // ambil daftar saran (mis. fetch ke server).
//                                            // Kembalikan null = jangan tampilkan apa-apa.
//       renderItem: (item) => '<b>..</b>',   // HTML satu baris saran (WAJIB pakai escapeHtml)
//       onSelect:   (item) => { ... },       // dipanggil saat saran dipilih (klik / Enter)
//   });
//
// Keyboard: panah atas/bawah memilih, Enter memakai saran yang disorot, Esc menutup.

export function autocomplete(input, { search, renderItem, onSelect, minLength = 2, delay = 250 }){
    // Bungkus input dengan <span position:relative>, supaya kotak saran
    // (position:absolute; top:100%) menempel tepat di bawah input.
    const wrapper = document.createElement('span');
    wrapper.style.cssText = 'position:relative; display:inline-block;';
    input.before(wrapper);
    wrapper.appendChild(input);

    const list = document.createElement('div');
    list.style.cssText = 'display:none; position:absolute; top:100%; left:0; z-index:100;'
        + ' width:max-content; min-width:100%; max-width:480px; max-height:260px; overflow-y:auto;'
        + ' background:#fff; border:1px solid #999; box-shadow:0 2px 6px rgba(0,0,0,.2);';
    wrapper.appendChild(list);

    input.setAttribute('autocomplete', 'off'); // matikan saran bawaan browser supaya tidak menumpuk

    let items = [];       // saran yang sedang tampil
    let active = -1;      // index saran yang disorot (keyboard / mouse)
    let timer = null;     // debounce: tunggu user berhenti mengetik
    let requestId = 0;    // penanda request terbaru, jawaban yang basi diabaikan

    function isOpen(){
        return list.style.display !== 'none';
    }

    function close(){
        list.style.display = 'none';
        list.innerHTML = '';
        items = [];
        active = -1;
    }

    // Batalkan pencarian yang masih ditunggu (debounce) atau sedang berjalan (fetch).
    function cancel(){
        clearTimeout(timer);
        requestId++;
    }

    function showMessage(text){
        items = [];
        active = -1;
        list.innerHTML = `<div style="padding:4px 8px; color:#777;">${text}</div>`;
        list.style.display = 'block';
    }

    function render(){
        list.innerHTML = items.map((item, index) => `
            <div data-index="${index}" style="padding:4px 8px; cursor:pointer; border-bottom:1px solid #eee;">
                ${renderItem(item)}
            </div>
        `).join('');
        list.style.display = 'block';
        highlight();
    }

    // Hanya ganti warna baris, TIDAK menggambar ulang list. Kalau list digambar
    // ulang saat mouse bergerak, elemen di bawah kursor berganti dan klik bisa hilang.
    function highlight(){
        list.querySelectorAll('[data-index]').forEach((row) => {
            row.style.background = Number(row.dataset.index) === active ? '#dbe8fb' : '';
        });
        list.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }

    function choose(index){
        const item = items[index];
        if (!item) return;

        cancel();   // pencarian yang masih jalan jangan sampai membuka list lagi
        close();
        onSelect(item);
    }

    async function run(term){
        const myRequest = ++requestId;

        try {
            const result = await search(term);

            // Sudah ada ketikan/pilihan baru, atau input sudah tidak fokus
            // (pindah field / pindah halaman) -> jawaban ini tidak dipakai.
            if (myRequest !== requestId || document.activeElement !== input) return;

            if (result === null) {
                close();
            } else if (result.length === 0) {
                showMessage('Tidak ada yang cocok');
            } else {
                items = result;
                active = -1;
                render();
            }
        } catch (err) {
            if (myRequest !== requestId || document.activeElement !== input) return;
            showMessage('Gagal memuat saran');
        }
    }

    input.addEventListener('input', () => {
        cancel();
        const term = input.value.trim();

        if (term.length < minLength) {
            close();
            return;
        }

        timer = setTimeout(() => run(term), delay);
    });

    input.addEventListener('keydown', (e) => {
        if (!isOpen()) return;

        if (e.key === 'Escape') {
            cancel();
            close();
            return;
        }
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault(); // jangan geser kursor teks
            active = (active + 1) % items.length;
            highlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            active = (active - 1 + items.length) % items.length;
            highlight();
        } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            choose(active);
        }
    });

    // Klik di luar (input kehilangan fokus) -> tutup.
    input.addEventListener('blur', () => {
        cancel();
        close();
    });

    // mousedown terjadi SEBELUM blur. Dicegah di sini supaya input tetap fokus,
    // kalau tidak, list sudah tertutup (oleh blur) sebelum klik sempat terjadi.
    list.addEventListener('mousedown', (e) => e.preventDefault());

    list.addEventListener('click', (e) => {
        const row = e.target.closest('[data-index]');
        if (row) choose(Number(row.dataset.index));
    });

    // Sorot baris yang ditunjuk mouse, tapi HANYA kalau mouse benar-benar digerakkan.
    // Kalau list baru muncul di bawah kursor yang diam, browser ikut mengirim event
    // mouse, dan sorotan akan "lompat" sendiri sehingga panah bawah mulai dari baris yang salah.
    let lastX = null;
    let lastY = null;
    list.addEventListener('mousemove', (e) => {
        if (e.clientX === lastX && e.clientY === lastY) return;
        lastX = e.clientX;
        lastY = e.clientY;

        const row = e.target.closest('[data-index]');
        if (!row || Number(row.dataset.index) === active) return;
        active = Number(row.dataset.index);
        highlight();
    });
}
