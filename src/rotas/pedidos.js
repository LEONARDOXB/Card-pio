const express = require('express');
const db = require('../db');
const { exigir } = require('../auth');
const { novoId, falha, rota, texto, montarPedidos } = require('../util');

const r = express.Router();

/*
 * POST /api/pedidos  (cliente logado)
 * Corpo: { restauranteId, mesa, obs, itens: [{ pid, qtd }] }
 * Nome e preço de cada item vêm do BANCO, nunca do navegador.
 */
r.post('/', exigir('cliente'), rota(async (req, res) => {
    const b = req.body || {};
    const restauranteId = texto(b.restauranteId, 60);
    const mesa = Math.trunc(Number(b.mesa));
    const obs = texto(b.obs, 300);

    if (!Array.isArray(b.itens) || !b.itens.length) falha(400, 'Seu carrinho está vazio.');
    if (b.itens.length > 50) falha(400, 'Pedido com itens demais.');

    // Junta itens repetidos e valida quantidades
    const qtdPor = new Map();
    for (const i of b.itens) {
        const pid = texto(i?.pid, 60);
        const qtd = Math.trunc(Number(i?.qtd));
        if (!pid || !Number.isFinite(qtd) || qtd < 1) falha(400, 'Há um item inválido no carrinho.');
        qtdPor.set(pid, (qtdPor.get(pid) || 0) + qtd);
    }
    for (const q of qtdPor.values()) if (q > 99) falha(400, 'A quantidade máxima por item é 99.');

    const pedido = await db.transacao(async tx => {
        // FOR UPDATE trava o restaurante durante a transação: dois pedidos ao mesmo
        // tempo não recebem o mesmo número.
        const rest = (await tx.query('SELECT * FROM restaurantes WHERE id = $1 FOR UPDATE', [restauranteId]))[0];
        if (!rest) falha(404, 'Restaurante não encontrado.');
        if (!Number.isFinite(mesa) || mesa < 1 || mesa > rest.mesas) falha(400, 'Escolha a sua mesa.');

        const ids = [...qtdPor.keys()];
        const prods = await tx.query(
            'SELECT * FROM produtos WHERE id = ANY($1::text[]) AND restaurante_id = $2',
            [ids, restauranteId],
        );
        const porId = new Map(prods.map(p => [p.id, p]));
        const itens = [];
        for (const [pid, qtd] of qtdPor) {
            const p = porId.get(pid);
            if (!p) falha(409, 'Um item do seu carrinho não existe mais no cardápio. Remova-o e tente de novo.');
            if (!p.ativo) falha(409, `"${p.nome}" está indisponível no momento. Remova-o do carrinho.`);
            itens.push({ p, qtd });
        }
        const total = itens.reduce((s, i) => s + i.p.preco_centavos * i.qtd, 0);
        const { prox } = (await tx.query(
            'SELECT COALESCE(MAX(numero), 0) + 1 AS prox FROM pedidos WHERE restaurante_id = $1',
            [restauranteId],
        ))[0];

        const id = novoId();
        const ped = (await tx.query(
            `INSERT INTO pedidos (id, numero, restaurante_id, cliente_id, cliente_nome, mesa, obs, total_centavos)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [id, prox, restauranteId, req.cliente.id, req.cliente.nome, mesa, obs, total],
        ))[0];
        for (const { p, qtd } of itens) {
            await tx.query(
                `INSERT INTO pedido_itens (pedido_id, produto_id, nome, preco_centavos, qtd) VALUES ($1, $2, $3, $4, $5)`,
                [id, p.id, p.nome, p.preco_centavos, qtd],
            );
        }
        ped.restaurante_nome = rest.nome;
        return (await montarPedidos(tx.query, [ped]))[0];
    });

    res.status(201).json(pedido);
}));

module.exports = r;
