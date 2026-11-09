const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { ErroApi, rota, falha } = require('./util');

function criarApp() {
    const app = express();
    app.set('trust proxy', 1); // Render/Koyeb ficam atrás de proxy: necessário para IP real
    app.disable('x-powered-by');

    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'script-src': ["'self'", "'unsafe-inline'"],   // o HTML usa onclick="..."
                'script-src-attr': ["'unsafe-inline'"],
                'img-src': ["'self'", 'data:', 'blob:'],
                'upgrade-insecure-requests': null, // permite testar pelo IP da rede local (http)
            },
        },
    }));
    app.use(compression());

    // CORS — só é necessário se o frontend for hospedado em OUTRO domínio.
    const origens = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (origens.length) {
        app.use((req, res, next) => {
            const o = req.headers.origin;
            if (o && (origens.includes('*') || origens.includes(o))) {
                res.setHeader('Access-Control-Allow-Origin', o);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            }
            if (req.method === 'OPTIONS') return res.status(204).end();
            next();
        });
    }

    const api = express.Router();
    api.use(express.json({ limit: '1mb' })); // fotos de até 400 KB em base64 cabem com folga
    api.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    // Limite de tentativas de login/cadastro (protege contra robôs que testam senhas)
    const limiteLogin = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: Number(process.env.LIMITE_LOGIN || 30),
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
    });
    api.use(['/clientes/login', '/clientes/cadastro', '/restaurantes/login', '/restaurantes/cadastro'], limiteLogin);
    api.use(rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.LIMITE_API || 300), standardHeaders: 'draft-7', legacyHeaders: false,
        message: { erro: 'Muitas requisições. Aguarde um momento.' } }));

    api.get('/saude', rota(async (req, res) => {
        await db.query('SELECT 1');
        res.json({ ok: true, banco: db.tipo, hora: new Date().toISOString() });
    }));

    // Fotos dos produtos (o id muda a cada foto nova, então pode ficar em cache para sempre)
    api.get('/imagens/:id', rota(async (req, res) => {
        const img = await db.um('SELECT mime, dados FROM imagens WHERE id = $1', [req.params.id]);
        if (!img) falha(404, 'Imagem não encontrada.');
        res.setHeader('Content-Type', img.mime);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(Buffer.from(img.dados));
    }));

    api.use('/clientes', require('./rotas/clientes'));
    api.use('/restaurantes', require('./rotas/restaurantes'));
    api.use('/pedidos', require('./rotas/pedidos'));
    api.use('/painel', require('./rotas/painel'));

    api.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
    // eslint-disable-next-line no-unused-vars
    api.use((err, req, res, next) => {
        if (err instanceof ErroApi) return res.status(err.status).json({ erro: err.message });
        if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo grande demais.' });
        if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados enviados em formato inválido.' });
        if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um cadastro com esses dados.' });
        console.error('[erro]', req.method, req.originalUrl, err);
        res.status(500).json({ erro: 'Erro no servidor. Tente novamente em instantes.' });
    });

    app.use('/api', api);

    // Frontend (HTML, CSS, JS e imagens)
    const pub = path.join(__dirname, '..', 'public');
    app.use(express.static(pub, {
        extensions: ['html'],
        setHeaders(res, arquivo) {
            if (/\.(png|jpe?g|webp|gif|svg)$/.test(arquivo)) res.setHeader('Cache-Control', 'public, max-age=604800');
            else res.setHeader('Cache-Control', 'no-cache'); // HTML/CSS/JS sempre atualizados após publicar
        },
    }));
    app.use((req, res) => res.status(404).sendFile(path.join(pub, 'index.html')));

    return app;
}

module.exports = criarApp;
