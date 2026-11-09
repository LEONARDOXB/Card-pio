/* WebCardápio — funções compartilhadas e comunicação com a API.
   Os dados (contas, restaurantes, produtos, pedidos) ficam no servidor.
   No navegador ficam só a sessão (token), o restaurante escolhido e o carrinho. */

// Se um dia o frontend for hospedado em outro domínio, defina antes deste script:
// <script>window.WEBCARDAPIO_API = 'https://seu-backend.onrender.com';</script>
const BASE_API = (window.WEBCARDAPIO_API || '').replace(/\/$/, '');

const K = {
    sc: 'wc_sessao_cliente', sr: 'wc_sessao_restaurante', esc: 'wc_restaurante_escolhido', car: 'wc_carrinho', ultPed: 'wc_ultimo_pedido'
};

const CATEGORIAS = ['Comidas', 'Sobremesas', 'Bebidas'];
const STATUS = {
    novo: 'Novo', preparando: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue'
};

const ler = (k, p) => {
    try {
        return JSON.parse(localStorage.getItem(k)) ?? p;
    }
    catch {
        return p;
    }
};

const gravar = (k, v) => {
    try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
    }
    catch {
        return false;
    }
};

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const real = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
const preco = t => {
    let s = String(t).replace(/[^\d.,]/g, '');
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? NaN : Math.round(n * 100) / 100;
};

const urlImagem = i => (i && i.startsWith('/api/') ? BASE_API + i : i);
const foto = p => p.imagem ? `<img src="${esc(urlImagem(p.imagem))}" alt="${esc(p.nome)}" loading="lazy">` : `<div class="sem-foto">${esc(p.nome[0] || '?')}</div>`;

function avisar(msg, tipo = 'ok') {
    let e = document.getElementById('aviso');
    if (!e) {
        e = document.createElement('div');
        e.id = 'aviso';
        e.setAttribute('role', 'status');
        document.body.appendChild(e);
    }
    e.textContent = msg;
    e.className = 'aviso ' + tipo + ' visivel';
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => e.classList.remove('visivel'), 2600);
}

/**
 * Chama a API.
 *   api('/restaurantes')
 *   api('/pedidos', { metodo: 'POST', corpo: {...}, sessao: 'cliente' })
 * Lança Error com a mensagem pronta para mostrar ao usuário.
 */
async function api(caminho, { metodo = 'GET', corpo, sessao } = {}) {
    const chave = sessao === 'cliente' ? K.sc : sessao === 'restaurante' ? K.sr : null;
    const s = chave ? ler(chave, null) : null;
    const headers = {};
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (s?.token) headers.Authorization = 'Bearer ' + s.token;

    // Servidores gratuitos "dormem" e podem levar alguns segundos para acordar.
    const lento = setTimeout(() => avisar('Conectando ao servidor, aguarde...'), 3000);
    let resp;
    try {
        resp = await fetch(BASE_API + '/api' + caminho, {
            method: metodo, headers, body: corpo !== undefined ? JSON.stringify(corpo) : undefined
        });
    }
    catch {
        throw new Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
    }
    finally {
        clearTimeout(lento);
    }
    let dados = null;
    if (resp.status !== 204) {
        dados = await resp.json().catch(() => null);
    }
    if (resp.status === 401 && chave) {
        localStorage.removeItem(chave);
        if (!/login|cadastro/.test(location.pathname)) {
            location.href = sessao === 'cliente' ? 'login.html' : 'restaurante-login.html';
        }
    }
    if (!resp.ok) {
        throw new Error(dados?.erro || 'Algo deu errado. Tente novamente.');
    }
    return dados;
}

/** Envia um formulário de forma assíncrona, bloqueando o botão enquanto espera. */
function aoEnviar(f, fn) {
    f.addEventListener('submit', async e => {
        e.preventDefault();
        const botao = f.querySelector('[type="submit"]');
        const erro = document.getElementById('erro');
        if (botao.disabled) {
            return;
        }
        botao.disabled = true;
        erro.textContent = '';
        try {
            erro.textContent = (await fn(Object.fromEntries(new FormData(f)))) || '';
        }
        catch (ex) {
            erro.textContent = ex.message;
        }
        finally {
            botao.disabled = false;
        }
    });
}

/** Desabilita um botão enquanto uma ação assíncrona roda; mostra erros como aviso. */
async function ocupado(botao, fn) {
    if (botao) {
        if (botao.disabled) return;
        botao.disabled = true;
    }
    try {
        return await fn();
    }
    catch (e) {
        avisar(e.message, 'erro');
    }
    finally {
        if (botao && botao.isConnected) botao.disabled = false;
    }
}
