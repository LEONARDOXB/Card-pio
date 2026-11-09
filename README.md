# WebCardápio

Cardápio online com pedidos por mesa. O cliente escolhe o restaurante, monta o carrinho e envia o pedido para a mesa; o restaurante recebe no painel, acompanha o preparo, gerencia mesas e produtos.

Tudo em um só projeto: **frontend + API + banco de dados**.

| Parte | Tecnologia |
|---|---|
| Frontend | HTML, CSS e JavaScript puro (pasta `public/`) |
| API | Node.js + Express (pasta `src/`) |
| Banco | PostgreSQL (Neon, grátis) — ou embutido no seu computador, sem instalar nada |
| Hospedagem | Render (grátis) |

---

## 1. Rodar no seu computador

Precisa só do **Node.js 20 ou mais novo** (https://nodejs.org).

```bash
npm install
npm start
```

Abra **http://localhost:3000**. Não precisa instalar banco: os dados ficam na pasta `dados/`.
Para começar do zero, pare o servidor e apague a pasta `dados/`.

Contas de teste (criadas automaticamente):

| Tipo | E-mail | Senha |
|---|---|---|
| Cliente | cliente@teste.com | 123456 |
| Restaurante "Sabor da Casa" | demo@restaurante.com | 123456 |
| Restaurante "Pizzaria Massa Fina" | pizzaria@teste.com | 123456 |
| Restaurante "Lanchonete do Zé" | lanchonete@teste.com | 123456 |

Testes automáticos (testam a API inteira num banco temporário):

```bash
npm test
```

---

## 2. Publicar de graça (Neon + Render)

São 3 passos: subir para o GitHub, criar o banco no Neon e criar o site no Render.

### Passo 1 — GitHub
1. Crie uma conta em https://github.com e um repositório novo (pode ser privado).
2. Envie esta pasta para ele. Pelo site: **Add file → Upload files** e arraste tudo,
   **menos** as pastas `node_modules` e `dados` (se existirem).

### Passo 2 — Banco de dados no Neon
1. Crie uma conta em https://neon.tech (dá para entrar com o GitHub).
2. Crie um projeto (região mais próxima: **São Paulo**, se aparecer).
3. Na tela do projeto, clique em **Connect** e copie a **connection string**. Ela parece com:
   `postgresql://usuario:senha@ep-xxxx.sa-east-1.aws.neon.tech/neondb?sslmode=require`
4. Guarde essa URL. As tabelas são criadas sozinhas quando o servidor iniciar.

> Por que Neon e não o banco do Render? O PostgreSQL gratuito do Render expira depois de um tempo; o do Neon não.

### Passo 3 — Site no Render
1. Crie uma conta em https://render.com (entre com o GitHub).
2. Clique em **New + → Blueprint** e escolha o seu repositório. O Render lê o arquivo `render.yaml` sozinho.
3. Ele vai pedir o valor de **DATABASE_URL**: cole a URL do Neon.
4. Clique em **Apply / Deploy** e espere alguns minutos.
5. Pronto: o endereço fica tipo `https://webcardapio.onrender.com`.

Teste em `https://SEU-ENDERECO.onrender.com/api/saude`: deve mostrar `{"ok":true,"banco":"postgres",...}`.
Se aparecer `"banco":"pglite"`, a DATABASE_URL não foi configurada — os dados seriam perdidos. Corrija em **Environment**.

<details>
<summary>Prefere criar sem Blueprint (manual)?</summary>

**New + → Web Service** → escolha o repositório e preencha:
- Runtime: **Node**
- Build Command: `npm ci --omit=dev`
- Start Command: `npm start`
- Instance Type: **Free**
- Environment Variables:
  - `DATABASE_URL` = URL do Neon
  - `JWT_SECRET` = um texto longo e aleatório (gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
  - `NODE_ENV` = `production`
</details>

### Sobre o plano gratuito do Render
- O site **"dorme" depois de 15 minutos sem acesso**. O primeiro acesso depois disso demora cerca de 1 minuto (o site mostra "Conectando ao servidor, aguarde...").
- Para evitar isso, cadastre o endereço `https://SEU-ENDERECO.onrender.com/api/saude` num serviço gratuito de "ping" como https://cron-job.org, chamando a cada 10 minutos.
- Cada publicação nova (push no GitHub) atualiza o site sozinha.

### Depois de publicar
- Quando tiver restaurantes reais, defina `SEED=false` no Render e exclua as contas de demonstração pelo banco (ou deixe-as, se quiser uma demonstração).
- Nunca divulgue o `JWT_SECRET` nem a `DATABASE_URL`.

---

## 3. Estrutura

```
server.js              inicia o servidor
src/
  app.js               configuração do Express, segurança, rotas
  db.js                conexão com o banco (PostgreSQL ou embutido)
  schema.sql           tabelas
  seed.js              dados de demonstração
  auth.js              login (JWT) e senhas (bcrypt)
  util.js              validações e formatos
  rotas/
    clientes.js        cadastro, login, histórico do cliente
    restaurantes.js    cadastro, login, lista pública e cardápio
    pedidos.js         envio de pedidos
    painel.js          painel do restaurante (pedidos, mesas, produtos)
public/                frontend (HTML, CSS, JS, imagens)
test/api.test.js       testes automáticos
render.yaml            configuração do Render
.env.example           variáveis de ambiente explicadas
```

---

## 4. API

Base: `/api`. Respostas em JSON. Erros sempre vêm como `{ "erro": "mensagem para o usuário" }`.
Rotas com 🔒 precisam do cabeçalho `Authorization: Bearer <token>` (recebido no login/cadastro).

### Geral
| Método | Rota | Descrição |
|---|---|---|
| GET | `/saude` | Status do servidor e do banco |
| GET | `/imagens/:id` | Foto de produto enviada pelo painel |

### Cliente
| Método | Rota | Corpo / Descrição |
|---|---|---|
| POST | `/clientes/cadastro` | `{ nome, cpf, telefone, email, senha, confirmar }` → `{ token, cliente }` |
| POST | `/clientes/login` | `{ email, senha }` → `{ token, cliente }` |
| GET | `/clientes/eu` 🔒 | Dados do cliente logado |
| GET | `/clientes/pedidos` 🔒 | Últimos 50 pedidos do cliente, com status |
| POST | `/pedidos` 🔒 | `{ restauranteId, mesa, obs, itens: [{ pid, qtd }] }` → pedido criado |

O preço do pedido é sempre calculado pelo servidor com os valores do banco (não dá para alterar pelo navegador).

### Restaurantes (público)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/restaurantes?busca=texto` | Lista de restaurantes |
| GET | `/restaurantes/:id` | Um restaurante |
| GET | `/restaurantes/:id/produtos` | Cardápio (só produtos disponíveis) |
| POST | `/restaurantes/cadastro` | `{ nome, descricao, cnpj, telefone, endereco, mesas, email, senha, confirmar }` → `{ token, restaurante }` |
| POST | `/restaurantes/login` | `{ email, senha }` → `{ token, restaurante }` |

### Painel do restaurante 🔒 (token de restaurante)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/painel/restaurante` | Dados do restaurante |
| PUT | `/painel/restaurante` | `{ nome?, descricao?, telefone?, endereco? }` |
| GET | `/painel/pedidos` | Pedidos em aberto (`?todos=1&limite=100` para histórico) |
| PATCH | `/painel/pedidos/:id/status` | `{ status }` — avança: novo → preparando → pronto → entregue |
| POST | `/painel/mesas/adicionar` | Adiciona uma mesa |
| POST | `/painel/mesas/remover` | Remove a última mesa (se estiver livre) |
| POST | `/painel/mesas/:mesa/liberar` | Encerra os pedidos abertos da mesa |
| GET | `/painel/produtos` | Todos os produtos (inclusive indisponíveis) |
| POST | `/painel/produtos` | `{ nome, descricao, preco, categoria, imagem? }` (imagem em data URL, até 400 KB) |
| PUT | `/painel/produtos/:id` | Mesmo corpo; `removerImagem: true` tira a foto |
| PATCH | `/painel/produtos/:id/ativo` | `{ ativo: true/false }` |
| DELETE | `/painel/produtos/:id` | Exclui o produto (pedidos antigos continuam com o nome e preço da época) |

Categorias aceitas: `Comidas`, `Sobremesas`, `Bebidas`.

---

## 5. Segurança incluída
- Senhas guardadas com **bcrypt** (nunca em texto).
- Login com **JWT** válido por 7 dias.
- Cada restaurante só enxerga e altera os próprios pedidos e produtos.
- Limite de tentativas de login (contra robôs que testam senhas).
- Fotos conferidas pelo conteúdo do arquivo (só PNG, JPG, WEBP e GIF de verdade).
- Cabeçalhos de segurança (Helmet) e proteção contra HTML malicioso nos textos.
