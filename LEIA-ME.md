# SUPREMO AÇAÍ E PETISCARIA — Loja online e Painel Gerencial

Sistema completo: site de vendas (cardápio, carrinho, checkout, PIX, acompanhamento em tempo real)
e painel gerencial (pedidos, produtos, estoque, fichas técnicas, financeiro, caixa, fornecedores,
funcionários, relatórios PDF/Excel, auditoria e cópias de segurança).

## Publicação na Vercel (produção)

O site roda na Vercel com:
- **Banco de dados Turso** (pedidos, estoque, financeiro) — variáveis `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`;
- **Vercel Blob** para as fotos enviadas pelo painel — variável `BLOB_READ_WRITE_TOKEN` (criada automaticamente ao conectar o Blob);
- arquivos do site em `public/` e o servidor em `api/index.js` (configuração em `vercel.json`).

No primeiro acesso, as tabelas e o cardápio inicial são criados sozinhos no banco.

## Como rodar no computador

Requisito: **Node.js 22 ou superior**.

```bash
npm install
npm start            # site em http://localhost:3000  ·  painel em http://localhost:3000/admin/
npm test             # teste automático de ponta a ponta (usa banco temporário)
```

Sem as variáveis do Turso, o sistema usa um arquivo local (`data/supremo.db`) e guarda as fotos em `data/uploads`.

No primeiro acesso a `/admin/`, o sistema pede para **criar o login da proprietária**. Não existe senha padrão.

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Banco de dados na nuvem (obrigatório na Vercel) |
| `BLOB_READ_WRITE_TOKEN` | Fotos enviadas pelo painel (Vercel Blob) |
| `PUBLIC_URL` | Endereço público, ex. `https://supremoacai.com.br` |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PAYER_EMAIL` | Pagamento online pelo Mercado Pago (opcional) |

## Primeiros passos no painel (quando chegarem os materiais oficiais)

1. **Identidade visual** — já aplicada: logo oficial, cores da marca (verde-água #13A49C, verde-água escuro #0B5E59,
   laranja #E38340, dourado #E4AE58, verde-folha #6FBF40, creme #F7F1E6) e fotos do banner (costela, salgados, torta de frango),
   em `public/img/`. Para trocar, use **Configurações › Identidade visual**. Para logo em alta resolução, envie o arquivo original.
2. **Configurações › Pagamentos** — cadastre a chave PIX, nome e cidade do recebedor.
3. **Produtos** — crie as categorias, os grupos de adicionais e os produtos do cardápio oficial (fotos, descrições, preços e tamanhos).
4. **Estoque** — cadastre ingredientes, embalagens e bebidas com unidade, estoque mínimo e custo.
5. **Fichas técnicas** — informe quanto de cada ingrediente cada produto/tamanho/adicional consome.
6. **Funcionários** — crie os acessos (Gerente, Atendente, Estoquista).

O sistema começa **vazio**: não há produtos, preços, fotos ou números fictícios. Enquanto não houver
cardápio cadastrado, o site mostra "Cardápio em breve" com botão para pedir pelo WhatsApp.

## Regras de negócio importantes

- **Preços são sempre recalculados no servidor** — o valor enviado pelo navegador é ignorado.
- **Pagamento só é "aprovado" com confirmação real**: pelo Mercado Pago (o servidor consulta a API do provedor,
  nunca confia só na notificação) ou por conferência manual no painel ("Confirmar PIX"), registrada com o nome de quem conferiu.
- **Baixa automática de estoque** quando o pedido entra em *Em preparação*, uma única vez por pedido.
  No cancelamento, escolhe-se entre devolver os ingredientes ao estoque ou registrá-los como perda.
- **Venda registrada** (financeiro + caixa aberto) quando o pedido é concluído (entregue/retirado).
- **Lucro estimado** = faturamento + outras receitas − custo dos produtos vendidos (fichas técnicas) − despesas operacionais.
  Compras de mercadoria viram estoque e entram no custo pelas fichas técnicas (sem contar o gasto duas vezes).
- **Histórico protegido**: movimentações de estoque e auditoria não podem ser alteradas nem apagadas (travado no banco).
  Correções são feitas com novos lançamentos de ajuste/cancelamento, com motivo.
- **Cópias de segurança**: o Turso guarda o histórico do banco (restauração por data) e o painel permite baixar todos os dados em JSON (Configurações › Segurança e backup).

## Perfis de acesso

| Perfil | Acesso |
|---|---|
| Proprietária | Tudo |
| Gerente | Dashboard (sem números financeiros), pedidos, produtos, estoque, movimentações, fichas, fornecedores, compras, caixa, relatórios operacionais |
| Atendente | Pedidos |
| Estoquista | Estoque e movimentações |

Para mudar, edite o mapa `PERMISSIONS` em `server/auth.js`.

## Publicação (produção)

- Publicado na Vercel (HTTPS automático). Também roda em qualquer servidor Node (há um `Dockerfile`).

## Estrutura

```
api/      index.js (função da Vercel)
server/   index.js (rotas) · db.js (banco) · auth.js (login/permissões) · orders.js (pedidos e estoque)
          analytics.js (indicadores/relatórios) · export.js (PDF/Excel) · pix.js · payments.js (Mercado Pago) · cardapio-inicial.js
public/   index.html · cardapio.html · checkout.html · pedido.html · css/ · js/ · admin/ (painel)
test/     flow.test.js
```
