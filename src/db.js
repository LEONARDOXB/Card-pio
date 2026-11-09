/*
 * Banco de dados.
 *  - Com DATABASE_URL definida → PostgreSQL de verdade (Neon, Render, Supabase...).
 *  - Sem DATABASE_URL → PostgreSQL embutido (PGlite), gravado na pasta ./dados.
 *    Serve para rodar no seu computador sem instalar nada.
 * As duas opções usam o mesmo SQL, então o que funciona local funciona no servidor.
 */
const fs = require('fs');
const path = require('path');

let motor = null; // { query(sql, params) → rows, transacao(fn), fechar() }

async function conectar() {
    if (motor) return motor;

    if (process.env.DATABASE_URL) {
        const { Pool } = require('pg');
        // Remove sslmode/channel_binding da URL (Neon/Supabase colocam) para usar a configuração SSL abaixo.
        let url = process.env.DATABASE_URL.trim();
        try {
            const u = new URL(url);
            u.searchParams.delete('sslmode');
            u.searchParams.delete('channel_binding');
            url = u.toString();
        } catch { /* URL fora do padrão: usa como veio */ }
        const local = /localhost|127\.0\.0\.1/.test(url);
        const pool = new Pool({
            connectionString: url,
            ssl: local || process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
            max: Number(process.env.DB_POOL_MAX || 5),
            idleTimeoutMillis: 30000,
        });
        pool.on('error', err => console.error('[db] erro inesperado no pool:', err.message));
        motor = {
            tipo: 'postgres',
            async query(sql, params = []) {
                return (await pool.query(sql, params)).rows;
            },
            async transacao(fn) {
                const cliente = await pool.connect();
                try {
                    await cliente.query('BEGIN');
                    const r = await fn({ query: async (s, p = []) => (await cliente.query(s, p)).rows });
                    await cliente.query('COMMIT');
                    return r;
                } catch (e) {
                    await cliente.query('ROLLBACK').catch(() => {});
                    throw e;
                } finally {
                    cliente.release();
                }
            },
            fechar: () => pool.end(),
        };
    } else {
        const { PGlite } = require('@electric-sql/pglite');
        const pasta = process.env.PGLITE_DIR === 'memoria'
            ? undefined
            : path.resolve(process.env.PGLITE_DIR || path.join(__dirname, '..', 'dados'));
        if (pasta) fs.mkdirSync(pasta, { recursive: true });
        const pg = new PGlite(pasta);
        await pg.waitReady;
        // PGlite executa uma consulta por vez; esta fila evita que transações se misturem.
        let fila = Promise.resolve();
        const naFila = fn => {
            const p = fila.then(fn, fn);
            fila = p.catch(() => {});
            return p;
        };
        motor = {
            tipo: 'pglite',
            query: (sql, params = []) => naFila(async () => (await pg.query(sql, params)).rows),
            transacao: fn => naFila(() => pg.transaction(tx => fn({
                query: async (s, p = []) => (await tx.query(s, p)).rows,
            }))),
            fechar: () => pg.close(),
        };
    }

    // Cria as tabelas (é seguro rodar toda vez: usa IF NOT EXISTS).
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    for (const cmd of schema.split(/;\s*$/m).map(s => s.trim()).filter(Boolean)) {
        await motor.query(cmd);
    }
    return motor;
}

const db = {
    conectar,
    query: (sql, params) => motor.query(sql, params),
    um: async (sql, params) => (await motor.query(sql, params))[0] || null,
    transacao: fn => motor.transacao(fn),
    fechar: async () => {
        if (motor) await motor.fechar();
        motor = null;
    },
    get tipo() {
        return motor?.tipo;
    },
};

module.exports = db;
