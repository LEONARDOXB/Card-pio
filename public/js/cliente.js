const car = () => ler(K.car, { rid: null, itens: [] });
const qtdCar = () => car().itens.reduce((a, i) => a + i.qtd, 0);

function exigir() {
    const s = ler(K.sc, null);
    if (!s?.token) {
        location.href = 'login.html';
        return null;
    }
    return s;
}

/** Busca no servidor o restaurante escolhido; volta para a lista se não existir mais. */
async function escolhido() {
    const id = ler(K.esc, null);
    if (!id) {
        return null;
    }
    try {
        return await api('/restaurantes/' + encodeURIComponent(id));
    }
    catch {
        localStorage.removeItem(K.esc);
        return null;
    }
}

const entrar = r => {
    gravar(K.sc, { token: r.token, id: r.cliente.id, nome: r.cliente.nome });
    location.href = 'restaurantes.html';
};

const paginas = {
    login(f) {
        if (ler(K.sc, null)?.token) {
            location.href = 'restaurantes.html';
            return;
        }
        aoEnviar(f, async d => {
            entrar(await api('/clientes/login', { metodo: 'POST', corpo: { email: d.email, senha: d.senha } }));
        });
    },
    cadastro(f) {
        aoEnviar(f, async d => {
            if (d.senha.length < 6) {
                return 'A senha precisa ter pelo menos 6 caracteres.';
            }
            if (d.senha !== d.confirmar) {
                return 'As senhas não são iguais.';
            }
            entrar(await api('/clientes/cadastro', { metodo: 'POST', corpo: d }));
        });
    },
    async restaurantes() {
        const s = exigir();
        if (!s) {
            return;
        }
        document.getElementById('saudacao').textContent = `Olá, ${s.nome.split(' ')[0]}! Em qual restaurante você vai pedir?`;
        document.getElementById('sair').onclick = () => {
            localStorage.removeItem(K.sc);
            location.href = 'login.html';
        };
        const lista = document.getElementById('lista'), busca = document.getElementById('busca');
        lista.innerHTML = '<p class="vazio">Carregando restaurantes...</p>';
        let todos = [];
        try {
            todos = await api('/restaurantes');
        }
        catch (e) {
            lista.innerHTML = `<p class="vazio">${esc(e.message)}</p>`;
            return;
        }
        const desenhar = () => {
            const q = busca.value.trim().toLowerCase();
            const l = todos.filter(r => r.nome.toLowerCase().includes(q));
            lista.innerHTML = l.map(r => `<article class="cartao-rest">
                <div class="inicial">${esc(r.nome[0])}</div>
                <h3>${esc(r.nome)}</h3>
                <p>${esc(r.descricao || '')}</p>
                <button data-r="${esc(r.id)}">Ver cardápio</button>
                </article>`).join('') || '<p class="vazio">Nenhum restaurante encontrado.</p>';
        };
        busca.addEventListener('input', desenhar);
        desenhar();
        lista.addEventListener('click', e => {
            const r = e.target.dataset.r;
            if (!r) {
                return;
            }
            const c = car();
            if (c.rid && c.rid !== r && c.itens.length && !confirm('Seu carrinho tem itens de outro restaurante. Esvaziar e continuar?')) {
                return;
            }
            if (c.rid !== r) {
                gravar(K.car, { rid: r, itens: [] });
            }
            gravar(K.esc, r);
            location.href = 'cardapio.html';
        });
    },
    async cardapio() {
        if (!exigir()) {
            return;
        }
        const secoes = document.getElementById('secoes');
        secoes.innerHTML = '<p class="vazio">Carregando cardápio...</p>';
        const r = await escolhido();
        if (!r) {
            location.href = 'restaurantes.html';
            return;
        }
        document.getElementById('nomeRest').textContent = r.nome;
        document.getElementById('descRest').textContent = r.descricao || '';
        let ps = [];
        try {
            ps = await api(`/restaurantes/${encodeURIComponent(r.id)}/produtos`);
        }
        catch (e) {
            secoes.innerHTML = `<p class="vazio">${esc(e.message)}</p>`;
            return;
        }
        const cats = CATEGORIAS.filter(c => ps.some(p => p.categoria === c));
        secoes.innerHTML = cats.map(c => `<section id="cat-${c}">
            <h2>${c}</h2>
            <div class="container-produtos">${ps.filter(p => p.categoria === c).map(p => `<div class="produto">${foto(p)}<h3>${esc(p.nome)}</h3>
            <p>${esc(p.descricao)}</p>
            <span>${real(p.preco)}</span>
            <button data-p="${esc(p.id)}">Adicionar</button>
            </div>`).join('')}</div>
            </section>`).join('') || '<p class="vazio">Este restaurante ainda não cadastrou produtos.</p>';
        const nav = () => {
            document.getElementById('nav').innerHTML = cats.map(c => `<button data-ir="${c}">${c}</button>`).join('') + `<button onclick="location.href='carrinho.html'">Carrinho (${qtdCar()})</button>`;
        };
        nav();
        document.addEventListener('click', e => {
            const ir = e.target.dataset.ir, pid = e.target.dataset.p;
            if (ir) {
                document.getElementById('cat-' + ir).scrollIntoView({ behavior: 'smooth' });
            }
            if (pid) {
                const p = ps.find(x => x.id === pid);
                let c = car();
                if (c.rid !== r.id) {
                    c = { rid: r.id, itens: [] };
                }
                const i = c.itens.find(x => x.pid === pid);
                if (i) {
                    if (i.qtd >= 99) {
                        return avisar('Quantidade máxima por item é 99.', 'erro');
                    }
                    i.qtd++;
                }
                else {
                    c.itens.push({ pid, nome: p.nome, preco: p.preco, qtd: 1 });
                }
                gravar(K.car, c);
                nav();
                avisar(p.nome + ' adicionado ao carrinho.');
            }
        });
    },
    async carrinho() {
        const s = exigir();
        if (!s) {
            return;
        }
        const r = await escolhido();
        if (!r) {
            location.href = 'restaurantes.html';
            return;
        }
        const mesa = document.getElementById('mesa');
        mesa.innerHTML = '<option value="">Selecione sua mesa</option>' + Array.from({ length: r.mesas }, (_, i) => `<option value="${i + 1}">Mesa ${i + 1}</option>`).join('');
        const total = () => car().itens.reduce((a, i) => a + i.preco * i.qtd, 0);
        const desenhar = () => {
            const c = car();
            document.getElementById('listaCarrinho').innerHTML = c.itens.map((i, n) => `<div class="item-carrinho">
                <div class="item-info">
                <h3>${esc(i.nome)}</h3>
                <p>${real(i.preco)} cada</p>
                </div>
                <div class="quantidade">
                <button data-n="${n}" data-d="-1" aria-label="Diminuir">−</button>
                <strong>${i.qtd}</strong>
                <button data-n="${n}" data-d="1" aria-label="Aumentar">+</button>
                </div>
                </div>`).join('') || '<p class="vazio">Seu carrinho está vazio.</p>';
            document.getElementById('total').textContent = 'Total: ' + real(total());
        };

        // Atualiza o carrinho com os preços atuais do servidor e tira itens indisponíveis.
        const sincronizar = async () => {
            const c = car();
            if (c.rid !== r.id || !c.itens.length) {
                return;
            }
            try {
                const ps = await api(`/restaurantes/${encodeURIComponent(r.id)}/produtos`);
                const porId = new Map(ps.map(p => [p.id, p]));
                const antes = c.itens.length;
                let mudouPreco = false;
                c.itens = c.itens.filter(i => porId.has(i.pid)).map(i => {
                    const p = porId.get(i.pid);
                    if (p.preco !== i.preco) mudouPreco = true;
                    return { ...i, nome: p.nome, preco: p.preco };
                });
                gravar(K.car, c);
                if (c.itens.length < antes) {
                    avisar('Alguns itens não estão mais disponíveis e foram retirados.', 'erro');
                }
                else if (mudouPreco) {
                    avisar('Alguns preços foram atualizados pelo restaurante.');
                }
            }
            catch { /* sem conexão: mantém o carrinho como está */ }
        };

        desenhar();
        await sincronizar();
        desenhar();

        document.getElementById('listaCarrinho').addEventListener('click', e => {
            const n = e.target.dataset.n;
            if (n == null) {
                return;
            }
            const c = car();
            c.itens[n].qtd = Math.min(99, c.itens[n].qtd + +e.target.dataset.d);
            if (c.itens[n].qtd < 1) {
                c.itens.splice(n, 1);
            }
            gravar(K.car, c);
            desenhar();
        });
        document.getElementById('limpar').onclick = () => {
            gravar(K.car, { rid: r.id, itens: [] });
            desenhar();
        };
        const botao = document.getElementById('finalizar');
        botao.onclick = () => ocupado(botao, async () => {
            const c = car();
            if (!c.itens.length) {
                return avisar('Seu carrinho está vazio.', 'erro');
            }
            if (!mesa.value) {
                return avisar('Escolha a sua mesa.', 'erro');
            }
            let p;
            try {
                p = await api('/pedidos', {
                    metodo: 'POST', sessao: 'cliente',
                    corpo: {
                        restauranteId: r.id, mesa: +mesa.value, obs: document.getElementById('obs').value.trim(),
                        itens: c.itens.map(i => ({ pid: i.pid, qtd: i.qtd }))
                    }
                });
            }
            catch (e) {
                await sincronizar();
                desenhar();
                throw e;
            }
            gravar(K.car, { rid: r.id, itens: [] });
            document.querySelector('main').innerHTML = `<h2>Pedido ${p.numero} enviado!</h2>
                <p class="vazio">${esc(r.nome)} recebeu seu pedido para a mesa ${p.mesa}. Total: ${real(p.total)}.</p>
                <p class="vazio">Situação: <strong id="situacao">${STATUS[p.status]}</strong></p>
                <button onclick="location.href='cardapio.html'">Voltar ao cardápio</button>`;
            acompanhar(p.id);
        });
    }
};

/** Mostra a situação do pedido (Novo → Em preparo → Pronto → Entregue) enquanto a tela estiver aberta. */
function acompanhar(id) {
    const t = setInterval(async () => {
        const el = document.getElementById('situacao');
        if (!el) {
            return clearInterval(t);
        }
        if (document.hidden) {
            return;
        }
        try {
            const p = (await api('/clientes/pedidos', { sessao: 'cliente' })).find(x => x.id === id);
            if (!p) return;
            el.textContent = p.encerrado && p.status !== 'entregue' ? 'Encerrado' : STATUS[p.status];
            if (p.status === 'entregue' || p.encerrado) {
                clearInterval(t);
            }
        }
        catch { /* tenta de novo no próximo ciclo */ }
    }, 10000);
}

document.addEventListener('DOMContentLoaded', () => {
    const f = document.querySelector('form');
    paginas[document.body.dataset.pagina]?.(f);
});
