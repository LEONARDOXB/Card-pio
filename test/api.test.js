/* Testes de ponta a ponta da API. Rodar com: npm test
   Usa um banco em memória, então não mexe nos seus dados. */
process.env.PGLITE_DIR = 'memoria';
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.LIMITE_LOGIN = '1000';
if (!process.env.TESTAR_POSTGRES) delete process.env.DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const seed = require('../src/seed');
const criarApp = require('../src/app');

let servidor, URL_BASE;
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function api(caminho, { metodo = 'GET', corpo, token } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(URL_BASE + '/api' + caminho, {
        method: metodo, headers, body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : null, headers: r.headers };
}

before(async () => {
    await db.conectar();
    await seed();
    servidor = criarApp().listen(0);
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
    servidor.close();
    await db.fechar();
});

const ctx = {};

test('saúde e frontend', async () => {
    const r = await api('/saude');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.ok, true);
    const html = await fetch(URL_BASE + '/');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /WebCardápio/);
    const js = await fetch(URL_BASE + '/js/dados.js');
    assert.equal(js.status, 200);
    const img = await fetch(URL_BASE + '/img/pizza.png');
    assert.equal(img.status, 200);
});

test('seed: 3 restaurantes e cardápio do Sabor da Casa', async () => {
    const r = await api('/restaurantes');
    assert.equal(r.corpo.length, 3);
    assert.equal(r.corpo[0].nome, 'Sabor da Casa');
    assert.equal(r.corpo[0].senha_hash, undefined, 'não pode vazar senha');
    assert.equal(r.corpo[0].email, undefined, 'não pode vazar e-mail na lista pública');
    ctx.r1 = r.corpo[0];
    const p = await api(`/restaurantes/${ctx.r1.id}/produtos`);
    assert.equal(p.corpo.length, 8);
    assert.deepEqual([...new Set(p.corpo.map(x => x.categoria))], ['Comidas', 'Sobremesas', 'Bebidas']);
    assert.equal(p.corpo[0].preco, 22.9);
    ctx.produtos = p.corpo;
    const busca = await api('/restaurantes?busca=pizz');
    assert.deepEqual(busca.corpo.map(x => x.nome), ['Pizzaria Massa Fina']);
});

