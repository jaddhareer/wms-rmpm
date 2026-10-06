// Router SPA: pindah halaman + mencatat history browser.
//
// Dipisah dari main.js supaya HALAMAN juga bisa memanggil navigateTo().
// Kalau navigateTo tetap di main.js, halaman harus meng-import main.js, padahal
// main.js sendiri meng-import halaman itu (import melingkar). Modul ini tidak
// meng-import halaman mana pun, jadi aman di-import dari mana saja.
//
// Parameter halaman ikut di URL: #retur?code=RMPMOB26090007
// -> tetap ada saat di-refresh, dan tombol back/forward ikut membawanya.

let renderPage = null;

// Dipanggil SEKALI dari main.js. render(page, params) = fungsi yang menggambar halaman.
export function initRouter(render){
    renderPage = render;

    // Tombol back/forward: gambar ulang sesuai entry history, TANPA pushState lagi.
    window.addEventListener('popstate', (e) => {
        const { page, params } = e.state ?? readHash();
        renderPage(page, params);
    });

    // Halaman awal diambil dari URL (berguna saat refresh).
    const { page, params } = readHash();
    history.replaceState({ page, params }, '', toHash(page, params));
    renderPage(page, params);
}

// Pindah halaman, mis. navigateTo('retur', { code: 'RMPMOB26090007' }).
export function navigateTo(page, params = {}){
    history.pushState({ page, params }, '', toHash(page, params));
    renderPage(page, params);
}

function toHash(page, params){
    const query = new URLSearchParams(params).toString();
    return '#' + page + (query ? '?' + query : '');
}

function readHash(){
    const [page, query] = location.hash.slice(1).split('?');
    return {
        page: page || 'dashboard',
        params: Object.fromEntries(new URLSearchParams(query || '')),
    };
}

// Perbarui parameter halaman yang SEDANG tampil tanpa menambah entry history
// (mis. operator memuat dokumen lain di menu Retur -> URL ikut, refresh tetap benar).
export function replaceParams(page, params = {}){
    history.replaceState({ page, params }, '', toHash(page, params));
}
