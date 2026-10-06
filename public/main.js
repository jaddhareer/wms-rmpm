import { setContent } from "./utilities/tools.js";
import { initRouter, navigateTo } from "./utilities/router.js";
import { dashboard } from "./pages/dashboard.js";
import { inbound } from "./pages/Inbound.js";
import { bintobin } from "./pages/bintobin.js";
import { outbound } from "./pages/outbound.js";
import { retur } from "./pages/retur.js";
import { transactions } from "./pages/transactions.js";
import { stock } from "./pages/stock.js";

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
            navigateTo(e.target.getAttribute('data-page'));
        })
    })

    return nav;
}

// Menggambar halaman. Dipanggil oleh router (klik menu, back/forward, refresh).
// params = parameter dari URL, mis. { code: 'RMPMOB26090007' } untuk #retur?code=...
function renderPage(page, params = {}){
    if(page === 'dashboard'){
        dashboard();
    } else if(page === 'inbound'){
        inbound();
    } else if(page === 'outbound'){
        outbound();
    } else if(page === 'bintobin'){
        bintobin();
    } else if(page === 'retur'){
        retur(params);
    } else if(page === 'transactions'){
        transactions();
    } else if(page === 'stock'){
        stock();
    } else if(page === 'user'){
        setContent(`<h1>INI HALAMAN user</h1>`)
    } else {
        setContent(`<h1>Halaman tidak ditemukan</h1>`)
    }
}

function initApp(){
    app.appendChild(renderNavbar());

    const contentArea = document.createElement('div');
    contentArea.id = 'content-area';
    app.appendChild(contentArea);

    initRouter(renderPage);
}

initApp();