test('login cliente de teste e erro de senha', async () => {
    const ok = await api('/clientes/login', { metodo: 'POST', corpo: { email: 'CLIENTE@teste.com ', senha: '123456' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.corpo.token);
    const ruim = await api('/clientes/login', { metodo: 'POST', corpo: { email: 'cliente@teste.com', senha: 'errada' } });
    assert.equal(ruim.status, 401);
    assert.equal(ruim.corpo.erro, 'E-mail ou senha incorretos.');
});

test('cadastro de cliente com validações', async () => {
    const base = { nome: 'Maria Souza', cpf: '123.456.789-09', telefone: '(63) 99999-1234', email: 'maria@ex.com', senha: 'abcdef', confirmar: 'abcdef' };
    assert.equal((await api('/clientes/cadastro', { metodo: 'POST', corpo: { ...base, confirmar: 'x' } })).corpo.erro, 'As senhas não são iguais.');
    assert.equal((await api('/clientes/cadastro', { metodo: 'POST', corpo: { ...base, senha: '123', confirmar: '123' } })).status, 400);
    assert.equal((await api('/clientes/cadastro', { metodo: 'POST', corpo: { ...base, cpf: '123' } })).status, 400);
    const ok = await api('/clientes/cadastro', { metodo: 'POST', corpo: base });
    assert.equal(ok.status, 201);
    ctx.tokCli = ok.corpo.token;
    const dup = await api('/clientes/cadastro', { metodo: 'POST', corpo: base });
    assert.equal(dup.status, 409);
    assert.equal(dup.corpo.erro, 'Este e-mail já tem cadastro.');
    const dupCpf = await api('/clientes/cadastro', { metodo: 'POST', corpo: { ...base, email: 'outra@ex.com' } });
    assert.equal(dupCpf.corpo.erro, 'Este CPF já tem cadastro.');
    const eu = await api('/clientes/eu', { token: ctx.tokCli });
    assert.equal(eu.corpo.cpf, '123.456.789-09');
});

test('pedido: preço vem do banco, número sequencial, mesa validada', async () => {
    const [hamb, pizza] = ctx.produtos;
    const sem = await api('/pedidos', { metodo: 'POST', corpo: {} });
    assert.equal(sem.status, 401);
    const mesaRuim = await api('/pedidos', { metodo: 'POST', token: ctx.tokCli, corpo: { restauranteId: ctx.r1.id, mesa: 99, itens: [{ pid: hamb.id, qtd: 1 }] } });
    assert.equal(mesaRuim.corpo.erro, 'Escolha a sua mesa.');
    const p1 = await api('/pedidos', {
        metodo: 'POST', token: ctx.tokCli,
        corpo: { restauranteId: ctx.r1.id, mesa: 3, obs: 'sem cebola', itens: [{ pid: hamb.id, qtd: 2, preco: 0.01 }, { pid: pizza.id, qtd: 1 }] },
    });
    assert.equal(p1.status, 201);
    assert.equal(p1.corpo.numero, 1);
    assert.equal(p1.corpo.total, 91.7); // 2×22,90 + 45,90 — ignora o preço falso enviado
    assert.equal(p1.corpo.status, 'novo');
    assert.equal(p1.corpo.cliente, 'Maria Souza');
    ctx.p1 = p1.corpo;
    // Pedidos simultâneos não podem repetir número
    const varios = await Promise.all([1, 2, 3].map(m => api('/pedidos', {
        metodo: 'POST', token: ctx.tokCli, corpo: { restauranteId: ctx.r1.id, mesa: m, itens: [{ pid: hamb.id, qtd: 1 }] },
    })));
    assert.deepEqual(varios.map(v => v.corpo.numero).sort(), [2, 3, 4]);
    const meus = await api('/clientes/pedidos', { token: ctx.tokCli });
    assert.equal(meus.corpo.length, 4);
    assert.equal(meus.corpo.at(-1).restauranteNome, 'Sabor da Casa');
});

test('restaurante: cadastro, login e isolamento entre restaurantes', async () => {
    const novo = await api('/restaurantes/cadastro', {
        metodo: 'POST',
        corpo: { nome: 'Bar Novo', descricao: 'Petiscos', cnpj: '12.345.678/0001-95', telefone: '63 3411-0000', endereco: 'Rua A, 1', mesas: '4', email: 'bar@ex.com', senha: 'segura1', confirmar: 'segura1' },
    });
    assert.equal(novo.status, 201);
    assert.equal(novo.corpo.restaurante.mesas, 4);
    ctx.tokBar = novo.corpo.token;
    const demo = await api('/restaurantes/login', { metodo: 'POST', corpo: { email: 'demo@restaurante.com', senha: '123456' } });
    assert.equal(demo.status, 200);
    ctx.tokRest = demo.corpo.token;
    // Token de cliente não entra no painel
    assert.equal((await api('/painel/pedidos', { token: ctx.tokCli })).status, 403);
    // Bar Novo não vê nem altera pedidos do Sabor da Casa
    assert.equal((await api('/painel/pedidos', { token: ctx.tokBar })).corpo.length, 0);
    const invasao = await api(`/painel/pedidos/${ctx.p1.id}/status`, { metodo: 'PATCH', token: ctx.tokBar, corpo: { status: 'preparando' } });
    assert.equal(invasao.status, 404);
    const invasaoProd = await api(`/painel/produtos/${ctx.produtos[0].id}`, { metodo: 'DELETE', token: ctx.tokBar });
    assert.equal(invasaoProd.status, 404);
});

test('painel: fluxo de status, mesas e liberação', async () => {
    const t = ctx.tokRest;
    const abertos = await api('/painel/pedidos', { token: t });
    assert.equal(abertos.corpo.length, 4);
    const pular = await api(`/painel/pedidos/${ctx.p1.id}/status`, { metodo: 'PATCH', token: t, corpo: { status: 'entregue' } });
    assert.equal(pular.status, 409);
    for (const st of ['preparando', 'pronto', 'entregue']) {
        const r = await api(`/painel/pedidos/${ctx.p1.id}/status`, { metodo: 'PATCH', token: t, corpo: { status: st } });
        assert.equal(r.corpo.status, st);
    }
    // Remover mesa 8 (livre) funciona; mesa ocupada não pode ser removida
    assert.equal((await api('/painel/mesas/remover', { metodo: 'POST', token: t })).corpo.mesas, 7);
    assert.equal((await api('/painel/mesas/adicionar', { metodo: 'POST', token: t })).corpo.mesas, 8);
    const lib = await api('/painel/mesas/3/liberar', { metodo: 'POST', token: t });
    assert.equal(lib.corpo.pedidosEncerrados, 2);
    assert.equal((await api('/painel/pedidos', { token: t })).corpo.length, 2);
    assert.equal((await api('/painel/pedidos?todos=1', { token: t })).corpo.length, 4);
});

test('painel: produtos com foto, edição, disponibilidade e exclusão', async () => {
    const t = ctx.tokRest;
    assert.equal((await api('/painel/produtos', { metodo: 'POST', token: t, corpo: { nome: 'X', preco: 'abc', categoria: 'Comidas' } })).status, 400);
    assert.equal((await api('/painel/produtos', { metodo: 'POST', token: t, corpo: { nome: 'X', preco: '10', categoria: 'Outra' } })).status, 400);
    const falsa = await api('/painel/produtos', { metodo: 'POST', token: t, corpo: { nome: 'X', preco: '10', categoria: 'Comidas', imagem: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' } });
    assert.equal(falsa.status, 400, 'deve recusar arquivo que não é imagem de verdade');

    const novo = await api('/painel/produtos', { metodo: 'POST', token: t, corpo: { nome: 'Açaí', descricao: '500 ml', preco: '1.234,50', categoria: 'Sobremesas', imagem: PNG_1x1 } });
    assert.equal(novo.status, 201);
    assert.equal(novo.corpo.preco, 1234.5);
    assert.match(novo.corpo.imagem, /^\/api\/imagens\//);
    const img = await fetch(URL_BASE + novo.corpo.imagem);
    assert.equal(img.headers.get('content-type'), 'image/png');

    const edit = await api(`/painel/produtos/${novo.corpo.id}`, { metodo: 'PUT', token: t, corpo: { nome: 'Açaí G', descricao: '700 ml', preco: 19.9, categoria: 'Sobremesas' } });
    assert.equal(edit.corpo.nome, 'Açaí G');
    assert.equal(edit.corpo.imagem, novo.corpo.imagem, 'mantém a foto se não enviar outra');

    const off = await api(`/painel/produtos/${novo.corpo.id}/ativo`, { metodo: 'PATCH', token: t, corpo: { ativo: false } });
    assert.equal(off.corpo.ativo, false);
    const publico = await api(`/restaurantes/${ctx.r1.id}/produtos`);
    assert.ok(!publico.corpo.some(p => p.id === novo.corpo.id), 'indisponível some do cardápio');
    const pedidoIndisp = await api('/pedidos', { metodo: 'POST', token: ctx.tokCli, corpo: { restauranteId: ctx.r1.id, mesa: 1, itens: [{ pid: novo.corpo.id, qtd: 1 }] } });
    assert.equal(pedidoIndisp.status, 409);

    assert.equal((await api(`/painel/produtos/${novo.corpo.id}`, { metodo: 'DELETE', token: t })).status, 204);
    assert.equal((await fetch(URL_BASE + novo.corpo.imagem)).status, 404, 'foto apagada junto');

    // Excluir produto que já foi pedido não estraga o histórico
    const hamb = ctx.produtos[0];
    assert.equal((await api(`/painel/produtos/${hamb.id}`, { metodo: 'DELETE', token: t })).status, 204);
    const hist = await api('/painel/pedidos?todos=1', { token: t });
    assert.ok(hist.corpo.some(p => p.itens.some(i => i.nome === 'Hambúrguer Artesanal' && i.pid === null)));
});

test('erros gerais', async () => {
    assert.equal((await api('/nao-existe')).status, 404);
    assert.equal((await api('/painel/pedidos', { token: 'token-invalido' })).status, 401);
    const r = await fetch(URL_BASE + '/api/clientes/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{quebrado' });
    assert.equal(r.status, 400);
});
