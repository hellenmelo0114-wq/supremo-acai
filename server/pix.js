// Geração de "PIX Copia e Cola" (BR Code estático, padrão EMV do Banco Central).
// O código estático NÃO confirma pagamento: a confirmação é feita pelo provedor
// (Mercado Pago, quando configurado) ou conferida manualmente no painel.

function clean(s, max) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-@+_]/g, '')
    .toUpperCase().trim().slice(0, max);
}
function field(id, value) {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
}
function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function normalizeKey(key, type) {
  let k = String(key || '').trim();
  if (type === 'phone') {
    const digits = k.replace(/\D/g, '');
    k = '+' + (digits.startsWith('55') ? digits : '55' + digits);
  } else if (type === 'cpf' || type === 'cnpj') {
    k = k.replace(/\D/g, '');
  } else if (type === 'email') {
    k = k.toLowerCase();
  }
  return k;
}

/**
 * @param {object} o { key, keyType, name, city, amountCents, txid, description }
 */
function buildPixPayload(o) {
  const key = normalizeKey(o.key, o.keyType);
  if (!key) throw new Error('Chave PIX não configurada');
  let mai = field('00', 'br.gov.bcb.pix') + field('01', key);
  if (o.description) mai += field('02', clean(o.description, 40));
  const txid = (String(o.txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***';
  let p = field('00', '01')
    + field('26', mai)
    + field('52', '0000')
    + field('53', '986');
  if (o.amountCents && o.amountCents > 0) p += field('54', (o.amountCents / 100).toFixed(2));
  p += field('58', 'BR')
    + field('59', clean(o.name, 25) || 'SUPREMO ACAI')
    + field('60', clean(o.city, 15) || 'MADRE DE DEUS')
    + field('62', field('05', txid))
    + '6304';
  return p + crc16(p);
}

module.exports = { buildPixPayload, crc16 };
