-- WebCardápio — estrutura do banco (PostgreSQL).
-- Preços são guardados em centavos (inteiro) para não haver erro de arredondamento.

CREATE TABLE IF NOT EXISTS clientes (
    id          TEXT PRIMARY KEY,
    nome        TEXT NOT NULL,
    cpf         TEXT UNIQUE,
    telefone    TEXT,
    email       TEXT NOT NULL UNIQUE,
    senha_hash  TEXT NOT NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS restaurantes (
    id          TEXT PRIMARY KEY,
    nome        TEXT NOT NULL,
    descricao   TEXT NOT NULL DEFAULT '',
    cnpj        TEXT UNIQUE,
    telefone    TEXT,
    endereco    TEXT,
    mesas       INTEGER NOT NULL DEFAULT 1 CHECK (mesas BETWEEN 1 AND 500),
    email       TEXT NOT NULL UNIQUE,
    senha_hash  TEXT NOT NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Fotos enviadas pelo painel ficam no próprio banco: servidores gratuitos
-- apagam o disco a cada reinício, então salvar em pasta perderia as fotos.
CREATE TABLE IF NOT EXISTS imagens (
    id          TEXT PRIMARY KEY,
    mime        TEXT NOT NULL,
    dados       BYTEA NOT NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS produtos (
    id              TEXT PRIMARY KEY,
    restaurante_id  TEXT NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    nome            TEXT NOT NULL,
    descricao       TEXT NOT NULL DEFAULT '',
    preco_centavos  INTEGER NOT NULL CHECK (preco_centavos > 0),
    categoria       TEXT NOT NULL CHECK (categoria IN ('Comidas', 'Sobremesas', 'Bebidas')),
    imagem          TEXT,              -- caminho estático (img/x.png) ou /api/imagens/<id>
    imagem_id       TEXT REFERENCES imagens(id) ON DELETE SET NULL,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_produtos_restaurante ON produtos(restaurante_id);

CREATE TABLE IF NOT EXISTS pedidos (
    id              TEXT PRIMARY KEY,
    numero          INTEGER NOT NULL,
    restaurante_id  TEXT NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    cliente_id      TEXT REFERENCES clientes(id) ON DELETE SET NULL,
    cliente_nome    TEXT NOT NULL,
    mesa            INTEGER NOT NULL CHECK (mesa >= 1),
    obs             TEXT NOT NULL DEFAULT '',
    total_centavos  INTEGER NOT NULL CHECK (total_centavos >= 0),
    status          TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'preparando', 'pronto', 'entregue')),
    encerrado       BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (restaurante_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_pedidos_abertos ON pedidos(restaurante_id, encerrado);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);

-- Cada item guarda nome e preço do momento da compra:
-- se o restaurante mudar o preço ou excluir o produto, o pedido antigo não muda.
CREATE TABLE IF NOT EXISTS pedido_itens (
    id              BIGSERIAL PRIMARY KEY,
    pedido_id       TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    produto_id      TEXT REFERENCES produtos(id) ON DELETE SET NULL,
    nome            TEXT NOT NULL,
    preco_centavos  INTEGER NOT NULL,
    qtd             INTEGER NOT NULL CHECK (qtd BETWEEN 1 AND 99)
);
CREATE INDEX IF NOT EXISTS idx_itens_pedido ON pedido_itens(pedido_id);
