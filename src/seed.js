/* Cria os dados de demonstração na primeira vez que o servidor sobe com o banco vazio.
   Para não criar, defina SEED=false nas variáveis de ambiente. */
const db = require('./db');
const { novoId } = require('./util');
const { hashSenha } = require('./auth');

async function seed() {
    if (process.env.SEED === 'false') return false;
    const { n } = await db.um('SELECT count(*)::int AS n FROM restaurantes');
    if (n > 0) return false;

    const senha = await hashSenha('123456');
    const restaurantes = [
        ['Sabor da Casa', 'Hambúrguer, pizza e sobremesas caseiras.', 'demo@restaurante.com'],
        ['Pizzaria Massa Fina', 'Pizzas de massa artesanal.', 'pizzaria@teste.com'],
        ['Lanchonete do Zé', 'Lanches e sucos naturais.', 'lanchonete@teste.com'],
    ].map(([nome, descricao, email]) => ({ id: novoId(), nome, descricao, email }));
    const [r1, r2, r3] = restaurantes.map(r => r.id);

    const produtos = [
        [r1, 'Hambúrguer Artesanal', 'Pão brioche, carne artesanal, queijo e molho especial.', 2290, 'Comidas', 'hamburguer'],
        [r1, 'Pizza Especial', 'Massa artesanal, mussarela e ingredientes especiais.', 4590, 'Comidas', 'pizza'],
        [r1, 'Torta de Morango', 'Torta cremosa com morangos frescos.', 1500, 'Sobremesas', 'torta'],
        [r1, 'Bolo de Chocolate', 'Bolo de chocolate com cobertura cremosa.', 1800, 'Sobremesas', 'bolo'],
        [r1, 'Refrigerante Lata', 'Lata 350 ml', 600, 'Bebidas', 'refri'],
        [r1, 'Refrigerante 2 Litros', 'Garrafa 2 litros', 1500, 'Bebidas', 'refri'],
        [r1, 'Suco de Laranja', 'Suco natural.', 1000, 'Bebidas', 'suco_laranja'],
        [r1, 'Suco de Morango', 'Suco natural.', 1200, 'Bebidas', 'suco_morango'],
        [r2, 'Pizza Especial', 'Mussarela e ingredientes especiais.', 4590, 'Comidas', 'pizza'],
        [r2, 'Pizza Mussarela', 'Mussarela e orégano.', 3990, 'Comidas', 'pizza'],
        [r2, 'Refrigerante 2 Litros', 'Garrafa 2 litros', 1500, 'Bebidas', 'refri'],
        [r3, 'Hambúrguer Artesanal', 'Pão brioche, carne e queijo.', 2000, 'Comidas', 'hamburguer'],
        [r3, 'Bolo de Chocolate', 'Com cobertura cremosa.', 1600, 'Sobremesas', 'bolo'],
        [r3, 'Suco de Laranja', 'Suco natural.', 900, 'Bebidas', 'suco_laranja'],
    ];

    await db.transacao(async tx => {
        for (const r of restaurantes) {
            await tx.query(
                `INSERT INTO restaurantes (id, nome, descricao, mesas, email, senha_hash)
                 VALUES ($1, $2, $3, 8, $4, $5)`,
                [r.id, r.nome, r.descricao, r.email, senha],
            );
        }
        for (const [rid, nome, descricao, centavos, categoria, img] of produtos) {
            await tx.query(
                `INSERT INTO produtos (id, restaurante_id, nome, descricao, preco_centavos, categoria, imagem)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [novoId(), rid, nome, descricao, centavos, categoria, `img/${img}.png`],
            );
        }
        await tx.query(
            `INSERT INTO clientes (id, nome, email, senha_hash) VALUES ($1, 'Cliente Teste', 'cliente@teste.com', $2)
             ON CONFLICT (email) DO NOTHING`,
            [novoId(), senha],
        );
    });
    console.log('[seed] Dados de demonstração criados (3 restaurantes, 14 produtos, 1 cliente).');
    return true;
}

module.exports = seed;
