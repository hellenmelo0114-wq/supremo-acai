// Cardápio oficial inicial (preços e descrições do cardápio digital da loja).
// É gravado no banco automaticamente na PRIMEIRA vez que o sistema roda, se ainda não houver
// produtos. Depois disso, tudo é editado pelo painel (Produtos) — este arquivo não é lido de novo.
const { db, tx, getSetting, setSetting } = require('./db');

const R = (v) => Math.round(v * 100);
const SACHES = 'Deseja sachês?';

// Opções das tigelas de açaí (conforme o cardápio digital da loja)
const ACAI_SABORES = ['Açaí com Banana', 'Açaí com Cupuaçu', 'Açaí com Jabuticaba', 'Açaí com Morango', 'Açaí com Pistache', 'Açaí Grego',
  'Açaí Natural', 'Açaí Premium', 'Açaí Zero', 'Creme com Passas', 'Creme de Cappuccino', 'Creme de Cookies',
  'Creme de Iogurte com Frutas Vermelhas', 'Creme de Limão', 'Creme de Maracujá', 'Creme de Ninho', 'Creme de Pitaya', 'Creme Kids',
  'Sorvete de Chocolate', 'Sorvete de Abacaxi', 'Sorvete de Ameixa', 'Sorvete de Baunilha', 'Sorvete de Brigadeiro', 'Sorvete de Cajá',
  'Sorvete de Chocomenta', 'Sorvete de Coco', 'Sorvete de Cupuaçu', 'Sorvete de Flocos', 'Sorvete de Laka', 'Sorvete de Mangaba',
  'Sorvete de Morango', 'Sorvete de Paçoca', 'Sorvete de Pavê', 'Sorvete de Prestígio', 'Sorvete de Tapioca', 'Sorvete de Umbu',
  'Sorvete Floresta Negra', 'Sorvete Menina Bonita'];
const ACAI_COMPLEMENTOS = ['Amendoim Granulado', 'Aveia', 'Chocolate Granulado', 'Cobertura de Frutas Vermelhas', 'Cobertura de Chiclete',
  'Cobertura de Açaí', 'Cobertura de Groselha', 'Cobertura de Limão', 'Cobertura de Morango', 'Cobertura de Pistache', 'Cobertura de Tutti-Frutti',
  'Cobertura Porto Blue', 'Finni Amora', 'Finni Bananinha', 'Finni Beijinho', 'Finni Dentadura', 'Finni Gelatina', 'Gotas de Chocolate Branco',
  'Gotas de Chocolate', 'Granola', 'Jujuba Azeda', 'Jujuba Doce', 'Leite em Pó', 'Marshmallow', "M&M's", 'Paçoca', 'Sucrilhos', 'Wafer',
  'Fruta - Banana', 'Leite Condensado'];
const ACAI_EXTRAS = [['Bis ao Leite', 2], ['Bombom', 2], ['Calda com Cereja', 4], ['Calda de Ambrosia', 4], ['Calda de Cookies', 4],
  ['Calda de Morango', 4], ['Calda de Maracujá com Sementes', 4], ['Calda Skimo', 4], ['Fruta - Kiwi', 3], ['Nutella', 4], ['Ovomaltine', 4]];


