require('dotenv').config({ quiet: true });
const db = require('./src/db');
const seed = require('./src/seed');
const criarApp = require('./src/app');

const PORTA = Number(process.env.PORT || 3000);

(async () => {
    try {
        await db.conectar();
        console.log(`[db] Conectado (${db.tipo === 'postgres' ? 'PostgreSQL' : 'PostgreSQL embutido (PGlite)'}).`);
        if (db.tipo === 'pglite' && process.env.NODE_ENV === 'production') {
            console.warn('[ATENÇÃO] DATABASE_URL não configurada: usando banco embutido. Em servidores gratuitos '
                + 'o disco é apagado a cada reinício e TODOS OS DADOS SERÃO PERDIDOS. Configure o Neon (veja o README).');
        }
        await seed();
        const servidor = criarApp().listen(PORTA, () => {
            console.log(`[ok] WebCardápio rodando em http://localhost:${PORTA}`);
        });
        const desligar = async sinal => {
            console.log(`[${sinal}] Encerrando...`);
            servidor.close();
            await db.fechar().catch(() => {});
            process.exit(0);
        };
        process.on('SIGTERM', () => desligar('SIGTERM'));
        process.on('SIGINT', () => desligar('SIGINT'));
    } catch (e) {
        console.error('[falha] Não foi possível iniciar o servidor:', e);
        process.exit(1);
    }
})();
