// Função da Vercel: todas as rotas /api/* são atendidas pelo servidor Express.
// Se o servidor não conseguir iniciar, responde com o motivo (sem dados sensíveis) para facilitar o diagnóstico.
let app = null;
let loadError = null;
try {
  app = require('../server/index.js');
} catch (e) {
  loadError = e;
  console.error('Falha ao iniciar o servidor:', e);
}
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

module.exports = (req, res) => {
  if (app) return app(req, res);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: false,
    erro: 'O servidor não iniciou',
    detalhe: String(loadError && loadError.message || loadError).slice(0, 500),
    codigo: loadError && loadError.code,
    node: process.version
  }));
};
