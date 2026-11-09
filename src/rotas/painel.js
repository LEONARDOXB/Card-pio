/* Rotas do painel — todas exigem login de restaurante.
   Cada consulta filtra por restaurante_id: um restaurante nunca vê nem altera dados de outro. */
const express = require('express');
const db = require('../db');
const { exigir } = require('../auth');
const {
    novoId, falha, rota, texto, paraCentavos, validarTelefone,
    jsonRestaurantePrivado, jsonProduto, montarPedidos, CATEGORIAS, PROXIMO_STATUS,
} = require('../util');

const r = express.Router();
r.use(exigir('restaurante'));
const rid = req => req.restaurante.id;

/* ===================== Restaurante ===================== */

r.get('/restaurante', rota(async (req, res) => res.json(jsonRestaurantePrivado(req.restaurante))));

// PUT /api/painel/restaurante — altera nome, descrição, telefone, endereço
r.put('/restaurante', rota(async (req, res) => {
    const b = req.body || {}, a = req.restaurante;
    const nome = b.nome !== undefined ? texto(b.nome, 100) : a.nome;
    if (nome.length < 2) falha(400, 'Informe o nome do restaurante.');
    const descricao = b.descricao !== undefined ? texto(b.descricao, 300) : a.descricao;
    const telefone = b.telefone !== undefined ? validarTelefone(b.telefone) : a.telefone;
    const endereco = b.endereco !== undefined ? texto(b.endereco, 200) : a.endereco;
    const rows = await db.query(
        `UPDATE restaurantes SET nome = $2, descricao = $3, telefone = $4, endereco = $5 WHERE id = $1 RETURNING *`,
        [a.id, nome, descricao, telefone, endereco],
    );
    res.json(jsonRestaurantePrivado(rows[0]));
}));

/* ===================== Mesas ===================== */

// POST /api/painel/mesas/adicionar
r.post('/mesas/adicionar', rota(async (req, res) => {
    const rows = await db.query(
        'UPDATE restaurantes SET mesas = mesas + 1 WHERE id = $1 AND mesas < 500 RETURNING *',
        [rid(req)],
    );
    if (!rows[0]) falha(400, 'Limite de 500 mesas atingido.');
    res.json(jsonRestaurantePrivado(rows[0]));
}));

// POST /api/painel/mesas/remover — remove a última, se estiver livre
r.post('/mesas/remover', rota(async (req, res) => {
    const out = await db.transacao(async tx => {
        const rest = (await tx.query('SELECT * FROM restaurantes WHERE id = $1 FOR UPDATE', [rid(req)]))[0];
        if (rest.mesas <= 1) falha(400, 'O restaurante precisa ter pelo menos 1 mesa.');
        const ocupada = await tx.query(
            'SELECT 1 FROM pedidos WHERE restaurante_id = $1 AND mesa = $2 AND NOT encerrado LIMIT 1',
            [rest.id, rest.mesas],
        );
        if (ocupada.length) falha(409, `A mesa ${rest.mesas} está ocupada. Libere antes de remover.`);
        return (await tx.query('UPDATE restaurantes SET mesas = mesas - 1 WHERE id = $1 RETURNING *', [rest.id]))[0];
    });
    res.json(jsonRestaurantePrivado(out));
}));

// POST /api/painel/mesas/:mesa/liberar — encerra todos os pedidos abertos da mesa
r.post('/mesas/:mesa/liberar', rota(async (req, res) => {
    const mesa = Math.trunc(Number(req.params.mesa));
    if (!Number.isFinite(mesa) || mesa < 1) falha(400, 'Mesa inválida.');
    const rows = await db.query(
        `UPDATE pedidos SET encerrado = TRUE WHERE restaurante_id = $1 AND mesa = $2 AND NOT encerrado RETURNING id`,
        [rid(req), mesa],
    );
    res.json({ mesa, pedidosEncerrados: rows.length });
}));

/* ===================== Pedidos ===================== */

// GET /api/painel/pedidos — pedidos em aberto (não encerrados)
// GET /api/painel/pedidos?todos=1&limite=100 — histórico, inclusive encerrados
r.get('/pedidos', rota(async (req, res) => {
    const todos = req.query.todos === '1' || req.query.todos === 'true';
    const limite = Math.min(Math.max(Math.trunc(Number(req.query.limite)) || 100, 1), 500);
    const pedidos = todos
        ? await db.query('SELECT * FROM pedidos WHERE restaurante_id = $1 ORDER BY criado_em DESC LIMIT $2', [rid(req), limite])
        : await db.query('SELECT * FROM pedidos WHERE restaurante_id = $1 AND NOT encerrado ORDER BY criado_em', [rid(req)]);
    res.json(await montarPedidos(db.query, pedidos));
}));

// PATCH /api/painel/pedidos/:id/status  { status: 'preparando' | 'pronto' | 'entregue' }
r.patch('/pedidos/:id/status', rota(async (req, res) => {
    const novo = texto(req.body?.status, 20);
    const p = await db.um('SELECT * FROM pedidos WHERE id = $1 AND restaurante_id = $2', [req.params.id, rid(req)]);
    if (!p) falha(404, 'Pedido não encontrado.');
    if (p.encerrado) falha(409, 'Este pedido já foi encerrado.');
    if (PROXIMO_STATUS[p.status] !== novo) {
        // Se a tela estava desatualizada (outro aparelho já mudou), devolve o pedido atual.
        if (p.status === novo) return res.json((await montarPedidos(db.query, [p]))[0]);
        falha(409, 'Não é possível mudar o pedido para este status agora. Atualize a página.');
    }
    const rows = await db.query('UPDATE pedidos SET status = $2 WHERE id = $1 RETURNING *', [p.id, novo]);
    res.json((await montarPedidos(db.query, rows))[0]);
}));

