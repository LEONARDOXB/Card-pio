const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { falha } = require('./util');

const SEGREDO = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    console.warn('[aviso] JWT_SECRET não definido! Defina um valor longo e aleatório nas variáveis de ambiente.');
}
const VALIDADE = process.env.JWT_VALIDADE || '7d';

const gerarToken = (tipo, id) => jwt.sign({ tipo, sub: id }, SEGREDO, { expiresIn: VALIDADE });
const hashSenha = senha => bcrypt.hash(senha, 10);
const conferirSenha = (senha, hash) => bcrypt.compare(String(senha ?? ''), hash);

function lerToken(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Middleware que exige login.
 * tipo = 'cliente' → coloca req.cliente
 * tipo = 'restaurante' → coloca req.restaurante
 */
function exigir(tipo) {
    const tabela = tipo === 'cliente' ? 'clientes' : 'restaurantes';
    return async (req, res, next) => {
        try {
            const token = lerToken(req);
            if (!token) falha(401, 'Faça login para continuar.');
            let dados;
            try {
                dados = jwt.verify(token, SEGREDO);
            } catch {
                falha(401, 'Sua sessão expirou. Entre novamente.');
            }
            if (dados.tipo !== tipo) falha(403, 'Acesso não permitido para este tipo de conta.');
            const conta = await db.um(`SELECT * FROM ${tabela} WHERE id = $1`, [dados.sub]);
            if (!conta) falha(401, 'Conta não encontrada. Entre novamente.');
            req[tipo] = conta;
            next();
        } catch (e) {
            next(e);
        }
    };
}

module.exports = { gerarToken, hashSenha, conferirSenha, exigir };
