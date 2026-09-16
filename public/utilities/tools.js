// ini untuk menyimpan berbagai function yang mempermudah seperti setconcent dan lain-lain mendatang

export function setContent(html){
    const content = document.getElementById('content-area');
    content.innerHTML = html;
}