const CARDAPIO = [
  {
    categoria: 'Açaí Supremo',
    produtos: [
      { nome: 'Tigela 300ml açaí ou sorvete', preco: 25.90, foto: '/img/produtos/tigela-acai.jpg', destaque: true, acai: 3,
        descricao: 'Tigela de 300ml de açaí ou sorvete podendo escolher até 2 sabores + 3 acompanhamentos. Os 300ml são somados com os acompanhamentos!' },
      { nome: 'Tigela 500ml açaí ou sorvete', preco: 31.90, foto: '/img/produtos/tigela-acai.jpg', destaque: true, acai: 3,
        descricao: 'Tigela de 500ml de açaí ou sorvete podendo escolher até 2 sabores + 3 acompanhamentos. Os 500ml são somados com os acompanhamentos!' },
      { nome: 'Tigela 700ml açaí ou sorvete', preco: 37.90, foto: '/img/produtos/tigela-acai.jpg', acai: 4,
        descricao: 'Tigela de 700ml de açaí ou sorvete podendo escolher até 2 sabores + 4 acompanhamentos. Os 700ml são somados com os acompanhamentos!' }
    ]
  },
  {
    categoria: 'Hamburguer',
    produtos: [
      { nome: 'Mini Supremo', preco: 39.90, foto: '/img/produtos/mini-supremo.jpg', descricao: '4 mini hambúrgueres Supremo.', saches: true },
      { nome: 'Misto Sanduíche', preco: 20.00, foto: '/img/produtos/misto.jpg', descricao: 'Pão, queijo e presunto.', saches: true },
      { nome: 'SUPREMO', preco: 25.00, foto: '/img/produtos/supremo.jpg', destaque: true, saches: true,
        descricao: 'Pão brioche, blend 150g, alface, maionese artesanal, queijo, cebola caramelizada e tomate.' },
      { nome: 'SUPREMO BACON', preco: 28.00, foto: '/img/produtos/supremo.jpg', saches: true,
        descricao: 'Pão brioche, blend 150g, alface, maionese artesanal, queijo, cebola caramelizada, tomate e bacon fatiado.' },
      { nome: 'SUPREMO CALABRESA', preco: 28.00, foto: '/img/produtos/supremo.jpg', saches: true,
        descricao: 'Pão brioche, blend 150g, alface, maionese artesanal, queijo, cebola caramelizada, tomate e calabresa.' },
      { nome: 'Supremo Cheddar', preco: 27.00, foto: '/img/produtos/supremo-cheddar.jpg', saches: true,
        descricao: 'Pão brioche, blend 150g, queijo cheddar, molho cheddar, cebola caramelizada, tomate e alface.' },
      { nome: 'Supremo Cheddar Bacon', preco: 30.00, foto: '/img/produtos/supremo-cheddar.jpg', saches: true,
        descricao: 'Pão brioche, blend 150g, queijo cheddar, bacon crispy, molho cheddar, cebola caramelizada, tomate e alface.' },
      { nome: 'Supremo Nordestino', preco: 35.00, foto: '/img/produtos/supremo-nordestino.jpg', destaque: true, saches: true,
        descricao: 'Pão brioche, blend 150g, queijo coalho, cream cheese, carne do sol desfiada, cebola roxa e melaço.' },
      { nome: 'Supremo Costela', preco: 38.00, foto: '/img/produtos/supremo-costela.jpg', destaque: true, saches: true,
        descricao: 'Pão brioche, costela desfiada 130g, queijo muçarela, molho barbecue, cebola caramelizada, tomate e alface.' },
      { nome: 'Supremo Cupim', preco: 38.00, foto: '/img/produtos/supremo-costela.jpg', saches: true,
        descricao: 'Pão brioche, cupim desfiado 130g, molho barbecue, queijo muçarela, cebola caramelizada, tomate e alface.' },
      { nome: 'X SUPREMO', preco: 38.00, foto: '/img/produtos/x-supremo.jpg', destaque: true, saches: true,
        descricao: 'Pão brioche, 2 blends de 150g, alface, maionese artesanal, queijo, cebola caramelizada, tomate e bacon fatiado.' },
      { nome: 'Supremo Ovo', preco: 16.00, foto: '/img/produtos/supremo.jpg', descricao: 'Pão brioche e ovo frito.', saches: true },
      { nome: 'Supremo Salada', preco: 22.00, foto: '/img/produtos/supremo.jpg', saches: true,
        descricao: 'Pão brioche, ovo, alface, maionese artesanal, queijo, cebola caramelizada e tomate. ATENÇÃO: NÃO ACOMPANHA CARNE.' }
    ]
  },
  {
    categoria: 'Sanduíche natural',
    produtos: [
      { nome: 'Sanduíche natural Atum', preco: 20.00, descricao: 'Atum, requeijão, alface, tomate e azeitona.', foto: '/img/produtos/natural-atum.jpg' },
      { nome: 'Sanduíche natural Frango', preco: 20.00, descricao: 'Frango, requeijão, alface, tomate e azeitona.', foto: '/img/produtos/natural-frango.jpg' },
      { nome: 'Sanduíche natural Peito de Peru', preco: 20.00, descricao: 'Peito de peru, queijo, requeijão, tomate e alface.', foto: '/img/produtos/natural-peru.jpg' }
    ]
  },
  {
    categoria: 'Espetinho',
    produtos: [
      { nome: 'Espetinho Carne', preco: 14.00, descricao: 'Espetinho acompanhado de 25g de farofa e 25g de salada.', foto: '/img/produtos/espetinho-carne.jpg' },
      { nome: 'Espetinho Coração', preco: 14.00, descricao: 'Espetinho acompanhado de 25g de farofa e 25g de salada.', foto: '/img/produtos/espetinho-coracao.jpg' },
      { nome: 'Espetinho Cupim', preco: 14.00, descricao: 'Espetinho acompanhado de 25g de farofa e 25g de salada.', foto: '/img/produtos/espetinho-carne.jpg' },
      { nome: 'Espetinho Misto', preco: 14.00, descricao: 'Espetinho acompanhado de 25g de farofa e 25g de salada.', foto: '/img/produtos/espetinho-misto.jpg' },
      { nome: 'Queijo Coalho', preco: 12.00, descricao: 'Espetinho de queijo coalho.', foto: '/img/produtos/queijo-coalho.jpg' },
      { nome: 'Porção', preco: 10.00, descricao: 'Farofa e salada.' },
      { nome: 'Porção farofa', preco: 5.00, descricao: 'Porção de farofa.', foto: '/img/produtos/porcao-farofa.jpg' },
      { nome: 'Porção salada', preco: 5.00, descricao: 'Porção de salada.', foto: '/img/produtos/porcao-salada.jpg' }
    ]
  },
  {
    categoria: 'Cuscuz',
    produtos: [
      { nome: 'Cuscuz Tradicional', preco: 23.00, descricao: 'Queijo e presunto.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Bom Dia', preco: 23.00, descricao: 'Cuscuz com ovo mexido.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Clássico', preco: 20.00, descricao: 'Cuscuz com manteiga.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Cremoso', preco: 23.00, descricao: 'Frango, queijo e catupiry.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Crocante', preco: 23.00, descricao: 'Bacon e queijo.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Magnífico', preco: 23.00, descricao: 'Banana da terra e queijo.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Mainha', preco: 23.00, descricao: 'Apenas carne moída.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Mistura Boa', preco: 23.00, descricao: 'Calabresa com queijo.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Painho', preco: 24.00, descricao: 'Carne moída, queijo e bacon.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Saboroso', preco: 23.00, descricao: 'Frango e calabresa.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Sertanejo', preco: 25.00, descricao: 'Carne do sol desfiada, banana da terra e queijo coalho.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Sertão', preco: 25.00, descricao: 'Carne do sol desfiada e queijo.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Supreme', preco: 23.00, descricao: 'Frango com queijo.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Dobrado Bom Dia', preco: 34.99, descricao: 'Com ovo mexido. Apenas 1 cuscuz do grande.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Dobrado Crocante', preco: 34.99, descricao: 'Bacon e queijo. Apenas 1 cuscuz do grande.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Dobrado Mistura Boa', preco: 34.99, descricao: 'Calabresa e queijo. Apenas 1 cuscuz do grande.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Dobrado Painho', preco: 36.99, descricao: 'Carne moída, queijo e bacon. Apenas 1 cuscuz do grande.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Dobrado Sertanejo', preco: 39.99, descricao: 'Carne do sol desfiada, queijo e banana da terra. Apenas 1 cuscuz do grande.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Dobrado Sertão', preco: 36.99, descricao: 'Carne do sol desfiada e queijo. Apenas 1 cuscuz do grande.', foto: '/img/produtos/cuscuz.jpg' },
      { nome: 'Cuscuz Dobrado Supreme', preco: 34.99, descricao: 'Frango e queijo. Apenas 1 cuscuz do grande.', foto: '/img/produtos/cuscuz.jpg' }
    ]
  },
  {
    categoria: 'Beiju',
    produtos: [
      { nome: 'Beiju Abusado', preco: 22.00, descricao: 'Queijo com ovo mexido.', foto: '/img/produtos/beiju-ovo.jpg' },
      { nome: 'Beiju Amanhecer', preco: 22.00, descricao: 'Carne moída com catupiry.', foto: '/img/produtos/beiju-carne-moida.jpg' },
      { nome: 'Beiju Caprichado', preco: 25.00, descricao: 'Carne do sol desfiada e queijo.', foto: '/img/produtos/beiju-carne-sol.jpg' },
      { nome: 'Beiju Chamego', preco: 22.00, descricao: 'Frango, calabresa e queijo.', foto: '/img/produtos/beiju-frango.jpg' },
      { nome: 'Beiju Clássico', preco: 22.00, descricao: 'Queijo, presunto, tomate, cebola, orégano e milho.', foto: '/img/produtos/beiju-queijo-presunto.jpg' },
      { nome: 'Beiju Divino', preco: 22.00, descricao: 'Frango, queijo e bacon.', foto: '/img/produtos/beiju-frango.jpg' },
      { nome: 'Beiju Encanto', preco: 22.00, descricao: 'Frango com queijo.', foto: '/img/produtos/beiju-frango.jpg' },
      { nome: 'Beiju Essência', preco: 22.00, descricao: 'Carne moída com queijo.', foto: '/img/produtos/beiju-carne-moida.jpg' },
      { nome: 'Beiju Queridinho', preco: 27.00, descricao: 'Carne do sol desfiada, queijo e banana da terra.', foto: '/img/produtos/beiju-carne-sol.jpg' },
      { nome: 'Beiju Querido', preco: 22.00, descricao: 'Queijo e presunto.', foto: '/img/produtos/beiju-queijo-presunto.jpg' },
      { nome: 'Beiju Quero Mais', preco: 22.00, descricao: 'Carne moída, calabresa e queijo.', foto: '/img/produtos/beiju-carne-moida.jpg' },
      { nome: 'Beiju Tentação', preco: 22.00, descricao: 'Carne moída, bacon e queijo.', foto: '/img/produtos/beiju-carne-moida.jpg' },
      { nome: 'Beiju Vixe Mainha', preco: 22.00, descricao: 'Banana da terra com queijo.', foto: '/img/produtos/beiju-banana.jpg' },
      { nome: 'Beiju Xodó', preco: 22.00, descricao: 'Frango com catupiry.', foto: '/img/produtos/beiju-frango.jpg' }
    ]
  },
  {
    categoria: 'Beiju doce',
    produtos: [
      { nome: 'Beiju Amor Perfeito', preco: 22.00, descricao: 'Queijo e goiabada.', foto: '/img/produtos/beiju-goiabada.jpg' },
      { nome: 'Beiju Desejo', preco: 22.00, descricao: 'Leite condensado e coco.', foto: '/img/produtos/beiju-leite-condensado.jpg' },
      { nome: 'Beiju Doce Infância', preco: 22.00, descricao: 'Brigadeiro e coco em flocos.', foto: '/img/produtos/beiju-brigadeiro.jpg' },
      { nome: 'Beiju Explosão', preco: 22.00, descricao: 'Banana da terra com doce de leite e canela.', foto: '/img/produtos/beiju-doce-de-leite-banana.jpg' },
      { nome: 'Beiju Pedaço do Céu', preco: 22.00, descricao: 'Doce de leite e coco em flocos.', foto: '/img/produtos/beiju-doce-de-leite-coco.jpg' }
    ]
  },
  {
    categoria: 'Beiju premium',
    produtos: [
      { nome: 'Beiju Chefão', preco: 29.99, descricao: 'Camarão e catupiry.', foto: '/img/produtos/beiju-camarao.jpg' },
      { nome: 'Beiju Poderoso', preco: 29.99, descricao: 'Atum e catupiry.', foto: '/img/produtos/beiju-atum.jpg' },
      { nome: 'Beiju Respeitoso', preco: 29.99, descricao: 'Costela e queijo coalho.', foto: '/img/produtos/beiju-costela.jpg' }
    ]
  },
  {
    categoria: 'Omelete',
    produtos: [
      { nome: 'Omelete Carne do Sol Desfiada e Queijo', preco: 25.00, descricao: 'Omelete de carne do sol desfiada e queijo.', foto: '/img/produtos/omelete.jpg' },
      { nome: 'Omelete Carne Moída e Queijo', preco: 22.00, descricao: 'Omelete de carne moída e queijo.', foto: '/img/produtos/omelete.jpg' },
      { nome: 'Omelete Frango e Queijo', preco: 22.00, descricao: 'Omelete de frango e queijo.', foto: '/img/produtos/omelete.jpg' },
      { nome: 'Omelete Temperado', preco: 22.00, descricao: 'Cebola, tomate e coentro.', foto: '/img/produtos/omelete.jpg' }
    ]
  },
  {
    categoria: 'Crepioca',
    produtos: [
      { nome: 'Crepioca Carne do Sol Desfiada e Queijo', preco: 28.00, descricao: 'Farinha de tapioca, ovo e recheio escolhido.', foto: '/img/produtos/crepioca.jpg' },
      { nome: 'Crepioca Carne Moída e Queijo', preco: 25.00, descricao: 'Farinha de tapioca, ovo e recheio escolhido.', foto: '/img/produtos/crepioca.jpg' },
      { nome: 'Crepioca Queijo e Presunto', preco: 25.00, descricao: 'Farinha de tapioca, ovo e recheio escolhido.', foto: '/img/produtos/crepioca.jpg' }
    ]
  },
  {
    categoria: 'Macarrão ao vivo',
    produtos: [
      { nome: 'Macarrão Alho e Óleo', preco: 30.00, descricao: 'Macarrão alho e óleo.', talher: true },
      { nome: 'Macarrão ao Molho Bolonhesa', preco: 39.99, descricao: 'Carne moída, queijo, milho verde, azeitona, uva passa, tomate, cebola, alho, orégano e pimenta calabresa. Aproximadamente 650g.', foto: '/img/produtos/macarrao.jpg', talher: true },
      { nome: 'Macarrão ao Molho Branco', preco: 39.99, descricao: 'Bacon, calabresa, frango, queijo, presunto, milho verde, azeitona, uva passa, tomate, cebola, alho, orégano e pimenta calabresa. Aproximadamente 650g.', foto: '/img/produtos/macarrao.jpg', talher: true },
      { nome: 'Macarrão ao Molho Rosé', preco: 39.99, descricao: 'Bacon, calabresa, frango, queijo, presunto, milho verde, azeitona, uva passa, tomate, cebola, alho, orégano e pimenta calabresa. Aproximadamente 650g.', foto: '/img/produtos/macarrao.jpg', talher: true },
      { nome: 'Macarrão ao Molho Vermelho', preco: 39.99, descricao: 'Bacon, calabresa, frango, queijo, presunto, milho verde, azeitona, uva passa, tomate, cebola, alho, orégano e pimenta calabresa. Aproximadamente 650g.', foto: '/img/produtos/macarrao.jpg', talher: true },
      { nome: 'Macarrão ao Molho Branco com Camarão', preco: 47.99, descricao: 'Camarão fresco, queijo, milho verde, azeitona, uva passa, tomate, cebola, alho, orégano e pimenta calabresa. Aproximadamente 650g.', foto: '/img/produtos/macarrao-camarao.jpg', talher: true },
      { nome: 'Macarrão ao Molho Rosé com Camarão', preco: 47.99, descricao: 'Camarão fresco, queijo, milho verde, azeitona, uva passa, tomate, cebola, alho, orégano e pimenta calabresa. Aproximadamente 650g.', foto: '/img/produtos/macarrao-camarao.jpg', talher: true },
      { nome: 'Macarrão ao Molho Vermelho com Camarão', preco: 47.99, descricao: 'Camarão fresco, queijo, milho verde, azeitona, uva passa, tomate, cebola, alho, orégano e pimenta calabresa. Aproximadamente 650g.', foto: '/img/produtos/macarrao-camarao.jpg', talher: true }
    ]
  },
  {
    categoria: 'Porções',
    produtos: [
      { nome: 'Bolinho de Camarão', preco: 39.99, descricao: 'Acompanha 10 unidades de bolinho + pote de 50ml de maionese extra.', foto: '/img/produtos/bolinho.jpg' },
      { nome: 'Bolinho de Carne Seca', preco: 39.99, descricao: 'Acompanha 10 unidades de bolinhos + pote de 50ml de maionese extra.', foto: '/img/produtos/bolinho.jpg' },
      { nome: 'Bolinho de Queijo', preco: 34.99, descricao: 'Acompanha 10 unidades de bolinho + pote de 50ml de maionese extra.', foto: '/img/produtos/bolinho.jpg' },
      { nome: 'Encapado de Camarão', preco: 39.99, descricao: 'Acompanha 10 unidades de encapado + pote de 50ml de maionese extra.', foto: '/img/produtos/encapado-camarao.jpg' },
      { nome: 'Mini Coxinha', preco: 36.99, descricao: 'Acompanha 10 unidades de mini coxinha + pote de 50ml de maionese extra.' },
      { nome: 'Mini Pastéis', preco: 34.99, descricao: 'Acompanha 10 unidades de mini pastéis com sabores sortidos.', foto: '/img/produtos/mini-pasteis.jpg' }
    ]
  },
  {
    categoria: 'Petiscos',
    produtos: [
      { nome: 'Aipim Frito', preco: 29.99, descricao: 'Aipim frito 300g.', foto: '/img/produtos/aipim.jpg' },
      { nome: 'Batata Frita', preco: 29.99, descricao: '330g de batata frita.', foto: '/img/produtos/batata-frita.jpg' },
      { nome: 'Batata Frita ao Molho de Queijo', preco: 36.99, descricao: 'Batata frita ao molho de queijo.', foto: '/img/produtos/batata-frita.jpg' },
      { nome: 'Batata Frita Premium', preco: 36.99, descricao: 'Batata, cheddar e bacon.', foto: '/img/produtos/batata-premium.jpg' },
      { nome: 'Carne do Sol com Farofa e Salada', preco: 64.99, descricao: '400g de carne do sol, acompanha farofa e salada.', foto: '/img/produtos/carne-sol-farofa.jpg' },
      { nome: 'Carne do Sol com Fritas', preco: 64.99, descricao: 'Carne do sol 400g e 330g de batata frita.', foto: '/img/produtos/carne-sol-fritas.jpg' },
      { nome: 'Carne do Sol com Fritas e Queijo Coalho', preco: 79.99, descricao: '400g de carne do sol, 300g de fritas e um queijo coalho.' },
      { nome: 'Escondidinho de Charque', preco: 59.99, descricao: 'Pirão de aipim com carne de charque desfiada, acompanha salada vinagrete. Serve duas pessoas.' },
      { nome: 'Pirão de Aipim com Calabresa e Carne do Sol', preco: 49.99, descricao: 'Pirão de aipim com carne do sol e calabresa, acompanha salada vinagrete. Serve duas pessoas.', foto: '/img/produtos/pirao-carne-sol.jpg' },
      { nome: 'Pirão de Aipim com Camarão', preco: 49.99, descricao: 'Pirão de aipim com camarão, acompanha salada vinagrete. Serve duas pessoas.', foto: '/img/produtos/pirao-camarao.jpg' },
      { nome: 'Pirão de Aipim com Carne do Sol', preco: 44.99, descricao: 'Pirão de aipim com carne do sol, acompanha salada vinagrete. Serve duas pessoas.', foto: '/img/produtos/pirao-carne-sol.jpg' }
    ]
  },
  {
    categoria: 'Caldos e sopas',
    produtos: [
      { nome: 'Caldos Diversos 500ml', preco: 28.00, caldo: true, descricao: 'Caldo de 500ml. Escolha o seu sabor.', foto: '/img/produtos/caldos.jpg' },
      { nome: 'Sopa', preco: 25.00, descricao: '500ml de sopa de carne com torrada.', foto: '/img/produtos/sopa.jpg' },
      { nome: 'Torrada Extra', preco: 2.00, descricao: 'Porção extra de torrada.', foto: '/img/produtos/torrada.jpg' }
    ]
  },
  {
    categoria: 'Pastel',
    produtos: [
      { nome: 'Pastel Alma de Praia', preco: 22.00, descricao: 'Carne moída, queijo e bacon.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Brisa', preco: 15.00, descricao: 'Pastel de vento, sem recheio.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Brisa do Mar', preco: 22.00, descricao: 'Frango, queijo e milho verde.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Céu de Verão', preco: 22.00, descricao: 'Bacon, queijo e milho.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Céu do Sertão', preco: 25.00, descricao: 'Carne do sol desfiada, catupiry e queijo coalho.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Dia de Praia', preco: 22.00, descricao: 'Queijo, presunto, tomate, pimentão e ovo cozido.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Eclipse', preco: 22.00, descricao: 'Frango, carne moída e queijo.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Férias', preco: 22.00, descricao: 'Queijo muçarela e banana da terra.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Good Vibes', preco: 22.00, descricao: 'Carne moída, catupiry e calabresa.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Jóia da Coroa', preco: 22.00, descricao: 'Frango, queijo e bacon.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Mar do Sertão', preco: 28.00, descricao: 'Carne do sol desfiada, queijo coalho e banana da terra.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Maré Mansa', preco: 22.00, descricao: 'Calabresa, queijo e orégano.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel O Praieiro', preco: 22.00, descricao: 'Frango, catupiry e milho verde.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Ondas do Mar', preco: 22.00, descricao: 'Queijo, presunto, tomate, cebola e milho verde.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Paraíso', preco: 22.00, descricao: 'Frango.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Pé na Areia', preco: 22.00, descricao: 'Frango, presunto e bacon.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Pôr do Sol', preco: 22.00, descricao: 'Carne moída, presunto e bacon.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Sabor do Verão', preco: 22.00, descricao: 'Carne moída, ovo cozido e azeitona.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Sertão Dourado', preco: 25.00, descricao: 'Carne do sol desfiada, queijo e azeitona.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Sol do Sertão', preco: 25.00, descricao: 'Carne do sol desfiada e queijo coalho.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Sunset', preco: 22.00, descricao: 'Frango, calabresa e pimenta calabresa.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Tropical', preco: 22.00, descricao: 'Queijo, presunto e orégano.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Verão na Praia', preco: 22.00, descricao: 'Carne moída, queijo e milho verde.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Verão Tropical', preco: 22.00, descricao: 'Carne moída, queijo, uva passa e pimenta calabresa.', foto: '/img/produtos/pastel.jpg' }
    ]
  },
  {
    categoria: 'Pastel doce',
    produtos: [
      { nome: 'Pastel Doce Verão 200g', preco: 16.00, descricao: 'Queijo e goiabada.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Maré 200g', preco: 16.00, descricao: 'Brigadeiro e coco flocado.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Praia e Sol 200g', preco: 16.00, descricao: 'Doce de leite e banana da prata.', foto: '/img/produtos/pastel.jpg' }
    ]
  },
  {
    categoria: 'Pastel Premium',
    produtos: [
      { nome: 'Pastel Areia Branca', preco: 35.00, descricao: 'Muçarela, catupiry, cheddar e gorgonzola.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Céu, Sol e Mar', preco: 35.00, descricao: 'Atum, catupiry e queijo.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Costa do Sol', preco: 35.00, descricao: 'Costela com queijo coalho e cebola.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Lua Cheia', preco: 35.00, descricao: 'Pirão de aipim, carne de charque e queijo coalho.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Maré de Ouro', preco: 35.00, descricao: 'Camarão com queijo.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Mistério do Mar', preco: 35.00, descricao: 'Siri com queijo.', foto: '/img/produtos/pastel.jpg' },
      { nome: 'Pastel Sol e Mar', preco: 35.00, descricao: 'Siri com catupiry.', foto: '/img/produtos/pastel.jpg' }
    ]
  },
  {
    categoria: 'Lanches',
    produtos: [
      { nome: 'Coxinha de Frango', preco: 15.00, descricao: 'Coxinha de frango.', foto: '/img/produtos/coxinha.jpg' },
      { nome: 'Coxinha de Frango com Catupiry', preco: 15.00, descricao: 'Coxinha de frango com catupiry.', foto: '/img/produtos/coxinha.jpg' }
    ]
  },
  {
    categoria: 'Café',
    produtos: [
      { nome: 'Cappuccino', preco: 12.00, descricao: 'Cappuccino.', foto: '/img/produtos/cappuccino.jpg' },
      { nome: 'Xícara de Café', preco: 5.00, descricao: 'Café preto com açúcar.', foto: '/img/produtos/cafe.jpg' },
      { nome: 'Xícara de Café com Leite', preco: 5.00, descricao: 'Café, leite e açúcar.', foto: '/img/produtos/cafe-com-leite.jpg' },
      { nome: 'Xícara de Café Descafeinado', preco: 7.00, descricao: 'Café descafeinado.' }
    ]
  },
  {
    categoria: 'Tortas doces',
    produtos: [
      { nome: 'Torta Delícia de Morango', preco: 24.00, descricao: 'Massa branca com recheio de Ninho e geleia artesanal de frutas.', foto: '/img/produtos/torta-morango.jpg' }
    ]
  },
  {
    categoria: 'Milkshakes',
    produtos: [
      { nome: 'Milkshake Açaí', preco: 25.00, descricao: 'Milkshake de 500ml.', foto: '/img/produtos/milk-acai.jpg' },
      { nome: 'Milkshake Chocolate', preco: 22.00, descricao: 'Milkshake de 500ml.', foto: '/img/produtos/milk-chocolate.jpg' },
      { nome: 'Milkshake Maracujá', preco: 25.00, descricao: 'Milkshake de 500ml.', foto: '/img/produtos/milk-maracuja.jpg' },
      { nome: 'Milkshake Morango', preco: 22.00, descricao: 'Milkshake de 500ml.', foto: '/img/produtos/milk-morango.jpg' },
      { nome: 'Milkshake Ninho', preco: 25.00, descricao: 'Milkshake de 500ml.', foto: '/img/produtos/milk-ninho.jpg' },
      { nome: 'Milkshake Nutella', preco: 25.00, descricao: 'Milkshake de 500ml.', foto: '/img/produtos/milk-nutella.jpg' },
      { nome: 'Milkshake Ovomaltine', preco: 25.00, descricao: 'Milkshake de 500ml.', foto: '/img/produtos/milk-ovomaltine.jpg' }
    ]
  },
  {
    categoria: 'Doces',
    produtos: [
      { nome: 'Aquaplay', preco: 12.00, descricao: 'Brinquedo aquaplay.', foto: '/img/produtos/aquaplay.jpg' },
      { nome: 'Bolhas de Sabão', preco: 6.00, descricao: 'Bolhas de sabão pequenas de animais variados.', foto: '/img/produtos/bolhas.jpg' },
      { nome: 'Bolinha de Ping Pong', preco: 2.00, descricao: 'Bolinhas coloridas de ping pong.' },
      { nome: 'Carrinho Mini', preco: 10.00, descricao: 'Carrinhos de corrida.', foto: '/img/produtos/carrinho.jpg' },
      { nome: 'Chokito', preco: 5.00, descricao: 'Chocolate Chokito.', foto: '/img/produtos/chokito.jpg' },
      { nome: 'Doce de Leite', preco: 3.00, descricao: 'Doce de leite em tablete.', foto: '/img/produtos/doce-de-leite.jpg' },
      { nome: 'Halls', preco: 5.00, descricao: 'Bala Halls.', foto: '/img/produtos/halls.jpg' },
      { nome: 'Kit Kat', preco: 6.00, descricao: 'Chocolate Kit Kat.', foto: '/img/produtos/kitkat.jpg' },
      { nome: 'Mentos Caixa', preco: 5.00, descricao: 'Mentos em caixa.', foto: '/img/produtos/mentos-caixa.jpg' },
      { nome: 'Mentos Individual', preco: 0.50, descricao: 'Mentos unidade.', foto: '/img/produtos/mentos-individual.jpg' },
      { nome: 'Mentos Tubo', preco: 5.00, descricao: 'Mentos em tubo.', foto: '/img/produtos/mentos-tubo.jpg' },
      { nome: 'Mola Maluca', preco: 5.00, descricao: 'Molas malucas coloridas.', foto: '/img/produtos/mola.jpg' },
      { nome: 'Ovo Surpresa', preco: 10.00, descricao: 'Ovo surpresa.', foto: '/img/produtos/ovo-surpresa.jpg' },
      { nome: 'Pirulito Diversos', preco: 5.00, descricao: 'Pirulitos variados.', foto: '/img/produtos/pirulito.jpg' },
      { nome: 'Prestígio', preco: 5.00, descricao: 'Chocolate Prestígio.', foto: '/img/produtos/prestigio.jpg' },
      { nome: 'Slime', preco: 12.00, descricao: 'Slime.', foto: '/img/produtos/slime.jpg' },
      { nome: 'Trident', preco: 4.00, descricao: 'Chiclete Trident.', foto: '/img/produtos/trident.jpg' },
      { nome: 'Trufas', preco: 6.00, descricao: 'Trufas de chocolate.', foto: '/img/produtos/trufas.jpg' }
    ]
  },
  {
    categoria: 'Água mineral',
    produtos: [
      { nome: 'Água Mineral 500ml', preco: 4.00, descricao: 'Água mineral sem gás 500ml.', foto: '/img/produtos/agua.jpg' },
      { nome: 'Água Mineral com Gás', preco: 5.00, descricao: 'Água mineral com gás.', foto: '/img/produtos/agua-gas.jpg' }
    ]
  },
  {
    categoria: 'Sucos',
    produtos: [
      { nome: 'Acerola 300ml', preco: 9.00, descricao: 'Suco de acerola 300ml.' },
      { nome: 'Acerola Jarra', preco: 18.00, descricao: 'Jarra de suco de acerola.' },
      { nome: 'Cacau 300ml', preco: 10.00, descricao: 'Suco de cacau 300ml.' },
      { nome: 'Cacau Jarra', preco: 20.00, descricao: 'Jarra de suco de cacau.' },
      { nome: 'Cacau com Laranja 300ml', preco: 15.00, descricao: 'Suco de cacau com laranja 300ml.' },
      { nome: 'Cacau com Laranja Jarra', preco: 25.00, descricao: 'Jarra de suco de cacau com laranja.' },
      { nome: 'Cacau com Leite 300ml', preco: 12.00, descricao: 'Suco de cacau com leite 300ml.' },
      { nome: 'Cacau com Leite Jarra', preco: 22.00, descricao: 'Jarra de suco de cacau com leite.' },
      { nome: 'Cajá 300ml', preco: 9.00, descricao: 'Suco de cajá 300ml.' },
      { nome: 'Cajá Jarra', preco: 18.00, descricao: 'Jarra de suco de cajá.' },
      { nome: 'Caju 300ml', preco: 9.00, descricao: 'Suco de caju 300ml.', foto: '/img/produtos/suco-garrafa.jpg' },
      { nome: 'Caju Jarra', preco: 18.00, descricao: 'Jarra de suco de caju.' },
      { nome: 'Cupuaçu 300ml', preco: 9.00, descricao: 'Suco de cupuaçu 300ml.' },
      { nome: 'Cupuaçu Jarra', preco: 18.00, descricao: 'Jarra de suco de cupuaçu.' },
      { nome: 'Graviola 300ml', preco: 9.00, descricao: 'Suco de graviola 300ml.' },
      { nome: 'Graviola Jarra', preco: 18.00, descricao: 'Jarra de suco de graviola.' },
      { nome: 'Laranja 300ml', preco: 12.00, descricao: 'Suco natural de laranja (gelado).', foto: '/img/produtos/suco-garrafa.jpg' },
      { nome: 'Laranja Jarra', preco: 24.00, descricao: 'Jarra de suco de laranja.' },
      { nome: 'Laranja com Leite 300ml', preco: 15.00, descricao: 'Suco de laranja com leite 300ml.' },
      { nome: 'Laranja com Leite Jarra', preco: 25.00, descricao: 'Jarra de suco de laranja com leite.' },
      { nome: 'Limão 300ml', preco: 12.00, descricao: 'Suco de limão 300ml.' },
      { nome: 'Limão Jarra', preco: 22.00, descricao: 'Jarra de suco de limão.' },
      { nome: 'Manga 300ml', preco: 9.00, descricao: 'Suco de manga 300ml.' },
      { nome: 'Manga Jarra', preco: 18.00, descricao: 'Jarra de suco de manga.' },
      { nome: 'Maracujá 300ml', preco: 12.00, descricao: 'Suco de maracujá 300ml.', foto: '/img/produtos/suco-maracuja.jpg' },
      { nome: 'Maracujá com Leite 300ml', preco: 15.00, descricao: 'Suco de maracujá com leite 300ml.' },
      { nome: 'Maracujá com Leite Jarra', preco: 25.00, descricao: 'Jarra de suco de maracujá com leite.' },
      { nome: 'Maracujá Jarra', preco: 20.00, descricao: 'Jarra de suco de maracujá.' },
      { nome: 'Morango 300ml', preco: 13.00, descricao: 'Suco de morango 300ml.', foto: '/img/produtos/suco-morango.jpg' },
      { nome: 'Morango com Laranja 300ml', preco: 16.00, descricao: 'Suco de morango com laranja 300ml.' },
      { nome: 'Morango com Laranja Jarra', preco: 35.00, descricao: 'Jarra de suco de morango com laranja.' },
      { nome: 'Morango Jarra', preco: 25.00, descricao: 'Jarra de suco de morango.' },
      { nome: 'Umbu 300ml', preco: 9.00, descricao: 'Suco de umbu 300ml.' },
      { nome: 'Umbu Jarra', preco: 18.00, descricao: 'Jarra de suco de umbu.' }
    ]
  },
  {
    categoria: 'Refrigerantes 1L',
    produtos: [
      { nome: 'Antarctica 1L', preco: 12.00, descricao: 'Guaraná Antarctica 1 litro.' },
      { nome: 'Coca-Cola 1L Zero', preco: 14.00, descricao: 'Coca-Cola Zero 1 litro.', foto: '/img/produtos/coca-1l-zero.jpg' },
      { nome: 'Coca-Cola 1L', preco: 12.00, descricao: 'Coca-Cola 1 litro.', foto: '/img/produtos/coca-1l.jpg' },
      { nome: 'Pepsi 1L', preco: 12.00, descricao: 'Pepsi 1 litro.' }
    ]
  },
  {
    categoria: 'Refrigerantes lata 350ml',
    produtos: [
      { nome: 'Coca-Cola Zero 350ml', preco: 7.00, descricao: 'Lata 350ml.', foto: '/img/produtos/coca-zero-lata.jpg' },
      { nome: 'Coca-Cola 350ml', preco: 6.00, descricao: 'Lata 350ml.', foto: '/img/produtos/coca-lata.jpg' },
      { nome: 'Fanta Laranja 350ml', preco: 6.00, descricao: 'Lata 350ml.', foto: '/img/produtos/fanta-laranja.jpg' },
      { nome: 'Fanta Laranja Zero Lata', preco: 7.00, descricao: 'Lata 350ml.' },
      { nome: 'Fanta Uva 350ml', preco: 6.00, descricao: 'Lata 350ml.', foto: '/img/produtos/fanta-uva.jpg' },
      { nome: 'H2OH!', preco: 8.00, descricao: 'H2OH!', foto: '/img/produtos/h2o.jpg' },
      { nome: 'Kuat 350ml', preco: 6.00, descricao: 'Lata 350ml.', foto: '/img/produtos/kuat.jpg' },
      { nome: 'Schweppes Água Tônica', preco: 10.00, descricao: 'Schweppes água tônica.', foto: '/img/produtos/schweppes.jpg' },
      { nome: 'Schweppes Citrus Color 350ml', preco: 10.00, descricao: 'Lata 350ml.' },
      { nome: 'Sprite Zero Lata', preco: 7.00, descricao: 'Lata 350ml.' },
      { nome: 'Sprite 350ml', preco: 6.00, descricao: 'Lata 350ml.', foto: '/img/produtos/sprite.jpg' },
      { nome: 'Suco Del Valle 450ml', preco: 6.00, descricao: 'Suco Del Valle 450ml.' },
      { nome: 'Suco Yulo 200ml', preco: 3.00, descricao: 'Suco Yulo 200ml.' }
    ]
  },
  {
    categoria: 'Drinks',
    produtos: [
      { nome: 'Aperol com Morango', preco: 25.00, descricao: 'Aperol com morango.' },
      { nome: 'Caipirinha', preco: 20.00, descricao: 'Vodka e limão.' },
      { nome: 'Caipiroska Kiwi', preco: 25.00, descricao: 'Vodka e kiwi.' },
      { nome: 'Caipiroska Morango', preco: 25.00, descricao: 'Vodka e morango.' },
      { nome: 'Montilla Dose', preco: 10.00, descricao: 'Dose de Montilla.' },
      { nome: 'Red Drink', preco: 20.00, descricao: 'Campari, suco de laranja e gelo.' },
      { nome: 'Rum Bacardi Dose 40ml', preco: 10.00, descricao: 'Dose de 40ml.' },
      { nome: 'Salinas Bálsamo Dose 40ml', preco: 10.00, descricao: 'Dose de 40ml.' },
      { nome: 'Supremo Cremoso', preco: 25.00, descricao: 'Vodka, limão, leite condensado, leite em pó e gelo.' },
      { nome: 'Supremo Tropical', preco: 25.00, descricao: 'Vodka, suco de laranja, frutas vermelhas, açúcar e gelo.' },
      { nome: 'Taça de Espumante', preco: 20.00, descricao: 'Taça de espumante.' },
      { nome: 'Taça de Vinho Pérgola Seco', preco: 12.00, descricao: 'Taça de vinho Pérgola seco.' },
      { nome: 'Vinho El Viajero', preco: 35.00, descricao: 'Vinho El Viajero.' },
      { nome: 'Whisky Old Parr Dose 40ml', preco: 26.00, descricao: 'Dose de 40ml.' }
    ]
  },
  {
    categoria: 'Cervejas',
    produtos: [
      { nome: 'Amstel 600ml', preco: 14.00, descricao: 'Delivery apenas se tiver o casco!', foto: '/img/produtos/amstel.jpg' },
      { nome: 'Brahma Chopp 600ml', preco: 14.00, descricao: 'Delivery apenas se tiver o casco!', foto: '/img/produtos/brahma.jpg' },
      { nome: 'Budweiser Long Neck 330ml', preco: 12.00, descricao: 'Long neck 330ml.', foto: '/img/produtos/budweiser.jpg' },
      { nome: 'Corona Long Neck 330ml', preco: 12.00, descricao: 'Long neck 330ml.', foto: '/img/produtos/corona.jpg' },
      { nome: 'Heineken 600ml', preco: 18.00, descricao: 'Delivery apenas se tiver o casco!', foto: '/img/produtos/heineken-600.jpg' },
      { nome: 'Heineken Long Neck 330ml', preco: 12.00, descricao: 'Long neck 330ml.', foto: '/img/produtos/heineken-long.jpg' },
      { nome: 'Heineken Long Neck Sem Álcool', preco: 12.00, descricao: 'Long neck sem álcool.' },
      { nome: 'Ice Smirnoff', preco: 12.00, descricao: 'Smirnoff Ice.', foto: '/img/produtos/ice-smirnoff.jpg' }
    ]
  },
  {
    categoria: 'Energéticos',
    produtos: [
      { nome: 'Red Bull 250ml', preco: 15.00, descricao: 'Energético Red Bull 250ml.', foto: '/img/produtos/red-bull.jpg' }
    ]
  },
  {
    categoria: 'Adicionais',
    produtos: [
      { nome: 'Azeitona Adicional', preco: 2.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Bacon Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Banana da Terra Adicional', preco: 3.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Barbecue Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Calabresa Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.', foto: '/img/produtos/calabresa.jpg' },
      { nome: 'Carne Moída Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Carne Seca Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Catupiry Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Cebola Adicional', preco: 2.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Cheddar Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Embalagem', preco: 1.00, descricao: 'Embalagem para viagem.' },
      { nome: 'Embalagem Garrafa', preco: 2.00, descricao: 'Embalagem para garrafa.' },
      { nome: 'Frango Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Leite em Pó Adicional', preco: 3.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Maionese Extra', preco: 4.00, descricao: 'Copo de 50ml.', foto: '/img/produtos/maionese.jpg' },
      { nome: 'Melaço Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Mentos Turbo 50 Un', preco: 15.00, descricao: 'Mentos turbo com 50 unidades.' },
      { nome: 'Milho Verde Adicional', preco: 2.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Porção Extra Camarão', preco: 29.99, descricao: 'Porção de camarão, aproximadamente 150g.' },
      { nome: 'Porção Extra Carne do Sol', preco: 29.99, descricao: 'Porção de carne do sol, aproximadamente 200g.' },
      { nome: 'Presunto Adicional', preco: 3.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Queijo Adicional', preco: 4.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Queijo Coalho Adicional', preco: 6.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Sumo de Limão', preco: 2.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Tomate Adicional', preco: 2.00, descricao: 'Adicional para o seu pedido.' },
      { nome: 'Uva Passa Adicional', preco: 3.00, descricao: 'Adicional para o seu pedido.' }
    ]
  }
];

// Um único lote de comandos (rápido no banco na nuvem). IDs calculados aqui.
async function seedMenuIfEmpty() {
  if (await getSetting('menu_seeded')) return false;
  const count = (await db.prepare('SELECT COUNT(*) n FROM products').get()).n;
  if (count > 0) { await setSetting('menu_seeded', true); return false; }
  const next = async (t) => ((await db.prepare(`SELECT COALESCE(MAX(id),0) m FROM ${t}`).get()).m) + 1;
  let gid = await next('addon_groups'); let aid = await next('addons'); let cid = await next('categories'); let pid = await next('products');
  const st = [];
  const add = (sql, ...args) => st.push({ sql, args });
  const grupoLista = (nome, min, max, itens) => {
    const id = gid++;
    add('INSERT INTO addon_groups (id, name, min_select, max_select) VALUES (?,?,?,?)', id, nome, min, max);
    itens.forEach((it, i) => { const [n, pr] = Array.isArray(it) ? it : [it, 0];
      add('INSERT INTO addons (id, group_id, name, price, sort) VALUES (?,?,?,?,?)', aid++, id, n, R(pr), i); });
    return id;
  };
  const simNao = (nome) => grupoLista(nome, 1, 1, ['Sim', 'Não']);
  const sachesId = simNao(SACHES);
  const acaiSabor = grupoLista('Qual sabor?', 1, 2, ACAI_SABORES);
  const acaiCompl = { 3: grupoLista('Quais complementos? (até 3)', 1, 3, ACAI_COMPLEMENTOS), 4: grupoLista('Quais complementos? (até 4)', 1, 4, ACAI_COMPLEMENTOS) };
  const acaiExtras = grupoLista('Complementos extras?', 0, 0, ACAI_EXTRAS);
  const colherId = simNao('Deseja colher?');
  const caldoSabor = grupoLista('Qual o sabor do seu caldo?', 0, 1, ['Camarão', 'Caldo Verde', 'Sururu']);
  const talherId = simNao('Deseja talher?');
  CARDAPIO.forEach((c, ci) => {
    const cat = cid++;
    add('INSERT INTO categories (id, name, sort) VALUES (?,?,?)', cat, c.categoria, ci);
    c.produtos.forEach((p, pi) => {
      const id = pid++;
      add(`INSERT INTO products (id, category_id, name, description, image, price, featured, sort) VALUES (?,?,?,?,?,?,?,?)`,
        id, cat, p.nome, p.descricao || '', p.foto || null, R(p.preco), p.destaque ? 1 : 0, pi);
      const groups = [];
      if (p.saches) groups.push(sachesId);
      if (p.talher) groups.push(talherId);
      if (p.caldo) groups.push(caldoSabor, colherId);
      if (p.acai) groups.push(acaiSabor, acaiCompl[p.acai], acaiExtras, colherId);
      for (const g of groups) add('INSERT INTO product_addon_groups VALUES (?,?)', id, g);
    });
  });
  add("INSERT INTO settings (key, value) VALUES ('menu_seeded', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  await db.batch(st);
  return true;
}

module.exports = { seedMenuIfEmpty, CARDAPIO };
