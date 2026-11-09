const crypto = require('crypto');

const CATEGORIAS = ['Comidas', 'Sobremesas', 'Bebidas'];
const STATUS = ['novo', 'preparando', 'pronto', 'entregue'];
// Só é permitido avançar um passo de cada vez, como no painel.
const PROXIMO_STATUS = { novo: 'preparando', preparando: 'pronto', pronto: 'entregue' };

const novoId = () => crypto.randomUUID();

/** Erro com status HTTP e mensagem amigável que vai direto para o usuário. */
class ErroApi extends Error {
    constructor(status, mensagem) {
        super(mensagem);
        this.status = status;
    }
}
const falha = (status, mensagem) => {
    throw new ErroApi(status, mensagem);
};

/** Permite usar async nas rotas do Express 4 sem try/catch em cada uma. */
const rota = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const texto = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const digitos = v => String(v ?? '').replace(/\D/g, '');
const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 160;

/** Aceita 22,90 / 22.90 / "R$ 1.234,50" / 22.9 → centavos inteiros. */
function paraCentavos(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
    let s = String(v ?? '').replace(/[^\d.,]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const reais = c => Math.round(Number(c)) / 100;

function validarSenha(senha, confirmar) {
    if (typeof senha !== 'string' || senha.length < 6) falha(400, 'A senha precisa ter pelo menos 6 caracteres.');
    if (senha.length > 72) falha(400, 'A senha pode ter no máximo 72 caracteres.');
    if (confirmar !== undefined && senha !== confirmar) falha(400, 'As senhas não são iguais.');
}

function validarEmail(email) {
    const e = texto(email, 160).toLowerCase();
    if (!emailValido(e)) falha(400, 'Informe um e-mail válido.');
    return e;
}

function validarTelefone(tel) {
    const d = digitos(tel);
    if (d.length < 10 || d.length > 11) falha(400, 'Informe um telefone com DDD, como (63) 99999-9999.');
    return d;
}

// Formatos de exibição
const fmtCpf = d => d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
const fmtCnpj = d => d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

/* ---------- Conversão das linhas do banco para o formato que o frontend usa ---------- */

const jsonRestaurante = r => r && ({
    id: r.id,
    nome: r.nome,
    descricao: r.descricao,
    telefone: r.telefone,
    endereco: r.endereco,
    mesas: Number(r.mesas),
});

const jsonRestaurantePrivado = r => r && ({
    ...jsonRestaurante(r),
    cnpj: r.cnpj,
    email: r.email,
});

const jsonProduto = p => p && ({
    id: p.id,
    restauranteId: p.restaurante_id,
    nome: p.nome,
    descricao: p.descricao,
    preco: reais(p.preco_centavos),
    categoria: p.categoria,
    imagem: p.imagem || '',
    ativo: !!p.ativo,
});

const jsonPedido = (p, itens = []) => ({
    id: p.id,
    numero: Number(p.numero),
    restauranteId: p.restaurante_id,
    restauranteNome: p.restaurante_nome,
    cliente: p.cliente_nome,
    mesa: Number(p.mesa),
    itens: itens.map(i => ({
        pid: i.produto_id,
        nome: i.nome,
        preco: reais(i.preco_centavos),
        qtd: Number(i.qtd),
    })),
    obs: p.obs,
    total: reais(p.total_centavos),
    status: p.status,
    encerrado: !!p.encerrado,
    criadoEm: new Date(p.criado_em).getTime(),
});

/** Busca os itens de vários pedidos de uma vez e devolve os pedidos montados. */
async function montarPedidos(q, pedidos) {
    if (!pedidos.length) return [];
    const ids = pedidos.map(p => p.id);
    const itens = await q('SELECT * FROM pedido_itens WHERE pedido_id = ANY($1::text[]) ORDER BY id', [ids]);
    const por = {};
    for (const i of itens) (por[i.pedido_id] ||= []).push(i);
    return pedidos.map(p => jsonPedido(p, por[p.id] || []));
}

module.exports = {
    CATEGORIAS, STATUS, PROXIMO_STATUS,
    novoId, ErroApi, falha, rota, texto, digitos,
    paraCentavos, reais, validarSenha, validarEmail, validarTelefone, fmtCpf, fmtCnpj,
    jsonRestaurante, jsonRestaurantePrivado, jsonProduto, jsonPedido, montarPedidos,
};
