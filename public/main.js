import { setContent } from "./utilities/tools.js";
import { inbound } from "./pages/Inbound.js";
import { bintobin } from "./pages/bintobin.js";

const app = document.getElementById('app');

function renderNavbar(){
    const nav = document.createElement('nav');
    nav.innerHTML = `
        <button class="nav-btn" data-page="dashboard">Dashboard</button><hr>
        <button class="nav-btn" data-page="inbound">Inbound</button>
        <button class="nav-btn" data-page="outbound">Outbound</button>
        <button class="nav-btn" data-page="bintobin">Bin to Bin</button>
        <button class="nav-btn" data-page="retur">Retur</button><hr>
        <button class="nav-btn" data-page="transactions">Histori Transaksi</button>
        <button class="nav-btn" data-page="stock">Stock Overview</button><hr>
        <button class="nav-btn" data-page="user">User</button>
    `;

    nav.querySelectorAll('.nav-btn').forEach(menu => {
        menu.addEventListener('click', (e) => {
            const page = e.target.getAttribute('data-page');
            navigateTo(page);
        })
    })

    return nav;
}

function initApp(){
    app.appendChild(renderNavbar());

    const contentArea = document.createElement('div');
    contentArea.id = 'content-area';
    app.appendChild(contentArea);

    const startPage = location.hash ? location.hash.slice(1) : 'dashboard';
    history.replaceState({ page: startPage }, '', '#' + startPage);
    renderPage(startPage);
}

// Dipanggil dari klik navbar -> ini yang mencatat entry baru ke history browser.
function navigateTo(page){
    history.pushState({ page }, '', '#' + page);
    renderPage(page);
}

// Benar-benar merender halaman, TIDAK menyentuh history sama sekali. Dipanggil dari
// navigateTo() (klik navbar) maupun dari event popstate (tombol back/forward) --
// dipisah supaya popstate tidak ikut mendorong history baru tiap kali user pencet back.
function renderPage(page){
    if(page === 'dashboard'){
        setContent(`<h1>INI HALAMAN dashboard</h1>`)
    } else if(page === 'inbound'){
        inbound();
    } else if(page === 'outbound'){
        setContent(`<h1>INI HALAMAN outbound</h1>`)
    } else if(page === 'bintobin'){
        bintobin();
    } else if(page === 'retur'){
        setContent(`<h1>INI HALAMAN retur</h1>`)
    } else if(page === 'transactions'){
        setContent(`<h1>INI HALAMAN histori transaksi</h1>`)
    } else if(page === 'stock'){
        setContent(`<h1>INI HALAMAN stock overview</h1>`)
    } else if(page === 'user'){
        setContent(`<h1>INI HALAMAN user</h1>`)
    } else {
        setContent(`<h1>Halaman tidak ditemukan</h1>`)
    }
}

// Tombol back/forward browser memicu ini -- render ulang sesuai state yang tersimpan
// di history-nya, TANPA pushState lagi (kalau ikut push, tombol back malah rusak).
window.addEventListener('popstate', (e) => {
    const page = e.state ? e.state.page : 'dashboard';
    renderPage(page);
});

initApp();