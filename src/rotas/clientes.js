const express = require('express');
const db = require('../db');
const { gerarToken, hashSenha, conferirSenha, exigir } = require('../auth');
const {
    novoId, falha, rota, texto, digitos, validarSenha, validarEmail, validarTelefone, fmtCpf, montarPedidos,
} = require('../util');

const r = express.Router();
const sessao = c => ({ token: gerarToken('cliente', c.id), cliente: { id: c.id, nome: c.nome, email: c.email } });

// POST /api/clientes/cadastro
r.post('/cadastro', rota(async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 120);
    if (nome.length < 3) falha(400, 'Informe seu nome completo.');
    const cpf = digitos(b.cpf);
    if (cpf.length !== 11) falha(400, 'O CPF precisa ter 11 números.');
    const telefone = validarTelefone(b.telefone);
    const email = validarEmail(b.email);
    validarSenha(b.senha, b.confirmar);

    if (await db.um('SELECT 1 FROM clientes WHERE email = $1', [email])) falha(409, 'Este e-mail já tem cadastro.');
    if (await db.um('SELECT 1 FROM clientes WHERE cpf = $1', [fmtCpf(cpf)])) falha(409, 'Este CPF já tem cadastro.');

    const c = { id: novoId(), nome, email };
    await db.query(
        `INSERT INTO clientes (id, nome, cpf, telefone, email, senha_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.id, nome, fmtCpf(cpf), telefone, email, await hashSenha(b.senha)],
    );
    res.status(201).json(sessao(c));
}));

// POST /api/clientes/login
r.post('/login', rota(async (req, res) => {
    const email = texto(req.body?.email, 160).toLowerCase();
    const c = email && await db.um('SELECT * FROM clientes WHERE email = $1', [email]);
    if (!c || !(await conferirSenha(req.body?.senha, c.senha_hash))) falha(401, 'E-mail ou senha incorretos.');
    res.json(sessao(c));
}));

// GET /api/clientes/eu
r.get('/eu', exigir('cliente'), rota(async (req, res) => {
    const c = req.cliente;
    res.json({ id: c.id, nome: c.nome, email: c.email, cpf: c.cpf, telefone: c.telefone });
}));

// GET /api/clientes/pedidos — histórico de pedidos do cliente logado (últimos 50)
r.get('/pedidos', exigir('cliente'), rota(async (req, res) => {
    const pedidos = await db.query(
        `SELECT p.*, r.nome AS restaurante_nome FROM pedidos p
         JOIN restaurantes r ON r.id = p.restaurante_id
         WHERE p.cliente_id = $1 ORDER BY p.criado_em DESC LIMIT 50`,
        [req.cliente.id],
    );
    res.json(await montarPedidos(db.query, pedidos));
}));

module.exports = r;
