const express = require('express');
const db = require('../db');
const { gerarToken, hashSenha, conferirSenha } = require('../auth');
const {
    novoId, falha, rota, texto, digitos, validarSenha, validarEmail, validarTelefone, fmtCnpj,
    jsonRestaurante, jsonRestaurantePrivado, jsonProduto, CATEGORIAS,
} = require('../util');

const r = express.Router();
const sessao = x => ({ token: gerarToken('restaurante', x.id), restaurante: jsonRestaurantePrivado(x) });

// POST /api/restaurantes/cadastro
r.post('/cadastro', rota(async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 100);
    if (nome.length < 2) falha(400, 'Informe o nome do restaurante.');
    const descricao = texto(b.descricao, 300);
    const cnpj = digitos(b.cnpj);
    if (cnpj.length !== 14) falha(400, 'O CNPJ precisa ter 14 números.');
    const telefone = validarTelefone(b.telefone);
    const endereco = texto(b.endereco, 200);
    if (endereco.length < 3) falha(400, 'Informe o endereço.');
    const mesas = Math.trunc(Number(b.mesas));
    if (!Number.isFinite(mesas) || mesas < 1 || mesas > 500) falha(400, 'O número de mesas deve ser entre 1 e 500.');
    const email = validarEmail(b.email);
    validarSenha(b.senha, b.confirmar);

    if (await db.um('SELECT 1 FROM restaurantes WHERE email = $1', [email])) falha(409, 'Este e-mail já tem cadastro.');
    if (await db.um('SELECT 1 FROM restaurantes WHERE cnpj = $1', [fmtCnpj(cnpj)])) falha(409, 'Este CNPJ já tem cadastro.');

    const rows = await db.query(
        `INSERT INTO restaurantes (id, nome, descricao, cnpj, telefone, endereco, mesas, email, senha_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [novoId(), nome, descricao, fmtCnpj(cnpj), telefone, endereco, mesas, email, await hashSenha(b.senha)],
    );
    res.status(201).json(sessao(rows[0]));
}));

// POST /api/restaurantes/login
r.post('/login', rota(async (req, res) => {
    const email = texto(req.body?.email, 160).toLowerCase();
    const x = email && await db.um('SELECT * FROM restaurantes WHERE email = $1', [email]);
    if (!x || !(await conferirSenha(req.body?.senha, x.senha_hash))) falha(401, 'E-mail ou senha incorretos.');
    res.json(sessao(x));
}));

// GET /api/restaurantes?busca=pizza — lista pública
r.get('/', rota(async (req, res) => {
    const busca = texto(req.query.busca, 100);
    const rows = busca
        ? await db.query(`SELECT * FROM restaurantes WHERE nome ILIKE $1 ORDER BY criado_em, nome`, [`%${busca.replace(/[%_\\]/g, '\\$&')}%`])
        : await db.query(`SELECT * FROM restaurantes ORDER BY criado_em, nome`);
    res.json(rows.map(jsonRestaurante));
}));

// GET /api/restaurantes/:id
r.get('/:id', rota(async (req, res) => {
    const x = await db.um('SELECT * FROM restaurantes WHERE id = $1', [req.params.id]);
    if (!x) falha(404, 'Restaurante não encontrado.');
    res.json(jsonRestaurante(x));
}));

// GET /api/restaurantes/:id/produtos — só os disponíveis, na ordem das categorias
r.get('/:id/produtos', rota(async (req, res) => {
    const x = await db.um('SELECT 1 FROM restaurantes WHERE id = $1', [req.params.id]);
    if (!x) falha(404, 'Restaurante não encontrado.');
    const rows = await db.query(
        `SELECT * FROM produtos WHERE restaurante_id = $1 AND ativo ORDER BY criado_em, nome`,
        [req.params.id],
    );
    rows.sort((a, b) => CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria));
    res.json(rows.map(jsonProduto));
}));

module.exports = r;