/* ===================== Produtos ===================== */

const LIMITE_FOTO = 400 * 1024; // mesmo limite que o painel mostra

/** Lê uma imagem em data URL e confere pelos bytes se é mesmo PNG/JPEG/WEBP/GIF. */
function lerImagem(dataUrl) {
    const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl));
    if (!m) falha(400, 'Formato de foto inválido.');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > LIMITE_FOTO) falha(400, 'Foto grande demais. Use uma imagem de até 400 KB.');
    const h = buf.subarray(0, 12);
    let mime = null;
    if (h[0] === 0x89 && h.toString('ascii', 1, 4) === 'PNG') mime = 'image/png';
    else if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) mime = 'image/jpeg';
    else if (h.toString('ascii', 0, 4) === 'GIF8') mime = 'image/gif';
    else if (h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
    if (!mime) falha(400, 'Use uma foto em PNG, JPG, WEBP ou GIF.');
    return { mime, buf };
}

function lerProduto(b) {
    const nome = texto(b.nome, 100);
    if (!nome) falha(400, 'Informe o nome do produto.');
    const descricao = texto(b.descricao, 300);
    const preco = paraCentavos(b.preco);
    if (!Number.isFinite(preco) || preco <= 0) falha(400, 'Informe um preço válido, como 22,90.');
    if (preco > 10000000) falha(400, 'Preço alto demais.');
    const categoria = texto(b.categoria, 30);
    if (!CATEGORIAS.includes(categoria)) falha(400, 'Escolha uma categoria válida.');
    return { nome, descricao, preco, categoria };
}

async function salvarImagem(tx, dataUrl) {
    const { mime, buf } = lerImagem(dataUrl);
    const id = novoId();
    await tx.query('INSERT INTO imagens (id, mime, dados) VALUES ($1, $2, $3)', [id, mime, buf]);
    return id;
}

const meuProduto = async (q, id, req) =>
    (await q('SELECT * FROM produtos WHERE id = $1 AND restaurante_id = $2', [id, rid(req)]))[0];

// GET /api/painel/produtos — todos, inclusive indisponíveis
r.get('/produtos', rota(async (req, res) => {
    const rows = await db.query('SELECT * FROM produtos WHERE restaurante_id = $1 ORDER BY categoria, nome', [rid(req)]);
    res.json(rows.map(jsonProduto));
}));

// POST /api/painel/produtos  { nome, descricao, preco, categoria, imagem?: dataURL }
r.post('/produtos', rota(async (req, res) => {
    const d = lerProduto(req.body || {});
    const p = await db.transacao(async tx => {
        let imagemId = null, imagem = null;
        if (req.body.imagem) {
            imagemId = await salvarImagem(tx, req.body.imagem);
            imagem = `/api/imagens/${imagemId}`;
        }
        return (await tx.query(
            `INSERT INTO produtos (id, restaurante_id, nome, descricao, preco_centavos, categoria, imagem, imagem_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [novoId(), rid(req), d.nome, d.descricao, d.preco, d.categoria, imagem, imagemId],
        ))[0];
    });
    res.status(201).json(jsonProduto(p));
}));

// PUT /api/painel/produtos/:id  { nome, descricao, preco, categoria, imagem?: dataURL, removerImagem?: true }
r.put('/produtos/:id', rota(async (req, res) => {
    const d = lerProduto(req.body || {});
    const p = await db.transacao(async tx => {
        const atual = await meuProduto(tx.query, req.params.id, req);
        if (!atual) falha(404, 'Produto não encontrado.');
        let { imagem, imagem_id: imagemId } = atual;
        const antiga = imagemId;
        if (req.body.imagem) {
            imagemId = await salvarImagem(tx, req.body.imagem);
            imagem = `/api/imagens/${imagemId}`;
        } else if (req.body.removerImagem) {
            imagemId = null;
            imagem = null;
        }
        const out = (await tx.query(
            `UPDATE produtos SET nome = $2, descricao = $3, preco_centavos = $4, categoria = $5, imagem = $6, imagem_id = $7
             WHERE id = $1 RETURNING *`,
            [atual.id, d.nome, d.descricao, d.preco, d.categoria, imagem, imagemId],
        ))[0];
        if (antiga && antiga !== imagemId) await tx.query('DELETE FROM imagens WHERE id = $1', [antiga]);
        return out;
    });
    res.json(jsonProduto(p));
}));

// PATCH /api/painel/produtos/:id/ativo  { ativo: true|false }
r.patch('/produtos/:id/ativo', rota(async (req, res) => {
    const rows = await db.query(
        'UPDATE produtos SET ativo = $3 WHERE id = $1 AND restaurante_id = $2 RETURNING *',
        [req.params.id, rid(req), req.body?.ativo === true || req.body?.ativo === 'true'],
    );
    if (!rows[0]) falha(404, 'Produto não encontrado.');
    res.json(jsonProduto(rows[0]));
}));

// DELETE /api/painel/produtos/:id
r.delete('/produtos/:id', rota(async (req, res) => {
    await db.transacao(async tx => {
        const p = await meuProduto(tx.query, req.params.id, req);
        if (!p) falha(404, 'Produto não encontrado.');
        await tx.query('DELETE FROM produtos WHERE id = $1', [p.id]);
        if (p.imagem_id) await tx.query('DELETE FROM imagens WHERE id = $1', [p.imagem_id]);
    });
    res.status(204).end();
}));

module.exports = r;
