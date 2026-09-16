import { setContent } from "./utilities/tools.js";

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

    navigateTo('dashboard');
}

function navigateTo(page){
    if(page === 'dashboard'){
        setContent(`
            <h1>INI HALAMAN dashboard</h1>
        `)
    } else if(page === 'inbound'){
        setContent(`
            <h1>INI HALAMAN inbound</h1>
        `)
    } else if(page === 'outbound'){
        setContent(`
            <h1>INI HALAMAN outbound</h1>
        `)
    } else if(page === 'bintobin'){
        setContent(`
            <h1>INI HALAMAN bin to bin</h1>
        `)
    } else if(page === 'retur'){
        setContent(`
            <h1>INI HALAMAN retur</h1>
        `)
    } else if(page === 'transactions'){
        setContent(`
            <h1>INI HALAMAN histori transaksi</h1>
        `)
    } else if(page === 'stock'){
        setContent(`
            <h1>INI HALAMAN stock overview</h1>
        `)
    } else if(page === 'user'){
        setContent(`
            <h1>INI HALAMAN user</h1>
        `)
    } else {

    }
}

initApp();