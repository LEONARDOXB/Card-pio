const entrarRest = r => {
    gravar(K.sr, { token: r.token, id: r.restaurante.id, nome: r.restaurante.nome });
    location.href = 'painel.html';
};

const paginasRest = {
    login(f) {
        if (ler(K.sr, null)?.token) {
            location.href = 'painel.html';
            return;
        }
        aoEnviar(f, async d => {
            entrarRest(await api('/restaurantes/login', { metodo: 'POST', corpo: { email: d.email, senha: d.senha } }));
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
            entrarRest(await api('/restaurantes/cadastro', { metodo: 'POST', corpo: d }));
        });
    },
    async painel() {
        const s = ler(K.sr, null), $ = q => document.querySelector(q);
        if (!s?.token) {
            location.href = 'restaurante-login.html';
            return;
        }
        const chamar = (caminho, op = {}) => api(caminho, { ...op, sessao: 'restaurante' });

        // Estado carregado do servidor
        let rest, pedidosAbertos = [], produtosLista = [];
        let editando = null, imagem = '', novosAntes = 0;

        try {
            [rest, pedidosAbertos, produtosLista] = await Promise.all([
                chamar('/painel/restaurante'), chamar('/painel/pedidos'), chamar('/painel/produtos')
            ]);
        }
        catch (e) {
            $('#quadro').innerHTML = `<p class="vazio">${esc(e.message)}</p>`;
            return;
        }
        novosAntes = pedidosAbertos.filter(p => p.status === 'novo').length;
        $('#nomeRest').textContent = rest.nome;

        const prox = {
            novo: ['preparando', 'Aceitar e preparar'], preparando: ['pronto', 'Marcar como pronto'], pronto: ['entregue', 'Marcar como entregue']
        };
        const hora = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const card = p => {
            const a = prox[p.status];
            return `<article class="pedido">
                <div class="linha">
                <strong>Pedido ${p.numero}</strong>
                <span>Mesa ${p.mesa}</span>
                </div>
                <small>${esc(p.cliente)} · ${hora(p.criadoEm)}</small>
                <ul>${p.itens.map(i => `<li>${i.qtd}× ${esc(i.nome)}</li>`).join('')}</ul>${p.obs ? `<p class="obs">Obs.: ${esc(p.obs)}</p>` : ''}<div class="linha">
                <strong>${real(p.total)}</strong>${a ? `<button class="btn" data-a="status" data-id="${esc(p.id)}" data-v="${a[0]}">${a[1]}</button>` : ''}</div>
                </article>`;
        };
        function pedidos() {
            const ps = pedidosAbertos;
            $('#quadro').innerHTML = Object.keys(STATUS).map(st => {
                const l = ps.filter(p => p.status === st).sort((a, b) => a.criadoEm - b.criadoEm);
                return `<section class="coluna ${st}">
                    <h2>${STATUS[st]} <span>${l.length}</span>
                    </h2>${l.map(card).join('') || '<p class="vazio">Nenhum pedido.</p>'}</section>`;
            }).join('');
            const n = ps.filter(p => p.status === 'novo').length;
            $('#badge').textContent = n || '';
            $('#badge').hidden = !n;
            document.title = (n ? `(${n}) ` : '') + 'WebCardápio - Painel do restaurante';
        }
        function mesas() {
            const n = rest.mesas, ps = pedidosAbertos;
            $('#grade').innerHTML = Array.from({ length: n }, (_, i) => {
                const m = i + 1, l = ps.filter(p => p.mesa === m);
                return `<article class="mesa ${l.length ? 'ocupada' : ''}">
                    <div class="linha">
                    <strong>Mesa ${m}</strong>
                    <span class="selo">${l.length ? 'Ocupada' : 'Livre'}</span>
                    </div>${l.length ? `<p>${l.length} pedido(s) · conta ${real(l.reduce((a, p) => a + p.total, 0))}</p>
                    <ul>${l.map(p => `<li>Pedido ${p.numero}: ${STATUS[p.status]}</li>`).join('')}</ul>
                    <button class="btn" data-a="liberar" data-v="${m}">Liberar mesa</button>` : '<p>Sem pedidos abertos.</p>'}</article>`;
            }).join('');
        }
        function produtos() {
            $('#lista').innerHTML = [...produtosLista].sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome)).map(p => `<article class="prod ${p.ativo ? '' : 'off'}">${foto(p)}<div>
                <strong>${esc(p.nome)}</strong>
                <small>${p.categoria} · ${real(p.preco)}</small>
                </div>
                <label>
                <input type="checkbox" data-a="ativo" data-id="${esc(p.id)}" ${p.ativo ? 'checked' : ''}> Disponível</label>
                <button class="btn claro" data-a="editar" data-id="${esc(p.id)}">Editar</button>
                <button class="btn perigo" data-a="excluir" data-id="${esc(p.id)}">Excluir</button>
                </article>`).join('') || '<p class="vazio">Nenhum produto cadastrado.</p>';
        }
        const desenhar = () => {
            pedidos();
            mesas();
            produtos();
        };

        // Busca pedidos no servidor e avisa quando chega um novo.
        let buscando = false;
        async function atualizarPedidos() {
            if (buscando) return;
            buscando = true;
            try {
                pedidosAbertos = await chamar('/painel/pedidos');
                const n = pedidosAbertos.filter(p => p.status === 'novo').length;
                if (n > novosAntes) {
                    avisar('Novo pedido recebido!');
                    bip();
                }
                novosAntes = n;
                pedidos();
                mesas();
            }
            catch { /* sem conexão: tenta de novo no próximo ciclo */ }
            finally {
                buscando = false;
            }
        }
        setInterval(() => {
            if (!document.hidden) atualizarPedidos();
        }, 5000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) atualizarPedidos();
        });

        function visao() {
            const v = ['pedidos', 'mesas', 'produtos'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'pedidos';
            document.querySelectorAll('.visao').forEach(e => e.hidden = e.id !== 'v-' + v);
            document.querySelectorAll('.lateral nav a').forEach(a => a.classList.toggle('ativo', a.hash === '#' + v));
        }
        function limpar() {
            editando = null;
            imagem = '';
            $('#formProd').reset();
            $('#tituloForm').textContent = 'Novo produto';
            $('#cancelar').hidden = true;
            $('#previa').hidden = true;
        }
        $('#categoria').innerHTML = CATEGORIAS.map(c => `<option>${c}</option>`).join('');
        $('#arquivo').addEventListener('change', e => {
            const a = e.target.files[0];
            if (!a) {
                return;
            }
            if (!/^image\/(png|jpeg|webp|gif)$/.test(a.type)) {
                e.target.value = '';
                return avisar('Use uma foto em PNG, JPG, WEBP ou GIF.', 'erro');
            }
            if (a.size > 400 * 1024) {
                e.target.value = '';
                return avisar('Foto grande demais. Use uma imagem de até 400 KB.', 'erro');
            }
            const l = new FileReader();
            l.onload = () => {
                imagem = l.result;
                $('#previa').src = imagem;
                $('#previa').hidden = false;
            };
            l.readAsDataURL(a);
        });
        $('#formProd').addEventListener('submit', e => {
            e.preventDefault();
            const f = e.target, p = preco(f.preco.value);
            if (isNaN(p) || p <= 0) {
                return avisar('Informe um preço válido, como 22,90.', 'erro');
            }
            const d = {
                nome: f.nome.value.trim(), descricao: f.descricao.value.trim(), preco: p, categoria: f.categoria.value
            };
            if (imagem) {
                d.imagem = imagem;
            }
            ocupado(f.querySelector('[type="submit"]'), async () => {
                const eraEdicao = !!editando;
                const salvo = eraEdicao
                    ? await chamar('/painel/produtos/' + encodeURIComponent(editando), { metodo: 'PUT', corpo: d })
                    : await chamar('/painel/produtos', { metodo: 'POST', corpo: d });
                const i = produtosLista.findIndex(x => x.id === salvo.id);
                i >= 0 ? produtosLista[i] = salvo : produtosLista.push(salvo);
                avisar(eraEdicao ? 'Produto atualizado.' : 'Produto adicionado.');
                limpar();
                produtos();
            });
        });
        $('#cancelar').onclick = limpar;
        $('#sair').onclick = () => {
            localStorage.removeItem(K.sr);
            location.href = 'restaurante-login.html';
        };
        $('#maisMesa').onclick = e => ocupado(e.target, async () => {
            rest = await chamar('/painel/mesas/adicionar', { metodo: 'POST' });
            mesas();
        });
        $('#menosMesa').onclick = e => ocupado(e.target, async () => {
            if (rest.mesas <= 1) {
                return;
            }
            rest = await chamar('/painel/mesas/remover', { metodo: 'POST' });
            mesas();
        });
        document.querySelector('main').addEventListener('click', e => {
            const el = e.target, a = el.dataset.a, i = el.dataset.id, v = el.dataset.v;
            if (!a) {
                return;
            }
            if (a === 'status') {
                ocupado(el, async () => {
                    const p = await chamar(`/painel/pedidos/${encodeURIComponent(i)}/status`, { metodo: 'PATCH', corpo: { status: v } });
                    const n = pedidosAbertos.findIndex(x => x.id === p.id);
                    if (n >= 0) pedidosAbertos[n] = p;
                    novosAntes = pedidosAbertos.filter(x => x.status === 'novo').length;
                    pedidos();
                    mesas();
                }).then(() => atualizarPedidos());
            }
            if (a === 'liberar') {
                const l = pedidosAbertos.filter(p => p.mesa === +v);
                if (l.some(p => p.status !== 'entregue') && !confirm('Há pedidos que ainda não foram entregues. Liberar a mesa mesmo assim?')) {
                    return;
                }
                ocupado(el, async () => {
                    await chamar(`/painel/mesas/${+v}/liberar`, { metodo: 'POST' });
                    pedidosAbertos = pedidosAbertos.filter(p => p.mesa !== +v);
                    novosAntes = pedidosAbertos.filter(x => x.status === 'novo').length;
                    pedidos();
                    mesas();
                    avisar(`Mesa ${v} liberada.`);
                });
            }
            if (a === 'ativo') {
                const marcado = el.checked;
                el.disabled = true;
                chamar(`/painel/produtos/${encodeURIComponent(i)}/ativo`, { metodo: 'PATCH', corpo: { ativo: marcado } })
                    .then(p => {
                        produtosLista[produtosLista.findIndex(x => x.id === p.id)] = p;
                        produtos();
                    })
                    .catch(ex => {
                        el.checked = !marcado;
                        el.disabled = false;
                        avisar(ex.message, 'erro');
                    });
            }
            if (a === 'excluir' && confirm('Excluir este produto do cardápio?')) {
                ocupado(el, async () => {
                    await chamar('/painel/produtos/' + encodeURIComponent(i), { metodo: 'DELETE' });
                    produtosLista = produtosLista.filter(p => p.id !== i);
                    if (editando === i) limpar();
                    produtos();
                    avisar('Produto excluído.');
                });
            }
            if (a === 'editar') {
                const p = produtosLista.find(x => x.id === i), f = $('#formProd');
                editando = i;
                imagem = '';
                f.reset();
                f.nome.value = p.nome;
                f.descricao.value = p.descricao;
                f.preco.value = p.preco.toFixed(2).replace('.', ',');
                f.categoria.value = p.categoria;
                $('#tituloForm').textContent = 'Editar produto';
                $('#cancelar').hidden = false;
                $('#previa').hidden = !p.imagem;
                $('#previa').src = p.imagem ? urlImagem(p.imagem) : '';
                f.nome.focus();
            }
        });
        window.addEventListener('hashchange', visao);
        visao();
        desenhar();
    }
};

/** Bip curto para chamar atenção quando chega pedido (o navegador pode bloquear até a primeira interação). */
function bip() {
    try {
        const ctx = bip.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.15, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.4);
    }
    catch { /* sem som disponível */ }
}

document.addEventListener('DOMContentLoaded', () => {
    paginasRest[document.body.dataset.pagina]?.(document.querySelector('form'));
});
